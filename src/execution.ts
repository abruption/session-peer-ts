import { hostname } from 'node:os';
import { doctor } from './diagnostics.js';
import { listing, Refusal } from './discovery.js';
import { HandoffBudget, parseWaitTimeout, type Handoff } from './handoff.js';
import { executable, run, UnknownOutcome, type Done } from './process.js';
import { host, VERSION_LINE } from './protocol.js';
import { route, type Tailnet } from './replies.js';
import { send, CodexUnknownOutcome, type SendOptions } from './send.js';
import { responseOutcome } from './ssh-response.js';
import { jumpOptions, sshConfig, type SshJump, type SshOptions, type sshUser } from './ssh.js';
import { UpdateRefusal } from './updates.js';
import { HomeRefusal } from './writer.js';

export type ParsedOptions = { command: 'list' | 'send' | 'doctor' | 'update'; values: Map<string, string>; flags: Set<string>; hosts: string[]; ssh: SshOptions; jump?: SshJump;
  address?: { uri: string; transport: 'local' | 'ssh'; implicit: boolean } };

export type Agent = 'claude' | 'codex';
type AgentSelection = { agent?: Agent; home?: string };
export type LocalOperation =
  | (AgentSelection & { command: 'list'; all: boolean })
  | (AgentSelection & { command: 'doctor'; binary?: string })
  | { command: 'send'; settings: SendOptions };

// These adapters are the existing guarded implementations. This injection
// seam is internal and lets tests prove routing without live agent effects.
type LocalAdapters = {
  list: typeof listing;
  doctor: typeof doctor;
  send: typeof send;
};
const localAdapters: LocalAdapters = { list: listing, doctor, send };

export async function executeLocal(operation: LocalOperation, adapters = localAdapters): Promise<Record<string, unknown>> {
  switch (operation.command) {
    case 'list':
      return adapters.list(operation.agent, operation.home, operation.all);
    case 'doctor':
      return adapters.doctor(operation.agent, operation.home, operation.binary);
    case 'send':
      return adapters.send(operation.settings);
  }
}

type SshOperation = {
  options: ParsedOptions;
  context: { tailnet?: Tailnet; returnTo?: string; budget?: HandoffBudget };
  message?: string;
};

export async function executeSsh({ options, context, message }: SshOperation) {
  return remotes(options, context.tailnet, message, context.returnTo, context.budget);
}

