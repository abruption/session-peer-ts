// Sender context, Tailscale routing hints and the opt-in return-route probe.
// Everything here is metadata: none of it authenticates a peer or authorizes a send.
import { isIPv6 } from 'node:net';
import { hostname, userInfo } from 'node:os';
import { isAbsolute } from 'node:path';
import { casefold } from './casefold.js';
import { canonical, claude, Refusal } from './discovery.js';
import { executable, run } from './process.js';
import { host, reply } from './protocol.js';
import { sshUser } from './ssh.js';
import { uuid } from './writer.js';

export type Sender = { agent: 'claude' | 'codex'; id: string; codexHome?: string };
type Node = Record<string, unknown>;
export type Tailnet = { magicDNS: boolean; self?: Node; nodes: Node[] };

// Claude Code exports its own inbox path to child processes; Codex exports its
// thread UUID. Both together (a nested agent) or a non-unique match is
// ambiguous, so no identity is claimed.
export function sender(): Sender | undefined {
  const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? '';
  let claudeSender: Sender | undefined, claudeClaimed = false;
  if (socket) {
    claudeClaimed = true;
    const pid = /(\d+)\.sock$/.exec(socket)?.[1];
    let rows: Record<string, unknown>[] = [];
    try { rows = claude(true).sessions as Record<string, unknown>[]; } catch { rows = []; }
    const matches = rows.filter(row => row.alive === true && (pid !== undefined ? row.pid === Number(pid) : row.socket === socket));
    if (matches.length === 1) {
      const row = matches[0]!, name = typeof row.name === 'string' ? row.name : '';
      // A name is a reply target only if it is printable, cannot be read as a PID
      // or agent prefix, and is unique by casefold; otherwise the PID is used.
      const unique = name && !/[\x00-\x1f\x7f-\x9f\u2028\u2029:]/.test(name) && !/^\d+$/.test(name) && name.length <= 256 &&
        rows.filter(other => other.alive === true && typeof other.name === 'string' && casefold(other.name) === casefold(name)).length === 1;
      claudeSender = { agent: 'claude', id: unique ? name : String(row.pid) };
    }
  }
  const thread = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || '';
  const conflicting = !!process.env.CODEX_THREAD_ID && !!process.env.CODEX_SESSION_ID && process.env.CODEX_THREAD_ID.toLowerCase() !== process.env.CODEX_SESSION_ID.toLowerCase();
  if (thread && (claudeClaimed || conflicting)) return undefined;
  if (claudeSender) return claudeSender;
  if (!thread || !uuid(thread)) return undefined;
  const result: Sender = { agent: 'codex', id: thread.toLowerCase() };
  const home = process.env.CODEX_HOME;
  if (home && isAbsolute(home)) { try { result.codexHome = canonical(home); } catch { /* Omit an unresolvable home. */ } }
  return result;
}

