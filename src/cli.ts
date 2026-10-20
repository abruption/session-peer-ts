#!/usr/bin/env node
import { handoffCommand, handoffSend, prepareHandoff, privateMessage } from './handoff-operations.js';
import { canonicalId, closed, HANDOFF_LIMITS, HandoffBudget, parseStrictJson, parseWaitTimeout, safeInteger, systemClock, type Handoff } from './handoff.js';
import { doctor } from './diagnostics.js';
import { help } from './help.js';
import { renderOutput, type OutputFormat } from './output.js';
import { hostname } from 'node:os';
import { lstatSync } from 'node:fs';
import { listing, Refusal } from './discovery.js';
import { executable, run, UnknownOutcome, type Done } from './process.js';
import { checkMessage, send, CodexUnknownOutcome } from './send.js';
import { HomeRefusal } from './writer.js';
import { responseOutcome } from './ssh-response.js';
import { envelope, host, reply, VERSION, VERSION_LINE } from './protocol.js';
import { CHANNELS, checkUpdate, noticeText, refreshCache, refuseSelfUpdate, REFRESH_ARG, updateNotice, UpdateRefusal } from './updates.js';
import { jumpOptions, sshConfig, sshJump, sshOptions, sshUser, type SshJump, type SshOptions } from './ssh.js';
import { configuredHost, detectedHost, isSelf, probeReturnRoute, unsafeReturnHost, replyUri, returnHost, route, sender, tailnet, type Tailnet } from './replies.js';

type Options = { command: 'list' | 'send' | 'doctor' | 'update'; values: Map<string, string>; flags: Set<string>; hosts: string[]; ssh: SshOptions; jump?: SshJump;
  address?: { uri: string; transport: 'local' | 'ssh'; implicit: boolean } };
