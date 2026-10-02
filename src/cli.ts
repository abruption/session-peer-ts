#!/usr/bin/env node
import { doctor } from './diagnostics.js';
import { help } from './help.js';
import { renderOutput, type OutputFormat } from './output.js';
import { hostname } from 'node:os';
import { lstatSync } from 'node:fs';
import { listing, Refusal } from './discovery.js';
import { executable, run, UnknownOutcome, type Done } from './process.js';
import { checkMessage, send, CodexUnknownOutcome } from './send.js';
import { HomeRefusal } from './writer.js';
import { envelope, host, reply, VERSION, VERSION_LINE } from './protocol.js';
import { sshOptions, sshUser, type SshOptions } from './ssh.js';

type Options = { command: 'list' | 'send' | 'doctor'; values: Map<string, string>; flags: Set<string>; hosts: string[]; ssh: SshOptions };
const FLAGS = ['--json', '--all', '--dry-run', '--no-from', '--no-reply-to', '--no-update-notice', '--allow-inactive-codex-home'];
const VALUES = ['--agent', '--codex-home', '--codex-bin', '--output-format', '--to', '--message', '-m', '--host', '--remote-bin', '--remote-platform', '--ssh-control-path', '--reply-address', '--ssh-opt'];
// Repeated in order; every other value option is single.
const REPEATED = ['--host', '--ssh-opt'];
// Requested destinations, so a command-wide refusal can be attributed to each.
let requested: string[] = [];
export function parse(args: string[]): Options {
  const command = args[0];
  if (command !== 'list' && command !== 'send' && command !== 'doctor') throw new Refusal('unsupported_command');
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
  requested = [...hosts];
  if (positional !== undefined) {
    if (values.has('--message')) throw new Refusal('conflicting_message_sources');
    values.set('--message', positional);
  }
  if (values.has('--output-format') && !['json', 'text'].includes(values.get('--output-format')!)) throw new Refusal('unsupported_output_format');
  if (flags.has('--json') && values.get('--output-format') === 'text') throw new Refusal('conflicting_output_options');
  if (!flags.has('--json') && !values.has('--output-format')) throw new Refusal('json_output_required');
  if (command === 'list' || command === 'doctor') {
    if (values.has('--agent') && !['claude', 'codex'].includes(values.get('--agent')!)) throw new Refusal('unsupported_agent');
    if (values.has('--codex-home') && !values.get('--codex-home')) throw new Refusal('invalid_codex_home');
    if (values.get('--agent') === 'claude' && values.has('--codex-home')) throw new Refusal('inapplicable_option');
    if (['--to', '--message', '--reply-address', ...(command === 'list' ? ['--codex-bin'] : [])].some(k => values.has(k)) || ['--dry-run', '--no-from', '--no-reply-to', '--allow-inactive-codex-home'].some(k => flags.has(k))) throw new Refusal('inapplicable_option');
    if (command === 'doctor' && (flags.has('--all') || (values.get('--agent') === 'claude' && values.has('--codex-bin')))) throw new Refusal('inapplicable_option');
  } else {
    if (!values.get('--to') || values.has('--agent') || flags.has('--all')) throw new Refusal('invalid_send_options');
    if (flags.has('--no-reply-to') && values.has('--reply-address')) throw new Refusal('conflicting_reply_options');
    if (values.get('--to')!.startsWith('session-peer:')) {
      const route = reply(values.get('--to')!);
      if (hosts.length && (hosts.length > 1 || host(hosts[0]!) !== route.host)) throw new Refusal('reply_route_conflict');
      if (route.host !== undefined) hosts = [route.host];
      if (values.has('--codex-home') && values.get('--codex-home') !== route.home) throw new Refusal('reply_route_conflict');
      if (route.home !== undefined) values.set('--codex-home', route.home);
      values.set('--to', route.to);
    }
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
  return { command, values, flags, hosts, ssh };
}
async function input(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const part = Buffer.from(chunk); bytes += part.length;
    if (bytes > 4_100_000) throw new Refusal('input_too_large');
    chunks.push(part);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Refusal('invalid_utf8'); }
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
async function remote(options: Options, ssh: string, target: string, message?: string): Promise<{ value: Record<string, unknown>; exitCode: number }> {
  const { values, flags, command } = options;
  const binary = values.get('--remote-bin') ?? 'session-peer';
  const windows = values.get('--remote-platform') === 'win32';
  const invoke = (flag: string) => {
    if (!windows) return `${quote(binary)} ${flag}`;
    // PowerShell also closes single-quoted strings on U+2018-U+201B.
    const code = `& '${binary.replace(/['\u2018-\u201b]/g, '$&$&')}' ${flag}`;
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(code, 'utf16le').toString('base64')}`;
  };
  // OpenSSH keeps the first value obtained, so the fixed hardening options
  // precede the allowlisted user options and cannot be overridden by them.
  const base = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    ...(values.has('--ssh-control-path') ? ['-S', values.get('--ssh-control-path')!] : []), ...options.ssh.args, '--', target];
  const preflight = await run(ssh, [...base, invoke('--version')], { timeout: 15000 });
  const preflightError = sshPreflightFailure(preflight, VERSION_LINE);
  if (preflightError) throw new Refusal(preflightError, 1);
  const args = [command, '--json'];
  for (const [key, value] of values) if (['--agent', '--codex-home', '--codex-bin', '--to'].includes(key)) args.push(key, value);
  if (flags.has('--all')) args.push('--all');
  if (flags.has('--dry-run')) args.push('--dry-run');
  if (flags.has('--allow-inactive-codex-home')) args.push('--allow-inactive-codex-home');
  if (command === 'send') args.push(`--message=${message!}`, '--no-from', '--no-reply-to');
  const done = await run(ssh, [...base, invoke('--stdio-request')], {
    timeout: 90000, input: JSON.stringify({ schemaVersion: 1, args })
  });
  const uncertain = () => { if (command === 'send' && !flags.has('--dry-run') && done.spawned) throw new UnknownOutcome(); throw new Refusal('remote_response_unverified', 1); };
  if (done.interrupted || !done.spawned) return uncertain();
  let value: Record<string, unknown>;
  try { value = JSON.parse(done.stdout); } catch { return uncertain(); }
  if (!value || value.schemaVersion !== 1 || value.command !== command || typeof value.ok !== 'boolean' || typeof value.host !== 'string' ||
      ![0, 1, 2].includes(done.code ?? -1) || (value.ok !== (done.code === 0))) return uncertain();
  if (command === 'doctor' && value.ok && (value.diagnosticCompleted !== true || typeof value.ready !== 'boolean' || value.implementation !== 'typescript' || !value.agents || typeof value.agents !== 'object' || Array.isArray(value.agents))) return uncertain();
  const expectedStatus = flags.has('--dry-run') ? 'validated' : values.get('--to')?.startsWith('codex:') ? 'queued' : 'posted';
  if (command === 'send' && (value.consumptionConfirmed !== false ||
      (value.ok && (value.submitted !== !flags.has('--dry-run') || value.status !== expectedStatus)) ||
      (!value.ok && !((value.submitted === false && value.status === 'refused') || (value.submitted === null && value.status === 'unknown'))))) return uncertain();
  return { value: { ...value, host: target, sshHost: target }, exitCode: done.code! };
}
function failure(error: unknown, command: string, where: string): { value: Record<string, unknown>; exitCode: number } {
  const unknown = error instanceof UnknownOutcome;
  const refusal = error instanceof Refusal ? error : new Refusal('operation_failed', 1);
  const homeResolution = error instanceof HomeRefusal || error instanceof CodexUnknownOutcome ? error.codexHomeResolution : undefined;
  return { exitCode: unknown ? 1 : refusal.exitCode, value: { schemaVersion: 1, host: where, command, ok: false,
    error: unknown ? 'outcome_unknown' : refusal.code, status: unknown ? 'unknown' : 'refused',
    submitted: unknown ? null : false, consumptionConfirmed: false, retryAllowed: false,
    ...(homeResolution === undefined ? {} : { codexHomeResolution: homeResolution }) } };
}
// Destinations run in order, one attempt each. A failure or unknown outcome is
// reported for that destination only; it is never retried or failed over.
async function remotes(options: Options, message?: string): Promise<{ value: Record<string, unknown>[]; exitCode: number }> {
  const ssh = executable('ssh'), results: Record<string, unknown>[] = [];
  let exitCode = 0;
  for (const requestedHost of options.hosts) {
    const target = host(requestedHost);
    const user = await sshUser(ssh, target, options.ssh);
    let outcome: { value: Record<string, unknown>; exitCode: number };
    try { outcome = await remote(options, ssh, target, message); }
    // One destination keeps the existing flat local-host failure shape.
    catch (error) { outcome = failure(error, options.command, options.hosts.length === 1 ? hostname() : requestedHost); }
    results.push({ ...outcome.value, ...(options.hosts.length > 1 ? { host: requestedHost } : {}), sshHost: target, ...user });
    exitCode = options.hosts.length === 1 ? outcome.exitCode : outcome.exitCode === 0 && exitCode === 0 ? 0 : 1;
  }
  return { value: results, exitCode };
}

let command = 'unknown';
let format: OutputFormat = 'json';
let wire = false;
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor! >= 13) || major === 24)) throw new Refusal('unsupported_node_version');
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Refusal('unsupported_platform');
  let args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--version') console.log(VERSION_LINE);
  else if ((args.length === 1 && ['--help', '-h'].includes(args[0]!)) ||
    (args.length === 2 && ['list', 'send', 'doctor'].includes(args[0]!) && ['--help', '-h'].includes(args[1]!))) console.log(help(args.length === 2 ? args[0] : undefined));
  else {
    wire = args.length === 1 && args[0] === '--stdio-request';
    if (wire) {
      let request: unknown;
      try { request = JSON.parse(await input()); } catch { throw new Refusal('invalid_remote_request'); }
      const record = request as { schemaVersion?: unknown; args?: unknown };
      if (!record || record.schemaVersion !== 1 || !Array.isArray(record.args) || record.args.some(a => typeof a !== 'string')) throw new Refusal('invalid_remote_request');
      args = record.args;
    }
    command = ['list', 'send', 'doctor'].includes(args[0] ?? '') ? args[0]! : 'unknown';
    const options = parse(args);
    format = !wire && options.values.get('--output-format') === 'text' ? 'text' : 'json';
    if (wire && options.values.get('--output-format') === 'text') throw new Refusal('remote_json_required');
    if (wire && (options.hosts.length || options.ssh.args.length || options.values.has('--remote-bin') || options.values.has('--remote-platform') || options.values.has('--ssh-control-path'))) throw new Refusal('nested_transport_forbidden');
    let message: string | undefined;
    if (command === 'send') {
      message = options.values.get('--message');
      if (message === undefined || message === '-') { if (wire) throw new Refusal('remote_message_required'); message = await input(); }
      checkMessage(message);
      message = envelope(message, options.flags.has('--no-from'), options.values.get('--reply-address'));
      checkMessage(message, options.values.get('--to')!.startsWith('codex:'));
    }
    let result: Record<string, unknown> = {}, exitCode: number | undefined, results: Record<string, unknown>[] | undefined;
    // Propagate the verified remote exit code so SSH and local refusals match.
    if (options.hosts.length) ({ value: results, exitCode } = await remotes(options, message));
    else if (command === 'send') result = await send({ to: options.values.get('--to')!, home: options.values.get('--codex-home'), codexBin: options.values.get('--codex-bin'), message: message!, dryRun: options.flags.has('--dry-run'), allowInactive: options.flags.has('--allow-inactive-codex-home') });
    else if (command === 'doctor') result = await doctor(options.values.get('--agent') as 'claude' | 'codex' | undefined, options.values.get('--codex-home'), options.values.get('--codex-bin'));
    else result = await listing(options.values.get('--agent') as 'claude' | 'codex' | undefined, options.values.get('--codex-home'), options.flags.has('--all'));
    const shape = (item: Record<string, unknown>) => ({ schemaVersion: 1, host: hostname(), command, ok: item.ok !== false, version: VERSION, referenceVersion: '1.0.2', ...item });
    // One destination stays flat; repeated --host returns an ordered array.
    console.log(renderOutput(results && results.length > 1 ? results.map(shape) : shape(results?.[0] ?? result), format));
    process.exitCode = exitCode ?? (result.ok === false ? 1 : 0);
  }
} catch (error) {
  // A command-wide refusal before dispatch applies to every requested host.
  const { value, exitCode } = failure(error, command, hostname());
  console.log(renderOutput(!wire && requested.length > 1 ? requested.map(item => ({ ...value, host: item })) : value, format));
  process.exitCode = exitCode;
}