const lower = (value: unknown) => typeof value === 'string' ? value.replace(/\.$/, '').toLowerCase() : '';
function names(node: Node): Set<string> {
  const result = new Set<string>(), dns = lower(node.DNSName), name = lower(node.HostName);
  if (dns) { result.add(dns); result.add(dns.split('.')[0]!); }
  if (name) result.add(name);
  if (Array.isArray(node.TailscaleIPs)) for (const address of node.TailscaleIPs) if (typeof address === 'string') result.add(address.toLowerCase());
  return result;
}
// `tailscale status --json` is only a routing hint. Absent, stopped, slow or
// malformed status means ordinary SSH. SESSION_PEER_TAILSCALE=off skips it.
export async function tailnet(): Promise<Tailnet | undefined> {
  if (process.env.SESSION_PEER_TAILSCALE === 'off') return undefined;
  const candidates: string[] = [];
  // The macOS app bundle is a fallback only when no CLI is on PATH.
  try { candidates.push(executable('tailscale')); }
  catch { if (process.platform === 'darwin') candidates.push('/Applications/Tailscale.app/Contents/MacOS/Tailscale'); }
  for (const binary of candidates) {
    const done = await run(binary, ['status', '--json'], { timeout: 3000, limit: 8 * 1024 * 1024 });
    if (!done.spawned || done.interrupted || done.code !== 0) continue;
    let status: Node;
    try { status = JSON.parse(done.stdout); } catch { continue; }
    if (!status || typeof status !== 'object' || status.BackendState !== 'Running') continue;
    const tailnetInfo = status.CurrentTailnet as Node | undefined;
    const self = status.Self && typeof status.Self === 'object' ? status.Self as Node : undefined;
    const peers = status.Peer && typeof status.Peer === 'object' ? Object.values(status.Peer as Node).filter(p => p && typeof p === 'object') as Node[] : [];
    return { magicDNS: !!tailnetInfo && tailnetInfo.MagicDNSEnabled === true, ...(self ? { self } : {}), nodes: [...(self ? [self] : []), ...peers] };
  }
  return undefined;
}
const split = (destination: string) => {
  const at = destination.lastIndexOf('@');
  return { user: at < 0 ? '' : destination.slice(0, at), name: destination.slice(at + 1) };
};
export type Route = { canonical: string; hostName?: string; hostKeyAlias?: string };
// Resolve a known tailnet node to its MagicDNS name. The requested alias stays
// the SSH destination (keeping Host/User/Port/IdentityFile config); HostName
// connects to the verified name and HostKeyAlias keeps the original known_hosts
// key unless ssh_config already sets one (decided by the caller from ssh -G).
// Exact states only: Online === true resolves, Online === false refuses, and any
// other value is ordinary SSH. Without MagicDNS a known-offline peer is still
// refused, but nothing is canonicalized because the DNS name may not resolve.
export function route(destination: string, status?: Tailnet): Route {
  const { user, name } = split(destination);
  if (!status) return { canonical: destination };
  const lookup = lower(name), matches = status.nodes.filter(node => names(node).has(lookup));
  if (!matches.length) return { canonical: destination };
  if (new Set(matches.map((node, index) => String(node.ID ?? node.PublicKey ?? `#${index}`))).size !== 1) throw new Refusal('tailscale_destination_ambiguous', 1);
  const node = matches[0]!, dns = lower(node.DNSName);
  if (node.Online === false) throw new Refusal('tailscale_peer_offline', 1);
  if (node.Online !== true || !status.magicDNS || !dns || !/^[a-z0-9][a-z0-9.-]*$/.test(dns)) return { canonical: destination };
  const resolved = user ? `${user}@${dns}` : dns;
  return resolved === destination ? { canonical: resolved } : { canonical: resolved, hostName: dns, hostKeyAlias: name };
}
// A loopback name always means the machine that evaluates it. Sent to another
// machine as a return host, it would name the receiver, not the origin.
// Numeric names are compared by value, without DNS: IPv4 in every inet_aton
// form (127.1, 2130706433, 0x7f.1, 0177.0.0.1) and IPv4-mapped/compatible IPv6.
function ipv4(name: string): number | undefined {
  const parts = name.split('.');
  if (parts.length > 4 || parts.some(part => !/^(?:0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/.test(part))) return undefined;
  const values = parts.map(part => part.startsWith('0x') ? parseInt(part.slice(2), 16) : part.length > 1 && part.startsWith('0') ? parseInt(part, 8) : Number(part));
  const last = values.pop()!, room = 2 ** (8 * (4 - values.length));
  if (values.some(value => value > 255) || last >= room) return undefined;
  return values.reduce((sum, value, index) => sum + value * 2 ** (8 * (3 - index)), 0) + last;
}
function ipv6Tail(name: string): number | undefined {
  const literal = name.replace(/^\[|\]$/g, '');
  if (!literal.includes(':') || !isIPv6(literal)) return undefined;
  const canonical = new URL(`http://[${literal}]`).hostname.slice(1, -1);
  if (canonical === '::') return 0;
  const match = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  return match ? parseInt(match[1]!, 16) * 65536 + parseInt(match[2]!, 16) : canonical === '::1' ? -1 : undefined;
}
export function loopback(destination: string): boolean {
  const name = lower(split(destination).name);
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const value = ipv4(name) ?? ipv6Tail(name);
  // -1 is ::1; 0 is the unspecified address; 127.0.0.0/8 is IPv4 loopback.
  return value !== undefined && (value === -1 || value === 0 || Math.floor(value / 2 ** 24) === 127);
}
// Whether a host name (any user) names this machine: loopback, its host name
// or its Tailscale self node. Independent of the login user's name.
export function namesThisMachine(destination: string, status?: Tailnet): boolean {
  const name = lower(split(destination).name);
  if (loopback(name) || name === lower(hostname())) return true;
  return !!status?.self && names(status.self).has(name);
}
export function localUser(): string | undefined {
  try { const name = userInfo().username; return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name) ? name : undefined; } catch { return undefined; }
}
// Same machine only when the destination names this OS user explicitly and a
// local name; a missing or different user stays an SSH route.
export function isSelf(destination: string, status?: Tailnet): boolean {
  const { user } = split(destination);
  return !!user && user === localUser() && namesThisMachine(destination, status);
}
// This machine's tailnet address: MagicDNS name, else a 100.64.0.0/10 IPv4.
export function detectedHost(status?: Tailnet): string | undefined {
  if (!status?.self) return undefined;
  const dns = lower(status.self.DNSName);
  if (dns && status.magicDNS) return dns;
  const addresses = Array.isArray(status.self.TailscaleIPs) ? status.self.TailscaleIPs : [];
  return addresses.find((item): item is string => typeof item === 'string' &&
    /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.test(item) && Number(item.split('.')[1]) >= 64 && Number(item.split('.')[1]) < 128 && item.split('.').every(part => Number(part) <= 255));
}
export function configuredHost(explicit?: string): string | undefined {
  return explicit || process.env.SESSION_PEER_REPLY_HOST || process.env.CC_PEER_REPLY_HOST || undefined;
}
// Qualify a return host with this user, then validate it as an SSH destination.
export function returnHost(value: string): string {
  const user = localUser();
  const qualified = value.includes('@') ? value : user ? `${user}@${value}` : value;
  try { return host(qualified); } catch { throw new Refusal('invalid_reply_host'); }
}
// Build a structured URI and accept it only if the parser accepts it back.
export function replyUri(identity: Sender, destination?: string): string {
  const fields = new URLSearchParams([['agent', identity.agent], ['session', identity.id], ['transport', destination ? 'ssh' : 'local'],
    ...(destination ? [['host', destination]] : []), ...(identity.codexHome ? [['codexHome', identity.codexHome]] : [])]);
  const uri = `session-peer://v1/reply?${fields}`;
  reply(uri);
  return uri;
}

