// Update checks read only public npm dist-tags. They never install packages,
// replace npm-owned files, or touch Python installs, remote hosts or skills.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSkills } from './diagnostics.js';
import { Refusal } from './discovery.js';
import { VERSION } from './protocol.js';

export const PACKAGE = 'session-peer';
export const REFRESH_ARG = '--_refresh-update-cache';
const LOCK_TOKEN = 'SESSION_PEER_UPDATE_LOCK_TOKEN';
export const CHANNELS = ['latest', 'preview'];
const TIMEOUT = 3000, RESPONSE_LIMIT = 65536, CACHE_LIMIT = 4096;
const TTL = 24 * 3600_000, FAILURE_TTL = 3600_000, LOCK_STALE = 60_000;
// Distinct from Python's update.json: npm and Python versions are separate streams.
const CACHE = 'npm-update.json', LOCK = 'npm-update.lock';

export class UpdateRefusal extends Refusal {
  constructor(code: string, readonly guidance: Record<string, unknown>) { super(code); }
}

type Version = { core: bigint[]; pre: string[] };
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`);
// npm versions without build metadata; no `v` prefix, partial or Python-style tags.
function parseVersion(text: unknown): Version | undefined {
  if (typeof text !== 'string' || text.length > 64) return undefined;
  const match = SEMVER.exec(text);
  return match ? { core: [match[1], match[2], match[3]].map(part => BigInt(part!)), pre: match[4]?.split('.') ?? [] } : undefined;
}
function order(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]! ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
export const validVersion = (text: unknown, stable = false) => { const parsed = parseVersion(text); return !!parsed && (!stable || !parsed.pre.length); };
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Refusal('invalid_version', 1);
  return order(x, y);
}

export type Manager = 'npm' | 'npm_project' | 'pnpm' | 'pnpm_project' | 'yarn' | 'bun' | 'volta' | 'npx' | 'source' | 'unknown';
export type Probe = { read: (path: string) => string; real: (path: string) => string };
const disk: Probe = {
  read: path => { if (statSync(path).size > 1_048_576) throw new Error('too_large'); return readFileSync(path, 'utf8'); },
  real: path => realpathSync(path).replace(/\\/g, '/')
};
const declares = (root: string, probe: Probe): boolean => {
  try {
    const value = JSON.parse(probe.read(`${root}/package.json`)) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => {
      const group = value?.[key];
      return !!group && typeof group === 'object' && Object.hasOwn(group, PACKAGE);
    });
  } catch { return false; }
};
const attempt = (check: () => boolean) => { try { return check(); } catch { return false; } };
// Guidance follows the resolved CLI file, and only a positively identified owner
// gets a command: an npm global prefix whose own launcher points at this package
// (default, Homebrew, nvm, nvm-windows, fnm), a manager-specific global store
// whose manifest declares session-peer, or Volta/npx stores. Anything else is
// `unknown` (no command), never a guess that could modify the current project.
export function manager(path = fileURLToPath(import.meta.url), platform = process.platform, probe: Probe = disk): Manager {
  const file = path.replace(/\\/g, '/');
  const match = /^(.*)\/node_modules\/session-peer\/dist\/[^/]+$/.exec(file);
  if (!match) {
    const root = /^(.*)\/dist\/[^/]+$/.exec(file)?.[1];
    return root && !/\/node_modules\//.test(file) && attempt(() => JSON.parse(probe.read(`${root}/package.json`)).name === PACKAGE) ? 'source' : 'unknown';
  }
  const parent = match[1]!, lower = parent.toLowerCase();
  if (/\/_npx\/[0-9a-f]+$/.test(lower)) return 'npx';
  if (/\/\.?volta\/tools\/image\/packages\/session-peer(?:\/lib)?$/.test(lower)) return 'volta';
  const store = lower.lastIndexOf('/node_modules/.pnpm/');
  if (store >= 0) {
    const root = parent.slice(0, store);
    if (!declares(root, probe)) return 'unknown';
    return /\/pnpm\/global\/\d+$/.test(root.toLowerCase()) ? 'pnpm' : 'pnpm_project';
  }
  if (/\/yarn\/(?:data\/)?global$/.test(lower)) return declares(parent, probe) ? 'yarn' : 'unknown';
  if (/\/\.bun\/install\/global$/.test(lower)) return declares(parent, probe) ? 'bun' : 'unknown';
  const cli = `${parent}/node_modules/session-peer/dist/cli.js`;
  if (platform === 'win32') {
    if (attempt(() => probe.read(`${parent}/session-peer.cmd`).replace(/\\/g, '/').toLowerCase().includes('/node_modules/session-peer/dist/cli.js'))) return 'npm';
  } else if (lower.endsWith('/lib') && attempt(() => probe.real(`${parent.slice(0, -4)}/bin/session-peer`) === probe.real(cli))) return 'npm';
  return declares(parent, probe) ? 'npm_project' : 'unknown';
}
const COMMANDS: Partial<Record<Manager, (spec: string) => string>> = {
  npm: spec => `npm install --global --ignore-scripts ${spec}`,
  pnpm: spec => `pnpm add --global --ignore-scripts ${spec}`,
  yarn: spec => `yarn global add --ignore-scripts ${spec}`,
  bun: spec => `bun add --global --ignore-scripts ${spec}`,
  volta: spec => `volta install ${spec}`,
  npx: spec => `npx --yes --ignore-scripts ${spec} --version`
};
export const upgradeCommand = (owner: Manager, target: string): string | null => COMMANDS[owner]?.(`${PACKAGE}@${target}`) ?? null;
export const upgradeGuidance = (owner: Manager): string =>
  owner === 'source' ? 'This is a source checkout; update it with git and rebuild.' :
  owner === 'npm_project' || owner === 'pnpm_project' ? 'Update the session-peer dependency in the project that installed it.' :
  owner === 'unknown' ? 'The installing package manager could not be identified; update session-peer with the tool that installed it.' :
  `Run updateCommand with ${owner}, which manages this installation.`;

export function registryUrl(env = process.env): URL {
  let url: URL;
  try { url = new URL(env.SESSION_PEER_UPDATE_REGISTRY || 'https://registry.npmjs.org/'); }
  catch { throw new Refusal('invalid_update_registry'); }
  // Plain HTTP only for loopback mirrors/fixtures; never embedded credentials.
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash)
    throw new Refusal('invalid_update_registry');
  return new URL(`-/package/${PACKAGE}/dist-tags`, url.href.endsWith('/') ? url.href : url.href + '/');
}
const networkFailure = (error: unknown) => new Refusal((error as Error)?.name === 'TimeoutError' ? 'registry_timeout' : 'registry_unreachable', 1);
// One bounded request, no retries. Response bodies are never reported.
export async function distTags(env = process.env): Promise<Record<string, unknown>> {
  const url = registryUrl(env);
  const signal = AbortSignal.timeout(TIMEOUT);
  let response: Response;
  try { response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal }); }
  catch (error) { throw networkFailure(error); }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new Refusal('registry_http_error', 1);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > RESPONSE_LIMIT) throw new Refusal('registry_response_invalid', 1);
      chunks.push(chunk);
    }
  } catch (error) { throw error instanceof Refusal ? error : networkFailure(error); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new Refusal('registry_response_invalid', 1); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Refusal('registry_response_invalid', 1);
  return value as Record<string, unknown>;
}

export function cacheDirectory(env = process.env, platform = process.platform): string {
  const configured = env.SESSION_PEER_CACHE_DIR;
  if (configured) {
    if (!isAbsolute(configured)) throw new Error('relative_cache_directory');
    return configured;
  }
  if (platform === 'win32') return join(env.LOCALAPPDATA && isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : join(homedir(), 'AppData', 'Local'), 'session-peer', 'Cache');
  if (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME)) return join(env.XDG_CACHE_HOME, 'session-peer');
  return join(homedir(), platform === 'darwin' ? 'Library/Caches' : '.cache', 'session-peer');
}
function privateDirectory(env: NodeJS.ProcessEnv): string {
  const directory = cacheDirectory(env);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory()) throw new Error('cache_not_directory');
  if (process.platform !== 'win32') {
    if (info.uid !== process.getuid!()) throw new Error('cache_not_owned');
    if (info.mode & 0o077) chmodSync(directory, 0o700);
  }
  return directory;
}
type CacheState = { status: 'missing' | 'invalid' | 'fresh' | 'expired'; latest?: string | null; checkedAt?: number };
export function readCache(env = process.env, now = Date.now()): CacheState {
  let value: unknown;
  try {
    const path = join(cacheDirectory(env), CACHE), info = lstatSync(path);
    if (!info.isFile() || info.size > CACHE_LIMIT) return { status: 'invalid' };
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) { return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid' }; }
  const record = value as Record<string, unknown>;
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.schemaVersion !== 1 || record.package !== PACKAGE ||
      record.source !== 'npm_registry' || record.channel !== 'latest') return { status: 'invalid' };
  const { latest, checkedAt } = record;
  if (typeof checkedAt !== 'number' || !Number.isSafeInteger(checkedAt) || checkedAt > now + 300_000 ||
      (latest !== null && !validVersion(latest, true))) return { status: 'invalid' };
  // A failed refresh (latest:null) only backs off further attempts.
  return { status: now - checkedAt < (latest === null ? FAILURE_TTL : TTL) ? 'fresh' : 'expired', latest: latest as string | null, checkedAt };
}
export function writeCache(latest: string | null, env = process.env, now = Date.now()): void {
  const directory = privateDirectory(env);
  const temporary = join(directory, `.${CACHE}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeSync(fd, JSON.stringify({ schemaVersion: 1, package: PACKAGE, source: 'npm_registry', channel: 'latest', latest, checkedAt: now }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, join(directory, CACHE));
  } finally { rmSync(temporary, { force: true }); }
}
// Single flight. Each acquisition writes a random token into an O_EXCL lock;
// the detached child inherits it. Stale takeover, cache publication and release
// run under a short O_EXCL mutex (itself token-owned) and first re-read the lock
// token, so only the current generation publishes or releases. A stale lock is
// replaced by atomically renaming a new token file over the exact generation
// observed, so the lock path is never missing. See PARITY.md for residual races.
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const readLock = (lock: string) => { try { return readFileSync(lock, 'utf8'); } catch { return undefined; } };
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function createLock(path: string): string | undefined {
  const token = randomUUID();
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined; throw error; }
  try { writeSync(fd, token); } finally { closeSync(fd); }
  return token;
}
// Remove `path` only if `owned` confirms the exact file: it is renamed to a
// unique name first (atomic), then checked, and restored with link() when it is
// someone else's. Restoring never overwrites a file created in the meantime.
function removeIfOwned(path: string, owned: (aside: string) => boolean): boolean {
  const aside = `${path}.${randomUUID()}.aside`;
  try { renameSync(path, aside); } catch { return false; }
  let mine = false;
  try { mine = owned(aside); } catch {}
  if (!mine) {
    try { linkSync(aside, path); }
    catch (error) {
      // Filesystems without hard links: rename back only while nothing newer exists.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') try { if (!existsSync(path)) renameSync(aside, path); } catch {}
    }
  }
  rmSync(aside, { force: true });
  return mine;
}
const mutexPath = (env: NodeJS.ProcessEnv) => join(cacheDirectory(env), `${LOCK}.takeover`);
type Identity = { dev: bigint; ino: bigint; mtimeNs: bigint };
// A mutex is held only across a few file operations. One older than LOCK_STALE
// belonged to a crashed process; it is reclaimed only if it is still the same
// inode with the same mtime that was judged stale.
export function reclaimMutex(observed: Identity, env = process.env): boolean {
  return removeIfOwned(mutexPath(env), aside => {
    const info = lstatSync(aside, { bigint: true });
    return info.dev === observed.dev && info.ino === observed.ino && info.mtimeNs === observed.mtimeNs;
  });
}
export function acquireMutex(env = process.env, now = Date.now()): string | undefined {
  const path = mutexPath(env), token = createLock(path);
  if (token) return token;
  try {
    const info = lstatSync(path, { bigint: true });
    if (now - Number(info.mtimeMs) >= LOCK_STALE) reclaimMutex(info, env);
  } catch {}
  return undefined;
}
export const releaseMutex = (token: string, env = process.env): boolean =>
  removeIfOwned(mutexPath(env), aside => readFileSync(aside, 'utf8') === token);
