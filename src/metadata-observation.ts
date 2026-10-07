// Opt-in, metadata-only observation for the exact qualified Codex store below.
// No transcript, native client, warming, migration or receipt bootstrap is used.
import childProcess, { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const METADATA_SOURCE = Object.freeze({ version: '0.160.1',
  commit: 'd27764b82f7118f674371e6d6e76271d9d606edb',
  database: 'thread_history_1.sqlite', recentUsers: 256, maxCellBytes: 256 * 1024, childMs: 1000 });
export type MetadataScope = Readonly<{ home: string; threadId: string; generation: string | null }>;
export type MetadataBudget = { observationRemainingMs(): number };
// The caller owns any resources used by this verifier and must honor its signal.
// A true result proves the ORIGINAL generation, rather than selecting a new one.
export type VerifyMetadataOwner = (scope: MetadataScope, signal: AbortSignal) => boolean | Promise<boolean>;
export type MetadataReason = 'metadata_version_unsupported' | 'metadata_platform_unsupported' |
  'metadata_scope_invalid' | 'metadata_storage_untrusted' | 'metadata_history_unavailable' |
  'metadata_schema_unsupported' | 'metadata_owner_changed' | 'metadata_deadline' |
  'metadata_probe_failed' | 'metadata_probe_stopped' | 'metadata_ambiguous';
export type MetadataCapability = { supported: boolean; reason?: MetadataReason };
export type MetadataObservation = MetadataCapability & { injectionObserved: boolean; clientUserMessageId?: string;
  turn?: { id: string; status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' } };
type Stamp = { path: string; dev: number; ino: number };
type ProbeRequest = { mode: 'capability' | 'observe'; database: string; threadId: string; clientUserMessageId?: string };
const reasons: readonly MetadataReason[] = ['metadata_version_unsupported', 'metadata_platform_unsupported',
  'metadata_scope_invalid', 'metadata_storage_untrusted', 'metadata_history_unavailable', 'metadata_schema_unsupported',
  'metadata_owner_changed', 'metadata_deadline', 'metadata_probe_failed', 'metadata_probe_stopped', 'metadata_ambiguous'];
const safe = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 &&
  Buffer.byteLength(value) <= limit && !/[\x00-\x1f\x7f-\x9f]/.test(value) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const uuid = (value: string) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const unsupported = (reason: MetadataReason): MetadataObservation => ({ supported: false, injectionObserved: false, reason });
function remaining(budget?: MetadataBudget): number {
  const value = budget?.observationRemainingMs() ?? 3000;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function trusted(scope: MetadataScope): Stamp[] {
  const uid = process.getuid?.();
  if (uid === undefined || !isAbsolute(scope.home) || resolve(scope.home) !== scope.home ||
      realpathSync(scope.home) !== scope.home) throw new Error();
  const home = lstatSync(scope.home);
  if (!home.isDirectory() || home.isSymbolicLink() || home.uid !== uid || (home.mode & 0o022)) throw new Error();
  const database = join(scope.home, METADATA_SOURCE.database);
  const stamps: Stamp[] = [];
  for (const path of [database, database + '-wal', database + '-shm', database + '-journal']) {
    let info;
    try { info = lstatSync(path); } catch (error) {
      if (path !== database && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== uid || info.nlink !== 1 || (info.mode & 0o022)) throw new Error();
    // A rollback journal can require recovery. Never let this reader recover it.
    if (path.endsWith('-journal')) throw new Error();
    stamps.push({ path, dev: info.dev, ino: info.ino });
  }
  // Read-only WAL access requires a pre-existing shared-memory sidecar. SQLite
  // may participate in transient SHM reader locks; it cannot create sidecars here.
  if (stamps.some(item => item.path.endsWith('-wal')) !== stamps.some(item => item.path.endsWith('-shm'))) throw new Error();
  return stamps;
}
function sameFiles(before: Stamp[], after: Stamp[]): boolean {
  return before.length === after.length && before.every((item, i) => item.path === after[i]?.path &&
    item.dev === after[i]?.dev && item.ino === after[i]?.ino);
}
async function owner(scope: MetadataScope, verify: VerifyMetadataOwner, budget?: MetadataBudget): Promise<boolean> {
  const duration = Math.min(METADATA_SOURCE.childMs, remaining(budget));
  if (duration < 1) return false;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => verify(scope, controller.signal)).then(value => value === true),
      new Promise<false>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, duration); })]);
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
function probe(request: ProbeRequest, budget?: MetadataBudget): Promise<MetadataObservation> {
  const duration = Math.min(METADATA_SOURCE.childMs, remaining(budget));
  if (duration < 1) return Promise.resolve(unsupported('metadata_deadline'));
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const worker = fileURLToPath(new URL('./handoff-observer-probe' + extension, import.meta.url));
  return new Promise(resolve => {
    let child: ChildProcessWithoutNullStreams;
    try { child = childProcess.spawn(process.execPath, [...(extension === '.ts' ? ['--experimental-strip-types'] : []), worker], {
      detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: undefined, NODE_PATH: undefined },
    }) as ChildProcessWithoutNullStreams; } catch { resolve(unsupported('metadata_probe_failed')); return; }
    let finished = false, stopped = false, total = 0, output = '', stopReason: MetadataReason = 'metadata_probe_failed';
    let grace: ReturnType<typeof setTimeout> | undefined;
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const handlers = new Map<NodeJS.Signals, () => void>();
    const reap = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ } };
    const finish = (result: MetadataObservation) => {
      if (finished) return; finished = true; clearTimeout(timer); if (grace) clearTimeout(grace);
      for (const signal of signals) process.removeListener(signal, handlers.get(signal)!);
      resolve(result);
    };
    const stop = (reason: MetadataReason) => {
      if (stopped || finished) return; stopped = true; stopReason = reason; reap();
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      // Cleanup grace stays inside the available original observation budget.
      grace = setTimeout(() => finish(unsupported(reason)), Math.min(100, remaining(budget)));
    };
    const interrupted = (signal: NodeJS.Signals) => {
      const sole = process.listenerCount(signal) === 1; stop('metadata_probe_stopped');
      if (sole) { for (const name of signals) process.removeListener(name, handlers.get(name)!); process.kill(process.pid, signal); }
    };
    const timer = setTimeout(() => stop('metadata_deadline'), duration);
    for (const signal of signals) { const handler = () => interrupted(signal); handlers.set(signal, handler); process.on(signal, handler); }
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part: string) => { total += Buffer.byteLength(part); if (total > 4096) stop('metadata_probe_failed'); else output += part; });
    // Drain without retaining or logging SQLite/native diagnostics.
    child.stderr.on('data', (part: Buffer) => { total += part.length; if (total > 8192) stop('metadata_probe_failed'); });
    child.once('error', () => stop('metadata_probe_failed'));
    child.once('close', code => {
      if (stopped) { finish(unsupported(stopReason)); return; }
      if (code !== 0) { finish(unsupported('metadata_probe_failed')); return; }
      try {
        const value = JSON.parse(output) as MetadataObservation;
        if (!value || typeof value.supported !== 'boolean' || typeof value.injectionObserved !== 'boolean' ||
            Object.keys(value).some(key => !['supported', 'injectionObserved', 'reason', 'clientUserMessageId', 'turn'].includes(key))) throw new Error();
        if (!value.supported) {
          if (value.injectionObserved || !reasons.includes(value.reason!) || value.clientUserMessageId !== undefined || value.turn !== undefined) throw new Error();
        } else if (value.reason !== undefined) throw new Error();
        if (value.injectionObserved) {
          if (value.clientUserMessageId !== request.clientUserMessageId || !safe(value.clientUserMessageId, 128) || !value.turn ||
              Object.keys(value.turn).some(key => !['id', 'status'].includes(key)) || !safe(value.turn.id, 128) ||
              !['running', 'completed', 'failed', 'interrupted', 'unknown'].includes(value.turn.status)) throw new Error();
        } else if (value.clientUserMessageId !== undefined || value.turn !== undefined) throw new Error();
        finish(value);
      } catch { finish(unsupported('metadata_probe_failed')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
async function inspect(scope: MetadataScope, mode: ProbeRequest['mode'], budget: MetadataBudget | undefined,
  verify: VerifyMetadataOwner, clientUserMessageId?: string): Promise<MetadataObservation> {
  if (!['darwin', 'linux'].includes(process.platform) || process.getuid?.() === undefined) return unsupported('metadata_platform_unsupported');
  if (!scope || !safe(scope.home, 2048) || !safe(scope.threadId, 128) || !uuid(scope.threadId) ||
      !safe(scope.generation, 256) || (mode === 'observe' && !safe(clientUserMessageId, 128))) return unsupported('metadata_scope_invalid');
  const original = Object.freeze({ home: scope.home, threadId: scope.threadId, generation: scope.generation });
  if (remaining(budget) < 1) return unsupported('metadata_deadline');
  let before: Stamp[];
  try { before = trusted(original); } catch { return unsupported('metadata_storage_untrusted'); }
  if (!(await owner(original, verify, budget))) return unsupported(remaining(budget) < 1 ? 'metadata_deadline' : 'metadata_owner_changed');
  const result = await probe({ mode, database: join(original.home, METADATA_SOURCE.database),
    threadId: original.threadId.toLowerCase(), ...(clientUserMessageId === undefined ? {} : { clientUserMessageId }) }, budget);
  if (!result.supported) return result;
  if (!(await owner(original, verify, budget))) return unsupported(remaining(budget) < 1 ? 'metadata_deadline' : 'metadata_owner_changed');
  try { if (!sameFiles(before, trusted(original))) return unsupported('metadata_storage_untrusted'); }
  catch { return unsupported('metadata_storage_untrusted'); }
  if (remaining(budget) < 1) return unsupported('metadata_deadline');
  return result;
}
export async function metadataCapability(scope: MetadataScope, version: string, budget: MetadataBudget | undefined,
  verifyOwner: VerifyMetadataOwner): Promise<MetadataCapability> {
  if (!/^(?:codex-cli )?0\.160\.1$/.test(version)) return { supported: false, reason: 'metadata_version_unsupported' };
  const result = await inspect(scope, 'capability', budget, verifyOwner);
  return { supported: result.supported, ...(result.reason === undefined ? {} : { reason: result.reason }) };
}
export function observeMetadata(scope: MetadataScope & { clientUserMessageId: string }, budget: MetadataBudget,
  verifyOwner: VerifyMetadataOwner): Promise<MetadataObservation> {
  return inspect(scope, 'observe', budget, verifyOwner, scope.clientUserMessageId);
}