const FLAGS = ['--json', '--all', '--dry-run', '--no-from', '--no-reply-to', '--no-update-notice', '--allow-inactive-codex-home', '--check-return-route', '--check', '--request-ack', '--observe-delivery'];
const VALUES = ['--agent', '--codex-home', '--codex-bin', '--output-format', '--to', '--message', '-m', '--host', '--remote-bin', '--remote-platform', '--ssh-control-path', '--reply-address', '--ssh-opt', '--ssh-jump', '--reply-to', '--return-route-host', '--channel', '--correlation-id', '--wait-for', '--wait-timeout', '--message-file'];
// Repeated in order; every other value option is single.
const REPEATED = ['--host', '--ssh-opt'];
// Requested destinations, so a command-wide refusal can be attributed to each.
let requested: string[] = [];
export function parse(args: string[]): Options {
  const command = args[0];
  if (command !== 'list' && command !== 'send' && command !== 'doctor' && command !== 'update') throw new Refusal('unsupported_command');
  // Collect requested hosts before any other validation, so that even a syntax
  // refusal with several --host values is attributed to each of them. Value
  // options consume their next token, as in the loop below; `--` ends options.
  requested = [];
  for (let i = 1; i < args.length && args[i] !== '--'; i++) {
    const token = args[i]!, key = token.split('=')[0]!;
    if (key === '--host') { const value = token.includes('=') ? token.slice(7) : args[++i]; if (value !== undefined) requested.push(value); }
    else if (VALUES.includes(key) && !token.includes('=')) i++;
  }
  let address: Options['address'];
  const values = new Map<string, string>(), flags = new Set<string>(), repeated = new Map<string, string[]>(REPEATED.map(k => [k, []]));
  let positional: string | undefined;
  let terminated = false;
  for (let i = 1; i < args.length; i++) {
    const token = args[i]!;
    if (token === '--' && !terminated) { terminated = true; continue; }
    if (terminated || !token.startsWith('-') || token === '-') {
      if (command !== 'send' || positional !== undefined) throw new Refusal('invalid_positional_message');
      positional = token; continue;
    }
    const split = token.indexOf('=');
    const key = split > 0 ? token.slice(0, split) : token;
    if (FLAGS.includes(key)) {
      if (flags.has(key) || split > 0) throw new Refusal('invalid_option');
      flags.add(key);
    } else if (VALUES.includes(key)) {
      const name = key === '-m' ? '--message' : key;
      const value = split > 0 ? token.slice(split + 1) : args[++i];
      // A separate value that is itself an option name is a missing value, as in
      // argparse; `--message=--dry-run` or stdin still send such text literally.
      const option = split > 0 ? '' : (value ?? '').split('=')[0]!;
      if (value === undefined || values.has(name) || [...FLAGS, ...VALUES, '--help', '-h', '--version', '--stdio-request'].includes(option)) throw new Refusal('invalid_option');
      if (REPEATED.includes(name)) repeated.get(name)!.push(value); else values.set(name, value);
    } else throw new Refusal('unsupported_option');
  }
  let hosts = repeated.get('--host')!;
  if (positional !== undefined) {
    if (values.has('--message')) throw new Refusal('conflicting_message_sources');
    values.set('--message', positional);
  }
  if (values.has('--output-format') && !['json', 'text'].includes(values.get('--output-format')!)) throw new Refusal('unsupported_output_format');
  if (flags.has('--json') && values.get('--output-format') === 'text') throw new Refusal('conflicting_output_options');
  if (!flags.has('--json') && !values.has('--output-format')) throw new Refusal('json_output_required');
  const handoff = flags.has('--request-ack') || flags.has('--observe-delivery') || values.has('--correlation-id') || values.has('--wait-for') || values.has('--wait-timeout');
  if (handoff) {
    if (command !== 'send') throw new Refusal('inapplicable_option');
    if (values.has('--correlation-id') && !canonicalId(values.get('--correlation-id'))) throw new Refusal('invalid_correlation_id');
    if (values.has('--wait-for') && !['delivered', 'acknowledged'].includes(values.get('--wait-for')!)) throw new Refusal('invalid_wait_for');
    if (values.has('--wait-timeout')) {
      parseWaitTimeout(values.get('--wait-timeout')!);
      if (!values.has('--correlation-id') && !values.has('--wait-for') && !flags.has('--request-ack') && !flags.has('--observe-delivery')) throw new Refusal('inapplicable_wait_timeout');
    }
    if (flags.has('--dry-run') && (flags.has('--request-ack') || flags.has('--observe-delivery') || values.has('--wait-for'))) throw new Refusal('incompatible_handoff_dry_run');
  }
  if (values.has('--message-file') && (command !== 'send' || values.has('--message'))) throw new Refusal('conflicting_message_sources');
  if (command === 'update') {
    if (values.has('--channel') && !CHANNELS.includes(values.get('--channel')!)) throw new Refusal('unsupported_update_channel');
    // Local client only: remote hosts and other installations update through their own managers.
    if ([...values.keys()].some(k => !['--output-format', '--channel'].includes(k)) || [...flags].some(k => !['--json', '--check', '--no-update-notice'].includes(k))) throw new Refusal('inapplicable_option');
    if (hosts.length || repeated.get('--ssh-opt')!.length) throw new Refusal('inapplicable_option');
    return { command, values, flags, hosts: [], ssh: { args: [] } };
  }
  if (flags.has('--check') || values.has('--channel')) throw new Refusal('inapplicable_option');
  if (command === 'list' || command === 'doctor') {
    if (values.has('--agent') && !['claude', 'codex'].includes(values.get('--agent')!)) throw new Refusal('unsupported_agent');
    if (values.has('--codex-home') && !values.get('--codex-home')) throw new Refusal('invalid_codex_home');
    if (values.get('--agent') === 'claude' && values.has('--codex-home')) throw new Refusal('inapplicable_option');
    if (['--to', '--message', '--reply-address', ...(command === 'list' ? ['--codex-bin', '--reply-to', '--return-route-host'] : [])].some(k => values.has(k)) || ['--dry-run', '--no-from', '--no-reply-to', '--allow-inactive-codex-home', ...(command === 'list' ? ['--check-return-route'] : [])].some(k => flags.has(k))) throw new Refusal('inapplicable_option');
    if (command === 'doctor' && (flags.has('--all') || (values.get('--agent') === 'claude' && values.has('--codex-bin')))) throw new Refusal('inapplicable_option');
    // --reply-to names the return host to probe; the probe itself is opt-in.
    if (command === 'doctor' && ((values.has('--reply-to') && !flags.has('--check-return-route')) || (values.has('--return-route-host') && flags.has('--check-return-route')))) throw new Refusal('inapplicable_option');
    for (const key of ['--reply-to', '--return-route-host']) if (values.has(key)) returnHost(values.get(key)!);
  } else {
    if (!values.get('--to') || values.has('--agent') || flags.has('--all')) throw new Refusal('invalid_send_options');
    if (flags.has('--check-return-route') || values.has('--return-route-host')) throw new Refusal('inapplicable_option');
    if ([flags.has('--no-reply-to'), values.has('--reply-address'), values.has('--reply-to')].filter(Boolean).length > 1) throw new Refusal('conflicting_reply_options');
    if (values.has('--reply-to')) returnHost(values.get('--reply-to')!);
    if (values.get('--to')!.startsWith('session-peer:')) {
      const route = reply(values.get('--to')!);
      // Only a route taken from the URI alone may later normalize to local.
      address = { uri: values.get('--to')!, transport: route.host === undefined ? 'local' : 'ssh',
        implicit: !hosts.length && !repeated.get('--ssh-opt')!.length && !['--remote-bin', '--remote-platform', '--ssh-control-path', '--ssh-jump'].some(k => values.has(k)) };
      if (hosts.length && (hosts.length > 1 || host(hosts[0]!) !== route.host)) throw new Refusal('reply_route_conflict');
      if (route.host !== undefined) hosts = [route.host];
      if (values.has('--codex-home') && values.get('--codex-home') !== route.home) throw new Refusal('reply_route_conflict');
      if (route.home !== undefined) values.set('--codex-home', route.home);
      values.set('--to', route.to);
    }
  }
  if (handoff && hosts.length) {
    if (hosts.length > HANDOFF_LIMITS.fanout) throw new Refusal('handoff_fanout_too_large');
    if (values.has('--correlation-id') && hosts.length > 1) throw new Refusal('handoff_correlation_fanout_forbidden');
    // Owned SSH descendant cleanup has only been qualified on POSIX origins.
    if (process.platform === 'win32' || values.get('--remote-platform') === 'win32') throw new Refusal('remote_handoff_unsupported', 1);
  }
  if (command === 'send' && flags.has('--allow-inactive-codex-home')) {
    if (!values.get('--to')!.startsWith('codex:')) throw new Refusal('inapplicable_option');
    if (!values.get('--codex-home')) throw new Refusal('inactive_opt_in_requires_explicit_home');
  }
  if (values.has('--codex-home') && !values.get('--codex-home')) throw new Refusal('invalid_codex_home');
  // Validate every destination and option before any SSH process starts.
  const destinations = new Set<string>();
  for (const item of hosts) {
    const destination = host(item), at = destination.lastIndexOf('@');
    // One attempt per destination: a repeated destination is refused, not sent twice.
    const name = destination.slice(at + 1).toLowerCase(), key = destination.slice(0, at + 1) + (name.includes(':') ? new URL(`http://[${name}]`).hostname : name);
    if (destinations.has(key)) throw new Refusal('duplicate_ssh_host');
    destinations.add(key);
  }
  if (repeated.get('--ssh-opt')!.length && !hosts.length) throw new Refusal('inapplicable_option');
  const ssh = sshOptions(repeated.get('--ssh-opt')!);
  // `ssh -l` silently overrides USER@HOST, so both together are ambiguous.
  if (ssh.user !== undefined && hosts.some(item => item.includes('@'))) throw new Refusal('conflicting_ssh_user');
  let jump: SshJump | undefined;
  if (values.has('--ssh-jump')) {
    if (!hosts.length) throw new Refusal('inapplicable_option');
    jump = sshJump(values.get('--ssh-jump')!);
    // An existing control master would bypass the hop entirely.
    if (values.has('--ssh-control-path')) throw new Refusal('conflicting_ssh_jump');
    // Win32-OpenSSH starts ProxyCommand without a POSIX shell. windowsProxyCommand's
    // quoting matched an isolated no-connection 9.5p1 probe; a connected hop and
    // cleanup are unverified. Enabling also needs: an analysis of real ssh.exe not
    // exiting with pipe stdin in a non-interactive session (run() uses pipe stdin);
    // the same absolute, resolved ssh.exe from executable() as the outer binary and
    // the ProxyCommand program; owned-process-tree cleanup on Windows: run() kills
    // only the direct child, so a ProxyCommand ssh.exe may outlive a timeout, an
    // overflow or an interrupt (#131 keeps tree cleanup as an unselected candidate
    // backend, whose native tests use a PowerShell -> PING stand-in, never this
    // ssh.exe -> ProxyCommand ssh.exe shape); any such stop stays an unknown effect
    // with no resend; and the builder called here, before ssh -G.
    if (process.platform === 'win32') throw new Refusal('ssh_jump_unsupported_platform');
  }
  if (values.has('--ssh-control-path')) {
    // One control socket multiplexes one destination, never several.
    if (hosts.length !== 1) throw new Refusal('inapplicable_option');
    try { if (!lstatSync(values.get('--ssh-control-path')!).isSocket()) throw new Error('not_socket'); }
    catch { throw new Refusal('invalid_ssh_control_path'); }
  }
  if (values.has('--remote-platform') && (!hosts.length || !['posix', 'win32'].includes(values.get('--remote-platform')!))) throw new Refusal('invalid_remote_platform');
  if (values.has('--remote-bin')) {
    const binary = values.get('--remote-bin')!;
    if (!hosts.length || (values.get('--remote-platform') === 'win32' ?
      !/^[A-Za-z]:\\[^\r\n]+$/.test(binary) : !/^\/[\x20-\x7e]+$/.test(binary))) throw new Refusal('invalid_remote_bin');
  }
  return { command, values, flags, hosts, ssh, ...(jump ? { jump } : {}), ...(address ? { address } : {}) };
}
async function input(limit = 4_100_000, preserveBOM = false, timeoutMs?: number): Promise<string> {
  const chunks: Buffer[] = []; let bytes = 0;
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => process.stdin.destroy(new Refusal('deadline_before_effect', 1)), Math.max(1,timeoutMs));
  try {
    for await (const chunk of process.stdin) {
      const part = Buffer.from(chunk); bytes += part.length;
      if (bytes > limit) throw new Refusal('input_too_large'); chunks.push(part);
    }
    try { return new TextDecoder('utf-8', {fatal:true,ignoreBOM:preserveBOM}).decode(Buffer.concat(chunks)); }
    catch { throw new Refusal('invalid_utf8'); }
  } finally { if(timer) clearTimeout(timer); }
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
async function remote(options: Options, ssh: string, target: string, resolved: { canonical: string; options: string[] }, message?: string, returnTo?: string, budget?: HandoffBudget): Promise<{ value: Record<string, unknown>; exitCode: number }> {
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
function failure(error: unknown, command: string, where: string): { value: Record<string, unknown>; exitCode: number } {
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
async function remotes(options: Options, status: Tailnet | undefined, message?: string, returnTo?: string, firstBudget?: HandoffBudget): Promise<{ value: Record<string, unknown>[]; exitCode: number }> {
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

let command = 'unknown';
let format: OutputFormat = 'json';
let wire = false;
let wireWatchdog: ReturnType<typeof setTimeout> | undefined;
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor! >= 13) || major === 24)) throw new Refusal('unsupported_node_version');
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Refusal('unsupported_platform');
  let args = process.argv.slice(2);
  if (args.length === 1 && args[0] === REFRESH_ARG) await refreshCache();
  else if (args.length === 1 && args[0] === '--version') console.log(VERSION_LINE);
  else if ((args.length === 1 && ['--help', '-h'].includes(args[0]!)) ||
    (args.length === 2 && ['list', 'send', 'doctor', 'update', 'handoff', 'ack'].includes(args[0]!) && ['--help', '-h'].includes(args[1]!))) console.log(help(args.length === 2 ? args[0] : undefined));
  else if (args[0] === 'handoff' || args[0] === 'ack') {
    command = args[0];
    const operation = await handoffCommand(args, limit => input(limit, true));
    console.log(JSON.stringify({ schemaVersion: 1, host: hostname(), command, ok: operation.exitCode === 0, ...operation.value }));
    process.exitCode = operation.exitCode;
  }
  else {
    wire = args[0] === '--stdio-request';
    let wireContext: { remainingMs: number; preparation?: true } | undefined;
    let wireBudget: HandoffBudget | undefined;
    let wireRemainingMs: number | undefined;
    if (wire) {
      if (args.length !== 1) {
        if (args.length !== 2 || !/^--handoff-remaining-ms=[1-9][0-9]{0,4}$/.test(args[1]!)) throw new Refusal('invalid_remote_request');
        wireRemainingMs = Number(args[1]!.slice('--handoff-remaining-ms='.length));
        if (wireRemainingMs > 60000) throw new Refusal('invalid_remote_request');
        // Charge Node startup and imports before module execution. The same
        // duration then covers input, preparation/effect and owned cleanup.
        const wireStartedAt = systemClock.monotonic() - process.uptime() * 1000;
        wireBudget = HandoffBudget.fromRemainingMs(wireRemainingMs, systemClock, wireStartedAt);
        wireBudget.beforeEffect();
        wireWatchdog = setTimeout(() => process.kill(process.pid, 'SIGTERM'), Math.max(1, wireBudget.remainingMs()));
      }
      let request: unknown;
      let raw: string;
      try { raw = await input(4_100_000, false, wireBudget?.observationRemainingMs()); request = JSON.parse(raw); }
      catch (error) {
        if (wireBudget && error instanceof Refusal && error.code === 'deadline_before_effect') throw error;
        throw new Refusal('invalid_remote_request');
      }
      const record = request as { schemaVersion?: unknown; args?: unknown; handoff?: unknown };
      if (!record || record.schemaVersion !== 1 || !Array.isArray(record.args) || record.args.some(a => typeof a !== 'string')) throw new Refusal('invalid_remote_request');
      if (record.handoff !== undefined) {
        try {
          parseStrictJson(raw, { scope: 'outer', maxBytes: 4_100_000 });
          closed(record, ['schemaVersion', 'args', 'handoff']);
          const context = closed(record.handoff, ['schemaVersion', 'remainingMs'], ['preparation']);
          if (context.schemaVersion !== 1 || !safeInteger(context.remainingMs) || context.remainingMs < 1 || context.remainingMs > 60000 ||
              (context.preparation !== undefined && context.preparation !== true)) throw new Error('invalid');
          wireContext = { remainingMs: context.remainingMs, ...(context.preparation ? { preparation: true } : {}) };
          if (wireContext.remainingMs !== wireRemainingMs) throw new Error('duration_mismatch');
        } catch { throw new Refusal('invalid_remote_request'); }
      }
      args = record.args;
    }
    command = ['list', 'send', 'doctor', 'update'].includes(args[0] ?? '') ? args[0]! : 'unknown';
    const options = parse(args);
    const handoffEnabled = options.flags.has('--request-ack') || options.flags.has('--observe-delivery') || options.values.has('--correlation-id') || options.values.has('--wait-for') || options.values.has('--wait-timeout');
    if (wire && (handoffEnabled !== !!wireContext || handoffEnabled !== !!wireBudget)) throw new Refusal('remote_handoff_context_required', 1);
    if (wireContext && (command !== 'send' || process.platform === 'win32')) throw new Refusal('remote_handoff_unsupported', 1);
    if (wireContext && wireContext.remainingMs > parseWaitTimeout(options.values.get('--wait-timeout') ?? '30') * 1000) throw new Refusal('invalid_remote_request');
    if (wireContext && !wireContext.preparation && !options.values.has('--correlation-id')) throw new Refusal('remote_preparation_required', 1);
    const handoffBudget = handoffEnabled ? wireContext ? wireBudget : new HandoffBudget(parseWaitTimeout(options.values.get('--wait-timeout') ?? '30')) : undefined;
    if (wireContext && handoffBudget) {
      handoffBudget.beforeEffect();
      // The input-side watchdog remains installed; do not renew it here.
    }
    format = !wire && options.values.get('--output-format') === 'text' ? 'text' : 'json';
    if (wire && options.values.get('--output-format') === 'text') throw new Refusal('remote_json_required');
    if (wire && command === 'update') throw new Refusal('remote_update_unsupported');
    if (wire && (options.address || options.hosts.length || options.ssh.args.length || options.jump || options.values.has('--remote-bin') || options.values.has('--remote-platform') || options.values.has('--ssh-control-path') ||
      options.values.has('--reply-to') || options.flags.has('--check-return-route'))) throw new Refusal('nested_transport_forbidden');
    if (!wire && options.values.has('--return-route-host')) throw new Refusal('unsupported_option');
    // Tailscale status is queried at most once, and only when a route needs it.
    let status: Tailnet | undefined, queried = false;
    const tailnetStatus = async () => { if (!queried) { queried = true; status = await tailnet(); } return status; };
    let rawMessage: string | undefined;
    let message: string | undefined, routing: Record<string, unknown> = {};
    if (command === 'send') {
      if (options.values.has('--message-file')) {
        // File contents are literal, including a single dash. Only the local
        // command-line message source uses '-' as the stdin selector.
        message = privateMessage(options.values.get('--message-file')!);
      } else {
        message = options.values.get('--message');
        if (message === undefined || (!wire && message === '-')) {
          if (wire) throw new Refusal('remote_message_required');
          message = await input(4_100_000, false, handoffBudget?.observationRemainingMs());
        }
      }
      checkMessage(message); rawMessage = message;
      const noFrom = options.flags.has('--no-from'), noReply = options.flags.has('--no-reply-to');
      if (options.address) {
        const resolution: Record<string, unknown> = { uri: options.address.uri, transport: options.address.transport };
        // A reply URI naming this user on this machine is delivered locally.
        if (options.address.implicit && options.address.transport === 'ssh' && isSelf(host(options.hosts[0]!), await tailnetStatus())) {
          options.hosts = []; requested = []; Object.assign(resolution, { transport: 'local', normalizedFrom: 'ssh_self' });
        }
        routing.addressResolution = resolution;
      }
      const identity = wire || (noFrom && noReply) ? undefined : sender();
      let address = options.values.get('--reply-address');
      if (!address && !noReply && identity) {
        const configured = configuredHost(options.values.get('--reply-to'));
        let destination = configured ? route(returnHost(configured), await tailnetStatus()).canonical : undefined;
        // Sent to another machine, a loopback or non-canonical numeric reply host could name the receiver.
        if (destination && options.hosts.length && unsafeReturnHost(destination)) throw new Refusal('invalid_reply_host');
        const local = !options.hosts.length && (!destination || isSelf(destination, await tailnetStatus()));
        if (!local && !destination) {
          const detected = detectedHost(await tailnetStatus());
          try { destination = detected ? returnHost(detected) : undefined; } catch { destination = undefined; }
        }
        // Generated routes are inert data; SSH routes stay unverified until doctor probes them.
        try {
          if (local) { address = replyUri(identity); routing.replyRoute = { uri: address, transport: 'local', status: 'verified', reason: 'same_machine_route' }; }
          else if (destination) { address = replyUri(identity, destination); routing.replyRoute = { uri: address, transport: 'ssh', status: 'unverified', reason: 'reverse_ssh_not_checked' }; }
        } catch { address = undefined; delete routing.replyRoute; }
      }
      message = envelope(message, noFrom, address, identity ?? null);
      checkMessage(message, options.values.get('--to')!.startsWith('codex:'));
    }
    let returnTo: string | undefined;
    if (command === 'doctor' && options.flags.has('--check-return-route')) {
      const configured = configuredHost(options.values.get('--reply-to')) ?? detectedHost(await tailnetStatus());
      try { returnTo = configured ? returnHost(configured) : undefined; }
      catch (error) { if (options.values.has('--reply-to') || configuredHost()) throw error; }
      // A remote executor would read a loopback name as itself, not as this origin.
      if (returnTo && options.hosts.length && unsafeReturnHost(returnTo)) throw new Refusal('invalid_return_route');
    }
    let result: Record<string, unknown> = {}, exitCode: number | undefined, results: Record<string, unknown>[] | undefined;
    // Propagate the verified remote exit code so SSH and local refusals match.
    if (options.hosts.length) ({ value: results, exitCode } = await remotes(options, await tailnetStatus(), message, returnTo, handoffBudget));
    else if (command === 'send') {
      const settings = { to: options.values.get('--to')!, home: options.values.get('--codex-home'), codexBin: options.values.get('--codex-bin'), message: message!, dryRun: options.flags.has('--dry-run'), allowInactive: options.flags.has('--allow-inactive-codex-home') };
      const enabled = options.flags.has('--request-ack') || options.flags.has('--observe-delivery') || options.values.has('--correlation-id') || options.values.has('--wait-for') || options.values.has('--wait-timeout');
      if (wireContext?.preparation) ({ value: result, exitCode } = await prepareHandoff(settings, undefined, options.values.get('--correlation-id'), handoffBudget));
      else if (enabled) ({ value: result, exitCode } = await handoffSend(settings, { correlationId: options.values.get('--correlation-id'), requestAck: options.flags.has('--request-ack'), observeDelivery: options.flags.has('--observe-delivery'), waitFor: options.values.get('--wait-for') as 'delivered' | 'acknowledged' | undefined, seconds: parseWaitTimeout(options.values.get('--wait-timeout') ?? '30'), payload: rawMessage, budget: handoffBudget, resultOverhead: Buffer.byteLength(JSON.stringify(routing)) + 1024 }));
      else result = await send(settings);
    }
    else if (command === 'update') result = options.flags.has('--check') ? await checkUpdate(options.values.get('--channel')) : refuseSelfUpdate(options.values.get('--channel'));
    else if (command === 'doctor') {
      result = await doctor(options.values.get('--agent') as 'claude' | 'codex' | undefined, options.values.get('--codex-home'), options.values.get('--codex-bin'));
      // Opt-in reverse probe: locally, or on the destination when it arrives over the wire.
      const probeTo = wire ? options.values.get('--return-route-host') : returnTo;
      if (options.flags.has('--check-return-route') || probeTo) result.returnRoute = await probeReturnRoute(probeTo && returnHost(probeTo), await tailnetStatus(), wire);
    }
    else result = await listing(options.values.get('--agent') as 'claude' | 'codex' | undefined, options.values.get('--codex-home'), options.flags.has('--all'));
    if (command === 'send') { results = results?.map(item => ({ ...item, ...routing })); result = { ...result, ...routing }; }
    // Wire-only request context for remote home canonicalization. The caller
    // validates and removes this scalar; ordinary local result shape is unchanged.
    if (wire && command === 'send' && result.ok === true && options.values.has('--codex-home'))
      result.requestedCodexHome = options.values.get('--codex-home');
    // Without a return host there is nothing to probe from the destination.
    if (command === 'doctor' && options.flags.has('--check-return-route') && !returnTo) results = results?.map(item => item.ok === false ? item : ({ ...item, returnRoute: { status: 'failed', transport: 'ssh', host: null, reason: 'return_host_unavailable' } }));
    const shape = (item: Record<string, unknown>) => ({ schemaVersion: 1, host: hostname(), command, ok: item.ok !== false, version: VERSION, referenceVersion: '1.1.0', ...item });
    // Cached advisory notice, computed once per invocation by this client and never
    // in wire mode. JSON: additive `clientUpdate` on a flat (single-result) object
    // only; a repeated --host array keeps its exact element shape. Text: one stderr line.
    const notice = wire || command === 'update' ? undefined : updateNotice(options.flags.has('--no-update-notice'));
    const array = !!results && results.length > 1;
    // One destination stays flat; repeated --host returns an ordered array.
    console.log(renderOutput(array ? results!.map(shape) : { ...shape(results?.[0] ?? result), ...(notice && format === 'json' ? { clientUpdate: notice } : {}) }, format));
    if (notice && format === 'text') console.error(noticeText(notice));
    process.exitCode = exitCode ?? (result.ok === false ? 1 : 0);
  }
} catch (error) {
  // A command-wide refusal before dispatch applies to every requested host.
  if (command === 'handoff' || command === 'ack') {
    const failureCode = error instanceof Refusal ? error.code : 'handoff_operation_failed';
    console.log(JSON.stringify({ schemaVersion: 1, host: hostname(), command, ok: false, error: failureCode }));
    process.exitCode = error instanceof Refusal ? error.exitCode : 1;
  } else {
  const { value, exitCode } = failure(error, command, hostname());
  console.log(renderOutput(!wire && requested.length > 1 ? requested.map(item => ({ ...value, host: item })) : value, format));
  process.exitCode = exitCode;
  }
} finally { if (wireWatchdog) clearTimeout(wireWatchdog); }