function exclusively<T>(env: NodeJS.ProcessEnv, now: number, action: () => T): T | undefined {
  const token = acquireMutex(env, now);
  if (!token) return undefined;
  try { return action(); } finally { releaseMutex(token, env); }
}
export function takeOverStaleLock(observed: string, env = process.env, now = Date.now()): string | undefined {
  const lock = join(privateDirectory(env), LOCK);
  return exclusively(env, now, () => {
    if (readLock(lock) !== observed) return undefined;
    const token = randomUUID(), temporary = `${lock}.${token}.tmp`;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeSync(fd, token); } finally { closeSync(fd); }
      // Windows can briefly refuse replacing a file another process is reading.
      for (let tries = 0; ; tries++) {
        try { renameSync(temporary, lock); break; }
        catch (error) {
          if (tries >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          pause(10);
        }
      }
      return token;
    } catch { return undefined; } finally { rmSync(temporary, { force: true }); }
  });
}
export function acquireLock(env = process.env, now = Date.now()): string | undefined {
  const lock = join(privateDirectory(env), LOCK);
  const token = createLock(lock);
  if (token) return token;
  let observed: string, age: number;
  // Read the token before the age so a replaced lock is never judged by an older mtime.
  try { observed = readFileSync(lock, 'utf8'); age = now - lstatSync(lock).mtimeMs; }
  catch { return createLock(lock); }
  return age < LOCK_STALE ? undefined : takeOverStaleLock(observed, env, now);
}
// Runs `action` only while `token` is the current lock generation, then releases
// the lock. A busy mutex is retried briefly; afterwards the lock expires as stale.
function asOwner(token: string | undefined, env: NodeJS.ProcessEnv, action: (lock: string) => void): boolean {
  if (!token || !TOKEN.test(token)) return false;
  let lock: string;
  try { lock = join(cacheDirectory(env), LOCK); } catch { return false; }
  for (let tries = 0; tries < 50; tries++) {
    const done = exclusively(env, Date.now(), () => {
      if (readLock(lock) !== token) return false;
      try { action(lock); } catch {}
      rmSync(lock, { force: true });
      return true;
    });
    if (done !== undefined) return done;
    pause(10);
  }
  return false;
}
export const releaseLock = (token: string | undefined, env = process.env): boolean => asOwner(token, env, () => {});
function scheduleRefresh(env: NodeJS.ProcessEnv, now: number): boolean {
  let token: string | undefined;
  try {
    token = acquireLock(env, now);
    if (!token) return false;
    const owned = token;
    const child = spawn(process.execPath, [fileURLToPath(new URL('./cli.js', import.meta.url)), REFRESH_ARG],
      { detached: true, stdio: 'ignore', windowsHide: true, env: { ...env, [LOCK_TOKEN]: owned } });
    child.once('error', () => releaseLock(owned, env));
    child.unref();
    return true;
  } catch {
    releaseLock(token, env);
    return false;
  }
}
// Background refresh: only the current lock generation publishes, and never over
// a cache record written after this refresh started (e.g. an explicit check).
export async function refreshCache(env = process.env): Promise<void> {
  const token = env[LOCK_TOKEN], started = Date.now();
  if (!token || !TOKEN.test(token)) return;
  let latest: string | null = null;
  try {
    const tags = await distTags(env);
    if (validVersion(tags.latest, true)) latest = tags.latest as string;
  } catch {}
  asOwner(token, env, () => {
    const current = readCache(env);
    if (current.checkedAt === undefined || current.checkedAt < started) writeCache(latest, env);
  });
}

const truthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
export const noticesEnabled = (optOut: boolean, env = process.env) =>
  !optOut && !truthy(env.SESSION_PEER_NO_UPDATE_NOTICE) && truthy(env.SESSION_PEER_UPDATE_NOTICE);
// Advisory and client-side only: reads the local cache, at most schedules one
// detached refresh, and never throws into or delays the requested command.
export function updateNotice(optOut: boolean, env = process.env, now = Date.now()): Record<string, unknown> | undefined {
  try {
    if (!noticesEnabled(optOut, env)) return undefined;
    const state = readCache(env, now);
    if (state.status !== 'fresh') { scheduleRefresh(env, now); return undefined; }
    if (!state.latest || compareVersions(VERSION, state.latest) >= 0) return undefined;
    const owner = manager();
    return { schemaVersion: 1, status: 'available', current: VERSION, latest: state.latest, channel: 'latest',
      checkedAt: new Date(state.checkedAt!).toISOString().replace(/\.\d{3}Z$/, 'Z'), source: 'npm_registry_cache',
      managedBy: owner, command: upgradeCommand(owner, state.latest), guidance: upgradeGuidance(owner) };
  } catch { return undefined; }
}
export const noticeText = (notice: Record<string, unknown>) =>
  `Update available: session-peer ${notice.current} -> ${notice.latest} (npm dist-tag latest). ` +
  (notice.command ? `Run: ${notice.command}` : String(notice.guidance));

