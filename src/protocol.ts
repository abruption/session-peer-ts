import { isIPv6 } from 'node:net';
import { Refusal } from './discovery.js';
import { uuid } from './writer.js';
export const VERSION = '0.3.2';
export const VERSION_LINE = `session-peer ${VERSION} (typescript)`;
// Return the OpenSSH destination: [user@]name, or an IPv6 literal with any
// brackets removed (`ssh` does not strip `[...]` outside ssh:// URIs). Zone IDs
// (`%`) and other characters that OpenSSH might expand are refused.
export function host(value: string): string {
  const match = value.length <= 255 ? /^((?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?)(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9][A-Za-z0-9_.-]*)|([0-9A-Fa-f.]*:[0-9A-Fa-f:.]*))$/.exec(value) : null;
  if (match?.[3] !== undefined) return value;
  const literal = match?.[2] ?? match?.[4];
  if (literal === undefined || !isIPv6(literal)) throw new Refusal('invalid_ssh_host');
  return match![1] + literal;
}
export function reply(value: string): { to: string; host?: string; home?: string } {
  if (value.length > 4096 || /[\x00-\x20\x7f]/.test(value) || /%(?![\da-f]{2})/i.test(value)) throw new Refusal('invalid_reply_uri');
  let url: URL;
  try { url = new URL(value); } catch { throw new Refusal('invalid_reply_uri'); }
  if (url.protocol !== 'session-peer:' || url.host !== 'v1' || url.pathname !== '/reply' || url.hash || url.username || url.password) throw new Refusal('invalid_reply_uri');
  const fields = new Map<string, string>();
  for (const [key, item] of url.searchParams) {
    if (!['agent', 'session', 'transport', 'host', 'codexHome'].includes(key) || fields.has(key) || !item || /[\x00-\x1f\x7f\ufffd]/.test(item)) throw new Refusal('invalid_reply_uri');
    fields.set(key, item);
  }
  const agent = fields.get('agent'), target = fields.get('session'), transport = fields.get('transport');
  if (!target || !['claude', 'codex'].includes(agent ?? '') || !['local', 'ssh'].includes(transport ?? '')) throw new Refusal('invalid_reply_uri');
  if (agent === 'codex' && !uuid(target)) throw new Refusal('invalid_reply_uri');
  // `to` uses reserved prefixes for agent selection and Reply-To parsing.
  // A forwarded value must not become Codex or another URI at the receiver.
  if (agent === 'claude' && (target.startsWith('codex:') || target.startsWith('session-peer:'))) throw new Refusal('invalid_reply_uri');
  if (agent !== 'codex' && fields.has('codexHome')) throw new Refusal('invalid_reply_uri');
  // Match Python: a POSIX or Windows absolute path, never cwd- or ~-relative.
  if (fields.has('codexHome') && !/^(?:\/|[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(fields.get('codexHome')!)) throw new Refusal('invalid_reply_uri');
  if (transport === 'local' && fields.has('host')) throw new Refusal('invalid_reply_uri');
  if (transport === 'ssh' && !fields.has('host')) throw new Refusal('invalid_reply_uri');
  return { to: agent === 'codex' ? `codex:${target}` : target,
    ...(transport === 'ssh' ? { host: host(fields.get('host')!) } : {}),
    ...(fields.has('codexHome') ? { home: fields.get('codexHome')! } : {}) };
}
// `sender` is an already-detected identity (null: none). Omitted, a valid
// Codex environment UUID is used, as in earlier versions.
export function envelope(text: string, noFrom: boolean, address?: string, sender?: { agent: string; id: string } | null): string {
  const thread = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
  const identity = sender !== undefined ? sender : thread && uuid(thread) ? { agent: 'codex', id: thread } : null;
  const from = !noFrom && identity ? `From: ${identity.agent}:${identity.id}\n\n` : '';
  if (address) reply(address);
  // Trim edge newlines by index: /\n+$/ is quadratic on long interior newline runs.
  let start = 0, end = text.length;
  while (start < end && text[start] === '\n') start++;
  while (end > start && text[end - 1] === '\n') end--;
  // No inferred identity/reverse route and no executable Reply command.
  return from + text.slice(start, end) + (address ? `\n\n---\nReply-To: ${address}` : '');
}
