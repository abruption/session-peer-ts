import { isIPv6 } from 'node:net';
import { Refusal } from './discovery.js';
import { run } from './process.js';

export type SshOptions = { args: string[]; user?: string };
export type SshUser = { sshUser: string | null; sshUserSource: 'explicit' | 'ssh_config_or_local_default' | 'unknown' };
// An allowlist, not a blocklist: OpenSSH has many spellings that run local
// commands (ProxyCommand, LocalCommand, KnownHostsCommand, Match exec, Include,
// -F, PKCS11Provider...). Only these connection settings are accepted, and they
// are re-emitted in one canonical argv form. ProxyJump is excluded because the
// jump hop does not inherit BatchMode/StrictHostKeyChecking from the command line.
const FLAGS: Record<string, string> = { p: 'port', l: 'user', i: 'identityfile' };
const KEYS = ['port', 'user', 'identityfile', 'identitiesonly'];
const valid: Record<string, (value: string) => boolean> = {
  port: value => /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 65535,
  user: value => value.length <= 255 && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value),
  // OpenSSH expands %tokens and ${ENV} in identity paths; refuse both.
  identityfile: value => value.length <= 4096 && !value.startsWith('-') && !/[\x00-\x1f\x7f%$]/.test(value),
  identitiesonly: value => value === 'yes' || value === 'no',
  family: () => true
};
export function sshOptions(tokens: string[]): SshOptions {
  const seen = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    let key: string, value: string | undefined;
    if (token === '-4' || token === '-6') { key = 'family'; value = token; }
    else {
      const match = /^-([plio])(.*)$/s.exec(token);
      if (!match) throw new Refusal('unsupported_ssh_option');
      value = match[2] || tokens[++i];
      if (value === undefined || value.startsWith('-')) throw new Refusal('invalid_ssh_option');
      if (match[1] === 'o') {
        // Only Key=Value; OpenSSH would re-tokenize spaces and quotes in -o.
        const pair = /^([A-Za-z]+)=(.*)$/s.exec(value);
        if (!pair || !KEYS.includes(pair[1]!.toLowerCase())) throw new Refusal('unsupported_ssh_option');
        key = pair[1]!.toLowerCase(); value = pair[2]!;
      } else key = FLAGS[match[1]!]!;
    }
    if (seen.has(key) || !valid[key]!(value)) throw new Refusal('invalid_ssh_option');
    seen.set(key, value);
  }
  const args: string[] = [];
  if (seen.has('port')) args.push('-p', seen.get('port')!);
  if (seen.has('user')) args.push('-l', seen.get('user')!);
  if (seen.has('identityfile')) args.push('-i', seen.get('identityfile')!);
  if (seen.has('identitiesonly')) args.push('-o', `IdentitiesOnly=${seen.get('identitiesonly')}`);
  if (seen.has('family')) args.push(seen.get('family')!);
  return { args, ...(seen.has('user') ? { user: seen.get('user')! } : {}) };
}
export type SshJump = { user: string; host: string; port?: string; spec: string };
// --ssh-jump USER@HOST[:PORT]: one hop with an explicit user. IPv6 needs
// brackets. Every part is limited to characters that are inert in a POSIX
// shell and in OpenSSH % tokens, because the hop runs inside ProxyCommand.
export function sshJump(value: string): SshJump {
  const match = value.length <= 255 ? /^([A-Za-z0-9_][A-Za-z0-9_.-]*)@(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9][A-Za-z0-9_.-]*))(?::([1-9]\d{0,4}))?$/.exec(value) : null;
  if (!match || (match[2] !== undefined && !isIPv6(match[2])) || (match[4] !== undefined && Number(match[4]) > 65535)) throw new Refusal('invalid_ssh_jump');
  return { user: match[1]!, host: match[2] ?? match[3]!, ...(match[4] ? { port: match[4] } : {}), spec: value };
}
// A fixed ProxyCommand instead of -J: OpenSSH's -J does not pass BatchMode or
// StrictHostKeyChecking to the hop. The hop's own ssh_config may not add a
// further proxy, control socket, forwarding or local command. OpenSSH runs
// ProxyCommand through the user's shell after %-token expansion (ssh_config(5)),
// so the executable path is shell-quoted and every % in it is doubled.
export function proxyCommand(ssh: string, jump: SshJump): string {
  const path = `'${ssh.replace(/'/g, "'\\''")}'`.replace(/%/g, '%%');
  return [path, '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=10',
    '-o', 'ConnectionAttempts=1', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'ControlPath=none', '-o', 'ForwardAgent=no',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', ...(jump.port ? ['-p', jump.port] : []), '-l', jump.user,
    '-W', "'[%h]:%p'", '--', jump.host].join(' ');
}
// Win32-OpenSSH has no shell step (PowerShell/openssh-portable source; the spawn
// path reads the same from v8.1.0.0 through latestw_all d0c65f2, which is source
// provenance, not a test of those versions): readconf.c keeps the raw value, and
// since 8.7 argv_split()s it first and rejects unbalanced quotes; sshconnect.c
// percent-expands "exec %s", skips "exec " and posix_spawnp()s the whole string
// as argv[0] with no arguments; misc.c build_commandline_string() passes a string
// that starts with '"' unchanged to CreateProcessW(NULL, ...) (w32fd.c, which
// then also skips its unquoted-name retry). No cmd.exe runs, so %VAR%, ^, & and |
// are inert; the ssh.exe UCRT splits the line once more. Only an absolute drive
// path ending in \ssh.exe without '"', ':' or wildcard characters is accepted:
// it is the quoted program name (read up to the next '"', no escapes), and every
// other argument is a fixed or validated token without spaces, quotes or
// backslashes, so no MSVCRT escaping is needed. "[%h]:%p" is double-quoted where
// POSIX single-quotes it; %h from a configured HostName stays the same trusted
// ssh_config boundary. SSH_TEST_ENVIRONMENT makes Win32-OpenSSH rewrite the
// path (bash_to_win_path) when atoi() of it is nonzero; parseInt() gives the
// same zero/nonzero result within the representable int range and refuses
// out-of-range or non-ASCII-whitespace forms (no full equivalence is claimed).
// An isolated no-connection probe with the real Win32-OpenSSH 9.5p1 ssh.exe and
// an argv-dump hop matched this exactly (VALIDATION). Not enabled: a connected
// hop and owned-process-tree cleanup of the hop grandchild are unqualified (#20,
// #131; see cli.ts).
export function windowsProxyCommand(ssh: string, jump: SshJump, env: NodeJS.ProcessEnv = process.env): string {
  if (ssh.length > 4096 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(ssh) ||
    !/^[A-Za-z]:\\(?:[^\x00-\x1f\x7f"*:<>?|/\\]+\\)*ssh\.exe$/i.test(ssh)) throw new Refusal('ssh_jump_unsupported_ssh_path');
  if (Number.parseInt(env.SSH_TEST_ENVIRONMENT ?? '', 10)) throw new Refusal('ssh_jump_unsupported_environment');
  return [`"${ssh.replace(/%/g, '%%')}"`, '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=10',
    '-o', 'ConnectionAttempts=1', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'ControlPath=none', '-o', 'ForwardAgent=no',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', ...(jump.port ? ['-p', jump.port] : []), '-l', jump.user,
    '-W', '"[%h]:%p"', '--', jump.host].join(' ');
}
// Outer options for a jump: a configured ControlMaster/ControlPath could reuse
// an existing master and bypass the hop, and ProxyUseFdpass would change how the
// proxy hands over its connection, so all three are fixed before user options.
export function jumpOptions(ssh: string, jump: SshJump, platform: NodeJS.Platform = process.platform): string[] {
  const command = platform === 'win32' ? windowsProxyCommand(ssh, jump) : proxyCommand(ssh, jump);
  return ['-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ProxyUseFdpass=no', '-o', `ProxyCommand=${command}`];
}
// Like Python, ask OpenSSH which login user applies without connecting. With
// `force`, `ssh -G` also runs for an explicit user so the caller can see a
// configured HostKeyAlias (`read` says whether the configuration was read).
export async function sshConfig(ssh: string, destination: string, options: SshOptions, force = false): Promise<{ user: SshUser; read: boolean; hostKeyAlias?: string }> {
  const at = destination.lastIndexOf('@');
  const explicit: SshUser | undefined = at > 0 ? { sshUser: destination.slice(0, at), sshUserSource: 'explicit' } :
    options.user ? { sshUser: options.user, sshUserSource: 'explicit' } : undefined;
  if (explicit && !force) return { user: explicit, read: false };
  const done = await run(ssh, ['-G', ...options.args, '--', destination], { timeout: 5000 });
  let user: SshUser = explicit ?? { sshUser: null, sshUserSource: 'unknown' }, hostKeyAlias: string | undefined;
  if (done.interrupted || done.code !== 0) return { user, read: false };
  for (const line of done.stdout.split(/\r?\n/)) {
    const match = /^(user|hostkeyalias) (\S[^\x00-\x1f\x7f]{0,254})$/i.exec(line);
    if (match?.[1]!.toLowerCase() === 'hostkeyalias') hostKeyAlias = match[2]!.trim();
    else if (match && !explicit) user = { sshUser: match[2]!.trim(), sshUserSource: 'ssh_config_or_local_default' };
  }
  return { user, read: true, ...(hostKeyAlias ? { hostKeyAlias } : {}) };
}
export async function sshUser(ssh: string, destination: string, options: SshOptions): Promise<SshUser> {
  return (await sshConfig(ssh, destination, options)).user;
}
