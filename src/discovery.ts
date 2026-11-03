// Read-only discovery: no inbox connections, writer selection, queue or DB writes.
// Windows Claude metadata uses native process inspection.
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readlinkSync, readSync, readdirSync, realpathSync, statSync, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { MACOS_ACL_LIMITS, inspectMacosAcls } from './macos-acl.js';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { windowsProcessStart } from './windows.js';

type Row = Record<string, unknown>;
export class Refusal extends Error {
  constructor(readonly code: string, readonly exitCode = 2) { super(code); }
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
// Automatic profiles are a macOS Orca convention, not a recursive home scan.
export const CLAUDE_PROFILE_LIMIT = 128;
export const CLAUDE_ENTRY_LIMIT = 4096;
const CLAUDE_RECORD_LIMIT = 1024 * 1024;
type DirectoryProof = { path: string; identity: string; sameUser: boolean; direct: boolean };
type ClaudeProof = { directory: string; canonical: string; chain: DirectoryProof[]; record: string;
  recordIdentity: string; privateRecord: boolean; endpoint: string | null; startedAt: unknown };
const claudeProofs = new WeakMap<Row, ClaudeProof>();
type InventoryProof = { path: string; direct: boolean; identity: string | null };
const claudeInventories = new WeakMap<Row, readonly InventoryProof[]>();
const claudeAclPaths = new WeakMap<Row, readonly string[]>();
export const CLAUDE_ACL_LIMITS = MACOS_ACL_LIMITS;
const nodeIdentity = (s: Stats) => [s.dev, s.ino, s.uid, s.mode].join(':');
const privateNode = (s: Stats) => typeof process.getuid === 'function' && s.uid === process.getuid() && (s.mode & 0o022) === 0;
const recordIdentity = (s: Stats) => [nodeIdentity(s), s.size, s.mtimeMs, s.ctimeMs, s.birthtimeMs].join(':');
function safeDirectory(path: string, sameUser: boolean, direct = true): DirectoryProof {
  const node = direct ? lstatSync(path) : statSync(path);
  if (!node.isDirectory() || (sameUser && !privateNode(node))) throw new Error('unsafe_directory');
  return { path, sameUser, direct, identity: nodeIdentity(node) };
}
function directoryUnchanged(proof: DirectoryProof): boolean {
  return safeDirectory(proof.path, proof.sameUser, proof.direct).identity === proof.identity;
}
function boundedEntries(path: string, limit: number): { entries: string[]; limited: boolean } {
  const directory = opendirSync(path), entries: string[] = [];
  try {
    while (true) {
      const item = directory.readSync();
      if (!item) return { entries: entries.sort(compareText), limited: false };
      if (entries.length >= limit) return { entries: entries.sort(compareText), limited: true };
      entries.push(item.name);
    }
  } finally { directory.closeSync(); }
}
// Reads bounded session-registration JSON, which may contain extra native
// fields. No separate credential/transcript files are opened and record contents
// are not persisted. Read at most 1 MiB + one
// overflow byte; stable descriptor/path checks are observational, not an atomic
// filesystem snapshot or a deadline for blocking filesystem I/O.
function claudeRecord(file: string, requirePrivate = false): { value: unknown; identity: string } | undefined {
  const before = lstatSync(file);
  if (!before.isFile() || before.size > CLAUDE_RECORD_LIMIT || (requirePrivate && !privateNode(before))) return undefined;
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK | constants.O_NOFOLLOW);
  const fd = openSync(file, flags);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > CLAUDE_RECORD_LIMIT || (requirePrivate && !privateNode(opened)) ||
        recordIdentity(opened) !== recordIdentity(before)) return undefined;
    const bytes = Buffer.alloc(CLAUDE_RECORD_LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    const final = fstatSync(fd), current = lstatSync(file);
    if (length > CLAUDE_RECORD_LIMIT || !current.isFile() ||
        (requirePrivate && (!privateNode(final) || !privateNode(current))) || recordIdentity(final) !== recordIdentity(opened) ||
        recordIdentity(current) !== recordIdentity(opened)) return undefined;
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))), identity: recordIdentity(opened) };
  } finally { closeSync(fd); }
}
function endpointIdentity(socket: string): string | null {
  if (!socket || socket.includes('\0')) return null;
  if (process.platform === 'win32') return /^\\\\\.\\pipe\\[^\r\n]+$/i.test(socket) ? socket.toLowerCase() : null;
  const alias = lstatSync(socket), canonical = realpathSync(socket), target = lstatSync(canonical);
  return target.isSocket() ? JSON.stringify([canonical, alias.dev, alias.ino, target.dev, target.ino]) : null;
}
function claudeLive(record: Row, matches: boolean, unknown?: () => void, absent?: () => void): boolean {
  if (!matches) return false;
  const pid = Number(record.pid);
  if (pid <= 1) return false; // Known-invalid PID is stale, not a failed native inspection.
  if (process.platform !== 'win32') {
    try { process.kill(pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') unknown?.(); return false; }
  }
  const started = typeof record.startedAt === 'number' && Number.isSafeInteger(record.startedAt) && record.startedAt > 0 ? record.startedAt : NaN;
  const ticks = windowsProcessStart(pid);
  if (ticks === undefined) {
    // A stale registry for a positively absent PID is not an inventory failure.
    // Signal 0 is absence-only evidence here; it never establishes a live
    // Windows incarnation or replaces the native creation-time check.
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { absent?.(); return false; } }
    unknown?.(); return false;
  }
  const actual = Number((ticks - 116444736000000000n) / 10000n);
  if (!Number.isFinite(started) || !Number.isFinite(actual)) { unknown?.(); return false; }
  return actual <= started + 2000;
}
export type ClaudeInventory = { sessions: Row[]; errors: string[]; directories: string[]; records: number;
  invalidRecords: number; permissionFailures: number; unknownInspections: number;
  selectedStatus: 'present' | 'missing' | 'unsupported' | 'permission_denied' | 'unknown' };
export function claudeInventory(): ClaudeInventory {
  const selected = join(process.env.CLAUDE_CONFIG_DIR || process.env.ANTHROPIC_CONFIG_DIR || join(homedir(), '.claude'), 'sessions');
  const inventory: ClaudeInventory = { sessions: [], errors: [], directories: [selected], records: 0,
    invalidRecords: 0, permissionFailures: 0, unknownInspections: 0, selectedStatus: 'missing' };
  const errors = inventory.errors;
  const directories: { directory: string; chain: DirectoryProof[]; automatic: boolean }[] = [];
  // Keep every observed source, numeric record and POSIX endpoint (including
  // absence) fenced until the WHOLE inventory is complete. Later reads can
  // mutate an earlier source without changing a directory entry.
  const scanEvidence: InventoryProof[] = [];
  const aclPaths = new Set<string>();
  function observeMetadata(path: string, direct = true): void {
    let identity: string | null;
    try { identity = recordIdentity(direct ? lstatSync(path) : statSync(path)); }
    catch (error) { if (!missing(error)) throw error; identity = null; }
    scanEvidence.push({ path, direct, identity });
  }
  function observeDirectory(path: string, sameUser: boolean, direct = true): DirectoryProof {
    observeMetadata(path, direct);
    const proof = safeDirectory(path, sameUser, direct);
    if (sameUser) aclPaths.add(path);
    return proof;
  }
  function failure(code: string, error?: unknown) {
    if (!errors.includes(code)) errors.push(code);
    if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException | undefined)?.code ?? '')) inventory.permissionFailures++;
  }
  try {
    directories.push({ directory: selected, chain: [observeDirectory(selected, false, false)], automatic: false }); inventory.selectedStatus = 'present';
  } catch (error) {
    if (!missing(error)) {
      inventory.selectedStatus = ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'permission_denied' :
        error instanceof Error && error.message === 'unsafe_directory' ? 'unsupported' : 'unknown';
      failure('sessions_directory_unavailable', error);
    }
  }
  if (process.platform === 'darwin' && !process.env.CLAUDE_CONFIG_DIR && !process.env.ANTHROPIC_CONFIG_DIR) {
    const base = join(homedir(), 'Library/Application Support/orca/claude-profiles');
    try {
      const baseProof = observeDirectory(base, true), before = recordIdentity(lstatSync(base));
      const found = boundedEntries(base, CLAUDE_PROFILE_LIMIT);
      if (found.limited) failure('profile_inventory_limit');
      for (const name of found.entries) {
        const profile = join(base, name);
        try {
          const node = lstatSync(profile);
          if (node.isFile()) continue; // Finder/metadata files are not profile homes.
          const chain = [baseProof, observeDirectory(profile, true), observeDirectory(join(profile, 'home'), true),
            observeDirectory(join(profile, 'home/sessions'), true)];
          const directory = join(profile, 'home/sessions');
          directories.push({ directory, chain, automatic: true }); inventory.directories.push(directory);
        } catch (error) { if (!missing(error)) failure('profile_directory_unavailable', error); }
      }
      if (!directoryUnchanged(baseProof) || recordIdentity(lstatSync(base)) !== before) failure('profile_inventory_changed');
    } catch (error) { if (!missing(error)) failure('profile_inventory_unavailable', error); }
  }
  // Resolve the strictest requirements before deduplicating aliases. A legacy
  // default path can alias an automatic registry; scanning that alias first
  // must not downgrade the automatic record ownership/write-mode checks.
  const automaticDirectories = new Set<string>();
  for (const item of directories.filter(item => item.automatic)) {
    try { automaticDirectories.add(realpathSync(item.directory)); }
    catch (error) { failure('profile_directory_unavailable', error); }
  }
  const multiple = directories.some(item => item.automatic) || directories.length > 1 || errors.length > 0;
  const invalid = () => { inventory.invalidRecords++; if (multiple) failure('session_record_unavailable'); };
  let enumerated = 0;
  const scanned = new Set<string>();
  for (const { directory, chain } of directories) {
    try {
      if (!chain.every(directoryUnchanged)) throw new Error('registry_changed');
      const canonical = realpathSync(directory), scanKey = canonical + ':' + chain.at(-1)!.identity;
      const privateRecord = automaticDirectories.has(canonical);
      if (scanned.has(scanKey)) continue;
      scanned.add(scanKey);
      const before = recordIdentity(statSync(directory));
      const found = boundedEntries(directory, CLAUDE_ENTRY_LIMIT - enumerated);
      enumerated += found.entries.length;
      if (found.limited) failure('session_inventory_limit');
      for (const entry of found.entries) {
        if (!/^[0-9]+\.json$/.test(entry)) continue;
        const path = join(directory, entry);
        let read: ReturnType<typeof claudeRecord>;
        try {
          // Every numeric record, including invalid/unreachable ones, remains
          // fenced: an in-place edit can introduce a competing identity without
          // changing its directory's metadata. Never reread bodies in the fence.
          observeMetadata(path);
          if (privateRecord) aclPaths.add(path);
          read = claudeRecord(path, privateRecord);
        }
        catch (error) {
          if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) failure('record_unavailable', error);
          else if (error instanceof SyntaxError || error instanceof TypeError || missing(error)) invalid();
          else { inventory.unknownInspections++; failure('record_unavailable'); }
          continue;
        }
        const value = read?.value;
        if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid(); continue; }
        const record = value as Row, pid = record.pid;
        if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) { invalid(); continue; }
        inventory.records++;
        const matches = pid === Number(entry.slice(0, -5));
        let processUnknown = false, processAbsent = false;
        const live = claudeLive(record, matches, () => { processUnknown = true; inventory.unknownInspections++; failure('process_unverified'); }, () => { processAbsent = true; });
        const socket = typeof record.messagingSocketPath === 'string' ? record.messagingSocketPath : '';
        let endpoint: string | null = null;
        try {
          if (socket && !socket.includes('\0') && process.platform !== 'win32') {
            // Track both advertised alias and followed endpoint, including an
            // observed absence. Retargeting an unselected alias can otherwise
            // introduce a conflict after its registry record was inspected.
            observeMetadata(socket); observeMetadata(socket, false);
          }
          endpoint = endpointIdentity(socket);
          if (endpoint && process.platform !== 'win32') observeMetadata(String(JSON.parse(endpoint)[0]));
        } catch (error) {
          if (!missing(error)) { inventory.unknownInspections++; failure('endpoint_unavailable', error); }
        }
        const row: Row = { agent: 'claude', pid, socket, alive: live, reachable: live && endpoint !== null };
        for (const key of ['name', 'status', 'cwd', 'kind', 'version', 'tmux']) row[key] = record[key] ?? null;
        if (!matches) row.staleReason = 'record_pid_mismatch';
        else if (processUnknown) row.staleReason = 'process_unverified';
        else if (!live && process.platform === 'win32') row.staleReason = processAbsent ? 'process_absent' : 'process_unverified';
        claudeProofs.set(row, { directory, canonical, chain, record: path, recordIdentity: read!.identity, privateRecord,
          endpoint, startedAt: typeof record.startedAt === 'number' ? record.startedAt : null });
        inventory.sessions.push(row);
      }
      if (!chain.every(directoryUnchanged) || realpathSync(directory) !== canonical ||
          recordIdentity(statSync(directory)) !== before) failure('sessions_directory_changed');
    } catch (error) { failure('sessions_directory_unavailable', error); }
  }
  const aclStatus = inspectMacosAcls([...aclPaths]);
  if (aclStatus !== 'clear') failure(aclStatus === 'acl' ? 'claude_extended_acl' : 'claude_acl_unavailable');
  for (const observed of scanEvidence) {
    let current: string | null;
    try { current = recordIdentity(observed.direct ? lstatSync(observed.path) : statSync(observed.path)); }
    catch (error) {
      if (!missing(error)) { failure('claude_inventory_changed', error); continue; }
      current = null;
    }
    if (current !== observed.identity) failure('claude_inventory_changed');
  }
  const frozenEvidence = Object.freeze(scanEvidence.map(item => Object.freeze({ ...item })));
  const frozenAclPaths = Object.freeze([...aclPaths]);
  for (const row of inventory.sessions) {
    claudeInventories.set(row, frozenEvidence); claudeAclPaths.set(row, frozenAclPaths);
  }
  // Exact registry aliases are scanned once. Divergent live PID, inbox-string or
  // underlying socket claims are conflicts, independent of directory order.
  const byPid = new Map<number, Row[]>(), bySocket = new Map<string, Row[]>(), byEndpoint = new Map<string, Row[]>();
  const conflicts = new Set<Row>();
  for (const row of inventory.sessions) {
    if (!row.alive) continue;
    const proof = claudeProofs.get(row)!, endpoint = proof.endpoint;
    const underlying = endpoint && process.platform !== 'win32' ? JSON.stringify(JSON.parse(endpoint).slice(-2)) : endpoint;
    const peers = new Set([...(byPid.get(Number(row.pid)) ?? []), ...(row.socket ? bySocket.get(String(row.socket)) ?? [] : []),
      ...(underlying ? byEndpoint.get(underlying) ?? [] : [])]);
    for (const other of peers) { conflicts.add(other); conflicts.add(row); }
    byPid.set(Number(row.pid), [...(byPid.get(Number(row.pid)) ?? []), row]);
    if (row.socket) bySocket.set(String(row.socket), [...(bySocket.get(String(row.socket)) ?? []), row]);
    if (underlying) byEndpoint.set(underlying, [...(byEndpoint.get(underlying) ?? []), row]);
  }
  if (conflicts.size) failure('conflicting_session_records');
  for (const row of conflicts) { row.reachable = false; row.staleReason = 'conflicting_session_records'; }
  return inventory;
}
// Private provenance is not serialized in ordinary rows and never becomes a
// public native-generation claim. It binds the selected registry and endpoint
// across async hooks; it is not authentication against a same-user writer.
// Metadata-only final fence: identity validation above/below can itself read
// registry files. Call this AFTER those reads, without recursively rediscovering
// or reading another record and opening another unfenced inventory window.
export function revalidateClaudeInventory(row: Row, other?: Row): void {
  const rows = other ? [row, other] : [row];
  const evidence: InventoryProof[] = [], paths = new Set<string>();
  for (const selected of rows) {
    const metadata = claudeInventories.get(selected), acls = claudeAclPaths.get(selected);
    if (!metadata || !acls) throw new Refusal('claude_discovery_incomplete', 1);
    evidence.push(...metadata); for (const path of acls) paths.add(path);
  }
  const metadataUnchanged = () => {
    for (const observed of evidence) {
      let current: string | null;
      try { current = recordIdentity(observed.direct ? lstatSync(observed.path) : statSync(observed.path)); }
      catch (error) {
        if (!missing(error)) throw new Refusal('claude_discovery_incomplete', 1);
        current = null;
      }
      if (current !== observed.identity) throw new Refusal('claude_discovery_incomplete', 1);
    }
  };
  // An ACL/path mutation while the synchronous helper is running must not be
  // accepted from an earlier clear result. These remain observational checks,
  // not an atomic filesystem snapshot or a universal kernel-I/O deadline.
  metadataUnchanged();
  if (inspectMacosAcls([...paths]) !== 'clear') throw new Refusal('claude_discovery_incomplete', 1);
  metadataUnchanged();
}
export function claudeSelectionIdentity(row: Row): string {
  const proof = claudeProofs.get(row);
  if (!proof) throw new Refusal('target_changed', 1);
  try {
    if (!proof.chain.every(directoryUnchanged) || realpathSync(proof.directory) !== proof.canonical) throw new Error();
    const read = claudeRecord(proof.record, proof.privateRecord), value = read?.value as Row | undefined;
    if (!read || !value || read.identity !== proof.recordIdentity || value.pid !== row.pid ||
        (value.messagingSocketPath ?? '') !== row.socket ||
        (typeof value.startedAt === 'number' ? value.startedAt : null) !== proof.startedAt ||
        !claudeLive(value, true) || endpointIdentity(String(row.socket)) !== proof.endpoint) throw new Error();
    return createHash('sha256').update(JSON.stringify(proof)).digest('hex');
  } catch { throw new Refusal('target_changed', 1); }
}
// Private opt-in receipt binding only. This is never a public row or native
// generation, and does not grant an action to a recipient or authenticate a model.
export type ClaudeReceiptProvenance = Readonly<{ registryDirectory: string; registryRecordPath: string;
  registryIdentity: string; socketPath: string; routeIdentity: string }>;
export function claudeReceiptProvenance(row: Row): ClaudeReceiptProvenance {
  const proof = claudeProofs.get(row);
  if (!proof || process.platform === 'win32') throw new Refusal('receipt_bootstrap_unsupported', 1);
  return { registryDirectory: proof.canonical, registryRecordPath: realpathSync(proof.record),
    registryIdentity: createHash('sha256').update(proof.recordIdentity).digest('hex'),
    socketPath: resolve(String(row.socket)), routeIdentity: claudeSelectionIdentity(row) };
}
export function claude(all: boolean): Row {
  const inventory = claudeInventory();
  return { sessions: inventory.sessions.filter(row => all || row.reachable),
    discovery: { claude: inventory.errors.length ? { status: 'error', code: 'claude_discovery_incomplete', errors: inventory.errors } : { status: 'ok' } } };
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