// Reverse SSH reachability from this machine: fixed `exit 0` command, no prompts,
// no host-key changes, no stderr in the result, and no retry.
const PROBE = ['-T', '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
  '-o', 'NumberOfPasswordPrompts=0', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=5',
  '-o', 'ConnectionAttempts=1', '-o', 'ControlMaster=no', '-o', 'ControlPath=none'];
// `remote`: the probe runs on a receiver for another origin. A name for the
// receiver itself (loopback, its host name or tailnet self) cannot verify the
// origin, so it fails instead of normalizing to a local route.
export async function probeReturnRoute(destination: string | undefined, status?: Tailnet, remote = false): Promise<Record<string, unknown>> {
  if (!destination) return { status: 'failed', transport: 'ssh', host: null, reason: 'return_host_unavailable' };
  if (remote && namesThisMachine(destination, status))
    return { status: 'failed', transport: 'ssh', host: destination, reason: 'return_host_is_receiver' };
  if (isSelf(destination, status)) return { status: 'verified', transport: 'local', host: hostname(), reason: 'self_route_normalized' };
  let ssh: string;
  try { ssh = executable('ssh'); } catch { return { status: 'failed', transport: 'ssh', host: destination, reason: 'ssh_executable_missing' }; }
  const user = await sshUser(ssh, destination, { args: [] });
  // `exit 0` is a no-op in POSIX shells, cmd.exe and PowerShell alike.
  const done = await run(ssh, [...PROBE, '--', destination, 'exit 0'], { timeout: 8000 });
  const result = (status: string, reason: string) => ({ status, transport: 'ssh', host: destination, reason, ...user });
  if (done.interrupted && done.spawned) return result('failed', 'timeout');
  if (!done.spawned) return result('failed', 'transport_failed');
  if (done.code === 0) return result('verified', 'ssh_command_succeeded');
  const detail = done.stderr;
  if (/permission denied|authentication failed|no supported authentication methods|too many authentication failures/i.test(detail)) return result('failed', 'authentication_failed');
  if (/host key verification failed|remote host identification has changed|offending key in|known_hosts|no [^\n]*host key is known/i.test(detail)) return result('failed', 'host_key_failed');
  if (/timed out|connect timeout/i.test(detail)) return result('failed', 'timeout');
  return result('failed', done.code === 255 ? 'transport_failed' : 'remote_command_failed');
}
