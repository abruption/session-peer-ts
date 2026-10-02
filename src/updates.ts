// Update checks read only public npm dist-tags. They never install packages,
// replace npm-owned files, or touch Python installs, remote hosts or skills.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSkills } from './diagnostics.js';
import { Refusal } from './discovery.js';
import { VERSION } from './protocol.js';

export const PACKAGE = 'session-peer';
export const REFRESH_ARG = '--_refresh-update-cache';
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

export type Manager = 'npm' | 'npm_project' | 'pnpm' | 'pnpm_project' | 'yarn' | 'bun' | 'npx' | 'source';
// Guidance follows the resolved CLI file; a checkout or `npm link` is source-managed.
export function manager(path = fileURLToPath(import.meta.url), platform = process.platform): Manager {
  const file = path.replace(/\\/g, '/').toLowerCase();
  if (!file.includes('/node_modules/session-peer/')) return 'source';
  if (file.includes('/_npx/')) return 'npx';
  if (file.includes('/pnpm/global/')) return 'pnpm';
  if (file.includes('/.pnpm/')) return 'pnpm_project';
  if (file.includes('/.bun/install/global/')) return 'bun';
  if (/\/yarn\/(?:data\/)?global\//.test(file)) return 'yarn';
  const global = platform === 'win32' ? /\/(?:npm|nodejs)\/node_modules\/session-peer\// : /\/lib\/node_modules\/session-peer\//;
  return global.test(file) ? 'npm' : 'npm_project';
}
const COMMANDS: Record<Manager, ((spec: string) => string) | undefined> = {
  npm: spec => `npm install --global --ignore-scripts ${spec}`,
  npm_project: spec => `npm install --ignore-scripts ${spec}`,
  pnpm: spec => `pnpm add --global --ignore-scripts ${spec}`,
  pnpm_project: spec => `pnpm add --ignore-scripts ${spec}`,
  yarn: spec => `yarn global add --ignore-scripts ${spec}`,
  bun: spec => `bun add --global --ignore-scripts ${spec}`,
  npx: spec => `npx --yes --ignore-scripts ${spec} --version`,
  source: undefined
};
export const upgradeCommand = (owner: Manager, target: string): string | null => COMMANDS[owner]?.(`${PACKAGE}@${target}`) ?? null;

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
// Single flight: the O_EXCL lock is created here and removed by the detached child.
function scheduleRefresh(env: NodeJS.ProcessEnv, now: number): boolean {
  let owned: string | undefined;
  try {
    const lock = join(privateDirectory(env), LOCK);
    let fd: number;
    try { fd = openSync(lock, 'wx', 0o600); }
    catch (error) {
      // A stale lock (crashed refresh) is replaced once; losing that race skips.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || now - lstatSync(lock).mtimeMs < LOCK_STALE) return false;
      unlinkSync(lock);
      fd = openSync(lock, 'wx', 0o600);
    }
    owned = lock;
    try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
    const child = spawn(process.execPath, [fileURLToPath(new URL('./cli.js', import.meta.url)), REFRESH_ARG],
      { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.once('error', () => { try { rmSync(lock, { force: true }); } catch {} });
    child.unref();
    return true;
  } catch {
    if (owned) try { rmSync(owned, { force: true }); } catch {}
    return false;
  }
}
export async function refreshCache(env = process.env): Promise<void> {
  try {
    let latest: string | null = null;
    try {
      const tags = await distTags(env);
      if (validVersion(tags.latest, true)) latest = tags.latest as string;
    } catch {}
    try { writeCache(latest, env); } catch {}
  } finally {
    try { rmSync(join(cacheDirectory(env), LOCK), { force: true }); } catch {}
  }
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
      managedBy: owner, command: upgradeCommand(owner, state.latest) };
  } catch { return undefined; }
}
export const noticeText = (notice: Record<string, unknown>) =>
  `Update available: session-peer ${notice.current} -> ${notice.latest} (npm dist-tag latest). ` +
  (notice.command ? `Run: ${notice.command}` : 'Update this source checkout and rebuild.');

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
    skills: inspectSkills(), skillsManagedBy: 'separate' };
}
// npm-owned files are never replaced in place; the owning manager installs updates.
export function refuseSelfUpdate(channel = 'latest'): never {
  const owner = manager();
  throw new UpdateRefusal('self_update_unsupported', { updated: false, managedBy: owner,
    updateCommand: upgradeCommand(owner, channel), checkCommand: `session-peer update --check${channel === 'latest' ? '' : ` --channel ${channel}`} --json` });
}
