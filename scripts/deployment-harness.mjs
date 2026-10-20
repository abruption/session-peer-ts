#!/usr/bin/env node
// Operator-invoked validation harness for the #23 remote deployment ADR
// (docs/design/remote-deployment.md). It is not the proposed F6 deploy helper:
// it never opens SSH, never runs during list/send/doctor, never edits PATH,
// profiles, services or another manager's session-peer, and writes only inside
// a dedicated prefix created by `dest init-prefix` (destination role) or a
// private journal created by `op init` (operator role). Every mutating command
// is a dry run unless --execute; deletions and lock overrides also require
// --confirm-destructive. POSIX only; the Windows procedure is documented.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, constants, cpSync, fsyncSync, existsSync, ftruncateSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, isAbsolute, join, parse as parsePath, posix, resolve, sep } from 'node:path';

const HARNESS = 'session-peer-ts deployment validation harness';
const MANAGER = 'session-peer-ts operator workflow';
const SENTINEL = '.session-peer-ts-harness.json';
const MARKER = '.session-peer-owner.json';
const MANIFEST = '.session-peer-manifest.json';
const LOCK = '.activate.lock';
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const INSTALL = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-([0-9a-f]{16})$/;
const STAGING = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?-[0-9a-f]{16})\.staging-[0-9a-f]{16}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const FLAGS = new Set(['--execute', '--confirm-destructive', '--unowned', '--declare-run-ended', '--declare-abandoned', '--adopt-existing']);
const VALUES = new Set(['--prefix', '--prefix-id', '--journal', '--dest-alias', '--dest-host', '--remote-bin', '--run', '--operator-label', '--event', '--file', '--target',
  '--kind', '--version', '--package-sha256', '--lock-integrity', '--identity', '--from-tree', '--npm-cli', '--package-tarball',
  '--staging', '--name', '--statement', '--lock-name', '--mode', '--compare']);
const MULTI = new Set(['--dependency-tarball']);

class Refusal extends Error { constructor(code, detail = {}) { super(code); this.code = code; this.detail = detail; } }
class Usage extends Error {}
const hex = bytes => randomBytes(bytes).toString('hex');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sha512 = data => `sha512-${createHash('sha512').update(data).digest('base64')}`;
const now = () => new Date().toISOString();
const missing = error => ['ENOENT', 'ENOTDIR'].includes(error?.code);
const lstat = path => { try { return lstatSync(path); } catch (error) { if (missing(error)) return undefined; throw error; } };
const uid = () => process.getuid();

function parse(argv) {
  const [role, command, ...rest] = argv;
  const values = new Map(), multi = new Map(), flags = new Set();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (FLAGS.has(key)) { flags.add(key); continue; }
    if ((!VALUES.has(key) && !MULTI.has(key)) || i + 1 >= rest.length) throw new Usage(`unexpected argument ${key}`);
    const value = rest[++i];
    if (MULTI.has(key)) multi.set(key, [...(multi.get(key) ?? []), value]);
    else if (values.has(key)) throw new Usage(`duplicate ${key}`);
    else values.set(key, value);
  }
  const need = key => { const value = values.get(key); if (value === undefined) throw new Usage(`missing ${key}`); return value; };
  return { role, command, values, multi, flags, need, execute: flags.has('--execute'), destructive: flags.has('--confirm-destructive') };
}

// ---- trust checks (ADR "Layout and root trust", POSIX) ----
function trusted(path, label) {
  const s = lstat(path);
  if (!s) throw new Refusal('untrusted_path', { label, reason: 'absent' });
  if (s.isSymbolicLink() || !s.isDirectory()) throw new Refusal('untrusted_path', { label, reason: s.isSymbolicLink() ? 'symlink' : 'not_directory' });
  if (s.uid !== uid()) throw new Refusal('untrusted_path', { label, reason: 'owner' });
  if ((s.mode & 0o077) !== 0) throw new Refusal('untrusted_path', { label, reason: 'mode' });
  return s;
}
function regular(path, label) {
  const s = lstat(path);
  if (!s) return undefined;
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== uid()) throw new Refusal('untrusted_path', { label, reason: s.isFile() ? 'owner' : 'not_regular' });
  return s;
}
// Ancestors of a prefix: no symlink (canonical path), and writable by others
// only when sticky and owned by root or this user (for example /tmp).
function ancestorsTrusted(path) {
  if (realpathSync(path) !== path) throw new Refusal('prefix_not_canonical');
  for (let dir = path; ; dir = dirname(dir)) {
    const s = lstatSync(dir);
    if (s.uid !== 0 && s.uid !== uid()) throw new Refusal('untrusted_path', { label: 'prefix_ancestor', reason: 'owner' });
    if ((s.mode & 0o022) !== 0 && (s.mode & 0o1000) === 0) throw new Refusal('untrusted_path', { label: 'prefix_ancestor', reason: 'mode' });
    if (dir === parsePath(dir).root) break;
  }
}
function layout(prefix) {
  if (!prefix || !isAbsolute(prefix)) throw new Refusal('prefix_not_absolute');
  if (process.platform === 'win32') throw new Refusal('windows_not_implemented');
  const root = join(prefix, 'data', 'session-peer-ts');
  return { prefix, root, receipts: join(root, '.receipts'), quarantine: join(root, '.receipts-quarantine'), lock: join(root, LOCK) };
}
// Every destination command runs only inside a prefix this harness created.
function dedicated(prefix) {
  const p = layout(prefix);
  if (!lstat(prefix)) throw new Refusal('prefix_not_dedicated');
  ancestorsTrusted(dirname(prefix));
  if (realpathSync(prefix) !== prefix) throw new Refusal('prefix_not_canonical');
  trusted(prefix, 'prefix');
  if (!regular(join(prefix, SENTINEL), 'sentinel')) throw new Refusal('prefix_not_dedicated');
  const sentinel = readJson(join(prefix, SENTINEL));
  if (sentinel?.harness !== HARNESS || !HEX32.test(sentinel.prefixId ?? '')) throw new Refusal('prefix_not_dedicated');
  trusted(join(prefix, 'data'), 'data'); trusted(p.root, 'root');
  return { ...p, prefixId: sentinel.prefixId };
}
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } }
// Test hooks only (never set in real runs): trace each fsync path in order,
// fail the fsync of a path ending with a given suffix (EIO), or cap each write
// at a few bytes to exercise short writes. They add failures, never skip work.
const TEST_TRACE = process.env.SESSION_PEER_TS_HARNESS_TEST_FSYNC_TRACE, TEST_FAIL = process.env.SESSION_PEER_TS_HARNESS_TEST_FSYNC_FAIL;
const TEST_SHORT = process.env.SESSION_PEER_TS_HARNESS_TEST_SHORT_WRITE === '1';
// Optional: fail only the first N matching fsyncs; fail the journal truncate.
let testFailures = Number(process.env.SESSION_PEER_TS_HARNESS_TEST_FSYNC_FAIL_COUNT ?? Infinity);
const TEST_TRUNCATE_FAIL = process.env.SESSION_PEER_TS_HARNESS_TEST_TRUNCATE_FAIL === '1';
function syncFd(fd, path) {
  if (TEST_TRACE) appendFileSync(TEST_TRACE, `${path}\n`);
  if (TEST_FAIL && path.endsWith(TEST_FAIL) && testFailures-- > 0) throw Object.assign(new Error('injected fsync failure'), { code: 'EIO' });
  fsyncSync(fd);
}
function syncPath(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { syncFd(fd, path); } finally { closeSync(fd); }
}
// Writes every byte (short writes continue) or throws.
function writeAll(fd, text) {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length;) {
    const written = writeSync(fd, bytes, offset, TEST_SHORT ? Math.min(7, bytes.length - offset) : bytes.length - offset);
    if (written <= 0) throw Object.assign(new Error('write made no progress'), { code: 'EIO' });
    offset += written;
  }
}
function writeExclusive(path, text, durable = false) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeAll(fd, text); if (durable) syncFd(fd, path); } finally { closeSync(fd); }
  if (durable) syncPath(dirname(path));
}
// The only activation/rollback move: rename after lstat ENOENT. rename(2)
// still replaces an empty directory created in between (ADR guarantee scope).
function renameNoReplace(from, to) {
  if (lstat(to)) throw new Refusal('target_exists');
  renameSync(from, to);
}
function installName(name) { if (!INSTALL.test(name ?? '')) throw new Usage('--name must be <version>-<id16>'); return name; }
function runId(value) { if (!HEX32.test(value ?? '')) throw new Usage('--run must be 32 hex digits'); return value; }

