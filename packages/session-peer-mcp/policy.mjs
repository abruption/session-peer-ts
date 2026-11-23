import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const POLICY_LIMIT = 32 * 1024;
const agents = ['claude', 'codex'];
const actions = ['list', 'send'];
const safeId = /^[a-zA-Z0-9_-]{1,48}$/;
const control = /[\x00-\x1f\x7f\ufffd]/u;
export class PolicyError extends Error {}

function requirePolicy(ok) {
  if (!ok) throw new PolicyError('invalid_policy');
}

function requireAllowed(ok) {
  if (!ok) throw new PolicyError('operation_not_allowed');
}

function closed(obj, required, optional = []) {
  requirePolicy(obj !== null && typeof obj === 'object' && !Array.isArray(obj));
  requirePolicy(required.every(key => Object.hasOwn(obj, key)) &&
    Object.keys(obj).every(key => required.includes(key) || optional.includes(key)));
}

function oneOf(values, permit) {
  requirePolicy(Array.isArray(values) && values.length > 0 &&
    values.every(value => permit.includes(value)) && values.length === new Set(values).size);
  return Object.freeze([...values]);
}

// JSON.parse checks grammar. This pass rejects duplicate keys before the
// parsed policy can grant access; escaped key spellings compare as text.
function uniqueKeys(text) {
  const stack = [];
  for (let index = 0; index < text.length; index++) {
    const token = text[index];
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && stack.at(-1)) stack.at(-1).key = true;
    else if (token === '"') {
      const start = index++;
      // The preceding JSON.parse guarantees a closing quote and valid escapes.
      while (text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
      const object = stack.at(-1);
      if (object?.key) {
        const key = JSON.parse(text.slice(start, index + 1));
        requirePolicy(!object.keys.has(key));
        object.keys.add(key);
        object.key = false;
      }
    }
  }
}

function absoluteHome(s, windows) {
  return typeof s === 'string' && s.length <= 2048 && !control.test(s) &&
    (windows ? win32.isAbsolute(s) && /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(s) : posix.isAbsolute(s));
}

function canonicalHost(host, reply) {
  requirePolicy(typeof host === 'string' && host.length <= 255 && !control.test(host));
  const q = new URLSearchParams({ agent: 'claude', session: 'policy-check', transport: 'ssh', host });
  try { return reply('session-peer://v1/reply?' + q).host; }
  catch { throw new PolicyError('invalid_policy'); }
}

export function parsePolicy(text, reply, platform = process.platform) {
  requirePolicy(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= POLICY_LIMIT);
  let doc;
  try { doc = JSON.parse(text); } catch { throw new PolicyError('invalid_policy'); }
  uniqueKeys(text);
  closed(doc, ['schemaVersion', 'destinations']);
  requirePolicy(doc.schemaVersion === 1 && Array.isArray(doc.destinations) &&
    doc.destinations.length > 0 && doc.destinations.length <= 32);
  const entries = new Map();
  for (const raw of doc.destinations) {
    closed(raw, ['id', 'transport', 'agents', 'capabilities'], ['host', 'remotePlatform', 'codexHome']);
    requirePolicy(typeof raw.id === 'string' && safeId.test(raw.id) && !entries.has(raw.id));
    requirePolicy(raw.transport === 'local' || raw.transport === 'ssh');
    const remote = raw.transport === 'ssh';
    requirePolicy(remote ? ['posix', 'win32'].includes(raw.remotePlatform) && Object.hasOwn(raw, 'host') :
      !Object.hasOwn(raw, 'host') && !Object.hasOwn(raw, 'remotePlatform'));
    const allowedAgents = oneOf(raw.agents, agents), capabilities = oneOf(raw.capabilities, actions);
    requirePolicy(allowedAgents.includes('codex') ?
      absoluteHome(raw.codexHome, remote ? raw.remotePlatform === 'win32' : platform === 'win32') :
      !Object.hasOwn(raw, 'codexHome'));
    entries.set(raw.id, Object.freeze({ id: raw.id, transport: raw.transport, agents: allowedAgents, capabilities,
      ...(remote ? { host: canonicalHost(raw.host, reply), remotePlatform: raw.remotePlatform } : {}),
      ...(raw.codexHome !== undefined ? { codexHome: raw.codexHome } : {}) }));
  }
  return entries;
}

function same(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

export function readPolicy(file, reply) {
  if (file === undefined) return parsePolicy('{"schemaVersion":1,"destinations":[{"id":"local","transport":"local","agents":["claude"],"capabilities":["list"]}]}', reply);
  requirePolicy(absoluteHome(file, process.platform === 'win32'));
  let fd;
  try {
    const before = lstatSync(file, { bigint: true });
    requirePolicy(before.isFile() && before.size <= POLICY_LIMIT);
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
    fd = openSync(file, flags);
    const opened = fstatSync(fd, { bigint: true });
    requirePolicy(opened.isFile() && same(before, opened));
    if (process.platform !== 'win32')
      requirePolicy(opened.uid === BigInt(process.getuid()) && (opened.mode & 0o022n) === 0n);
    const bytes = Buffer.alloc(POLICY_LIMIT + 1);
    let bytesRead = 0;
    for (; bytesRead < bytes.length;) {
      const count = readSync(fd, bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!count) break;
      bytesRead += count;
    }
    requirePolicy(bytesRead === Number(opened.size) && same(opened, fstatSync(fd, { bigint: true })) &&
      same(opened, lstatSync(file, { bigint: true })));
    return parsePolicy(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)), reply);
  } catch {
    throw new PolicyError('invalid_policy');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function authorizeList(policy, { destination = 'local', agent } = {}) {
  const route = policy.get(destination);
  requireAllowed(route?.capabilities.includes('list') && (agent === undefined || route.agents.includes(agent)));
  return { route, agents: agent === undefined ? route.agents : [agent] };
}

export function authorizeSend(policy, { destination = 'local', target }, reply) {
  const route = policy.get(destination);
  requireAllowed(route?.capabilities.includes('send'));
  requireAllowed(typeof target === 'string' && target.length > 0 && target.length <= 4096 && !control.test(target));
  let to = target, uri;
  if (target.startsWith('session-peer:')) {
    try { uri = reply(target); } catch { throw new PolicyError('operation_not_allowed'); }
    requireAllowed((uri.host === undefined ? 'local' : 'ssh') === route.transport && uri.host === route.host);
    to = uri.to;
  }
  const agent = to.startsWith('codex:') ? 'codex' : 'claude';
  requireAllowed(route.agents.includes(agent));
  if (agent === 'codex') requireAllowed(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(to.slice(6)));
  else requireAllowed(!!(to.startsWith('claude:') ? to.slice(7) : to).trim());
  if (uri) requireAllowed(uri.home === (agent === 'codex' ? route.codexHome : undefined));
  return { route, to, agent };
}