export async function checkUpdate(channel = 'latest', env = process.env): Promise<Record<string, unknown>> {
  const tags = await distTags(env);
  if (tags[channel] === undefined) throw new Refusal('dist_tag_missing', 1);
  const latest = tags[channel];
  if (!validVersion(latest, channel === 'latest')) throw new Refusal('registry_response_invalid', 1);
  if (channel === 'latest') try { writeCache(latest as string, env); } catch {}
  const position = compareVersions(VERSION, latest as string), owner = manager();
  return { ok: true, package: PACKAGE, current: VERSION, latest, channel, distTag: channel, source: 'npm_registry',
    status: position < 0 ? 'update_available' : position === 0 ? 'up_to_date' : 'ahead', outdated: position < 0,
    updated: false, managedBy: owner, updateCommand: position < 0 ? upgradeCommand(owner, latest as string) : null,
    guidance: position < 0 ? upgradeGuidance(owner) : `No update is needed for the ${channel} dist-tag.`,
    skills: inspectSkills(), skillsManagedBy: 'separate' };
}
// npm-owned files are never replaced in place; the owning manager installs updates.
export function refuseSelfUpdate(channel = 'latest'): never {
  const owner = manager();
  throw new UpdateRefusal('self_update_unsupported', { updated: false, managedBy: owner,
    updateCommand: upgradeCommand(owner, channel), guidance: upgradeGuidance(owner), checkCommand: `session-peer update --check${channel === 'latest' ? '' : ` --channel ${channel}`} --json` });
}