// ---- identity, manifest, marker ----
function runtime() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor >= 13) || major === 24)) throw new Refusal('unsupported_node');
  const libc = process.platform === 'linux' ? (process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl') : undefined;
  return { platform: process.platform, arch: process.arch, ...(libc ? { libc } : {}), nodeMajor: major,
    modules: process.versions.modules, node: realpathSync(process.execPath) };
}
function identityOf({ version, sha256: packageSha, lockIntegrity }, rt = runtime()) {
  const sorted = Object.fromEntries(Object.keys(lockIntegrity).sort().map(key => [key, lockIntegrity[key]]));
  return { package: 'session-peer', version, sha256: packageSha, lockIntegrity: sorted, platform: rt.platform, arch: rt.arch,
    ...(rt.libc ? { libc: rt.libc } : {}), nodeMajor: rt.nodeMajor, modules: rt.modules, node: rt.node };
}
const identityHash = identity => sha256(JSON.stringify(identity));
// Closed schema for identity input read from a file (stage) or a marker: the
// version becomes part of a path, so nothing unvalidated reaches a write.
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/, PACKAGE = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;
function validIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['package', 'version', 'sha256', 'lockIntegrity', 'platform', 'arch', ...(value.platform === 'linux' ? ['libc'] : []), 'nodeMajor', 'modules', 'node'];
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) return false;
  const lock = value.lockIntegrity;
  return value.package === 'session-peer' && typeof value.version === 'string' && VERSION.test(value.version) &&
    typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256) &&
    !!lock && typeof lock === 'object' && !Array.isArray(lock) && Object.keys(lock).length > 0 &&
    Object.entries(lock).every(([key, integrity]) => PACKAGE.test(key) && typeof integrity === 'string' && INTEGRITY.test(integrity)) &&
    ['darwin', 'linux'].includes(value.platform) && typeof value.arch === 'string' && /^[a-z0-9]+$/.test(value.arch) &&
    (value.platform !== 'linux' || ['glibc', 'musl'].includes(value.libc)) &&
    Number.isInteger(value.nodeMajor) && typeof value.modules === 'string' && /^\d+$/.test(value.modules) &&
    typeof value.node === 'string' && isAbsolute(value.node) && !/[\x00-\x1f]/.test(value.node);
}
// A name built from validated input must still resolve to a direct child of root.
function inside(root, name) {
  const path = resolve(root, name);
  if (dirname(path) !== root || name.includes(sep)) throw new Refusal('path_outside_root');
  return path;
}
// Follows a link the way the OS would, one component and one link at a time,
// and requires every intermediate location (not only the end) to stay inside
// `top`: no absolute link text, no `..` above `top` (even to come back), no
// dangling or looping link. `top` and every directory walked are real paths,
// so `..` here is the physical parent, as for the OS.
function resolvesInside(top, link) {
  const inside = path => path === top || path.startsWith(`${top}${sep}`);
  const first = readlinkSync(link);
  if (first.startsWith('/')) return false;
  let current = dirname(link), hops = 0;
  const pending = first.split('/');
  while (pending.length) {
    const part = pending.shift();
    if (part === '' || part === '.') continue;
    if (part === '..') { current = dirname(current); if (!inside(current)) return false; continue; }
    const next = join(current, part);
    const s = lstat(next);
    if (!s) return false;
    if (s.isSymbolicLink()) {
      if (++hops > 40) return false;
      const text = readlinkSync(next);
      if (text.startsWith('/')) return false;
      pending.unshift(...text.split('/'));
      continue;
    }
    if (pending.some(item => item !== '' && item !== '.') && !s.isDirectory()) return false;
    current = next;
    if (!inside(current)) return false;
  }
  return inside(current);
}
function manifestOf(dir) {
  // Null-prototype maps: a root entry named __proto__ is an ordinary key.
  const files = Object.create(null), links = Object.create(null);
  const top = realpathSync(dir);
  const walk = rel => {
    for (const entry of readdirSync(join(dir, rel)).sort()) {
      const path = rel ? `${rel}/${entry}` : entry;
      if (!rel && (entry === MANIFEST || entry === MARKER)) continue;
      const s = lstatSync(join(dir, path));
      if (s.isSymbolicLink()) {
        // Links are recorded by their text, so they must resolve inside the
        // install (through any chain): absolute, escaping, dangling or looping
        // links are refused before anything follows them.
        const text = readlinkSync(join(dir, path));
        if (!resolvesInside(top, join(top, path))) throw new Refusal('unsafe_link', { path });
        links[path] = text;
      }
      else if (s.isDirectory()) walk(path);
      else if (s.isFile()) files[path] = sha256(readFileSync(join(dir, path)));
      else throw new Refusal('unsupported_entry');
    }
  };
  walk('');
  return JSON.stringify({ manifestVersion: 1, files, links });
}
function markerOf(dir) {
  const path = join(dir, MARKER);
  try { if (!regular(path, 'marker')) return { state: 'no_valid_marker' }; } catch { return { state: 'no_valid_marker' }; }
  const marker = readJson(path);
  if (!marker) return { state: 'unparsable_marker' };
  if (marker.manager !== MANAGER || marker.markerVersion !== 1 || !HEX32.test(marker.runId ?? '') || !validIdentity(marker.identity))
    return { state: 'other_manager' };
  return { state: 'owned', marker };
}

// ---- classification (ADR "Activation outcome by target state") ----
function receiptState(p, name) {
  const dir = lstat(p.receipts);
  if (!dir) return { state: 'none' };
  try { trusted(p.receipts, 'receipts'); } catch { return { state: 'untrusted_receipts' }; }
  const path = join(p.receipts, `${name}.json`);
  const s = lstat(path);
  if (!s) return { state: 'none' };
  if (!s.isFile() || s.uid !== uid()) return { state: 'untrusted_receipt' };
  const receipt = readJson(path);
  if (!validReceipt(receipt)) return { state: 'corrupt' };
  const target = join(p.root, name);
  if (!lstat(target)) return { state: 'orphan', receipt };
  const owned = markerOf(target);
  if (owned.state !== 'owned') return { state: 'mismatched', receipt };
  let manifest; try { manifest = sha256(manifestOf(target)); } catch { return { state: 'mismatched', receipt }; }
  const same = receipt.runId === owned.marker.runId && receipt.identityHash === owned.marker.identityHash && receipt.manifestSha256 === manifest;
  return { state: same ? 'matching' : 'mismatched', receipt };
}
function classify(p, name) {
  const target = join(p.root, name);
  const s = lstat(target);
  if (!s) return { state: 'absent', receipt: receiptState(p, name).state };
  if (s.isSymbolicLink()) return { state: 'foreign', reason: 'symlink' };
  if (!s.isDirectory()) return { state: 'foreign', reason: 'file' };
  if (s.uid !== uid() || (s.mode & 0o077) !== 0) return { state: 'foreign', reason: s.uid !== uid() ? 'owner' : 'mode' };
  if (!readdirSync(target).length) return { state: 'empty' };
  const owned = markerOf(target);
  if (owned.state !== 'owned') return { state: 'foreign', reason: owned.state };
  const { marker } = owned;
  if (identityHash(marker.identity) !== marker.identityHash || marker.identityHash.slice(0, 16) !== INSTALL.exec(name)?.[2] ||
    marker.identity.version !== INSTALL.exec(name)?.[1]) return { state: 'inconsistent_marker', marker };
  let manifest; try { manifest = sha256(manifestOf(target)); } catch { manifest = undefined; }
  if (manifest !== marker.manifestSha256) return { state: 'owned_failed_verification', marker };
  const receipt = receiptState(p, name).state;
  return { state: receipt === 'none' ? 'owned_no_receipt' : receipt === 'matching' ? 'owned_receipted' : `owned_receipt_${receipt}`, marker, manifest };
}

