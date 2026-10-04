import { closeSync, constants, fstatSync, lstatSync, openSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { listingCandidates, Refusal } from './discovery.js';
import { executable, run } from './process.js';
import { inspectWindows } from './windows.js';

const missing = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
export const uuid = (value: string) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
function snapshot(path: string): string {
  const s = lstatSync(path, { bigint: true });
  return [s.dev, s.ino, s.size, s.mtimeNs].join(':');
}
export async function probeLock(path: string): Promise<'free' | 'held' | 'absent' | 'unknown'> {
  let fd: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) return 'unknown';
    const locks = await import('fs-ext-extra-prebuilt');
    fd = openSync(path, constants.O_RDWR | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino) return 'unknown';
    if (process.platform === 'win32') {
      try { locks.lockFileExSync(fd, locks.constants.LOCKFILE_EXCLUSIVE_LOCK | locks.constants.LOCKFILE_FAIL_IMMEDIATELY, 0, 0, 0xffffffff, 0xffffffff); }
      catch (error) { return ['EAGAIN', 'EACCES', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '') ||
        (error as NodeJS.ErrnoException & { errno?: number }).errno === 33 ? 'held' : 'unknown'; }
      locks.unlockFileExSync(fd, 0, 0, 0xffffffff, 0xffffffff);
    } else {
      try { locks.flockSync(fd, 'exnb'); }
      catch (error) { return ['EAGAIN', 'EACCES', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'held' : 'unknown'; }
      locks.flockSync(fd, 'un');
    }
    return 'free';
  } catch (error) { return missing(error) ? 'absent' : 'unknown'; }
  finally { if (fd !== undefined) closeSync(fd); }
}
type Owner = { pid: number; uid?: number | string; command?: string; start?: string };
async function sample(path: string) {
  const state = await probeLock(path);
  if (state !== 'held') return { state, fingerprint: state === 'free' ? snapshot(path) : '', owners: [] as Owner[], valid: true };
  const fingerprint = snapshot(path);
  if (process.platform === 'win32') {
    const owners = inspectWindows('openers', path);
    return { state, fingerprint, owners, valid: true };
  }
  const listed = await run(executable('lsof'), ['-nP', '-F0pcu', '--', path]);
  const owners: Owner[] = [];
  let current: Owner | undefined;
  for (const token of listed.stdout.split(/[\0\n]/)) {
    const value = token.slice(1).trim();
    if (token[0] === 'p') { current = { pid: Number(value) }; owners.push(current); }
    if (current && token[0] === 'u') {
      const uid = /^\d+$/.test(value) ? Number(value) : NaN;
      current.uid = Number.isSafeInteger(uid) ? uid : undefined;
    }
    if (current && token[0] === 'c') current.command = value;
  }
  for (const owner of owners) {
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 1) continue;
    const result = await run(executable('ps'), ['-p', String(owner.pid), '-o', 'lstart='], { env: { ...process.env, LC_ALL: 'C' } });
    if (result.code === 0 && !result.interrupted) owner.start = result.stdout.trim();
  }
  return { state, fingerprint, owners, valid: listed.code === 0 && !listed.interrupted };
}
export async function inspectWriter(home: string, id: string) {
  const path = join(home, 'thread-writer-locks', `${id}.lock`);
  const before = await sample(path);
  if (before.state === 'free' || before.state === 'absent') return { activity: 'inactive' as const, writerLock: before.state, identity: JSON.stringify({ state: before.state, fingerprint: before.fingerprint }) };
  if (before.state !== 'held') throw new Refusal('active_writer_unverified', 1);
  await delay(250);
  const after = await sample(path);
  const owner = after.owners[0];
  const ownId = process.platform === 'win32' ? inspectWindows('identity', String(process.pid))[0]?.uid : process.getuid?.();
  if (!before.valid || !after.valid || before.state !== after.state || before.fingerprint !== after.fingerprint ||
      before.owners.length !== 1 || after.owners.length !== 1 || JSON.stringify(before.owners) !== JSON.stringify(after.owners) ||
      !owner?.start || ownId === undefined || owner.uid !== ownId || !/^codex(?:\.exe|-|$)/i.test(owner.command ?? '')) {
    throw new Refusal('active_writer_unverified', 1);
  }
  return { activity: 'live_writer' as const, writerLock: 'held' as const, identity: JSON.stringify({ fingerprint: after.fingerprint, ...owner }) };
}
export type HomeCandidate = {
  codexHome: string; sources: string[]; savedThread: boolean | null;
  writerLock: 'not_checked' | 'held' | 'free' | 'absent' | 'unknown';
  activity?: 'inactive' | 'live_writer' | 'unknown'; reason: string;
};
export type HomeResolution = {
  schemaVersion: 1; status: 'selected' | 'explicit' | 'ambiguous' | 'unknown';
  selected: string | null; reason: string; candidates: HomeCandidate[];
};
export class HomeRefusal extends Refusal {
  constructor(code: string, readonly codexHomeResolution: HomeResolution, exitCode = 1) { super(code, exitCode); }
}
function resolution(status: HomeResolution['status'], selected: string | null, reason: string, candidates: HomeCandidate[]): HomeResolution {
  return { schemaVersion: 1, status, selected, reason, candidates };
}
function inventory(selected?: string) {
  // Never pass selected as listing's pin: send must inventory competing homes.
  const automatic = listingCandidates();
  const explicit = selected === undefined ? undefined : listingCandidates(selected);
  const items = [...(explicit?.homes ?? []), ...automatic.homes];
  const merged = new Map<string, typeof items[number]>();
  for (const item of items) {
    const old = merged.get(item.codexHome);
    if (old) { old.required ||= item.required; old.sources = [...new Set([...old.sources, ...item.sources])]; }
    else merged.set(item.codexHome, { ...item, sources: [...item.sources] });
  }
  const homes = [...merged.values()].sort((a, b) => a.codexHome < b.codexHome ? -1 : a.codexHome > b.codexHome ? 1 : 0);
  const candidates: HomeCandidate[] = homes.map(item => ({ codexHome: item.codexHome, sources: item.sources,
    savedThread: null, writerLock: 'not_checked', reason: 'not_inspected' }));
  const errors = [...(explicit?.errors ?? []), ...automatic.errors];
  if (errors.length) {
    const reason = errors.some(e => e.code === 'invalid_home_configuration') ? 'invalid_home_configuration' :
      errors.some(e => e.code === 'home_resolution_failed') ? 'home_resolution_failed' : 'home_inventory_unreadable';
    throw new HomeRefusal(reason, resolution('unknown', null, reason, candidates));
  }
  return { homes, candidates, explicit: explicit?.homes[0]?.codexHome };
}
export function homes(selected?: string): string[] { return inventory(selected).homes.map(item => item.codexHome); }
export type WriterSelection = { home: string; evidence: string; resolution: HomeResolution };
export async function resolveWriter(selected: string | undefined, id: string, allowInactive = false): Promise<WriterSelection> {
  if (!uuid(id)) throw new HomeRefusal('codex_uuid_required', resolution('unknown', null, 'invalid_thread_id', []), 2);
  if (selected !== undefined && !selected) throw new HomeRefusal('invalid_codex_home', resolution('unknown', null, 'invalid_codex_home', []), 2);
  if (allowInactive && !selected) throw new HomeRefusal('inactive_opt_in_requires_explicit_home',
    resolution('unknown', null, 'inactive_opt_in_requires_explicit_home', []), 2);
  const { homes: inventoryHomes, candidates, explicit } = inventory(selected);
  const { DatabaseSync } = await import('node:sqlite');
  const fingerprints: { home: string; database: string; writer: string }[] = [];
  for (const [index, item] of inventoryHomes.entries()) {
    const candidate = candidates[index]!;
    let dbFingerprint = 'absent';
    let present = true;
    try {
      try { if (!statSync(item.stateDb).isFile()) { candidate.reason = 'state_db_not_regular'; throw new Error(); } }
      catch (error) {
        if (!missing(error)) throw error;
        present = false; candidate.savedThread = false;
        candidate.reason = item.required ? 'state_db_missing' : 'state_db_absent';
        if (item.required) throw new Error();
      }
      if (present) {
        // Track file identity, not mtime: normal unrelated DB activity is allowed.
        const before = statSync(item.stateDb, { bigint: true });
        const db = new DatabaseSync(item.stateDb, { readOnly: true });
        try {
          db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000');
          candidate.savedThread = Boolean(db.prepare('SELECT 1 FROM threads WHERE id=? LIMIT 1').get(id));
        } finally { db.close(); }
        const after = statSync(item.stateDb, { bigint: true });
        if (before.dev !== after.dev || before.ino !== after.ino) { candidate.reason = 'state_db_changed'; throw new Error(); }
        dbFingerprint = `${after.dev}:${after.ino}`;
        candidate.reason = candidate.savedThread ? 'saved_thread' : 'thread_not_saved';
      }
    } catch (error) {
      if (candidate.reason === 'not_inspected') candidate.reason =
        ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'permission_denied' : 'state_db_read_failed';
      throw new HomeRefusal('home_inventory_unreadable', resolution('unknown', null, 'home_inventory_unreadable', candidates));
    }
    // Inspect this UUID even without a saved row: an unsaved competing first turn
    // is not permission to queue elsewhere. Optional absent homes remain bounded.
    try {
      const writer = await inspectWriter(item.codexHome, id);
      candidate.activity = writer.activity; candidate.writerLock = writer.writerLock;
      if (writer.activity === 'live_writer') candidate.reason = 'stable_live_writer';
      fingerprints.push({ home: item.codexHome, database: dbFingerprint, writer: writer.identity });
    } catch {
      candidate.activity = 'unknown'; candidate.writerLock = 'unknown'; candidate.reason = 'active_writer_unverified';
      throw new HomeRefusal('active_writer_unverified', resolution('unknown', null, 'active_writer_unverified', candidates));
    }
  }
  const refuse = (code: string, status: HomeResolution['status'] = 'unknown', exitCode = 1, reason = code): never => {
    throw new HomeRefusal(code, resolution(status, null, reason, candidates), exitCode);
  };
  const live = candidates.filter(c => c.activity === 'live_writer');
  if (live.length > 1) refuse('multiple_live_writers', 'ambiguous');
  let chosen: HomeCandidate;
  let reason: string;
  if (live.length === 1) {
    chosen = live[0]!;
    if (explicit !== undefined && chosen.codexHome !== explicit) refuse('explicit_home_conflicts_with_live_writer', 'ambiguous');
    if (!chosen.savedThread) refuse('thread_not_yet_persisted', 'unknown', 2);
    reason = explicit === undefined ? 'single_stable_live_writer' : 'explicit_live_writer';
  } else {
    if (!candidates.some(c => c.savedThread)) refuse('thread_not_saved_in_known_homes', 'unknown', 2);
    const pinned = candidates.find(c => c.codexHome === explicit);
    if (explicit !== undefined && !pinned?.savedThread) refuse('thread_not_saved_in_explicit_home', 'unknown', 2);
    if (!allowInactive || !pinned) refuse('inactive_writer', 'ambiguous', 1, 'inactive_queue_requires_opt_in');
    chosen = pinned!; reason = 'explicit_inactive_opt_in';
  }
  const result = resolution(explicit === undefined ? 'selected' : 'explicit', chosen.codexHome, reason, candidates);
  // Bind all candidates (including inactive, absent and unsaved competitors),
  // saved-row presence, DB identity and native owner/file evidence to revalidation.
  return { home: chosen.codexHome, resolution: result, evidence: JSON.stringify({ result, fingerprints }) };
}
export async function revalidateWriter(previous: WriterSelection, selected: string | undefined, id: string, allowInactive = false): Promise<void> {
  const current = await resolveWriter(selected, id, allowInactive);
  if (current.evidence !== previous.evidence) {
    throw new HomeRefusal('writer_evidence_changed_before_queue',
      resolution('unknown', null, 'writer_evidence_changed_before_queue', current.resolution.candidates));
  }
}
