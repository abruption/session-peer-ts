// Read-only discovery: no inbox connections, writer selection, queue or DB writes.
// Windows Claude metadata uses native process inspection.
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { windowsProcessStart } from './windows.js';

type Row = Record<string, unknown>;
export class Refusal extends Error {
  constructor(readonly code: string, readonly exitCode = 2) { super(code); }
}
// Codex can relocate state_5.sqlite/queue_1.sqlite with `sqlite_home`; validation
// reads <home>/state_5.sqlite, so any configured relocation is unsupported.
export function sqliteHome(home: string): 'default' | 'configured' | 'unknown' {
  let text: string;
  try {
    const file = join(home, 'config.toml'), stat = statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return 'unknown';
    text = readFileSync(file, 'utf8');
  } catch (error) { return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'default' : 'unknown'; }
  return /^[ \t]*["']?sqlite_home["']?[ \t]*=/m.test(text) ? 'configured' : 'default';
}

function missing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
}
export function canonical(path: string): string {
  if (path === '~' || path.startsWith('~/')) path = join(homedir(), path.slice(2));
  else if (path.startsWith('~')) throw new Refusal('unsupported_home_expansion');
  return canonicalPath(resolve(path), new Set());
}
function canonicalPath(absolute: string, seen: Set<string>): string {
  if (seen.has(absolute)) throw new Refusal('home_resolution_failed', 1);
  seen.add(absolute);
  try { return realpathSync(absolute); }
  catch (error) {
    if (!missing(error)) throw new Refusal('home_resolution_failed', 1);
    // realpath fails for dangling links. Resolve the link itself before falling
    // back to its parent, so missing aliases still merge required source labels.
    let target: string | undefined;
    try { if (lstatSync(absolute).isSymbolicLink()) target = readlinkSync(absolute); }
    catch (linkError) { if (!missing(linkError)) throw new Refusal('home_resolution_failed', 1); }
    if (target !== undefined) return canonicalPath(resolve(dirname(absolute), target), seen);
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonicalPath(parent, seen), absolute.slice(parent.length));
  }
}
function alive(pid: number): boolean {
  if (pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
export function claude(all: boolean): Row {
  const directory = join(process.env.CLAUDE_CONFIG_DIR || process.env.ANTHROPIC_CONFIG_DIR || join(homedir(), '.claude'), 'sessions');
  let entries: string[];
  try { entries = readdirSync(directory).sort(); }
  catch (error) {
    if (missing(error)) entries = [];
    else throw new Refusal('claude_discovery_failed', 1);
  }
  const sessions: Row[] = [];
  for (const entry of entries) {
    if (!/^[0-9]+\.json$/.test(entry)) continue;
    let record: Row;
    try {
      const value: unknown = JSON.parse(readFileSync(join(directory, entry), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      record = value as Row;
    } catch { continue; }
    const pid = record.pid;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid > 2147483647) continue;
    const matches = pid === Number(entry.slice(0, -5));
    let live = matches && process.platform !== 'win32' && alive(pid);
    if (matches && process.platform === 'win32') {
      const started = typeof record.startedAt === 'number' && Number.isSafeInteger(record.startedAt) && record.startedAt > 0 ? record.startedAt : NaN;
      const ticks = windowsProcessStart(pid);
      const actual = ticks === undefined ? NaN : Number((ticks - 116444736000000000n) / 10000n);
      live = Number.isFinite(started) && Number.isFinite(actual) && actual <= started + 2000;
    }
    const socket = typeof record.messagingSocketPath === 'string' ? record.messagingSocketPath : '';
    let inbox = false;
    if (socket) {
      if (process.platform === 'win32') inbox = /^\\\\\.\\pipe\\[^\r\n]+$/i.test(socket);
      else try { inbox = statSync(socket).isSocket(); } catch { /* Inaccessible is not reachable. */ }
    }
    const row: Row = { agent: 'claude', pid, socket, alive: live, reachable: live && inbox };
    for (const key of ['name', 'status', 'cwd', 'kind', 'version', 'tmux']) row[key] = record[key] ?? null;
    if (!matches) row.staleReason = 'record_pid_mismatch';
    else if (!live && process.platform === 'win32') row.staleReason = 'process_unverified';
    if (all || row.reachable) sessions.push(row);
  }
  return { sessions, discovery: { claude: { status: 'ok' } } };
}

// Shared bounded sources; listing accumulates diagnostics while writer inventory
// keeps its stricter, fail-closed policy. No recursive scan or credential reads.
export function configuredHomePaths(): string[] {
  const value = process.env.SESSION_PEER_CODEX_HOMES;
  if (value === undefined) return [];
  let paths: unknown;
  try { paths = JSON.parse(value); } catch { throw new Refusal('invalid_home_configuration', 1); }
  if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string' || !p.trim() ||
      p.includes('\0') || (!isAbsolute(p) && !p.startsWith('~/')))) {
    throw new Refusal('invalid_home_configuration', 1);
  }
  return paths;
}
export function orcaHomePaths(): string[] {
  const directory = join(homedir(), 'Library/Application Support/orca/codex-accounts');
  return readdirSync(directory).sort(compareText).map(entry => join(directory, entry, 'home'));
}
function compareText(a: string, b: string): number {
  // Python sorts Unicode code points, independent of locale and UTF-16 ordering.
  const left = [...a], right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const diff = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (diff) return diff;
  }
  return left.length - right.length;
}
type Candidate = { codexHome: string; stateDb: string; sources: string[]; required: boolean };
type Listing = { sessions: Row[]; discovery: Record<string, Row>; ok?: boolean; codexHome?: string; error?: string };
export function listingCandidates(explicit?: string): { homes: Candidate[]; errors: Row[] } {
  const candidates = new Map<string, Candidate>(), errors: Row[] = [];
  function add(path: string, source: string, required: boolean) {
    let home: string;
    try { home = canonical(path); }
    catch { errors.push({ source, path, code: 'home_resolution_failed', error: 'home_resolution_failed' }); return; }
    const item = candidates.get(home) ?? { codexHome: home, stateDb: join(home, 'state_5.sqlite'), sources: [], required: false };
    if (!item.sources.includes(source)) item.sources.push(source);
    item.required ||= required;
    candidates.set(home, item);
  }
  if (explicit !== undefined) add(explicit, 'argument', true);
  else {
    add(join(homedir(), '.codex'), 'default', false);
    if (process.env.CODEX_HOME) add(process.env.CODEX_HOME, 'environment', true);
    if (process.platform === 'darwin') {
      try { for (const home of orcaHomePaths()) add(home, 'orca', false); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          errors.push({ source: 'orca', path: join(homedir(), 'Library/Application Support/orca/codex-accounts'),
            code: 'candidate_enumeration_failed', error: 'candidate_enumeration_failed' });
        }
      }
    }
    try { for (const home of configuredHomePaths()) add(home, 'configured', true); }
    catch { errors.push({ source: 'configured', code: 'invalid_home_configuration', error: 'invalid_home_configuration' }); }
  }
  return { homes: [...candidates.values()], errors };
}
async function readCodex(home: string, file: string, all: boolean): Promise<Row[]> {
  // Lazy import: Claude-only commands don't initialize experimental SQLite.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000');
    const columns = new Set((db.prepare('PRAGMA table_info(threads)').all() as Row[]).map(row => row.name));
    const required = ['id', 'title', 'cwd', 'updated_at', 'archived', 'rollout_path'];
    if (!required.every(name => columns.has(name))) throw new Error('unsupported_schema');
    const name = columns.has('name') ? "COALESCE(NULLIF(name, ''), NULLIF(title, ''), id)" : "COALESCE(NULLIF(title, ''), id)";
    const rows = db.prepare(`SELECT id, ${name} AS display_name, cwd, updated_at, archived FROM threads ${all ? '' : 'WHERE archived = 0'} ORDER BY updated_at DESC, id ASC`).all() as Row[];
    return rows.map(row => {
      if (typeof row.id !== 'string' || !row.id || typeof row.display_name !== 'string' ||
          typeof row.updated_at !== 'number' || !Number.isSafeInteger(row.updated_at) ||
          typeof row.archived !== 'number' || (row.cwd !== null && typeof row.cwd !== 'string')) {
        throw new Error('unsupported_row');
      }
      const firstLine = row.display_name.split(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u)[0] ?? '';
      return { agent: 'codex', id: row.id, name: [...firstLine].slice(0, 120).join(''),
        cwd: row.cwd, updatedAt: row.updated_at, archived: Boolean(row.archived),
        codexHome: home, stateDb: file };
    });
  } finally { db.close(); }
}
export async function codex(path: string | undefined, all: boolean): Promise<Listing> {
  const { homes, errors } = listingCandidates(path);
  const sessions: Row[] = [], diagnostics: Row[] = [];
  for (const { required, ...item } of homes) {
    let code: string | undefined;
    let absent = false;
    try {
      if (!statSync(item.stateDb).isFile()) code = 'state_db_not_regular';
    } catch (error) {
      if (missing(error)) { if (required) code = 'state_db_missing'; else absent = true; }
      else code = ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'permission_denied' : 'state_db_read_failed';
    }
    let rows: Row[] = [];
    if (!code && !absent) {
      try { rows = await readCodex(item.codexHome, item.stateDb, all); }
      catch (error) { code = ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'permission_denied' : 'state_db_read_failed'; }
    }
    sessions.push(...rows);
    diagnostics.push({ ...item, ...(code ? { status: 'error', code, error: code } :
      absent ? { status: 'absent', code: 'state_db_absent' } : { status: 'ok', sessionCount: rows.length }) });
  }
  sessions.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt) ||
    compareText(String(a.codexHome), String(b.codexHome)) || compareText(String(a.id), String(b.id)));
  const failed = errors.length > 0 || diagnostics.some(item => item.status === 'error');
  const discovery: Row = { status: failed ? 'error' : diagnostics.some(item => item.status === 'ok') ? 'ok' : 'not_installed', homes: diagnostics };
  if (errors.length) discovery.errors = errors;
  if (failed) discovery.error = 'Codex home discovery is incomplete; inspect homes and errors';
  return { sessions, discovery: { codex: discovery }, ok: !failed,
    ...(homes.length === 1 && !errors.length ? { codexHome: homes[0]!.codexHome } : {}),
    ...(failed ? { error: 'Discovery failed for: codex' } : {}) };
}
export async function listing(agent: 'claude' | 'codex' | undefined, home: string | undefined, all: boolean): Promise<Listing> {
  const result: Listing = { sessions: [], discovery: {}, ok: true };
  for (const name of agent ? [agent] : ['claude', 'codex']) {
    try {
      const found = name === 'claude' ? claude(all) as Listing : await codex(home, all);
      result.sessions.push(...found.sessions);
      Object.assign(result.discovery, found.discovery);
      if (found.codexHome !== undefined) result.codexHome = found.codexHome;
    } catch (error) {
      const code = error instanceof Refusal ? error.code : 'discovery_failed';
      result.discovery[name] = { status: 'error', error: code };
    }
  }
  const failed = Object.keys(result.discovery).filter(name => result.discovery[name]!.status === 'error');
  if (failed.length) { result.ok = false; result.error = 'Discovery failed for: ' + failed.join(', '); }
  return result;
}