const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
// Classify only the no-message version preflight. Never expose SSH stderr,
// which can contain user paths or agent output.
export function sshPreflightFailure(result: Done, expected: string): string | undefined {
  if (result.interrupted) return 'ssh_preflight_timeout';
  if (!result.spawned) return 'ssh_unavailable';
  // A verified version is success even when login scripts write to stderr.
  if (result.code === 0 && result.stdout.trim() === expected) return undefined;
  const detail = result.stderr;
  if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|no [^\n]*host key is known/i.test(detail))
    return 'ssh_host_key_untrusted';
  if (/permission denied \(|authentication failed|too many authentication failures|tailnet policy does not permit/i.test(detail))
    return 'ssh_authentication_refused';
  if (/could not resolve hostname|name or service not known|network is unreachable|no route to host|connection timed out|connection refused|operation timed out/i.test(detail))
    return 'ssh_unreachable';
  if (result.code === 127 && /not found|no such file|not recognized/i.test(detail))
    return 'remote_cli_missing';
  if (result.code === 0 && result.stdout.trim() !== expected) return 'remote_version_mismatch';
  if (result.code !== 0) return 'ssh_preflight_failed';
  return undefined;
}
async function remote(options: ParsedOptions, ssh: string, target: string, resolved: { canonical: string; options: string[] }, message?: string, returnTo?: string, budget?: HandoffBudget): Promise<{ value: Record<string, unknown>; exitCode: number }> {
  const { values, flags, command } = options;
  const binary = values.get('--remote-bin') ?? 'session-peer';
  const windows = values.get('--remote-platform') === 'win32';
  const invoke = (flag: string) => {
    if (!windows) return `${quote(binary)} ${flag}`;
    // PowerShell also closes single-quoted strings on U+2018-U+201B.
    // PowerShell otherwise maps every native nonzero exit to 1. A failed
    // invocation has no native exit code and must not accidentally exit 0.
    const code = `& '${binary.replace(/['\u2018-\u201b]/g, '$&$&')}' ${flag}; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE`;
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(code, 'utf16le').toString('base64')}`;
  };
  // OpenSSH keeps the first value obtained, so the fixed hardening options
  // precede the allowlisted user options and cannot be overridden by them.
  const base = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    ...(options.jump ? jumpOptions(ssh, options.jump) : []),
    ...(values.has('--ssh-control-path') ? ['-S', values.get('--ssh-control-path')!] : []), ...resolved.options, ...options.ssh.args, '--', target];
  budget?.beforeEffect();
  const preflight = await run(ssh, [...base, invoke('--version')], { timeout: budget ? Math.max(1, Math.min(15000, budget.observationRemainingMs())) : 15000 });
  const preflightError = sshPreflightFailure(preflight, VERSION_LINE);
  if (preflightError) throw new Refusal(preflightError, 1);
  const args = [command, '--json'];
  for (const [key, value] of values) if (['--agent', '--codex-home', '--codex-bin', '--to'].includes(key)) args.push(key, value);
  if (flags.has('--all')) args.push('--all');
  if (flags.has('--dry-run')) args.push('--dry-run');
  if (flags.has('--allow-inactive-codex-home')) args.push('--allow-inactive-codex-home');
  if (command === 'send') args.push(`--message=${message!}`, '--no-from', '--no-reply-to');
  // The destination probes back to this machine; the request carries only the host.
  if (returnTo) args.push('--return-route-host', returnTo);
  const context = budget ? { correlationId: values.get('--correlation-id'), requestAck: flags.has('--request-ack'),
    observeDelivery: flags.has('--observe-delivery'), waitFor: values.get('--wait-for') as 'delivered' | 'acknowledged' | undefined } : undefined;
  if (context) {
    for (const key of ['--correlation-id', '--wait-for', '--wait-timeout']) if (values.has(key)) args.push(key, values.get(key)!);
    for (const key of ['--request-ack', '--observe-delivery']) if (flags.has(key)) args.push(key);
  }
  const execute = (requestArgs: string[], preparation = false) => {
    budget?.beforeEffect();
    const remainingMs = budget ? Math.floor(budget.remainingMs()) : undefined;
    if (remainingMs !== undefined && (remainingMs < 1 || remainingMs > 60000)) throw new Refusal('invalid_handoff_budget', 1);
    return run(ssh, [...base, invoke(`--stdio-request${remainingMs === undefined ? '' : ` --handoff-remaining-ms=${remainingMs}`}`)], {
      timeout: budget ? Math.max(1, budget.remainingMs() - 200) : 90000, rawStdout: true,
      input: JSON.stringify({ schemaVersion: 1, args: requestArgs,
        ...(remainingMs !== undefined ? { handoff: { schemaVersion: 1, remainingMs, ...(preparation ? { preparation: true } : {}) } } : {}) })
    });
  };
  let prepared: Pick<Handoff, 'correlationId' | 'ledgerEpoch' | 'targetGeneration'> | undefined;
  let destinationHost: string | undefined;
  let boundTo = values.get('--to'), boundHome = values.get('--codex-home');
  if (budget) {
    // This round reserves a destination-owned intent and performs zero native
    // submissions. An incomplete response is never replayed or guessed into send.
    const preparation = await execute(args, true);
    let checked: ReturnType<typeof responseOutcome>;
    try { checked = responseOutcome(preparation, { command, to: boundTo, home: boundHome, dryRun: true,
      allowInactive: flags.has('--allow-inactive-codex-home'), handoff: { ...context, preparation: true } }); }
    catch { throw new Refusal('remote_preparation_unverified', 1); }
    if (checked.value.ok === true && checked.exitCode !== 0) throw new Refusal('remote_preparation_unverified', 1);
    if (checked.exitCode !== 0 || checked.value.ok !== true) return { value: { ...checked.value, host: resolved.canonical, sshHost: target }, exitCode: checked.exitCode || 1 };
    const h = checked.value.handoff as Handoff | undefined;
    if (!h) throw new Refusal('remote_preparation_unverified', 1);
    prepared = { correlationId: h.correlationId, ledgerEpoch: h.ledgerEpoch, targetGeneration: h.targetGeneration };
    destinationHost = checked.value.host as string;
    const nativeTarget = checked.value.target as { id?: string; pid?: number };
    boundTo = boundTo!.startsWith('codex:') ? `codex:${nativeTarget.id!}` : `claude:${nativeTarget.pid!}`;
    if (boundTo.startsWith('codex:')) boundHome = checked.value.codexHome as string;
    const replace = (key: string, value: string) => { const index = args.indexOf(key); if (index >= 0) args[index + 1] = value; else args.push(key, value); };
    replace('--to', boundTo); replace('--correlation-id', h.correlationId);
    if (boundHome !== undefined) replace('--codex-home', boundHome);
  }
  const done = await execute(args);
  const uncertain = () => { if (command === 'send' && !flags.has('--dry-run') && done.spawned) throw new UnknownOutcome(); throw new Refusal('remote_response_unverified', 1); };
  let verified: ReturnType<typeof responseOutcome>;
  try { verified = responseOutcome(done, { command, to: boundTo, dryRun: flags.has('--dry-run'), returnTo,
    home: boundHome, allowInactive: flags.has('--allow-inactive-codex-home'), ...(context ? { handoff: { ...context, correlationId: prepared!.correlationId, prepared, destinationHost } } : {}) }); }
  catch { return uncertain(); }
  const { value } = verified;
  // `clientUpdate` is client-local: a remote-supplied value is never trusted or shown.
  delete value.clientUpdate;
  return { value: { ...value, host: resolved.canonical, sshHost: target }, exitCode: verified.exitCode };
}
export function failure(error: unknown, command: string, where: string): { value: Record<string, unknown>; exitCode: number } {
  const unknown = error instanceof UnknownOutcome;
  const refusal = error instanceof Refusal ? error : new Refusal('operation_failed', 1);
  const homeResolution = error instanceof HomeRefusal || error instanceof CodexUnknownOutcome ? error.codexHomeResolution : undefined;
  return { exitCode: unknown ? 1 : refusal.exitCode, value: { schemaVersion: 1, host: where, command, ok: false,
    error: unknown ? 'outcome_unknown' : refusal.code, status: unknown ? 'unknown' : 'refused',
    submitted: unknown ? null : false, consumptionConfirmed: false, retryAllowed: false,
    ...(homeResolution === undefined ? {} : { codexHomeResolution: homeResolution }),
    ...(error instanceof UpdateRefusal ? error.guidance : {}) } };
}
// Destinations run in order, one attempt each. A failure or unknown outcome is
// reported for that destination only; it is never retried or failed over.
async function remotes(options: ParsedOptions, status: Tailnet | undefined, message?: string, returnTo?: string, firstBudget?: HandoffBudget): Promise<{ value: Record<string, unknown>[]; exitCode: number }> {
  const ssh = executable('ssh'), results: Record<string, unknown>[] = [];
  let exitCode = 0;
  for (const requestedHost of options.hosts) {
    const target = host(requestedHost);
    let outcome: { value: Record<string, unknown>; exitCode: number }, user: Partial<Awaited<ReturnType<typeof sshUser>>> = {}, canonical = target;
    try {
      const budget = firstBudget ? results.length === 0 ? firstBudget : new HandoffBudget(parseWaitTimeout(options.values.get('--wait-timeout') ?? '30')) : undefined;
      budget?.beforeEffect();
      // A known offline or ambiguous tailnet peer is refused before any SSH process.
      const resolved = route(target, status); canonical = resolved.canonical;
      const hostName = resolved.hostName ? ['-o', `HostName=${resolved.hostName}`] : [];
      // One `ssh -G` serves the user metadata and, for a resolved peer, shows
      // whether ssh_config already pins a HostKeyAlias. Ours is added only when
      // the configuration was read and has none; an unread one is never overridden.
      let alias: string[] = [];
      try {
        const config = await sshConfig(ssh, target, { ...options.ssh, args: [...hostName, ...options.ssh.args] }, !!resolved.hostName);
        user = config.user;
        if (resolved.hostKeyAlias && config.read && !config.hostKeyAlias) alias = ['-o', `HostKeyAlias=${resolved.hostKeyAlias}`];
      } catch { user = { sshUser: null, sshUserSource: 'unknown' }; }
      // Metadata never blocks or aborts a destination; earlier results are kept.
      outcome = await remote(options, ssh, target, { canonical, options: [...hostName, ...alias] }, message, returnTo, budget);
    }
    // One destination keeps the existing flat local-host failure shape.
    catch (error) { outcome = failure(error, options.command, options.hosts.length === 1 ? hostname() : canonical !== target ? canonical : requestedHost); }
    results.push({ ...outcome.value, ...(options.hosts.length > 1 && canonical === target ? { host: requestedHost } : {}), sshHost: target, ...user,
      ...(options.jump ? { sshJump: options.jump.spec } : {}) });
    exitCode = options.hosts.length === 1 ? outcome.exitCode : outcome.exitCode === 0 && exitCode === 0 ? 0 : 1;
  }
  return { value: results, exitCode };
}
