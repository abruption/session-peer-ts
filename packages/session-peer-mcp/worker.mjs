import { spawn } from 'node:child_process';

export const WORKER_LIMIT = 512 * 1024;
export const DEFAULT_TIMEOUT_MS = 110_000;
const cancelGraceMs = 750;

function workerEnvironment() {
  const env = { ...process.env };
  const omitted = new Set(['CLAUDE_CODE_MESSAGING_SOCKET', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID',
    'NODE_OPTIONS', 'NODE_PATH', 'SESSION_PEER_UPDATE_NOTICE', 'SESSION_PEER_REPLY_HOST', 'CC_PEER_REPLY_HOST']);
  for (const key of Object.keys(env)) if (omitted.has(key.toUpperCase())) delete env[key];
  env.SESSION_PEER_MCP_WORKER = '1';
  return env;
}

function unknown(command, reason, launched, effectful) {
  const uncertain = launched && effectful;
  return { schemaVersion: 1, command, ok: false, submitted: uncertain ? null : false,
    status: uncertain ? 'unknown' : 'refused', retryAllowed: false, consumptionConfirmed: false, error: reason };
}

function parseOutcome(stdout, command, exitCode) {
  if (![0, 1, 2].includes(exitCode)) return undefined;
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout)); }
  catch { return undefined; }
  if (result?.schemaVersion !== 1 || result.command !== command || typeof result.ok !== 'boolean' ||
      Array.isArray(result)) return undefined;
  if (command === 'list' && result.ok && !Array.isArray(result.sessions)) return undefined;
  if (command === 'send' && (!['posted', 'queued', 'validated', 'refused', 'unknown'].includes(result.status) ||
      result.consumptionConfirmed !== false ||
      result.submitted !== ({ posted: true, queued: true, validated: false, refused: false, unknown: null })[result.status])) return undefined;
  return result;
}

export async function runWorker({ cli, operation, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const { route, agent, command } = operation;
  const effectful = command === 'send' && !operation.dryRun;
  if (signal?.aborted) return unknown(command, 'cancelled', false, effectful);

  const args = [cli, command, '--json', '--no-update-notice'];
  if (route.transport === 'ssh') {
    args.push('--host=' + route.host);
    if (route.remotePlatform === 'win32') args.push('--remote-platform=win32');
  }
  if (agent === 'codex') args.push('--codex-home=' + route.codexHome);
  if (command === 'list') args.push('--agent=' + agent, ...(operation.all ? ['--all'] : []));
  else args.push('--to=' + operation.to, '--no-from', '--no-reply-to', ...(operation.dryRun ? ['--dry-run'] : []));

  return new Promise(resolve => {
    let child;
    try {
      child = spawn(process.execPath, args, { env: workerEnvironment(), shell: false,
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    } catch { resolve(unknown(command, 'worker_unavailable', false, effectful)); return; }
    // A returned PID is enough to make a send conservative from this point.
    const launched = child.pid !== undefined;
    let stopReason, forceTimer, completionTimer, finished = false, total = 0;
    const chunks = [];
    const finish = exitCode => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline); clearTimeout(forceTimer); clearTimeout(completionTimer);
      signal?.removeEventListener('abort', abort);
      if (child.connected) child.disconnect();
      const complete = !stopReason && parseOutcome(Buffer.concat(chunks, total), command, exitCode);
      resolve(complete || unknown(command, stopReason ?? 'worker_response_unverified', launched, effectful));
    };
    const stop = reason => {
      if (finished || stopReason) return;
      stopReason = reason;
      child.stdin.destroy();
      if (child.connected) child.send('session-peer:cancel', () => {});
      else if (process.platform !== 'win32' && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        child.stdout.destroy(); child.stderr.destroy();
        completionTimer = setTimeout(() => finish(null), 100);
      }, cancelGraceMs);
    };
    const abort = () => stop('cancelled');
    const deadline = setTimeout(() => stop('worker_timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', part => {
      if (stopReason) return;
      if (total + part.length > WORKER_LIMIT) { stop('worker_output_limit'); return; }
      total += part.length;
      chunks.push(part);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => stop('worker_unavailable'));
    child.on('close', finish);
    if (signal?.aborted) abort();
    else child.stdin.end(command === 'send' ? operation.message : undefined);
  });
}