// ---- probes ----
const NATIVE = `const dir = process.argv[1];
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const locks = require('node:module').createRequire(path.join(dir, 'node_modules', 'session-peer', 'package.json'))('fs-ext-extra-prebuilt');
const file = path.join(dir, '.harness-probe-' + crypto.randomBytes(8).toString('hex'));
const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
try { locks.flockSync(fd, 'exnb'); locks.flockSync(fd, 'un'); process.stdout.write('loaded'); }
finally { fs.closeSync(fd); fs.unlinkSync(file); }`;
function probe(dir, identity) {
  const banner = spawnSync(join(dir, 'session-peer'), ['--version'], { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin' } });
  const native = spawnSync(identity.node, ['-e', NATIVE, dir], { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin' } });
  const expected = `session-peer ${identity.version} (typescript)`;
  return { banner: banner.status === 0 && banner.stdout.trim() === expected, nativeLock: native.status === 0 && native.stdout === 'loaded' ? 'loaded' : 'failed' };
}

// ---- activation lock (ADR "Activation lock and guarantee scope") ----
function lockState(p) {
  const s = lstat(p.lock);
  if (!s) return { state: 'absent' };
  try { trusted(p.lock, 'lock'); } catch { return { state: 'untrusted' }; }
  const ownerPath = join(p.lock, 'owner.json');
  if (!lstat(ownerPath)) return { state: 'held_unowned' };
  const owner = (() => { try { return regular(ownerPath, 'owner') && readJson(ownerPath); } catch { return undefined; } })();
  if (!owner || !HEX32.test(owner.runId ?? '') || !HEX32.test(owner.lockId ?? '') || typeof owner.createdAt !== 'string') return { state: 'held_unreadable' };
  // The activation intent is written (and synced) before the rename, so a run
  // interrupted at any point still shows which target it may have created.
  // Its presence and its validity are separate: any present intent that is not
  // exactly this lock's record is `invalid`, never treated as absent.
  const intent = join(p.lock, 'activation.json');
  const activated = lstat(intent) ? validIntent(intent, owner) : undefined;
  // A staging tree this lock kept after `already_provisioned`; like the intent,
  // a present but invalid record is `invalid`, never absent.
  const retainedPath = join(p.lock, 'retained.json');
  const retained = lstat(retainedPath) ? validRetained(retainedPath, owner) : undefined;
  return { state: 'held', owner, activated, retained };
}
function validRetained(path, owner) {
  let value;
  try { value = regular(path, 'retained') && JSON.parse(readFileSync(path, 'utf8')); } catch { value = undefined; }
  const ok = !!value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(['target', 'staging', 'runId', 'lockId']) &&
    INSTALL.test(value.target ?? '') && STAGING.exec(value.staging ?? '')?.[1] === value.target && value.runId === owner.runId && value.lockId === owner.lockId;
  return ok ? value : { invalid: true };
}
function validIntent(path, owner) {
  let value;
  try { value = regular(path, 'intent') && JSON.parse(readFileSync(path, 'utf8')); } catch { value = undefined; }
  const ok = !!value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(['target', 'staging', 'runId', 'lockId', 'at']) &&
    INSTALL.test(value.target ?? '') && STAGING.exec(value.staging ?? '')?.[1] === value.target &&
    value.runId === owner.runId && value.lockId === owner.lockId && typeof value.at === 'string';
  return ok ? value : { invalid: true };
}
// Every lock-bound result, record and statement carries this pair; a fresh
// random lockId per acquisition distinguishes re-acquisitions by the same run.
function validPublication(path, owner) {
  let value;
  try { value = regular(path, 'publication') && JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(['target', 'receipt', 'runId', 'lockId']) || !INSTALL.test(value.target ?? '') ||
    typeof value.receipt !== 'string' || value.runId !== owner.runId || value.lockId !== owner.lockId) return undefined;
  try { if (!validReceipt(JSON.parse(value.receipt))) return undefined; } catch { return undefined; }
  return value;
}
// Closed receipt schema (ADR "Completion receipt").
function validReceipt(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(['receiptVersion', 'runId', 'identityHash', 'manifestSha256', 'verifiedAt']) &&
    value.receiptVersion === 1 && typeof value.runId === 'string' && HEX32.test(value.runId) &&
    typeof value.identityHash === 'string' && /^[0-9a-f]{64}$/.test(value.identityHash) &&
    typeof value.manifestSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.manifestSha256) && typeof value.verifiedAt === 'string' &&
    !Number.isNaN(Date.parse(value.verifiedAt)) && new Date(value.verifiedAt).toISOString() === value.verifiedAt;
}
function staticVerified(checked) {
  return checked.checks.realDirectory && checked.checks.owned && checked.checks.markerConsistent && checked.checks.manifest && checked.checks.stagingGone !== false;
}
// The install a committed receipt names must still be at the target, unchanged.
function describes(checked, receipt) {
  return staticVerified(checked) && checked.markerRunId === receipt.runId && checked.identityHash === receipt.identityHash && checked.manifestSha256 === receipt.manifestSha256;
}
function publicationSynced(p, pub) {
  const path = join(p.lock, 'publication.synced.json');
  let value;
  try { value = lstat(path) && regular(path, 'synced') && JSON.parse(readFileSync(path, 'utf8')); } catch { return false; }
  return !!value && value.target === pub.target && value.receiptSha256 === sha256(pub.receipt);
}
// Syncs the receipt file, its directory and the root (which holds .receipts),
// then records that durably under the lock. Nothing is reported as published
// before this completes.
// Order on every executed write, completion, replay or adoption: the existing
// intent and the lock directory, then the receipt, .receipts and the root, then
// the synced marker (written, or the existing one) and the lock directory.
function syncPublication(p, pub) {
  syncPath(join(p.lock, 'publication.json')); syncPath(p.lock);
  syncPath(join(p.receipts, `${pub.target}.json`)); syncPath(p.receipts); syncPath(p.root);
  const path = join(p.lock, 'publication.synced.json');
  if (publicationSynced(p, pub)) { syncPath(path); syncPath(p.lock); return; }
  if (lstat(path)) throw new Refusal('publication_intent_unreadable');
  writeExclusive(path, JSON.stringify({ target: pub.target, receiptSha256: sha256(pub.receipt) }), true);
}
const lockBinding = (p, lock) => ({ prefixId: p.prefixId, lockId: lock.owner.lockId });
const sameLock = (proof, p, lock) => proof?.prefixId === p.prefixId && proof?.lockId === lock.owner.lockId && HEX32.test(proof.lockId ?? '');
function heldBy(p, run) {
  const lock = lockState(p);
  if (lock.state !== 'held' || lock.owner.runId !== run) throw new Refusal('lock_not_owned', { lock: lock.state });
  return lock;
}
// Removes only the known metadata entries of the trusted lock directory. Each
// is a file, a symlink (unlinked, never followed) or an empty directory; any
// other entry or a non-empty directory refuses before anything is removed.
const LOCK_ENTRIES = ['owner.json', 'activation.json', 'publication.json', 'publication.synced.json', 'retained.json'];
function clearLock(p) {
  trusted(p.lock, 'lock');
  const entries = readdirSync(p.lock);
  if (entries.some(entry => !LOCK_ENTRIES.includes(entry))) throw new Refusal('lock_contents_unexpected');
  const kinds = entries.map(entry => {
    const s = lstatSync(join(p.lock, entry));
    const dir = s.isDirectory() && !s.isSymbolicLink();
    if (!(s.isFile() || s.isSymbolicLink() || dir) || (dir && readdirSync(join(p.lock, entry)).length)) throw new Refusal('lock_contents_unexpected');
    return [entry, dir];
  });
  for (const [entry, dir] of kinds) (dir ? rmdirSync : unlinkSync)(join(p.lock, entry));
  rmdirSync(p.lock);
}

// ---- operator statements (produced by `op statement`, checked here) ----
function statement(file, kind, run, target) {
  const value = file && readJson(file);
  if (!value || value.harness !== HARNESS || value.statementVersion !== 1 || value.kind !== kind) throw new Refusal('statement_missing', { kind });
  if (value.runId !== run || (target !== undefined && value.target !== target)) throw new Refusal('statement_mismatch', { kind });
  return value;
}

// ---- verification (ADR step 8, destination part) ----
function verify(p, name, execute) {
  const target = join(p.root, name);
  const c = classify(p, name);
  const lock = lockState(p);
  const checks = { realDirectory: false, owned: false, markerConsistent: false, manifest: false, banner: false, nativeLock: 'not_run',
    stagingGone: lock.activated?.target === name ? !lstat(join(p.root, lock.activated.staging))
      : lock.retained?.invalid ? false : lock.retained?.target === name ? !lstat(join(p.root, lock.retained.staging)) : 'not_applicable' };
  const s = lstat(target);
  checks.realDirectory = !!s && s.isDirectory() && !s.isSymbolicLink() && s.uid === uid() && (s.mode & 0o077) === 0;
  checks.owned = !!c.marker;
  checks.markerConsistent = !!c.marker && c.state !== 'inconsistent_marker';
  checks.manifest = !!c.manifest;
  // Probes launch code: only after every applicable static check has passed.
  const staticOk = checks.realDirectory && checks.owned && checks.markerConsistent && checks.manifest && checks.stagingGone !== false;
  if (!execute || !staticOk) Object.assign(checks, { banner: 'not_run', nativeLock: 'not_run' });
  else Object.assign(checks, probe(target, c.marker.identity));
  const ok = checks.realDirectory && checks.owned && checks.markerConsistent && checks.manifest && checks.banner &&
    checks.nativeLock === 'loaded' && checks.stagingGone !== false;
  return { ok, ...(execute ? { dryRun: false } : { dryRun: true }), target: name, state: c.state, checks, markerRunId: c.marker?.runId,
    version: c.marker?.identity.version, identityHash: c.marker?.identityHash, manifestSha256: c.manifest, receipt: receiptState(p, name).state,
    // Harness-only: the wrapper path an operator check must name exactly.
    wrapper: join(p.root, name, 'session-peer') };
}

// ---- destination commands ----
const dest = {
  'init-prefix'(a) {
    const prefix = a.need('--prefix');
    const p = layout(prefix);
    if (lstat(prefix)) throw new Refusal('prefix_exists');
    ancestorsTrusted(dirname(prefix));
    if (!a.execute) return { dryRun: true, plan: ['mkdir prefix 0700', `write ${SENTINEL}`, 'mkdir data/session-peer-ts 0700'] };
    mkdirSync(prefix, { mode: 0o700 });
    writeExclusive(join(prefix, SENTINEL), JSON.stringify({ harness: HARNESS, prefixId: hex(16), createdAt: now() }));
    mkdirSync(join(prefix, 'data'), { mode: 0o700 }); mkdirSync(p.root, { mode: 0o700 });
    return { dryRun: false, created: true };
  },
  inspect(a) {
    const p = dedicated(a.need('--prefix'));
    const rt = runtime();
    const npmDir = join(dirname(dirname(rt.node)), 'lib', 'node_modules', 'npm');
    const npm = existsSync(join(npmDir, 'bin', 'npm-cli.js'))
      ? { cli: realpathSync(join(npmDir, 'bin', 'npm-cli.js')), version: readJson(join(npmDir, 'package.json'))?.version } : undefined;
    const entries = readdirSync(p.root).filter(entry => entry !== LOCK);
    return { runtime: rt, npm, lock: lockState(p).state,
      installs: entries.filter(entry => INSTALL.test(entry)).map(entry => ({ name: entry, ...pick(classify(p, entry)) })),
      stagings: entries.filter(entry => STAGING.test(entry)), other: entries.filter(entry => !INSTALL.test(entry) && !STAGING.test(entry)),
      receipts: lstat(p.receipts) ? receiptsList(p) : [] };
  },
  identity(a) {
    const version = a.need('--version'), packageSha = a.need('--package-sha256');
    const lockIntegrity = readJson(a.need('--lock-integrity'));
    const identity = lockIntegrity && typeof lockIntegrity === 'object' ? identityOf({ version, sha256: packageSha, lockIntegrity }) : undefined;
    if (!validIdentity(identity)) throw new Refusal('identity_invalid');
    const hash = identityHash(identity);
    return { identity, identityHash: hash, name: `${version}-${hash.slice(0, 16)}` };
  },
  stage(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run'));
    const input = readJson(a.need('--identity'));
    if (!validIdentity(input?.identity)) throw new Refusal('identity_invalid');
    const identity = identityOf(input.identity);
    if (identityHash(identity) !== identityHash(input.identity)) throw new Refusal('identity_runtime_mismatch');
    const hash = identityHash(identity), name = `${identity.version}-${hash.slice(0, 16)}`;
    if (!INSTALL.test(name)) throw new Refusal('identity_invalid');
    const tree = a.values.get('--from-tree'), npmCli = a.values.get('--npm-cli');
    if (!!tree === !!npmCli) throw new Usage('exactly one of --from-tree or --npm-cli');
    // Tarballs are passed to npm as absolute paths of regular files, so no
    // value can be read as an npm option (for example `--prefix=...`); the
    // hashed path is exactly the path npm receives.
    const given = [a.values.get('--package-tarball'), ...(a.multi.get('--dependency-tarball') ?? [])];
    if (npmCli && !given[0]) throw new Usage('--npm-cli needs --package-tarball and --dependency-tarball');
    // The given path is interpreted by the OS, never lexically (a symlink
    // ancestor followed by `..` must select what the OS would read). Its
    // final component must be a regular file, not a symlink, and npm gets its
    // absolute real path: no value can be read as an npm option.
    const tarballs = npmCli ? given.map(file => {
      let st, path;
      try { st = lstatSync(file); path = realpathSync(file); } catch { throw new Refusal('tarball_invalid'); }
      if (!st.isFile() || st.isSymbolicLink() || !path.startsWith('/') || !lstatSync(path).isFile()) throw new Refusal('tarball_invalid');
      return path;
    }) : [];
    if (npmCli) {
      if (sha256(readFileSync(tarballs[0])) !== identity.sha256) throw new Refusal('package_sha256_mismatch');
      const integrities = new Set(tarballs.slice(1).map(file => sha512(readFileSync(file))));
      if (Object.values(identity.lockIntegrity).some(value => !integrities.has(value)) || integrities.size !== Object.keys(identity.lockIntegrity).length)
        throw new Refusal('dependency_integrity_mismatch');
    }
    const staging = `${name}.staging-${hex(8)}`;
    if (!STAGING.test(staging)) throw new Refusal('identity_invalid');
    const dir = inside(p.root, staging);
    const plan = [`mkdir ${staging} 0700 (exclusive)`, npmCli ? 'npm install --offline --ignore-scripts with recorded Node' : 'copy prepared tree',
      'write wrapper, manifest, marker'];
    if (!a.execute) return { dryRun: true, staging, name, plan };
    mkdirSync(dir, { mode: 0o700 });
    if (tree) cpSync(tree, dir, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    else {
      const scratch = join(dir, '.harness-scratch');
      mkdirSync(scratch, { mode: 0o700 }); mkdirSync(join(scratch, 'home'), { mode: 0o700 });
      writeExclusive(join(scratch, 'userconfig'), ''); writeExclusive(join(scratch, 'globalconfig'), '');
      const result = spawnSync(identity.node, [npmCli, 'install', '--prefix', dir, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
        '--cache', join(scratch, 'cache'), '--userconfig', join(scratch, 'userconfig'), '--globalconfig', join(scratch, 'globalconfig'), ...tarballs],
      { encoding: 'utf8', timeout: 300000, env: { PATH: [dirname(identity.node), '/usr/bin', '/bin'].join(delimiter), HOME: join(scratch, 'home') } });
      rmSync(scratch, { recursive: true });
      if (result.status !== 0) throw new Refusal('npm_install_failed', { staging, npmExit: result.status });
      const lock = readJson(join(dir, 'package-lock.json'));
      for (const [key, value] of Object.entries(identity.lockIntegrity))
        if (lock?.packages?.[`node_modules/${key}`]?.integrity !== value) throw new Refusal('installed_integrity_mismatch', { staging, package: key });
    }
    manifestOf(dir); // link safety before anything reads through the tree
    if (readJson(join(dir, 'node_modules', 'session-peer', 'package.json'))?.version !== identity.version) throw new Refusal('installed_version_mismatch', { staging });
    const quoted = `'${identity.node.replace(/'/g, `'\\''`)}'`;
    writeExclusive(join(dir, 'session-peer'), `#!/bin/sh\nhere=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 127\nexec ${quoted} "$here/node_modules/session-peer/dist/cli.js" "$@"\n`);
    chmodSync(join(dir, 'session-peer'), 0o700);
    const manifest = manifestOf(dir);
    writeExclusive(join(dir, MANIFEST), manifest);
    const npm = npmCli ? { cli: realpathSync(npmCli), version: readJson(join(dirname(dirname(realpathSync(npmCli))), 'package.json'))?.version } : undefined;
    writeExclusive(join(dir, MARKER), JSON.stringify({ manager: MANAGER, markerVersion: 1, runId: run, identityHash: hash, identity,
      manifestSha256: sha256(manifest), provenance: { source: tree ? 'prepared-tree' : 'npm-offline', harness: HARNESS, ...(npm ? { npm } : {}) },
      stagedAt: now() }));
    return { dryRun: false, staging, name, source: tree ? 'prepared-tree' : 'npm-offline' };
  },
  probe(a) {
    const p = dedicated(a.need('--prefix')), name = a.need('--name');
    if (!INSTALL.test(name) && !STAGING.test(name)) throw new Usage('--name must be an install or staging name');
    const dir = join(p.root, name);
    trusted(dir, 'probe_target');
    const owned = markerOf(dir);
    if (owned.state !== 'owned') throw new Refusal('probe_target_not_owned', { state: owned.state });
    // Runs the launcher and creates/removes a lock file: an effect, so --execute.
    if (!a.execute) return { dryRun: true, name, plan: ['run <dir>/session-peer --version', 'flock a temporary file inside <dir> and remove it'] };
    if (sha256(manifestOf(dir)) !== owned.marker.manifestSha256) throw new Refusal('probe_target_failed_verification');
    const result = probe(dir, owned.marker.identity);
    if (sha256(manifestOf(dir)) !== owned.marker.manifestSha256) throw new Refusal('probe_changed_manifest');
    return { ok: result.banner && result.nativeLock === 'loaded', name, ...result };
  },
  lock(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run')), label = a.need('--operator-label');
    if (!HEX32.test(label)) throw new Usage('--operator-label must be the journal operator label');
    const current = lockState(p);
    if (current.state !== 'absent') throw new Refusal('lock_held', { lock: current.state, autoStale: false });
    if (!a.execute) return { dryRun: true, plan: [`mkdir ${LOCK} (EEXIST refuses)`, 'write owner.json exclusively'] };
    try { mkdirSync(p.lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Refusal('lock_held', { lock: lockState(p).state, autoStale: false }); throw error; }
    const owner = { runId: run, lockId: hex(16), operatorLabel: label, createdAt: now() };
    writeExclusive(join(p.lock, 'owner.json'), JSON.stringify(owner));
    return { dryRun: false, runId: run, prefixId: p.prefixId, lockId: owner.lockId };
  },
  activate(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run')), staging = a.need('--staging');
    const match = STAGING.exec(staging);
    if (!match) throw new Usage('--staging must be a staging name');
    const lock = heldBy(p, run);
    if (lock.activated?.invalid) throw new Refusal('activation_intent_unreadable');
    if (lock.activated) throw new Refusal('already_activated_under_lock');
    if (lock.retained) throw new Refusal(lock.retained.invalid ? 'retained_staging_unreadable' : 'retained_staging_pending');
    // One publication scope per acquisition: a rollback must not let the same
    // lock recreate a target and complete it using an earlier publication proof.
    if (lstat(join(p.lock, 'publication.json'))) throw new Refusal('publication_pending');
    const dir = join(p.root, staging);
    trusted(dir, 'staging');
    const owned = markerOf(dir);
    if (owned.state !== 'owned' || owned.marker.runId !== run) throw new Refusal('staging_not_owned');
    if (identityHash(owned.marker.identity) !== owned.marker.identityHash || owned.marker.identityHash.slice(0, 16) !== INSTALL.exec(match[1])[2] ||
      sha256(manifestOf(dir)) !== owned.marker.manifestSha256) throw new Refusal('staging_failed_verification');
    if (lstat(p.receipts)) trusted(p.receipts, 'receipts');
    const target = classify(p, match[1]);
    // Dry runs classify only; probes launch code and are deferred to --execute.
    if (target.state === 'owned_receipted') {
      if (!a.execute) return { dryRun: true, outcome: 'already_provisioned_pending_verification', target: match[1] };
      const checked = verify(p, match[1], true);
      // The existing receipt is reused. This run's staging stays until the
      // explicit `discard-staging --confirm-destructive` step.
      if (checked.ok) {
        // The kept staging is tracked under this lock until it is discarded.
        writeExclusive(join(p.lock, 'retained.json'), JSON.stringify({ target: match[1], staging, runId: run, lockId: lock.owner.lockId }), true);
        return { dryRun: false, outcome: 'already_provisioned', runId: run, ...lockBinding(p, lock), target: match[1], receiptReused: true, stagingRetained: staging };
      }
      throw new Refusal('existing_install_failed_verification', { target: match[1] });
    }
    if (target.state !== 'absent') throw new Refusal('target_not_absent', { target: match[1], state: target.state, reason: target.reason });
    if (target.receipt !== 'none') throw new Refusal('orphan_receipt', { target: match[1], receipt: target.receipt });
    if (!a.execute) return { dryRun: true, target: match[1], plan: ['probe staging (banner, native lock)', 'lstat target ENOENT', 'rename staging to target'] };
    const checks = probe(dir, owned.marker.identity);
    if (!checks.banner || checks.nativeLock !== 'loaded') throw new Refusal('staging_probe_failed', checks);
    const intent = join(p.lock, 'activation.json');
    writeExclusive(intent, JSON.stringify({ target: match[1], staging, runId: run, lockId: lock.owner.lockId, at: now() }), true);
    try { renameNoReplace(dir, join(p.root, match[1])); }
    catch (error) { if (!lstat(join(p.root, match[1])) && lstat(dir)) unlinkSync(intent); throw error; }
    return { dryRun: false, outcome: 'activated', runId: run, ...lockBinding(p, lock), target: match[1] };
  },
  verify(a) {
    const p = dedicated(a.need('--prefix'));
    // Without --execute: static checks only (no launcher run, no probe file).
    // With --run, the result is bound to this prefix and the run's current lock;
    // only a bound result can be recorded.
    const run = a.values.has('--run') ? runId(a.values.get('--run')) : undefined;
    const lock = run ? heldBy(p, run) : undefined;
    const result = verify(p, installName(a.need('--name')), a.execute);
    const binding = lock ? { runId: run, ...lockBinding(p, lock) } : {};
    return a.execute ? { ...result, ...binding } : { ...result, ...binding, ok: true, verified: false };
  },
  // Step 8 completion: only after the journal shows destination verification,
  // then operator doctor and dry-run, and only while this run holds the lock.
  receipt(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run')), name = installName(a.need('--name'));
    const lock = heldBy(p, run);
    if (lock.activated?.invalid) throw new Refusal('activation_intent_unreadable');
    if (lock.activated && lock.activated.target !== name) throw new Refusal('receipt_for_other_target');
    const proof = statement(a.values.get('--statement'), 'operator-checks-passed', run, name);
    if (!sameLock(proof, p, lock)) throw new Refusal('statement_mismatch', { kind: 'operator-checks-passed', reason: 'lock' });
    if (lstat(p.receipts)) trusted(p.receipts, 'receipts');
    const receiptPath = join(p.receipts, `${name}.json`);
    // A publication intent written by this lock (synced before the receipt)
    // lets a retry after a lost response replay, or complete, exactly the
    // committed bytes. Nothing is rewritten, and a later lock never replays.
    const pubPath = join(p.lock, 'publication.json');
    if (lstat(pubPath)) {
      const pub = validPublication(pubPath, lock.owner);
      if (!pub) throw new Refusal('publication_intent_unreadable');
      if (pub.target !== name) throw new Refusal('receipt_for_other_target');
      const committed = JSON.parse(pub.receipt);
      if (proof.identityHash !== committed.identityHash || proof.manifestSha256 !== committed.manifestSha256)
        throw new Refusal('statement_mismatch', { kind: 'operator-checks-passed', reason: 'install' });
      const present = receiptState(p, name);
      if (present.state === 'none') {
        // Completing a lost write: only for the same, unchanged install (all
        // static checks, and probes when executed), never after a rollback.
        const checked = verify(p, name, a.execute);
        if (!describes(checked, committed) || (a.execute && !checked.ok)) throw new Refusal('publication_target_changed', { state: checked.state });
        if (!a.execute) return { dryRun: true, target: name, plan: ['write the committed receipt bytes'] };
        // An earlier intent write may have failed its sync. Reconfirm it
        // before creating or syncing the missing receipt on this attempt.
        syncPath(pubPath); syncPath(p.lock);
        writeExclusive(receiptPath, pub.receipt, true);
        if (receiptState(p, name).state !== 'matching') throw new Refusal('receipt_present', { receipt: receiptState(p, name).state });
      } else if (!regular(receiptPath, 'receipt') || sha256(readFileSync(receiptPath)) !== sha256(pub.receipt) || present.state !== 'matching' ||
        !describes(verify(p, name, false), committed))
        throw new Refusal('receipt_present', { receipt: present.state });
      if (!a.execute) return { dryRun: true, target: name, replayed: true };
      syncPublication(p, pub);
      return { dryRun: false, runId: run, ...lockBinding(p, lock), target: name, receipt: committed, recovery: committed.runId !== run, replayed: true };
    }
    const state = receiptState(p, name).state;
    if (a.flags.has('--adopt-existing')) {
      // Explicit, non-destructive recovery: a receipt that still matches the
      // install (for example after its publishing run ended with a lost
      // response and its lock was broken) is published under this lock, on
      // fresh checks of this lock. The bytes and verifiedAt stay as written.
      if (state !== 'matching') throw new Refusal(state === 'none' ? 'nothing_to_adopt' : 'receipt_present', { receipt: state });
      const bytes = readFileSync(receiptPath, 'utf8');
      let existing; try { existing = JSON.parse(bytes); } catch { existing = undefined; }
      if (!validReceipt(existing)) throw new Refusal('receipt_present', { receipt: 'invalid' });
      const checked = verify(p, name, a.execute);
      if (!describes(checked, existing) || (a.execute && !checked.ok)) throw new Refusal('verification_failed', { checks: checked.checks, state: checked.state });
      if (proof.identityHash !== existing.identityHash || proof.manifestSha256 !== existing.manifestSha256)
        throw new Refusal('statement_mismatch', { kind: 'operator-checks-passed', reason: 'install' });
      if (!a.execute) return { dryRun: true, target: name, plan: ['record a publication intent with the existing receipt bytes'] };
      const adopted = { target: name, receipt: bytes, runId: run, lockId: lock.owner.lockId };
      writeExclusive(pubPath, JSON.stringify(adopted), true);
      syncPublication(p, adopted);
      return { dryRun: false, runId: run, ...lockBinding(p, lock), target: name, receipt: existing, recovery: existing.runId !== run, adopted: true };
    }
    if (state !== 'none') throw new Refusal('receipt_present', { receipt: state });
    const checked = verify(p, name, a.execute);
    if (!staticVerified(checked) || (a.execute && !checked.ok))
      throw new Refusal('verification_failed', { checks: checked.checks, state: checked.state });
    if (proof.identityHash !== checked.identityHash || proof.manifestSha256 !== checked.manifestSha256)
      throw new Refusal('statement_mismatch', { kind: 'operator-checks-passed', reason: 'install' });
    const receipt = { receiptVersion: 1, runId: checked.markerRunId, identityHash: checked.identityHash, manifestSha256: checked.manifestSha256, verifiedAt: now() };
    if (!a.execute) return { dryRun: true, target: name, receipt, recovery: checked.markerRunId !== run };
    if (!lstat(p.receipts)) { mkdirSync(p.receipts, { mode: 0o700 }); trusted(p.receipts, 'receipts'); }
    const text = JSON.stringify(receipt);
    const pub = { target: name, receipt: text, runId: run, lockId: lock.owner.lockId };
    writeExclusive(pubPath, JSON.stringify(pub), true);
    writeExclusive(receiptPath, text, true);
    syncPublication(p, pub);
    return { dryRun: false, runId: run, ...lockBinding(p, lock), target: name, receipt, recovery: checked.markerRunId !== run };
  },
  unlock(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run'));
    const lock = heldBy(p, run);
    if (lock.activated) {
      // Released only when the intended target was never created (or was rolled
      // back) or now has a matching receipt; anything else needs recovery.
      if (lock.activated.invalid) throw new Refusal('activation_intent_unreadable');
      const target = classify(p, lock.activated.target);
      if (target.state !== 'absent' && target.state !== 'owned_receipted') throw new Refusal('unreceipted_activation', { target: lock.activated.target, state: target.state });
    }
    if (lock.retained?.invalid) throw new Refusal('retained_staging_unreadable');
    if (lock.retained && lstat(join(p.root, lock.retained.staging))) throw new Refusal('retained_staging_pending', { staging: lock.retained.staging });
    // Publication evidence stays while a receipt or its install exists but the
    // receipt was not confirmed synced.
    const pubPath = join(p.lock, 'publication.json');
    if (lstat(pubPath)) {
      const pub = validPublication(pubPath, lock.owner);
      if (!pub) throw new Refusal('publication_intent_unreadable');
      if (!publicationSynced(p, pub) && (lstat(join(p.receipts, `${pub.target}.json`)) || lstat(join(p.root, pub.target))))
        throw new Refusal('publication_unsynced', { target: pub.target });
    }
    if (!a.execute) return { dryRun: true, plan: ['remove owner.json', 'rmdir lock'] };
    clearLock(p);
    return { dryRun: false, runId: run, ...lockBinding(p, lock), released: true };
  },
  rollback(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run')), name = installName(a.need('--name'));
    const lock = heldBy(p, run);
    const target = classify(p, name);
    if (!['owned_no_receipt', 'owned_failed_verification'].includes(target.state)) throw new Refusal('rollback_refused', { state: target.state });
    const sameRun = lock.activated?.target === name && target.marker.runId === run;
    if (!sameRun) {
      let proof;
      try { proof = statement(a.values.get('--statement'), 'no-caller', run, name); }
      catch { throw new Refusal('rollback_unconfirmed', { allowed: 'reverify_only' }); }
      if (!sameLock(proof, p, lock)) throw new Refusal('rollback_unconfirmed', { allowed: 'reverify_only' });
    }
    const failed = `${name}.failed-${hex(8)}`;
    if (!a.execute || !a.destructive) return { dryRun: true, target: name, sameRun, plan: [`rename to ${failed}`, 'delete it'] };
    renameNoReplace(join(p.root, name), join(p.root, failed));
    rmSync(join(p.root, failed), { recursive: true });
    return { dryRun: false, runId: run, ...lockBinding(p, lock), target: name, rolledBack: true, sameRun };
  },
  'break-lock'(a) {
    const p = dedicated(a.need('--prefix'));
    const lock = lockState(p);
    if (lock.state === 'absent') throw new Refusal('lock_absent');
    if (lock.state === 'untrusted') throw new Refusal('untrusted_path', { label: 'lock' });
    let override = false;
    if (a.flags.has('--unowned')) {
      // Unconfirmable owner: explicit naming plus a run-ended declaration.
      if (a.values.get('--lock-name') !== LOCK || !a.flags.has('--declare-run-ended')) throw new Refusal('override_incomplete');
      override = true;
    } else {
      if (lock.state !== 'held') throw new Refusal('owner_unconfirmable', { lock: lock.state });
      const proof = statement(a.values.get('--statement'), 'run-ended', lock.owner.runId);
      if (!sameLock(proof, p, lock)) throw new Refusal('statement_mismatch', { kind: 'run-ended', reason: 'lock' });
    }
    if (!a.execute || !a.destructive) return { dryRun: true, lock: lock.state, override, plan: ['remove lock only; installs untouched'] };
    clearLock(p);
    return { dryRun: false, broken: true, lock: lock.state, override, runId: lock.owner?.runId, prefixId: p.prefixId, brokenLockId: lock.owner?.lockId ?? null };
  },
  'receipt-cleanup'(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run')), name = installName(a.need('--name')), mode = a.need('--mode');
    if (!['quarantine', 'remove'].includes(mode)) throw new Usage('--mode quarantine|remove');
    const lock = heldBy(p, run);
    trusted(p.receipts, 'receipts');
    const path = join(p.receipts, `${name}.json`);
    if (!regular(path, 'receipt')) throw new Refusal('receipt_absent');
    const state = receiptState(p, name).state;
    if (!['corrupt', 'mismatched', 'orphan'].includes(state)) throw new Refusal('receipt_not_cleanable', { receipt: state });
    const markerOwned = markerOf(join(p.root, name)).state === 'owned';
    if (!markerOwned) {
      let proof;
      try { proof = statement(a.values.get('--statement'), 'receipt-owned', run, name); }
      catch { throw new Refusal('receipt_ownership_unconfirmed'); }
      if (!sameLock(proof, p, lock)) throw new Refusal('receipt_ownership_unconfirmed');
    }
    const quarantined = `${name}.${hex(8)}.json`;
    if (!a.execute || !a.destructive) return { dryRun: true, receipt: state, mode, ownership: markerOwned ? 'marker' : 'journal' };
    if (mode === 'remove') unlinkSync(path);
    else {
      if (!lstat(p.quarantine)) mkdirSync(p.quarantine, { mode: 0o700 });
      trusted(p.quarantine, 'quarantine');
      renameNoReplace(path, join(p.quarantine, quarantined));
    }
    return { dryRun: false, runId: run, ...lockBinding(p, lock), target: name, receipt: state, mode, ownership: markerOwned ? 'marker' : 'journal' };
  },
  retire(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run')), name = installName(a.need('--name'));
    const lock = heldBy(p, run);
    const target = classify(p, name);
    if (!['owned_receipted', 'owned_no_receipt'].includes(target.state)) throw new Refusal('retire_refused', { state: target.state });
    let proof;
    try { proof = statement(a.values.get('--statement'), 'no-caller', run, name); }
    catch { throw new Refusal('configured_for_caller_or_unconfirmed'); }
    if (!sameLock(proof, p, lock)) throw new Refusal('configured_for_caller_or_unconfirmed');
    const retired = `${name}.retired-${hex(8)}`;
    if (!a.execute || !a.destructive) return { dryRun: true, target: name, plan: ['rename aside', 'delete it', 'remove its matching receipt'] };
    renameNoReplace(join(p.root, name), join(p.root, retired));
    rmSync(join(p.root, retired), { recursive: true });
    if (target.state === 'owned_receipted') unlinkSync(join(p.receipts, `${name}.json`));
    return { dryRun: false, runId: run, ...lockBinding(p, lock), target: name, retired: true };
  },
  // Removes a staging tree whose marker names this run.
  'discard-staging'(a) {
    const p = dedicated(a.need('--prefix')), run = runId(a.need('--run')), staging = a.need('--staging');
    if (!STAGING.test(staging)) throw new Usage('--staging must be a staging name');
    const dir = inside(p.root, staging);
    trusted(dir, 'staging');
    const owned = markerOf(dir);
    if (owned.state !== 'owned' || owned.marker.runId !== run) throw new Refusal('staging_not_owned', { marker: owned.state });
    if (!a.execute || !a.destructive) return { dryRun: true, staging, runId: run };
    rmSync(dir, { recursive: true });
    return { dryRun: false, staging, runId: run, removed: true };
  },
  // A staging tree with no marker path at all (a stage that failed before
  // writing it) has no owner to check: removal needs an explicit abandonment
  // declaration. Any marker entry (this workflow's, another manager's, a broken,
  // unreadable, non-regular or symlinked one) refuses: the flags are not a
  // permission to delete what something else may own.
  'discard-leftover'(a) {
    const p = dedicated(a.need('--prefix')), staging = a.need('--staging');
    if (!STAGING.test(staging)) throw new Usage('--staging must be a staging name');
    const dir = inside(p.root, staging);
    trusted(dir, 'staging');
    if (lstat(join(dir, MARKER))) throw new Refusal('staging_has_marker');
    if (lockState(p).activated?.staging === staging) throw new Refusal('staging_in_activation_intent');
    if (!a.flags.has('--declare-abandoned')) throw new Refusal('leftover_not_declared');
    if (!a.execute || !a.destructive) return { dryRun: true, staging };
    rmSync(dir, { recursive: true });
    return { dryRun: false, staging, removed: true, declaredAbandoned: true };
  },
  'path-inventory'(a) {
    const entries = [];
    // An empty PATH component (leading, trailing or doubled separator) means
    // the current directory, which is what a shell would execute.
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      for (const name of ['session-peer']) {
        const path = dir ? join(dir, name) : `.${sep}${name}`;
        if (!lstat(path)) continue;
        let real, digest;
        try { real = realpathSync(path); digest = sha256(readFileSync(real)); } catch { real = null; digest = null; }
        entries.push({ path, realpath: real, sha256: digest, symlink: lstatSync(path).isSymbolicLink() });
      }
    }
    const compare = a.values.get('--compare');
    if (!compare) return { entries };
    const before = readJson(compare)?.entries;
    if (!Array.isArray(before)) throw new Refusal('inventory_unreadable');
    return { entries, unchanged: JSON.stringify(before) === JSON.stringify(entries) };
  },
  'destroy-prefix'(a) {
    const p = dedicated(a.need('--prefix'));
    if (p.prefix.split(sep).filter(Boolean).length < 2 || p.prefix === process.env.HOME) throw new Refusal('prefix_not_dedicated');
    if (!a.execute || !a.destructive) return { dryRun: true, plan: ['remove the dedicated prefix recursively'] };
    rmSync(p.prefix, { recursive: true });
    return { dryRun: false, removed: true };
  }
};
function pick(c) { return { state: c.state, ...(c.reason ? { reason: c.reason } : {}), ...(c.receipt ? { receipt: c.receipt } : {}) }; }
function receiptsList(p) {
  try { trusted(p.receipts, 'receipts'); } catch { return [{ state: 'untrusted_receipts' }]; }
  return readdirSync(p.receipts).filter(entry => entry.endsWith('.json')).map(entry => ({ name: entry.slice(0, -5), state: receiptState(p, entry.slice(0, -5)).state }));
}

// ---- operator journal (append-only, hash-chained JSONL) ----
function journalRead(path) {
  if (!isAbsolute(path ?? '')) throw new Usage('--journal must be absolute');
  trusted(dirname(path), 'journal_dir');
  const st = regular(path, 'journal');
  if (!st) throw new Refusal('journal_absent');
  // The coordination lock is per path: a hard-linked journal would have two
  // locks for one file, so a journal must have exactly one link.
  if (st.nlink !== 1) throw new Refusal('journal_aliased');
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let prev = '0'.repeat(64);
  const entries = lines.map((line, seq) => {
    let entry; try { entry = JSON.parse(line); } catch { throw new Refusal('journal_corrupt'); }
    if (entry.seq !== seq || entry.prev !== prev) throw new Refusal('journal_corrupt');
    prev = sha256(line);
    return entry;
  });
  if (entries[0]?.event !== 'journal_created') throw new Refusal('journal_corrupt');
  return { entries, head: prev, operatorLabel: entries[0].operatorLabel, destHost: entries[0].destHost, dev: st.dev, ino: st.ino, size: st.size };
}
// Before an append (and its rollback) the open file must still be the single-
// link journal that was read, with nothing appended since.
function sameJournal(fd, journal) {
  const s = fstatSync(fd);
  return s.nlink === 1 && s.dev === journal.dev && s.ino === journal.ino;
}
// Cooperative journal coordination: `<journal>.lock`, created exclusively by
// mkdir and removed afterwards, held by every begin, record and statement
// (dry runs included). Its only effect is this ephemeral directory; a crash
// can leave it behind. A held lock refuses (`journal_busy`); nothing waits,
// steals or kills, and a leftover lock is removed by the operator after
// checking that no op command is running. This coordinates cooperating
// harness commands only, not a hostile same-user writer.
const journalLock = path => `${path}.lock`;
function withJournalLock(path, work) {
  if (!isAbsolute(path ?? '')) throw new Usage('--journal must be absolute');
  trusted(dirname(path), 'journal_dir');
  try { mkdirSync(journalLock(path), { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Refusal('journal_busy'); throw error; }
  let released = false;
  try {
    testPause('SESSION_PEER_TS_HARNESS_TEST_PAUSE_IN_JOURNAL_LOCK', journalLock(path));
    const result = work();
    try { rmdirSync(journalLock(path)); released = true; } catch {}
    return released ? result : { ...result, journalLock: 'left_in_place' };
  } finally { if (!released) try { rmdirSync(journalLock(path)); } catch {} }
}
// Test hooks only: at a named point (inside the journal lock, or after a
// failed append before its rollback), announce it and wait (bounded) for a
// release file, so a second command can be run deterministically.
function testPause(variable, note) {
  const file = process.env[variable];
  if (!file) return;
  writeExclusive(`${file}.held`, note);
  const cell = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; !existsSync(file); waited += 20) {
    if (waited > 60000) throw Object.assign(new Error('test pause timed out'), { code: 'ETIMEDOUT' });
    Atomics.wait(cell, 0, 0, 20);
  }
}
// A record succeeds only once the whole line is written and synced. On a
// failure the journal is truncated back to its previous length and synced:
// `journal_append_failed` (rollback `restored`) only when that is confirmed;
// otherwise `journal_append_unknown` (rollback `unconfirmed`), and the operator
// must inspect the journal before any next step. A failure never promises the
// record is absent, and the append is never retried.
function journalAppend(path, journal, event) {
  const line = JSON.stringify({ seq: journal.entries.length, prev: journal.head, at: now(), ...event });
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    if (!sameJournal(fd, journal) || fstatSync(fd).size !== journal.size) throw new Refusal('journal_aliased');
    const size = fstatSync(fd).size;
    try { writeAll(fd, `${line}\n`); syncFd(fd, path); }
    catch (error) {
      let rollbackError;
      testPause('SESSION_PEER_TS_HARNESS_TEST_PAUSE_BEFORE_ROLLBACK', path);
      try {
        if (TEST_TRUNCATE_FAIL) throw Object.assign(new Error('injected truncate failure'), { code: 'EIO' });
        if (!sameJournal(fd, journal)) throw Object.assign(new Error('journal identity changed'), { code: 'journal_aliased' });
        ftruncateSync(fd, size); syncFd(fd, path);
        if (fstatSync(fd).size !== size) rollbackError = 'size_mismatch';
      } catch (failure) { rollbackError = failure?.code ?? 'unknown'; }
      throw new Refusal(rollbackError ? 'journal_append_unknown' : 'journal_append_failed',
        { reason: error?.code ?? 'unknown', rollback: rollbackError ? 'unconfirmed' : 'restored', ...(rollbackError ? { rollbackError } : {}) });
    }
  } finally { closeSync(fd); }
  return { seq: journal.entries.length, head: sha256(line) };
}
// Destination-result event mappings. Operator events are handled separately below.
const RESULT = { lock_acquired: 'dest lock', activated: 'dest activate', verified: 'dest verify', receipt_published: 'dest receipt',
  lock_released: 'dest unlock', rolled_back: 'dest rollback', lock_broken: 'dest break-lock', receipt_cleaned: 'dest receipt-cleanup',
  retired: 'dest retire' };
function runEvents(journal, run) {
  const events = journal.entries.filter(entry => entry.runId === run);
  if (events[0]?.event !== 'run_started') throw new Refusal('run_unknown');
  return events;
}
// An acquisition stays open until this run's unlock of the same (prefixId,
// lockId) or a recorded break that closed exactly that pair.
function acquisitionClosed(journal, acquired) {
  return journal.entries.slice(acquired.seq + 1).some(entry => entry.prefixId === acquired.prefixId &&
    ((entry.event === 'lock_released' && entry.runId === acquired.runId && entry.lockId === acquired.lockId) ||
     (entry.event === 'lock_broken' && entry.closesLockId === acquired.lockId)));
}
function since(events, event) { const index = events.findLastIndex(entry => entry.event === event); return index < 0 ? [] : events.slice(index); }
// Caller state is per (prefix, install name): two prefixes can hold the same name.
// Older journals recorded caller events without a prefix; such history for this
// name cannot be attributed, so it makes the count unusable rather than zero.
function switches(journal, prefixId, target) {
  if (journal.entries.some(entry => ['callers_switched', 'callers_unswitched'].includes(entry.event) && entry.target === target && !entry.prefixId))
    throw new Refusal('caller_history_unusable');
  let count = 0;
  for (const entry of journal.entries) if (entry.prefixId === prefixId && entry.target === target)
    count += entry.event === 'callers_switched' ? 1 : entry.event === 'callers_unswitched' ? -1 : 0;
  return count;
}
const op = {
  init(a) {
    const path = a.need('--journal'), alias = a.need('--dest-alias'), destHost = a.need('--dest-host');
    if (!isAbsolute(path)) throw new Usage('--journal must be absolute');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(alias)) throw new Usage('--dest-alias must be a short local alias');
    if (!/^[A-Za-z0-9_.@:[\]-]{1,255}$/.test(destHost)) throw new Usage('--dest-host must be the --host value the operator CLI uses');
    trusted(dirname(path), 'journal_dir');
    // Under the journal lock from the exclusive create until the header line
    // (with its newline) is written and synced; a dry run holds it only to read.
    return withJournalLock(path, () => {
      if (lstat(path)) throw new Refusal('journal_exists');
      if (!a.execute) return { dryRun: true, plan: ['create journal exclusively'] };
      const label = hex(16);
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        writeAll(fd, JSON.stringify({ seq: 0, prev: '0'.repeat(64), at: now(), event: 'journal_created', operatorLabel: label, destAlias: alias, destHost }));
        testPause('SESSION_PEER_TS_HARNESS_TEST_PAUSE_IN_INIT_HEADER', path);
        writeAll(fd, '\n'); syncFd(fd, path);
      } finally { closeSync(fd); }
      syncPath(dirname(path));
      return { dryRun: false, operatorLabel: label };
    });
  },
  begin(a) {
    const path = a.need('--journal');
    if (!a.execute) return withJournalLock(path, () => { journalRead(path); return { dryRun: true }; });
    return withJournalLock(path, () => {
      const journal = journalRead(path), run = hex(16);
      journalAppend(path, journal, { event: 'run_started', runId: run });
      return { dryRun: false, runId: run, operatorLabel: journal.operatorLabel };
    });
  },
  // Every journal command except init holds the journal lock: executed
  // records across read, validation, append and rollback; dry runs and
  // statements across their read, so they never see a line that a concurrent
  // failed append later rolls back.
  record(a) {
    const path = a.need('--journal');
    return withJournalLock(path, () => recordUnderLock(a, path));
  },
  statement(a) {
    const path = a.need('--journal');
    return withJournalLock(path, () => statementOf(a));
  }
};
function recordUnderLock(a, path) {
  const journal = journalRead(path), run = runId(a.need('--run')), event = a.need('--event');
  const events = runEvents(journal, run);
  if (events.some(entry => entry.event === 'run_ended')) throw new Refusal('run_ended');
  const target = a.values.get('--target');
  const file = a.values.get('--file');
  const value = file ? readJson(file) : undefined;
  const record = { event, runId: run };
  const locked = since(events, 'lock_acquired');
  const holding = !!locked.length && !acquisitionClosed(journal, locked[0]);
  if (RESULT[event]) {
    if (value?.harness !== HARNESS || value.command !== RESULT[event] || value.ok !== true || value.dryRun !== false)
      throw new Refusal('result_invalid', { event });
    if (event === 'lock_broken') {
      // A break (an override included) closes an acquisition only when its
      // readable owner pair names an open one recorded here, on the same
      // prefix and with the same lockId. Anything else (an override whose
      // owner pair cannot be identified, another journal's or prefix's lock,
      // an already closed lock) is kept as an audit record that closes nothing.
      if (!HEX32.test(value.prefixId ?? '')) throw new Refusal('result_invalid', { event });
      if (value.brokenLockId && journal.entries.some(entry => entry.event === 'lock_broken' && entry.prefixId === value.prefixId && entry.brokenLockId === value.brokenLockId))
        throw new Refusal('break_replayed');
      const open = value.brokenLockId ? journal.entries.find(entry => entry.event === 'lock_acquired' && entry.prefixId === value.prefixId &&
        entry.lockId === value.brokenLockId && !acquisitionClosed(journal, entry)) : undefined;
      if (open && open.runId !== value.runId) throw new Refusal('result_invalid', { event, reason: 'owner' });
      Object.assign(record, { brokenRunId: value.runId ?? null, override: value.override, prefixId: value.prefixId, brokenLockId: value.brokenLockId ?? null,
        closesLockId: open ? open.lockId : null });
    } else if (value.runId !== run) throw new Refusal('result_invalid', { event, reason: 'run' });
    if (event === 'lock_acquired') {
      if (!HEX32.test(value.lockId ?? '') || !HEX32.test(value.prefixId ?? '')) throw new Refusal('result_invalid', { event });
      // Each acquisition is recorded exactly once per journal, by its own run:
      // re-recording (even the current one) is refused, never deduplicated.
      // A break of that same pair recorded anywhere (even before the
      // acquisition itself) is a tombstone: the pair can never become current.
      if (journal.entries.some(entry => entry.prefixId === value.prefixId &&
        ((entry.event === 'lock_acquired' && entry.lockId === value.lockId) || (entry.event === 'lock_broken' && entry.brokenLockId === value.lockId))))
        throw new Refusal('acquisition_replayed');
      if (holding) throw new Refusal('result_invalid', { event, reason: 'already_holding' });
      Object.assign(record, { prefixId: value.prefixId, lockId: value.lockId });
    } else if (event !== 'lock_broken') {
      // Every lock-bound result must come from this run's current lock on
      // the same prefix; an earlier lock's result (even of the same run) is stale.
      if (!holding) throw new Refusal('lock_not_recorded');
      if (value.prefixId !== locked[0].prefixId || value.lockId !== locked[0].lockId)
        throw new Refusal('result_invalid', { event, reason: 'stale_or_foreign_lock' });
      Object.assign(record, { prefixId: value.prefixId, lockId: value.lockId });
    }
    if (value.target) record.target = value.target;
    if (event === 'verified') Object.assign(record, { identityHash: value.identityHash, manifestSha256: value.manifestSha256, markerRunId: value.markerRunId,
      version: value.version, wrapper: value.wrapper });
    if (event === 'activated') record.outcome = value.outcome;
    if (event === 'receipt_cleaned') Object.assign(record, { mode: value.mode, receipt: value.receipt, ownership: value.ownership });
    if (event === 'receipt_published' && locked.some(entry => entry.event === 'receipt_published' && entry.target === value.target))
      throw new Refusal('receipt_already_recorded');
    // A destructive lifecycle event for this prefix and name recorded since
    // this acquisition closes its publication, even if the receipt response
    // arrives later; recovery needs a new lock and new checks.
    if (event === 'receipt_published' && journal.entries.some(entry => entry.seq > locked[0].seq && entry.prefixId === value.prefixId &&
      entry.target === value.target && ['rolled_back', 'retired', 'receipt_cleaned'].includes(entry.event)))
      throw new Refusal('publication_closed');
  } else if (event === 'operator_doctor' || event === 'operator_dry_run') {
    if (!target || !holding) throw new Refusal('lock_not_recorded');
    const verified = locked.findLast(entry => entry.event === 'verified' && entry.target === target);
    if (!verified) throw new Refusal('operator_check_before_verify');
    // Operator SSH output: a completed doctor, and a dry-run that reached the
    // destination CLI and sent nothing: the intended nonexistent-target
    // refusal or a normal validated dry run. Transport, preflight, version
    // and other refusals do not pass.
    const ok = event === 'operator_doctor'
      ? value?.ok === true && value.diagnosticCompleted === true && value.implementation === 'typescript' && typeof value.host === 'string'
      : value?.submitted === false && value.consumptionConfirmed === false && typeof value.host === 'string' &&
        ((value.ok === false && value.status === 'refused' && value.error === 'no_reachable_target') ||
         (value.ok === true && value.status === 'validated' && value.error === undefined));
    if (!ok) throw new Refusal('operator_check_failed', { event });
    // Bound from the JSON: the destination host and, for doctor, the remote
    // version. Not visible in the JSON: which --remote-bin was used. That is
    // the operator's attestation, recorded as such and checked only for
    // naming the verified install.
    if (value.host !== journal.destHost) throw new Refusal('operator_check_host_mismatch', { event });
    if (event === 'operator_doctor' && value.version !== verified.version) throw new Refusal('operator_check_version_mismatch');
    const remoteBin = a.values.get('--remote-bin');
    if (!remoteBin) throw new Usage('--remote-bin required: the exact value passed to the operator CLI');
    // The attested path must already be canonical (absolute POSIX, no `.`,
    // `..`, repeated or trailing `/`) and equal exactly the verified target's
    // wrapper. Normalizing is not enough: a shell resolves `link/..` through
    // the link. The path is never resolved, locally or remotely.
    if (!remoteBin.startsWith('/') || posix.normalize(remoteBin) !== remoteBin || remoteBin.endsWith('/') ||
      typeof verified.wrapper !== 'string' || remoteBin !== verified.wrapper)
      throw new Refusal('operator_check_target_mismatch', { event });
    // Recorded order: the dry-run only after a doctor recorded since the
    // latest verify of this target under this lock. This is the order of the
    // journal records, not proof of when the operator commands ran.
    const sinceVerify = locked.slice(locked.lastIndexOf(verified) + 1);
    if (event === 'operator_dry_run' && !sinceVerify.some(entry => entry.event === 'operator_doctor' && entry.target === target))
      throw new Refusal('operator_check_order');
    Object.assign(record, { target, outcome: value.error ?? value.status ?? 'ok', host: value.host, remoteBinAttested: remoteBin,
      prefixId: locked[0].prefixId, lockId: locked[0].lockId });
  } else if (event === 'callers_switched' || event === 'callers_unswitched') {
    // Caller configuration is local and not under a destination lock, so the
    // prefix is explicit and must be one this journal has acquired a lock on.
    const prefixId = a.values.get('--prefix-id');
    if (!target || !HEX32.test(prefixId ?? '')) throw new Usage('--target and --prefix-id required');
    if (!journal.entries.some(entry => entry.event === 'lock_acquired' && entry.prefixId === prefixId)) throw new Refusal('prefix_unknown_to_journal');
    if (event === 'callers_switched') {
      const published = journal.entries.findLast(entry => entry.event === 'receipt_published' && entry.prefixId === prefixId && entry.target === target);
      if (!published) throw new Refusal('switch_before_receipt');
      // Lifecycle fence: a later new activation, rollback, retirement or
      // receipt cleanup of this (prefix, name) invalidates the publication.
      if (journal.entries.some(entry => entry.seq > published.seq && entry.prefixId === prefixId && entry.target === target &&
        (['rolled_back', 'retired', 'receipt_cleaned'].includes(entry.event) || (entry.event === 'activated' && entry.outcome !== 'already_provisioned'))))
        throw new Refusal('publication_superseded');
      // The publishing acquisition must be closed: by its run's unlock or by a
      // recorded break that closed exactly that (prefix, lockId).
      const acquired = journal.entries.find(entry => entry.event === 'lock_acquired' && entry.prefixId === prefixId && entry.lockId === published.lockId);
      if (!acquired || !acquisitionClosed(journal, acquired)) throw new Refusal('switch_before_unlock');
    }
    // No caller change while any acquisition on this prefix is open: a
    // statement issued under it (no-caller, for example) must stay true.
    if (journal.entries.some(entry => entry.event === 'lock_acquired' && entry.prefixId === prefixId && !acquisitionClosed(journal, entry)))
      throw new Refusal('acquisition_open');
    if (event === 'callers_unswitched' && switches(journal, prefixId, target) < 1) throw new Refusal('no_switch_recorded');
    Object.assign(record, { target, prefixId });
  } else if (event !== 'run_ended') throw new Usage(`unknown --event ${event}`);
  if (!a.execute) return { dryRun: true, record };
  journalAppend(path, journal, record);
  return { dryRun: false, record };
}
function statementOf(a) {
  const journal = journalRead(a.need('--journal')), kind = a.need('--kind'), run = runId(a.need('--run'));
  const events = runEvents(journal, run), target = a.values.get('--target');
  const locked = since(events, 'lock_acquired');
  const base = { harness: HARNESS, statementVersion: 1, kind, runId: run, operatorLabel: journal.operatorLabel, journalHead: journal.head, issuedAt: now() };
  const lockId = locked[0]?.lockId ?? null, prefixId = locked[0]?.prefixId ?? null;
  const holding = !!locked.length && !acquisitionClosed(journal, locked[0]);
  const ended = events.some(entry => entry.event === 'run_ended');
  if (kind === 'run-ended') {
    if (!ended) throw new Refusal('run_not_ended');
    return { ...base, prefixId, lockId };
  }
  // An ended run issues nothing else, even if its lock is still on disk.
  if (ended) throw new Refusal('run_ended');
  if (!target || !holding) throw new Refusal('lock_not_recorded');
  if (kind === 'operator-checks-passed') {
    const last = locked.findLastIndex(entry => entry.event === 'verified' && entry.target === target);
    const after = last < 0 ? [] : locked.slice(last + 1);
    const doctor = after.findIndex(entry => entry.event === 'operator_doctor' && entry.target === target);
    if (last < 0 || doctor < 0 || !after.slice(doctor + 1).some(entry => entry.event === 'operator_dry_run' && entry.target === target))
      throw new Refusal('operator_checks_incomplete');
    if (after.some(entry => entry.event === 'receipt_published' && entry.target === target)) throw new Refusal('receipt_already_recorded');
    const v = locked[last];
    return { ...base, target, prefixId, lockId, identityHash: v.identityHash, manifestSha256: v.manifestSha256 };
  }
  if (kind === 'no-caller') {
    // Positive confirmation: this journal knows the target and records no
    // outstanding caller switch. A missing receipt is not such evidence.
    // Scoped to the prefix of the current lock.
    if (!journal.entries.some(entry => entry.prefixId === prefixId && entry.target === target && ['activated', 'verified', 'receipt_published'].includes(entry.event)))
      throw new Refusal('target_unknown_to_journal');
    if (switches(journal, prefixId, target) !== 0) throw new Refusal('configured_for_caller');
    return { ...base, target, prefixId, lockId };
  }
  if (kind === 'receipt-owned') {
    if (!journal.entries.some(entry => entry.event === 'receipt_published' && entry.prefixId === prefixId && entry.target === target))
      throw new Refusal('receipt_unknown_to_journal');
    return { ...base, target, prefixId, lockId };
  }
  throw new Usage(`unknown --kind ${kind}`);
}

function main(argv) {
  let a;
  try {
    a = parse(argv);
    const table = a.role === 'dest' ? dest : a.role === 'op' ? op : undefined;
    if (!table || !Object.hasOwn(table, a.command ?? '')) throw new Usage('usage: deployment-harness.mjs dest|op <command> [options]; see docs/design/remote-deployment.md');
    if (process.platform === 'win32') throw new Refusal('windows_not_implemented');
    const result = table[a.command](a);
    process.stdout.write(`${JSON.stringify({ harness: HARNESS, command: `${a.role} ${a.command}`, ok: true, ...result })}\n`);
    return result.ok === false ? 1 : 0;
  } catch (error) {
    if (error instanceof Usage) { process.stderr.write(`${error.message}\n`); return 2; }
    const code = error instanceof Refusal ? error.code : 'harness_error';
    const detail = error instanceof Refusal ? error.detail : { reason: error?.code ?? 'unexpected' };
    process.stdout.write(`${JSON.stringify({ harness: HARNESS, command: a ? `${a.role} ${a.command}` : null, ok: false, error: code, ...detail })}\n`);
    return 1;
  }
}
// Runs as a command; imported (by its tests), it only exposes pure helpers.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
export { manifestOf, resolvesInside };
