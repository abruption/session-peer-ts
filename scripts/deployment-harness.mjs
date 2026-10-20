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
import { chmodSync, closeSync, constants, cpSync, fsyncSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, isAbsolute, join, parse as parsePath, resolve, sep } from 'node:path';

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
const FLAGS = new Set(['--execute', '--confirm-destructive', '--unowned', '--declare-run-ended', '--declare-abandoned']);
const VALUES = new Set(['--prefix', '--journal', '--dest-alias', '--dest-host', '--remote-bin', '--run', '--operator-label', '--event', '--file', '--target',
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
function writeExclusive(path, text, durable = false) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeSync(fd, text); if (durable) fsyncSync(fd); } finally { closeSync(fd); }
  if (!durable) return;
  const dir = openSync(dirname(path), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
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
function manifestOf(dir) {
  const files = {}, links = {};
  const walk = rel => {
    for (const entry of readdirSync(join(dir, rel)).sort()) {
      const path = rel ? `${rel}/${entry}` : entry;
      if (!rel && (entry === MANIFEST || entry === MARKER)) continue;
      const s = lstatSync(join(dir, path));
      if (s.isSymbolicLink()) links[path] = readlinkSync(join(dir, path));
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
  if (!receipt || receipt.receiptVersion !== 1 || !HEX32.test(receipt.runId ?? '') || !/^[0-9a-f]{64}$/.test(receipt.identityHash ?? '') ||
    !/^[0-9a-f]{64}$/.test(receipt.manifestSha256 ?? '')) return { state: 'corrupt' };
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
  return { state: 'held', owner, activated };
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
const lockBinding = (p, lock) => ({ prefixId: p.prefixId, lockId: lock.owner.lockId });
const sameLock = (proof, p, lock) => proof?.prefixId === p.prefixId && proof?.lockId === lock.owner.lockId && HEX32.test(proof.lockId ?? '');
function heldBy(p, run) {
  const lock = lockState(p);
  if (lock.state !== 'held' || lock.owner.runId !== run) throw new Refusal('lock_not_owned', { lock: lock.state });
  return lock;
}
function clearLock(p) {
  const entries = readdirSync(p.lock);
  if (entries.some(entry => !['owner.json', 'activation.json'].includes(entry))) throw new Refusal('lock_contents_unexpected');
  for (const entry of entries) unlinkSync(join(p.lock, entry));
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
    stagingGone: lock.activated?.target === name ? !lstat(join(p.root, lock.activated.staging)) : 'not_applicable' };
  const s = lstat(target);
  checks.realDirectory = !!s && s.isDirectory() && !s.isSymbolicLink() && s.uid === uid() && (s.mode & 0o077) === 0;
  checks.owned = !!c.marker;
  checks.markerConsistent = !!c.marker && c.state !== 'inconsistent_marker';
  checks.manifest = !!c.manifest;
  if (!execute) Object.assign(checks, { banner: 'not_run', nativeLock: 'not_run' });
  else if (checks.manifest) Object.assign(checks, probe(target, c.marker.identity));
  const ok = checks.realDirectory && checks.owned && checks.markerConsistent && checks.manifest && checks.banner &&
    checks.nativeLock === 'loaded' && checks.stagingGone !== false;
  return { ok, ...(execute ? { dryRun: false } : { dryRun: true }), target: name, state: c.state, checks, markerRunId: c.marker?.runId,
    version: c.marker?.identity.version, identityHash: c.marker?.identityHash, manifestSha256: c.manifest, receipt: receiptState(p, name).state };
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
    const tarballs = [a.values.get('--package-tarball'), ...(a.multi.get('--dependency-tarball') ?? [])];
    if (npmCli) {
      if (!tarballs[0]) throw new Usage('--npm-cli needs --package-tarball and --dependency-tarball');
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
      if (checked.ok) return { dryRun: false, outcome: 'already_provisioned', runId: run, ...lockBinding(p, lock), target: match[1], receiptReused: true, stagingRetained: staging };
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
    const state = receiptState(p, name).state;
    if (state !== 'none') throw new Refusal('receipt_present', { receipt: state });
    const checked = verify(p, name, a.execute);
    if (a.execute ? !checked.ok : !checked.checks.manifest || !checked.checks.markerConsistent)
      throw new Refusal('verification_failed', { checks: checked.checks, state: checked.state });
    if (proof.identityHash !== checked.identityHash || proof.manifestSha256 !== checked.manifestSha256)
      throw new Refusal('statement_mismatch', { kind: 'operator-checks-passed', reason: 'install' });
    const receipt = { receiptVersion: 1, runId: checked.markerRunId, identityHash: checked.identityHash, manifestSha256: checked.manifestSha256, verifiedAt: now() };
    if (!a.execute) return { dryRun: true, target: name, receipt, recovery: checked.markerRunId !== run };
    if (!lstat(p.receipts)) { mkdirSync(p.receipts, { mode: 0o700 }); trusted(p.receipts, 'receipts'); }
    writeExclusive(join(p.receipts, `${name}.json`), JSON.stringify(receipt));
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
  // A staging tree without a valid marker (a stage that failed before writing
  // it) has no owner to check: removal needs an explicit abandonment declaration.
  'discard-leftover'(a) {
    const p = dedicated(a.need('--prefix')), staging = a.need('--staging');
    if (!STAGING.test(staging)) throw new Usage('--staging must be a staging name');
    const dir = inside(p.root, staging);
    trusted(dir, 'staging');
    if (markerOf(dir).state === 'owned') throw new Refusal('staging_has_owner');
    if (lockState(p).activated?.staging === staging) throw new Refusal('staging_in_activation_intent');
    if (!a.flags.has('--declare-abandoned')) throw new Refusal('leftover_not_declared');
    if (!a.execute || !a.destructive) return { dryRun: true, staging };
    rmSync(dir, { recursive: true });
    return { dryRun: false, staging, removed: true, declaredAbandoned: true };
  },
  'path-inventory'(a) {
    const entries = [];
    for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const name of ['session-peer']) {
        const path = join(dir, name);
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
  if (!regular(path, 'journal')) throw new Refusal('journal_absent');
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let prev = '0'.repeat(64);
  const entries = lines.map((line, seq) => {
    let entry; try { entry = JSON.parse(line); } catch { throw new Refusal('journal_corrupt'); }
    if (entry.seq !== seq || entry.prev !== prev) throw new Refusal('journal_corrupt');
    prev = sha256(line);
    return entry;
  });
  if (entries[0]?.event !== 'journal_created') throw new Refusal('journal_corrupt');
  return { entries, head: prev, operatorLabel: entries[0].operatorLabel, destHost: entries[0].destHost };
}
function journalAppend(path, journal, event) {
  const line = JSON.stringify({ seq: journal.entries.length, prev: journal.head, at: now(), ...event });
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try { writeSync(fd, `${line}\n`); } finally { closeSync(fd); }
  return { seq: journal.entries.length, head: sha256(line) };
}
const RESULT = { lock_acquired: 'dest lock', activated: 'dest activate', verified: 'dest verify', receipt_published: 'dest receipt',
  lock_released: 'dest unlock', rolled_back: 'dest rollback', lock_broken: 'dest break-lock' };
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
function switches(journal, target) {
  let count = 0;
  for (const entry of journal.entries) if (entry.target === target) count += entry.event === 'callers_switched' ? 1 : entry.event === 'callers_unswitched' ? -1 : 0;
  return count;
}
const op = {
  init(a) {
    const path = a.need('--journal'), alias = a.need('--dest-alias'), destHost = a.need('--dest-host');
    if (!isAbsolute(path)) throw new Usage('--journal must be absolute');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(alias)) throw new Usage('--dest-alias must be a short local alias');
    if (!/^[A-Za-z0-9_.@:[\]-]{1,255}$/.test(destHost)) throw new Usage('--dest-host must be the --host value the operator CLI uses');
    trusted(dirname(path), 'journal_dir');
    if (lstat(path)) throw new Refusal('journal_exists');
    if (!a.execute) return { dryRun: true, plan: ['create journal exclusively'] };
    const label = hex(16);
    writeExclusive(path, `${JSON.stringify({ seq: 0, prev: '0'.repeat(64), at: now(), event: 'journal_created', operatorLabel: label, destAlias: alias, destHost })}\n`);
    return { dryRun: false, operatorLabel: label };
  },
  begin(a) {
    const path = a.need('--journal'), journal = journalRead(path);
    const run = hex(16);
    if (!a.execute) return { dryRun: true };
    journalAppend(path, journal, { event: 'run_started', runId: run });
    return { dryRun: false, runId: run, operatorLabel: journal.operatorLabel };
  },
  record(a) {
    const path = a.need('--journal'), journal = journalRead(path), run = runId(a.need('--run')), event = a.need('--event');
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
        // A break closes an acquisition only when it names an open one recorded
        // here, on the same prefix and with the same lockId. Anything else (an
        // unowned override, another journal's or prefix's lock, an already
        // closed lock) is kept as an audit record that closes nothing.
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
        version: value.version });
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
      if (!remoteBin.split(/[\\/]/).includes(target)) throw new Refusal('operator_check_target_mismatch', { event });
      Object.assign(record, { target, outcome: value.error ?? value.status ?? 'ok', host: value.host, remoteBinAttested: remoteBin,
        prefixId: locked[0].prefixId, lockId: locked[0].lockId });
    } else if (event === 'callers_switched' || event === 'callers_unswitched') {
      if (!target) throw new Usage('--target required');
      if (event === 'callers_switched') {
        const published = journal.entries.findLastIndex(entry => entry.event === 'receipt_published' && entry.target === target);
        if (published < 0) throw new Refusal('switch_before_receipt');
        const { runId: publisher, lockId: publishedUnder } = journal.entries[published];
        if (!journal.entries.slice(published).some(entry => entry.event === 'lock_released' && entry.runId === publisher && entry.lockId === publishedUnder))
          throw new Refusal('switch_before_unlock');
      } else if (switches(journal, target) < 1) throw new Refusal('no_switch_recorded');
      record.target = target;
    } else if (event !== 'run_ended') throw new Usage(`unknown --event ${event}`);
    if (!a.execute) return { dryRun: true, record };
    journalAppend(path, journal, record);
    return { dryRun: false, record };
  },
  statement(a) {
    const journal = journalRead(a.need('--journal')), kind = a.need('--kind'), run = runId(a.need('--run'));
    const events = runEvents(journal, run), target = a.values.get('--target');
    const locked = since(events, 'lock_acquired');
    const base = { harness: HARNESS, statementVersion: 1, kind, runId: run, operatorLabel: journal.operatorLabel, journalHead: journal.head, issuedAt: now() };
    const lockId = locked[0]?.lockId ?? null, prefixId = locked[0]?.prefixId ?? null;
    const holding = !!locked.length && !acquisitionClosed(journal, locked[0]);
    if (kind === 'run-ended') {
      if (!events.some(entry => entry.event === 'run_ended')) throw new Refusal('run_not_ended');
      return { ...base, prefixId, lockId };
    }
    if (!target || !holding) throw new Refusal('lock_not_recorded');
    if (kind === 'operator-checks-passed') {
      const last = locked.findLastIndex(entry => entry.event === 'verified' && entry.target === target);
      const after = last < 0 ? [] : locked.slice(last + 1);
      if (last < 0 || !after.some(entry => entry.event === 'operator_doctor' && entry.target === target) ||
        !after.some(entry => entry.event === 'operator_dry_run' && entry.target === target)) throw new Refusal('operator_checks_incomplete');
      if (after.some(entry => entry.event === 'receipt_published' && entry.target === target)) throw new Refusal('receipt_already_recorded');
      const v = locked[last];
      return { ...base, target, prefixId, lockId, identityHash: v.identityHash, manifestSha256: v.manifestSha256 };
    }
    if (kind === 'no-caller') {
      // Positive confirmation: this journal knows the target and records no
      // outstanding caller switch. A missing receipt is not such evidence.
      if (!journal.entries.some(entry => entry.target === target && ['activated', 'verified', 'receipt_published'].includes(entry.event)))
        throw new Refusal('target_unknown_to_journal');
      if (switches(journal, target) !== 0) throw new Refusal('configured_for_caller');
      return { ...base, target, prefixId, lockId };
    }
    if (kind === 'receipt-owned') {
      if (!journal.entries.some(entry => entry.event === 'receipt_published' && entry.target === target)) throw new Refusal('receipt_unknown_to_journal');
      return { ...base, target, prefixId, lockId };
    }
    throw new Usage(`unknown --kind ${kind}`);
  }
};

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
process.exitCode = main(process.argv.slice(2));
