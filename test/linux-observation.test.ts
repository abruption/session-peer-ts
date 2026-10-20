// Platform-aware native profile selection and Linux procfs machinery (#130).
// Fakes model /proc on every host; `linuxNative` cases read the real kernel
// only on Linux. Synthetic tables exercise selection/binding mechanics; the one
// production Linux row (linux-arm64 / 0.162.1) is backed by recorded live evidence.
import { test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { NATIVE_PROFILES, nativeProfileRefusal, selectNativeProfile, validateNativeProfiles, type NativeProfile } from '../dist/native-profiles.js';
import { artifactDigest, devParts, nativeExecutable, parseProcStat, parseProcStatusUid, procFlockOwner, procLockHolders,
  procOpenedFiles, procOwnedFiles, procOwner, ProcRefusal, type ProcReader } from '../dist/linux-proc.js';
import { AppServerFault, BoundedAppServerClient, appServerCapability, nativeQueueCapability, nativeQueueOnce,
  nativeQueueOnceWithProfiles, verifyProcfsSqliteBinding, type AppServerScope, type MetadataOnlyTransport } from '../dist/app-server.js';
import { metadataCapability, metadataQualification, resumeMetadataObservation, METADATA_RESUME_QUALIFICATION,
  METADATA_SOURCE } from '../dist/metadata-observation.js';
import { DatabaseSync } from 'node:sqlite';
import { HandoffLedger, payloadDigest, type HandoffBinding } from '../dist/handoff-ledger.js';
import { HandoffBudget } from '../dist/handoff.js';
import { waitForHandoff } from '../dist/handoff-operations.js';
import { run } from '../dist/process.js';

const posix = { skip: process.platform === 'win32' };
const linuxNative = { skip: process.platform !== 'linux' };
const host = `${process.platform}-${process.arch}`;
const thread = '01950000-0000-7000-8000-000000000130';
const current = '092d3acd6bec3e3a14bdc7e7a2810ab628ab759d';
const temp = (t: TestContext, prefix: string) => {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), prefix))); chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
};
const linuxRow = (patch: Partial<NativeProfile> = {}): NativeProfile => ({ platform: 'linux-arm64', version: '0.162.1', commit: current,
  platformOs: 'linux', storageBinding: 'linux_procfs', ownerInspection: 'lsof_ps_procfs_locks',
  artifact: { target: 'aarch64-unknown-linux-musl', sha256: 'a'.repeat(64) }, ...patch });
const refused = (error: unknown) => error instanceof ProcRefusal;
function fault(code: string, attempted = false) {
  return (error: unknown) => { assert.ok(error instanceof AppServerFault); assert.equal(error.code, code); assert.equal(error.attempted, attempted); return true; };
}

test('production native profiles are exact rows; only the evidenced linux-arm64 0.162.1 tuple exists for Linux', () => {
  assert.equal(Object.isFrozen(NATIVE_PROFILES), true);
  assert.deepEqual(NATIVE_PROFILES.map(row => [row.platform, row.version, row.commit, row.platformOs, row.storageBinding, row.artifact?.sha256 ?? null]), [
    ['darwin-arm64', '0.160.1', 'd27764b82f7118f674371e6d6e76271d9d606edb', 'macos', 'darwin_lsof', null],
    ['darwin-arm64', '0.162.1', current, 'macos', 'darwin_lsof', null],
    ['linux-arm64', '0.162.1', current, 'linux', 'linux_procfs', '071cbe8d821cf1b02b6d8ba6c8b7991b228fcb8519dcb68a37d31222bb8cabe5'],
  ]);
  for (const row of NATIVE_PROFILES) assert.equal(Object.isFrozen(row), true);
  const scope: AppServerScope = { codexHome: '/fixture', threadId: thread, generation: 'g', ownerIdentity: 'o' };
  const absent: [string, string][] = [];
  for (const platform of ['linux-x64', 'linux-arm', 'linux-arm64-musl', 'linux-arm64-gnu', 'Linux-arm64', 'darwin-x64']) {
    for (const version of ['0.160.1', '0.162.1', '0.163.0']) absent.push([platform, version]);
  }
  absent.push(['linux-arm64', '0.160.1'], ['linux-arm64', '0.163.0'], ['linux-arm64', '0.162.2'], ['linux-arm64', '0.162.0']);
  for (const [platform, version] of absent) {
    assert.equal(selectNativeProfile({ platform, version }), undefined, platform + '/' + version);
    assert.equal(metadataQualification(version, platform), undefined);
    assert.equal(nativeQueueCapability({ version, platform, scope }).queueSupported, false);
    assert.equal(appServerCapability({ version, platform, scope }).schema, 'version_unqualified');
  }
  assert.equal(nativeProfileRefusal({ platform: 'linux-x64', version: '0.162.1' }), 'platform_unsupported');
  assert.equal(nativeProfileRefusal({ platform: 'linux-arm64', version: '0.160.1' }), 'platform_unsupported');
  assert.equal(nativeQueueCapability({ version: '0.162.1', platform: 'linux-arm64', scope }).queueSupported, true);
  assert.deepEqual(metadataQualification('codex-cli 0.162.1', 'linux-arm64'), { version: '0.162.1', commit: current, platform: 'linux-arm64' });
  // Without a platform a version naming two platform rows is ambiguous, not darwin.
  assert.equal(metadataQualification('0.162.1'), undefined);
  for (const version of ['0.162.0', '0.162.2', '0.163.0', '0.162', '0.162.1-alpha', 'codex-cli 0.162.1', '>=0.160.1']) {
    assert.equal(selectNativeProfile({ platform: 'darwin-arm64', version }), undefined);
    assert.equal(nativeProfileRefusal({ platform: 'darwin-arm64', version }), 'version_unsupported');
  }
  assert.deepEqual(metadataQualification('codex-cli 0.162.1', 'darwin-arm64'), { version: '0.162.1', commit: current, platform: 'darwin-arm64' });
  assert.deepEqual(metadataQualification('0.160.1', 'darwin-arm64'), METADATA_RESUME_QUALIFICATION);
  assert.equal(selectNativeProfile(undefined as any), undefined);
  assert.equal(selectNativeProfile({ platform: 'darwin-arm64', version: 0 } as any), undefined);
});

test('the linux-arm64 row matches its recorded artifact, schema and live injection evidence', async () => {
  const evidence = JSON.parse(readFileSync(new URL('./fixtures/linux-observation-native-evidence.json', import.meta.url), 'utf8'));
  const row = selectNativeProfile({ platform: 'linux-arm64', version: '0.162.1' })!;
  assert.deepEqual(evidence.nativeProfile, JSON.parse(JSON.stringify(row)));
  assert.equal(evidence.upstreamArtifact.extractedBinarySha256, row.artifact!.sha256);
  assert.equal(evidence.upstreamArtifact.hostBinarySha256Equal, true);
  const { APP_SERVER_QUEUE_EVIDENCE, NATIVE_QUEUE_01621_NOTIFICATION_OPTOUTS } = await import('../dist/app-server.js');
  const schema = APP_SERVER_QUEUE_EVIDENCE.find(entry => entry.version === '0.162.1' && entry.inspectedPlatform === 'linux-arm64')!;
  for (const key of ['queueAddParamsSha256', 'queueAddResponseSha256', 'itemStartedSha256', 'turnCompletedSha256'] as const) {
    assert.equal(schema[key], evidence.generatedSchema[key], key);
  }
  assert.equal(evidence.generatedSchema.notificationMethods, NATIVE_QUEUE_01621_NOTIFICATION_OPTOUTS.length);
  const live = evidence.liveFixture;
  assert.equal(live.newDedicatedThread, true); assert.equal(live.queueAttemptsWithEffect, 1);
  assert.equal(live.matchingClientIdRows, 1); assert.equal(live.nativeItemIdEqualsClientId, false);
  assert.equal(live.generationUnchanged, true); assert.equal(live.injectionObserved, true);
  assert.equal(live.kernelFlockHolderEqualsLsofOwner, true); assert.equal(live.independentWaitSatisfied, true);
  assert.equal(live.acknowledged, false); assert.equal(live.bootstrapTurns, 1);
  assert.equal(live.preEffectRefusalFoundByLiveRun.submitted, false);
  assert.equal(JSON.stringify(evidence).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b|\/home\/|ubuntu@/), null);
});

// Regression (found by the live run): once one version has rows on two
// platforms, the structural capability check must not become ambiguous.
test('structural metadata capability accepts an exact version that has rows on two platforms', posix, async t => {
  const root = temp(t, 'codex-two-platform-'), file = join(root, METADATA_SOURCE.database), db = new DatabaseSync(file);
  t.after(() => db.close());
  chmodSync(file, 0o600);
  db.exec(`CREATE TABLE thread_turns(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id));
CREATE TABLE thread_items(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,item_id TEXT NOT NULL,rollout_ordinal INTEGER NOT NULL,item_json TEXT NOT NULL,item_type TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id,item_id));
CREATE INDEX idx_thread_items_user_messages ON thread_items(thread_id,rollout_ordinal) WHERE item_type='userMessage';
CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER NOT NULL,next_rollout_ordinal INTEGER NOT NULL);`);
  db.prepare('INSERT INTO thread_history_projection_state VALUES(?,?,?)').run(thread, 1, 1);
  assert.equal(NATIVE_PROFILES.filter(row => row.version === '0.162.1').length, 2);
  const scope = { home: root, threadId: thread, generation: 'fixture-generation' };
  for (const version of ['0.162.1', 'codex-cli 0.162.1']) {
    assert.deepEqual(await metadataCapability(scope, version, { observationRemainingMs: () => 5000 }, () => true), { supported: true }, version);
  }
  assert.deepEqual(await metadataCapability(scope, '0.162.2', { observationRemainingMs: () => 5000 }, () => true),
    { supported: false, reason: 'metadata_version_unsupported' });
});

test('profile table validation requires one exact evidence-backed artifact tuple and forbids inheritance', () => {
  const synthetic = validateNativeProfiles([linuxRow(), linuxRow({ platform: 'linux-x64', artifact: { target: 'x86_64-unknown-linux-musl', sha256: 'b'.repeat(64) } })]);
  assert.equal(selectNativeProfile({ platform: 'linux-arm64', version: '0.162.1' }, synthetic)?.artifact?.sha256, 'a'.repeat(64));
  // No version range, arch or libc fallback from a neighbouring row.
  for (const query of [{ platform: 'linux-arm64', version: '0.162.2' }, { platform: 'linux-arm64', version: '0.160.1' },
    { platform: 'linux-arm', version: '0.162.1' }, { platform: 'darwin-arm64', version: '0.162.1' }]) assert.equal(selectNativeProfile(query, synthetic), undefined);
  assert.equal(nativeProfileRefusal({ platform: 'darwin-arm64', version: '0.162.1' }, synthetic), 'platform_unsupported');
  const invalid: [string, unknown][] = [
    ['artifact missing', linuxRow({ artifact: null })],
    ['wrong libc target', linuxRow({ artifact: { target: 'aarch64-unknown-linux-gnu', sha256: 'a'.repeat(64) } })],
    ['cross-arch target', linuxRow({ artifact: { target: 'x86_64-unknown-linux-musl', sha256: 'a'.repeat(64) } })],
    ['short digest', linuxRow({ artifact: { target: 'aarch64-unknown-linux-musl', sha256: 'a'.repeat(63) } })],
    ['inherited macOS handshake', linuxRow({ platformOs: 'macos' })],
    ['inherited lsof binding', linuxRow({ storageBinding: 'darwin_lsof' })],
    ['owner without kernel lock evidence', linuxRow({ ownerInspection: 'lsof_ps' })],
    ['version range', linuxRow({ version: '0.162.x' })],
    ['leading zero', linuxRow({ version: '0.162.01' })],
    ['libc platform alias', linuxRow({ platform: 'linux-arm64-musl' })],
    ['unknown platform', linuxRow({ platform: 'freebsd-arm64' })],
    ['abbreviated commit', linuxRow({ commit: current.slice(0, 12) })],
    ['extra field', { ...linuxRow(), inheritedFrom: 'darwin-arm64' }],
    ['new unpinned Darwin row', { ...NATIVE_PROFILES[1]!, version: '0.163.0' }],
  ];
  for (const [name, row] of invalid) assert.throws(() => validateNativeProfiles([row as NativeProfile]), /invalid native/, name);
  assert.throws(() => validateNativeProfiles([linuxRow(), linuxRow({ artifact: { target: 'aarch64-unknown-linux-musl', sha256: 'c'.repeat(64) } })]), /ambiguous/);
});

test('retained qualification for another platform refuses before any probe, owner check or native process', posix, async t => {
  let spawned = 0, owners = 0;
  mock.method(childProcess, 'spawn', () => { spawned++; throw new Error('unexpected process'); });
  syncBuiltinESMExports(); t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  const scope = { home: '/no-such-fixture', threadId: thread, generation: 'a'.repeat(64), clientUserMessageId: 'client' };
  const other = host === 'darwin-arm64' ? 'linux-arm64' : 'darwin-arm64';
  for (const [qualification, reason] of [
    [{ version: '0.162.1', commit: current, platform: other }, 'metadata_platform_unsupported'],
    [{ version: '0.162.1', commit: current, platform: 'linux-x64' }, 'metadata_platform_unsupported'],
    [{ version: '0.162.1', commit: current, platform: 'linux-arm64-musl' }, 'metadata_platform_unsupported'],
    [{ version: 'codex-cli 0.162.1', commit: current, platform: host }, 'metadata_version_unsupported'],
    [{ version: '0.162.1', commit: 'd27764b82f7118f674371e6d6e76271d9d606edb', platform: 'linux-arm64' }, 'metadata_schema_unsupported'],
  ] as const) {
    assert.deepEqual(await resumeMetadataObservation(scope, qualification, { observationRemainingMs: () => 5000 }, () => { owners++; return true; }),
      { supported: false, injectionObserved: false, reason }, JSON.stringify(qualification));
  }
  assert.equal(spawned, 0); assert.equal(owners, 0);
});

test('independent resumed wait with a retained foreign-platform profile terminates unsupported without native calls', posix, async t => {
  const root = temp(t, 'codex-linux-resume-');
  const ledger = new HandoffLedger(join(root, 'ledger')); ledger.init();
  const generation = 'a'.repeat(64);
  const binding: HandoffBinding = { agent: 'codex', destination: hostname(), target: thread, home: join(root, 'home'),
    writerIdentity: generation, generation, payloadDigest: payloadDigest('fixture body') };
  const other = host === 'darwin-arm64' ? 'linux-arm64' : 'darwin-arm64';
  const h = ledger.prepare(binding, { observeDelivery: true, observationSupported: true,
    observationQualification: { version: '0.162.1', commit: current, platform: other } });
  ledger.commitEffect(h.correlationId, binding); ledger.recordSubmission(h.correlationId, 'submitted');
  assert.equal(ledger.observationContext(h.correlationId)?.qualification.platform, other);
  let spawned = 0;
  mock.method(childProcess, 'spawn', () => { spawned++; throw new Error('unexpected process'); });
  syncBuiltinESMExports(); t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  const result = await waitForHandoff(ledger, h.correlationId, 'delivered', new HandoffBudget(6));
  assert.equal(result.exitCode, 1); assert.equal(result.value.ok, false);
  const handoff = result.value.handoff as any;
  assert.equal(handoff.wait.status, 'unsupported'); assert.equal(handoff.submission.status, 'submitted');
  assert.equal(handoff.observation.injectionObserved, false); assert.equal(handoff.retry.allowed, false);
  assert.equal(spawned, 0);
  // The original retained qualification is never rewritten to today's host.
  assert.equal(ledger.observationContext(h.correlationId)?.qualification.platform, other);
});

// /proc fakes: every read is literal data keyed by path.
function fakeProc(files: Record<string, string>, links: Record<string, string> = {}, stats: Record<string, { dev: bigint; ino: bigint }> = {},
  dirs: Record<string, string[]> = {}): ProcReader & { reads: string[] } {
  const reads: string[] = [];
  const missing = (path: string) => Object.assign(new Error('ENOENT ' + path), { code: 'ENOENT' });
  return { reads,
    readFile: path => { reads.push(path); if (!(path in files)) throw missing(path); return files[path]!; },
    readdir: path => { reads.push(path); if (!(path in dirs)) throw missing(path); return dirs[path]!; },
    readlink: path => { reads.push(path); if (!(path in links)) throw missing(path); return links[path]!; },
    stat: path => { reads.push(path); if (!(path in stats)) throw missing(path); return stats[path]!; } };
}
const statLine = (pid: number, ppid: number, pgrp: number, start: string, comm = 'codex', state = 'S') =>
  `${pid} (${comm}) ${state} ${ppid} ${pgrp} ${pgrp} 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${start} 1000 10 18446744073709551615\n`;
const statusText = (uid: number | string, slots = [uid, uid, uid, uid]) => `Name:\tcodex\nState:\tS (sleeping)\nUid:\t${slots.join('\t')}\nGid:\t20\t20\t20\t20\n`;

test('procfs stat/status parsers are closed against comm injection, zombies and mixed UIDs', () => {
  assert.deepEqual(parseProcStat(statLine(42, 7, 42, '123456', 'co dex) Z 1 1')), { state: 'S', ppid: 7, pgrp: 42, starttime: '123456' });
  for (const text of ['42 codex S 1', '42 (codex)S 1 1', '42 (codex) S x 1 ' + '0 '.repeat(20), '42 (codex) S 1 1 1', '']) assert.throws(() => parseProcStat(text), refused);
  assert.equal(parseProcStatusUid(statusText(501)), 501);
  assert.throws(() => parseProcStatusUid(statusText(501, [501, 0, 501, 501])), refused);
  assert.throws(() => parseProcStatusUid(statusText(501) + 'Uid:\t501\t501\t501\t501\n'), refused);
  assert.throws(() => parseProcStatusUid('Name:\tcodex\n'), refused);
  const reader = fakeProc({ '/proc/42/stat': statLine(42, 7, 42, '9', 'codex', 'Z'), '/proc/42/status': statusText(501) });
  assert.throws(() => procOwner(42, reader), refused);
  assert.throws(() => procOwner(1, reader), refused); assert.throws(() => procOwner(Number.NaN, reader), refused);
  assert.throws(() => procOwner(43, reader), refused);
});

test('kernel lock table selects exactly one granted exclusive flock holder for the inspected inode', () => {
  const dev = (8n << 8n) | 1n, ino = 131090n, target = { dev, ino };
  assert.deepEqual(devParts(dev), { major: 8n, minor: 1n });
  // glibc large-minor encoding (e.g. NVMe partitions, overlay anon devices).
  assert.deepEqual(devParts((0x103n << 8n) | 0x45n | (0x123n << 20n)), { major: 0x103n, minor: 0x12345n });
  const row = (id: number, pid: number, kind = 'FLOCK  ADVISORY ', access = 'WRITE', inode = '08:01:131090', blocked = '') =>
    `${id}: ${blocked}${kind} ${access} ${pid} ${inode} 0 EOF`;
  const reader = (text: string) => fakeProc({ '/proc/locks': text }, {}, { '/lock': target });
  assert.equal(procFlockOwner('/lock', reader([row(1, 99, 'POSIX  ADVISORY ', 'WRITE', '08:01:5'), row(2, 4242)].join('\n') + '\n')), 4242);
  // A blocked waiter is not the holder; other inodes and other devices are ignored.
  assert.equal(procFlockOwner('/lock', reader([row(1, 4242), row(1, 77, 'FLOCK  ADVISORY ', 'WRITE', '08:01:131090', '-> '),
    row(2, 88, 'FLOCK  ADVISORY ', 'WRITE', '08:02:131090'), row(3, 89, 'FLOCK  ADVISORY ', 'WRITE', '08:01:1310900')].join('\n'))), 4242);
  assert.equal(procLockHolders(row(1, 4242) + '\n7: LEASE  ACTIVE    READ  10 08:01:5 0 EOF\n', target).length, 1);
  for (const [name, text] of [
    ['no holder', row(1, 77, 'FLOCK  ADVISORY ', 'WRITE', '08:01:131090', '-> ')],
    ['two holders', [row(1, 4242), row(2, 4243)].join('\n')],
    ['shared lock', row(1, 4242, 'FLOCK  ADVISORY ', 'READ ')],
    ['POSIX lock on writer inode', [row(1, 4242), row(2, 4242, 'POSIX  ADVISORY ')].join('\n')],
    ['OFD lock reports no pid', row(1, -1, 'OFDLCK ADVISORY ')],
    ['namespace-hidden pid', row(1, 0)],
    ['unrecognized row naming the inode', '1: FUTURE WEIRD 4242 08:01:131090 0 EOF'],
  ] as const) assert.throws(() => procFlockOwner('/lock', reader(text)), refused, name);
  assert.throws(() => procFlockOwner('/lock', fakeProc({})), (error: any) => error.code === 'ENOENT');
});

test('owned procfs storage binding requires direct child, own group, UID, exact exe and stable start time', () => {
  const exe = { dev: 5n, ino: 77n }, base = (start = '100') => ({ '/proc/900/stat': statLine(900, 50, 900, start), '/proc/900/status': statusText(501) });
  const fds = { '/proc/900/fd': ['0', '1', '2', '3', '4', '5', '6', '7'] };
  const links = { '/proc/900/fd/0': 'pipe:[1]', '/proc/900/fd/1': 'socket:[2]', '/proc/900/fd/2': 'anon_inode:[eventfd]',
    '/proc/900/fd/3': '/home/state_5.sqlite', '/proc/900/fd/4': '/home/queue_1.sqlite', '/proc/900/fd/5': '/home/old.sqlite (deleted)',
    '/proc/900/fd/6': '/home/vanished' };
  const stats = { '/proc/900/exe': exe, '/proc/900/fd/0': { dev: 0n, ino: 1n }, '/proc/900/fd/1': { dev: 0n, ino: 2n }, '/proc/900/fd/2': { dev: 0n, ino: 3n },
    '/proc/900/fd/3': { dev: 9n, ino: 3n }, '/proc/900/fd/4': { dev: 9n, ino: 4n }, '/proc/900/fd/5': { dev: 9n, ino: 5n } };
  const files = procOwnedFiles(900, 50, 501, exe, fakeProc(base(), links, stats, fds));
  // Non-path descriptors, a closed descriptor (fd 6/7 vanished mid-walk) are not storage.
  assert.deepEqual(files, [{ name: '/home/state_5.sqlite', dev: 9n, ino: 3n, deleted: false },
    { name: '/home/queue_1.sqlite', dev: 9n, ino: 4n, deleted: false }, { name: '/home/old.sqlite', dev: 9n, ino: 5n, deleted: true }]);
  const cases: [string, ProcReader, number?, number?, { dev: bigint; ino: bigint }?][] = [
    ['not our child (reparented/reused pid)', fakeProc({ ...base(), '/proc/900/stat': statLine(900, 1, 900, '100') }, links, stats, fds)],
    ['left its owned group', fakeProc({ ...base(), '/proc/900/stat': statLine(900, 50, 50, '100') }, links, stats, fds)],
    ['foreign UID', fakeProc({ ...base(), '/proc/900/status': statusText(502) }, links, stats, fds)],
    ['setuid saved UID', fakeProc({ ...base(), '/proc/900/status': statusText(501, [501, 501, 0, 501]) }, links, stats, fds)],
    ['interpreter or shim exe', fakeProc(base(), links, { ...stats, '/proc/900/exe': { dev: 5n, ino: 78n } }, fds)],
    ['exe unreadable', fakeProc(base(), links, Object.fromEntries(Object.entries(stats).filter(([path]) => !path.endsWith('/exe'))), fds)],
    ['fd table unreadable', fakeProc(base(), links, stats, {})],
    ['non-numeric fd entry', fakeProc(base(), links, stats, { '/proc/900/fd': ['3', '..'] })],
    ['unbounded fd table', fakeProc(base(), links, stats, { '/proc/900/fd': Array.from({ length: 4097 }, (_, i) => String(i)) })],
  ];
  for (const [name, reader] of cases) assert.throws(() => procOwnedFiles(900, 50, 501, exe, reader), refused, name);
  // PID reuse/exec between the two samples: the second stat has a new start.
  let reads = 0; const changing = fakeProc(base(), links, stats, fds);
  const readFile = changing.readFile; changing.readFile = path => path.endsWith('/stat') && ++reads > 1 ? statLine(900, 50, 900, '101') : readFile(path);
  assert.throws(() => procOwnedFiles(900, 50, 501, exe, changing), refused);
  // Closed mid-walk (ENOENT) is skipped; a permission failure is not absence.
  const denied = fakeProc({}, { '/proc/900/fd/3': '/x' }, {}, { '/proc/900/fd': ['3'] });
  assert.deepEqual(procOpenedFiles(900, denied), []);
  denied.stat = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  assert.throws(() => procOpenedFiles(900, denied), refused);
});

test('procfs binding projection reuses exact canonical SQLite path and inode checks with deleted/foreign refusal', posix, t => {
  const root = temp(t, 'codex-procfs-binding-'), home = join(root, 'home'), other = join(root, 'other');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(other, { mode: 0o700 });
  for (const dir of [home, other]) for (const file of ['state_5.sqlite', 'state_5.sqlite-wal', 'queue_1.sqlite', 'queue_1.sqlite-wal']) writeFileSync(join(dir, file), '');
  const exe = statSync(realpathSync(process.execPath), { bigint: true }), uid = process.getuid!();
  const stat = (path: string) => { const s = statSync(path, { bigint: true }); return { dev: s.dev, ino: s.ino }; };
  const reader = (paths: string[], patch: Record<string, { dev: bigint; ino: bigint }> = {}) => {
    const links: Record<string, string> = {}, stats: Record<string, { dev: bigint; ino: bigint }> = { '/proc/900/exe': { dev: exe.dev, ino: exe.ino } };
    paths.forEach((path, fd) => { links[`/proc/900/fd/${fd}`] = path; stats[`/proc/900/fd/${fd}`] = patch[path] ?? stat(path.replace(/ \(deleted\)$/, '')); });
    return fakeProc({ '/proc/900/stat': statLine(900, process.pid, 900, '7'), '/proc/900/status': statusText(uid) }, links, stats,
      { '/proc/900/fd': paths.map((_, fd) => String(fd)) });
  };
  const ok = [join(home, 'state_5.sqlite'), join(home, 'queue_1.sqlite'), join(home, 'queue_1.sqlite-wal')];
  const later = () => performance.now() + 1000;
  verifyProcfsSqliteBinding(900, home, later(), process.execPath, reader(ok));
  const rejected: [string, ProcReader, string?][] = [
    ['opened other home', reader([join(other, 'state_5.sqlite'), join(other, 'queue_1.sqlite')])],
    ['missing queue store', reader([join(home, 'state_5.sqlite')])],
    ['foreign WAL sidecar', reader([...ok, join(other, 'state_5.sqlite-wal')])],
    ['deleted state store', reader([join(home, 'state_5.sqlite') + ' (deleted)', join(home, 'queue_1.sqlite')])],
    ['same path, replaced inode', reader(ok, { [join(home, 'queue_1.sqlite')]: { dev: 1n, ino: 1n } })],
    ['different executable', reader(ok), join(root, 'not-the-binary')],
  ];
  writeFileSync(join(root, 'not-the-binary'), '');
  for (const [name, fake, binary] of rejected) {
    assert.throws(() => verifyProcfsSqliteBinding(900, home, later(), binary ?? process.execPath, fake), fault('storage_binding_unverified'), name);
  }
  assert.throws(() => verifyProcfsSqliteBinding(900, home, performance.now() - 1, process.execPath, reader(ok)), fault('storage_binding_unverified'));
  assert.throws(() => verifyProcfsSqliteBinding(undefined, home, later(), process.execPath, reader(ok)), fault('storage_binding_unverified'));
});

test('artifact identity accepts only the host-native executable format and hashes complete bytes within the deadline', posix, async t => {
  const root = temp(t, 'codex-artifact-'), header = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(64)]);
  const elf = (machine: number) => { const b = header([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); b.writeUInt16LE(2, 16); b.writeUInt16LE(machine, 18); return b; };
  const macho = (cpu: number, type = 2) => { const b = Buffer.alloc(64); b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(cpu, 4); b.writeUInt32LE(type, 12); return b; };
  assert.equal(nativeExecutable(elf(183), 'linux', 'arm64'), true); assert.equal(nativeExecutable(elf(62), 'linux', 'x64'), true);
  assert.equal(nativeExecutable(elf(62), 'linux', 'arm64'), false); assert.equal(nativeExecutable(elf(183), 'darwin', 'arm64'), false);
  assert.equal(nativeExecutable(macho(0x0100000c), 'darwin', 'arm64'), true); assert.equal(nativeExecutable(macho(0x0100000c, 6), 'darwin', 'arm64'), false);
  assert.equal(nativeExecutable(macho(0x0100000c), 'linux', 'arm64'), false);
  assert.equal(nativeExecutable(Buffer.from('#!/usr/bin/env node\n' + ' '.repeat(40)), 'linux', 'arm64'), false);
  const path = join(root, 'codex'), body = Buffer.concat([elf(183), Buffer.alloc(3 * 1024 * 1024, 7)]);
  writeFileSync(path, body);
  assert.equal(await artifactDigest(path, 'linux', 'arm64', Infinity, () => 0), createHash('sha256').update(body).digest('hex'));
  await assert.rejects(artifactDigest(path, 'linux', 'x64', Infinity, () => 0), refused);
  await assert.rejects(artifactDigest(path, 'linux', 'arm64', 10, () => 10), refused);
  await assert.rejects(artifactDigest(path, 'linux', 'arm64', Infinity, () => 0, 1024 * 1024), refused);
});

function hermetic(t: TestContext, platformOs: string, version = '0.162.1') {
  const input = new PassThrough(), requests: any[] = []; let closes = 0;
  const scope: AppServerScope = { codexHome: join(tmpdir(), 'fixture-home'), threadId: thread, generation: 'g', ownerIdentity: 'o' };
  const output = new Writable({ write(chunk, _encoding, callback) {
    const r = JSON.parse(chunk.toString()); requests.push(r); callback();
    if (r.method === 'initialize') input.write(JSON.stringify({ id: r.id, result: { codexHome: scope.codexHome, platformFamily: 'unix', platformOs,
      userAgent: `session-peer-native-queue/${version} (fixture)` } }) + '\n');
    if (r.method === 'thread/queue/add') input.write(JSON.stringify({ id: r.id, result: { queuedSubmission: { id: 'q',
      clientUserMessageId: r.params.clientUserMessageId, input: r.params.input } } }) + '\n');
  } });
  const transport: MetadataOnlyTransport = { qualification: 'hermetic_fixture_only', input, output,
    close: async () => { closes++; input.destroy(); output.destroy(); } };
  t.after(() => { input.destroy(); output.destroy(); });
  return { scope, transport, requests, closes: () => closes };
}

test('wire selection is the exact (platform, version) row: Linux handshake drift and absent rows refuse before effect', async t => {
  const table = [linuxRow()];
  const linux = hermetic(t, 'linux');
  const client = await BoundedAppServerClient.connectNativeQueueFixture(linux.scope, linux.transport, performance.now() + 1000,
    async () => true, async () => {}, '0.162.1', 'linux-arm64', table);
  assert.deepEqual(await client.queueOnce({ clientUserMessageId: 'cid', message: 'one' }), { queueId: 'q', clientUserMessageId: 'cid' });
  assert.deepEqual(linux.requests.map(r => r.method), ['initialize', 'initialized', 'thread/queue/add']);
  await client.close();
  // A macOS-reporting process cannot satisfy a Linux row (and vice versa).
  const drift = hermetic(t, 'macos');
  await assert.rejects(BoundedAppServerClient.connectNativeQueueFixture(drift.scope, drift.transport, performance.now() + 1000,
    async () => true, async () => {}, '0.162.1', 'linux-arm64', table), fault('owner_changed'));
  assert.deepEqual(drift.requests.map(r => r.method), ['initialize']);
  // Production has only linux-arm64/0.162.1; arch/version neighbours are absent.
  for (const [platform, version, profiles] of [['linux-x64', '0.162.1', NATIVE_PROFILES], ['linux-arm64', '0.160.1', NATIVE_PROFILES],
    ['linux-x64', '0.162.1', table],
    ['linux-arm64', '0.160.1', table]] as const) {
    const absent = hermetic(t, 'linux', version); let guards = 0;
    await assert.rejects(BoundedAppServerClient.connectNativeQueueFixture(absent.scope, absent.transport, performance.now() + 1000,
      async () => true, async () => { guards++; }, version, platform, profiles), fault('unsupported_version'));
    assert.equal(absent.requests.length, 0); assert.equal(guards, 0); assert.equal(absent.closes(), 1);
  }
  // Runtime build drift inside a selected Linux row is refused before queue/add.
  const runtime = hermetic(t, 'linux', '0.162.2');
  await assert.rejects(BoundedAppServerClient.connectNativeQueueFixture(runtime.scope, runtime.transport, performance.now() + 1000,
    async () => true, async () => {}, '0.162.1', 'linux-arm64', table), fault('unsupported_version'));
  assert.deepEqual(runtime.requests.map(r => r.method), ['initialize']);
});

test('a host without any profile row refuses before owner checks, version probes or native processes', posix, async t => {
  let spawned = 0, owners = 0, guards = 0;
  const originalSpawn = childProcess.spawn;
  mock.method(childProcess, 'spawn', (...args: Parameters<typeof childProcess.spawn>) => { spawned++; return originalSpawn(...args); });
  syncBuiltinESMExports(); t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  const options = { binary: process.execPath, scope: { codexHome: '/fixture-home', threadId: thread, generation: 'g', ownerIdentity: 'o' },
    message: 'fixture', clientUserMessageId: 'cid', deadlineMs: performance.now() + 1000,
    verifyOwner: async () => { owners++; return true; }, beforeEffect: async () => { guards++; } };
  const foreign = host.startsWith('linux') ? [{ ...NATIVE_PROFILES[1]! }] : [linuxRow({ platform: 'linux-x64',
    artifact: { target: 'x86_64-unknown-linux-musl', sha256: 'a'.repeat(64) } })];
  await assert.rejects(nativeQueueOnceWithProfiles(options, foreign), fault('unsupported_transport'));
  if (!NATIVE_PROFILES.some(row => row.platform === host)) await assert.rejects(nativeQueueOnce(options), fault('unsupported_transport'));
  assert.equal(spawned, 0); assert.equal(owners, 0); assert.equal(guards, 0);
  await assert.rejects(nativeQueueOnceWithProfiles(options, [linuxRow({ artifact: null })]), /invalid native/);
});

// A compiled stand-in is the only hermetic way for /proc/<pid>/exe to equal the
// selected binary; a #! script's exe is its interpreter and must be refused.
function compiledFixture(t: TestContext, root: string): string | undefined {
  const binary = join(root, 'codex'), cc = spawnSync('cc', ['-O0', '-o', binary, resolve('test/fixtures/native-codex-fixture.c')], { encoding: 'utf8' });
  if (cc.error || cc.status !== 0) { t.skip('C compiler unavailable for the compiled native fixture'); return undefined; }
  chmodSync(binary, 0o700); return binary;
}
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function syntheticRow(binary: string, patch: Partial<NativeProfile> = {}): NativeProfile {
  const target = process.platform === 'linux' ? (process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl') : 'aarch64-apple-darwin';
  return { platform: host, version: '0.162.1', commit: current, platformOs: process.platform === 'linux' ? 'linux' : 'macos',
    storageBinding: process.platform === 'linux' ? 'linux_procfs' : 'darwin_lsof',
    ownerInspection: process.platform === 'linux' ? 'lsof_ps_procfs_locks' : 'lsof_ps',
    artifact: { target, sha256: sha(binary) }, ...patch };
}
async function compiledRun(t: TestContext) {
  const root = temp(t, 'codex-compiled-native-'), home = join(root, 'home'), other = join(root, 'other'), log = join(root, 'events.jsonl');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(other, { mode: 0o700 }); writeFileSync(log, '');
  const binary = compiledFixture(t, root); if (!binary) return undefined;
  let guards = 0;
  const options = { binary, scope: { codexHome: home, threadId: thread, generation: 'g', ownerIdentity: 'o' }, message: 'own echo',
    clientUserMessageId: 'compiled-client-id', deadlineMs: performance.now() + 5000, verifyOwner: async () => true,
    beforeEffect: async () => { guards++; }, env: { PATH: process.env.PATH, HOME: root, FIXTURE_LOG: log } };
  const events = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { root, home, other, binary, options, events, guards: () => guards };
}

test('compiled native stand-in exercises exact artifact pinning on this host (synthetic row, never production)', {
  skip: !['linux-arm64', 'linux-x64', 'darwin-arm64'].includes(host),
}, async t => {
  const f = await compiledRun(t); if (!f) return;
  const row = syntheticRow(f.binary);
  const env = { ...f.options.env, FIXTURE_OS: process.platform === 'linux' ? 'linux' : 'macos' };
  assert.deepEqual(await nativeQueueOnceWithProfiles({ ...f.options, env }, [row]), { queueId: 'fixture-native-q', clientUserMessageId: 'compiled-client-id' });
  assert.equal(f.guards(), 1);
  assert.deepEqual(f.events().map(e => e.event), ['version', 'app-server', 'initialize', 'queue']);
  for (const event of f.events()) assert.throws(() => process.kill(event.pid, 0), (e: any) => e.code === 'ESRCH');
  // A different pinned digest refuses after the version probe, before app-server.
  await assert.rejects(nativeQueueOnceWithProfiles({ ...f.options, env, deadlineMs: performance.now() + 5000 },
    [syntheticRow(f.binary, { artifact: { ...row.artifact!, sha256: 'f'.repeat(64) } })]), fault('unsupported_version'));
  assert.equal(f.events().filter(e => e.event === 'app-server').length, 1);
  // The OS reported by the process must match the selected row's platform.
  await assert.rejects(nativeQueueOnceWithProfiles({ ...f.options, deadlineMs: performance.now() + 5000,
    env: { ...env, FIXTURE_OS: process.platform === 'linux' ? 'macos' : 'linux' } }, [row]), fault('owner_changed'));
  assert.equal(f.events().filter(e => e.event === 'queue').length, 1); assert.equal(f.guards(), 1);
});

test('Linux procfs binding: compiled owned child is verified natively; storage redirection and shims are refused', linuxNative, async t => {
  const f = await compiledRun(t); if (!f) return;
  const row = syntheticRow(f.binary);
  assert.equal(row.storageBinding, 'linux_procfs');
  assert.deepEqual(await nativeQueueOnceWithProfiles(f.options, [row]), { queueId: 'fixture-native-q', clientUserMessageId: 'compiled-client-id' });
  // Effective storage outside the pinned home: refused before the effect guard.
  await assert.rejects(nativeQueueOnceWithProfiles({ ...f.options, deadlineMs: performance.now() + 5000,
    env: { ...f.options.env, FIXTURE_STORAGE_HOME: f.other } }, [row]), fault('storage_binding_unverified'));
  assert.equal(f.guards(), 1);
  // A #! shim pinned by its own digest is still not a native executable.
  const shim = join(f.root, 'codex-shim');
  writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(f.binary)} "$@"\n`, { mode: 0o700 });
  const shimRow = syntheticRow(f.binary, { artifact: { ...row.artifact!, sha256: sha(shim) } });
  await assert.rejects(nativeQueueOnceWithProfiles({ ...f.options, binary: shim, deadlineMs: performance.now() + 5000 }, [shimRow]), fault('unsupported_version'));
  assert.equal(f.events().filter(e => e.event === 'queue').length, 1);
});

test('Linux procfs owner/storage readers inspect a real owned child and its kernel flock', linuxNative, async t => {
  const root = temp(t, 'codex-procfs-real-'), home = join(root, 'home'); mkdirSync(home, { mode: 0o700 });
  const lock = join(root, 'writer.lock'), locks = createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');
  const child = spawn(process.execPath, ['-e', `const fs=require('node:fs'),path=require('node:path');
    const home=process.argv[1];fs.openSync(path.join(home,'state_5.sqlite'),'w+');fs.openSync(path.join(home,'queue_1.sqlite'),'w+');
    require(process.argv[3]).flockSync(fs.openSync(process.argv[2],'w',0o600),'exnb');process.stdout.write('ready');setInterval(()=>{},1000);`, home, lock, locks],
  { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume(); await once(child.stdout, 'data');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { process.kill(-child.pid!, 'SIGKILL'); await once(child, 'close'); } });
  const owner = procOwner(child.pid!, undefined, true);
  assert.equal(owner.ppid, process.pid); assert.equal(owner.pgrp, child.pid); assert.equal(owner.uid, process.getuid!());
  assert.equal(procFlockOwner(lock), child.pid);
  verifyProcfsSqliteBinding(child.pid, home, performance.now() + 1000, process.execPath);
  // The selected binary must be the inode the owned PID executes, not a shim.
  const shim = join(root, 'node-shim'); writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o700 });
  assert.throws(() => verifyProcfsSqliteBinding(child.pid, home, performance.now() + 1000, shim), fault('storage_binding_unverified'));
  assert.throws(() => verifyProcfsSqliteBinding(child.pid, join(root, 'other'), performance.now() + 1000, process.execPath), fault('storage_binding_unverified'));
  process.kill(-child.pid!, 'SIGKILL'); await once(child, 'close');
  assert.throws(() => verifyProcfsSqliteBinding(child.pid, home, performance.now() + 1000, process.execPath), fault('storage_binding_unverified'));
  assert.throws(() => procFlockOwner(lock), refused);
});

async function writerFixture(t: TestContext) {
  const root = temp(t, 'codex-procfs-writer-'), home = join(root, 'home'), bin = join(root, 'bin');
  mkdirSync(join(home, 'thread-writer-locks'), { recursive: true, mode: 0o700 }); mkdirSync(bin, { mode: 0o700 });
  const lock = join(home, 'thread-writer-locks', thread + '.lock'), locks = createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');
  const held = spawn(process.execPath, ['-e', `const fs=require('node:fs');require(process.argv[2]).flockSync(fs.openSync(process.argv[1],'w',0o600),'exnb');process.stdout.write('ready');setInterval(()=>{},1000);`, lock, locks],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  held.stderr.resume(); await once(held.stdout, 'data');
  t.after(async () => { if (held.exitCode === null && held.signalCode === null) { held.kill('SIGKILL'); await once(held, 'close'); } });
  const lsof = join(bin, 'lsof'), owner = (pid: number) => writeFileSync(lsof + '.data', `p${pid}\0ccodex-fixture\0u${process.getuid?.()}\0`, { mode: 0o600 });
  owner(held.pid!); writeFileSync(lsof, '#!/bin/sh\nexec /bin/cat "$0.data"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "Fixture stable start\\n"\n', { mode: 0o700 });
  const env = { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ''), NODE_OPTIONS: undefined, NODE_PATH: undefined };
  const probe = async (...extra: string[]) => JSON.parse((await run(process.execPath, [resolve('dist/handoff-writer-probe.js'), home, thread, ...extra],
    { env, timeout: 2000, limit: 4096 })).stdout);
  return { home, held, owner, probe };
}

test('writer probe kernel mode is Linux-only and keeps the lsof/ps generation byte-for-byte', posix, async t => {
  const f = await writerFixture(t), plain = await f.probe();
  assert.equal(plain.ok, true);
  if (process.platform !== 'linux') {
    assert.deepEqual(await f.probe('--procfs-owner'), { schemaVersion: 1, ok: false, error: 'writer_probe_unsupported' });
  } else {
    assert.deepEqual(await f.probe('--procfs-owner'), plain);
    // lsof names a different (live, same-UID) process than the kernel holder.
    f.owner(process.pid);
    assert.equal((await f.probe()).ok, true);
    assert.deepEqual(await f.probe('--procfs-owner'), { schemaVersion: 1, ok: false, error: 'writer_probe_unverified' });
  }
  for (const extra of [['--procfs'], ['--procfs-owner', 'x'], ['extra']]) {
    assert.deepEqual(await f.probe(...extra), { schemaVersion: 1, ok: false, error: 'writer_probe_invalid' });
  }
});

// CLI-level Linux behaviour with an exact Darwin-qualified version installed:
// required delivery refuses before any effect; best-effort falls back to the
// ordinary queue chosen before an app-server attempt; nothing is resent.
async function cliFixture(t: TestContext, version = '0.162.1') {
  const root = temp(t, 'codex-linux-cli-'), home = join(root, 'home'), bin = join(root, 'bin');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(bin, { mode: 0o700 }); mkdirSync(join(home, 'thread-writer-locks'), { mode: 0o700 });
  const { DatabaseSync } = await import('node:sqlite');
  const state = new DatabaseSync(join(home, 'state_5.sqlite')); state.exec('CREATE TABLE threads(id TEXT)'); state.prepare('INSERT INTO threads VALUES(?)').run(thread); state.close();
  const locks = createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');
  const held = spawn(process.execPath, [resolve('test/fixtures/ssh-codex-lock-holder.cjs'), join(home, 'thread-writer-locks', thread + '.lock'), locks]);
  held.stderr.resume(); await once(held.stdout, 'data');
  t.after(async () => { if (held.exitCode === null && held.signalCode === null) { held.kill('SIGKILL'); await once(held, 'close'); } });
  writeFileSync(join(bin, 'lsof.data'), `p${held.pid}\0ccodex-fixture\0u${process.getuid?.()}\0`, { mode: 0o600 });
  writeFileSync(join(bin, 'lsof'), '#!/bin/sh\nexec /bin/cat "$0.data"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "Fixture stable start\\n"\n', { mode: 0o700 });
  const queueLog = join(root, 'queue.jsonl'), nativeLog = join(root, 'native.jsonl'), codex = join(bin, 'codex');
  writeFileSync(queueLog, ''); writeFileSync(nativeLog, '');
  writeFileSync(codex, readFileSync(resolve('test/fixtures/ssh-codex-native.cjs')), { mode: 0o700 });
  writeFileSync(codex + '.json', JSON.stringify({ mode: 'inject', version, queueLog, nativeLog }), { mode: 0o600 });
  const env = { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: home, SESSION_PEER_CODEX_HOMES: '[]', CLAUDE_CONFIG_DIR: join(root, '.claude'),
    SESSION_PEER_TAILSCALE: 'off', SESSION_PEER_UPDATE_NOTICE: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '',
    PATH: bin + delimiter + (process.env.PATH ?? ''), SESSION_PEER_HANDOFF_HOME: join(root, 'state', 'handoff') };
  async function invoke(args: string[]) {
    const child = spawn(process.execPath, [resolve('dist/cli.js'), ...args, '--json'], { env }); let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000); const [code, signal] = await once(child, 'close'); clearTimeout(timer);
    assert.equal(signal, null, stderr); return { code, value: JSON.parse(stdout), stdout };
  }
  assert.equal((await invoke(['handoff', 'init'])).code, 0);
  const read = (path: string) => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { env, invoke, queueCalls: () => read(queueLog), nativeCalls: () => read(nativeLog),
    args: ['send', '--to', 'codex:' + thread, '--codex-home', home, '--codex-bin', codex, '--message', 'fixture request', '--no-from', '--no-reply-to'] };
}

// Only versions without an exact row for this Linux host (all of them on x64).
for (const version of ['0.160.1', '0.162.1'].filter(version => !selectNativeProfile({ platform: host, version }))) {
  test(`Linux host with exact Darwin-qualified ${version} refuses required delivery and downgrades best-effort before any app-server`, linuxNative, async t => {
    const f = await cliFixture(t, version);
    const required = await f.invoke([...f.args, '--wait-for', 'delivered', '--wait-timeout', '10']);
    assert.equal(required.code, 1, required.stdout); assert.equal(required.value.submitted, false);
    assert.equal(required.value.handoff.wait.status, 'unsupported'); assert.equal(required.value.handoff.observation.status, 'unsupported');
    assert.deepEqual(f.queueCalls(), []);
    const best = await f.invoke([...f.args, '--observe-delivery']);
    assert.equal(best.code, 0, best.stdout); assert.equal(best.value.status, 'queued'); assert.equal(best.value.submitted, true);
    assert.equal(best.value.consumptionConfirmed, false); assert.equal(best.value.handoff.observation.status, 'unsupported');
    assert.equal(best.value.handoff.observation.injectionObserved, false); assert.equal(best.value.handoff.retry.allowed, false);
    assert.deepEqual(f.queueCalls(), [{ method: 'legacy' }]);
    assert.equal(f.nativeCalls().some(call => call.command === 'app-server'), false);
    const wait = await f.invoke(['handoff', 'wait', '--correlation-id', best.value.handoff.correlationId, '--wait-for', 'delivered', '--wait-timeout', '10']);
    assert.equal(wait.code, 1); assert.equal(wait.value.handoff.wait.status, 'unsupported');
    assert.deepEqual(f.queueCalls(), [{ method: 'legacy' }]);
    const duplicate = await f.invoke([...f.args, '--observe-delivery', '--correlation-id', best.value.handoff.correlationId]);
    assert.equal(duplicate.code, 1); assert.equal(duplicate.value.error, 'handoff_already_attempted');
    assert.deepEqual(f.queueCalls(), [{ method: 'legacy' }]);
    for (const secret of ['PRIVATE_SSH_CODEX_BODY_SENTINEL', 'observationQualification', 'payloadDigest']) assert.equal(best.stdout.includes(secret), false);
  });
}

// Fake SSH to a Linux destination running this checkout: complete results
// carry the destination's pre-effect refusal; partial preparation never sends.
async function sshFixture(t: TestContext) {
  const f = await cliFixture(t, '0.160.1'), root = temp(t, 'codex-linux-ssh-'), log = join(root, 'requests.jsonl'); writeFileSync(log, '');
  const ssh = join(root, 'ssh');
  writeFileSync(ssh, `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);
if(args.includes('-G')){console.log('user fixture-user');process.exit(0);}
if(args.at(-1).endsWith('--version')){console.log(process.env.FIXTURE_VERSION);process.exit(0);}
const input=fs.readFileSync(0,'utf8'),request=JSON.parse(input);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(request)+'\\n');
if(process.env.FIXTURE_PARTIAL_PREPARE&&request.handoff?.preparation){process.stdout.write('{');process.exit(0);}
const selector=args.at(-1).match(/ --handoff-remaining-ms=([1-9][0-9]{0,4})$/);
const child=cp.spawn(process.execPath,[process.env.FIXTURE_CLI,'--stdio-request',...(selector?['--handoff-remaining-ms='+selector[1]]:[])],{stdio:['pipe','inherit','inherit']});
child.stdin.end(input);child.on('close',code=>{process.exitCode=code;});
`, { mode: 0o700 });
  const { VERSION_LINE } = await import('../dist/protocol.js');
  return { ...f, log: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    ssh: { PATH: root + delimiter + f.env.PATH, FIXTURE_VERSION: VERSION_LINE, FIXTURE_LOG: log, FIXTURE_CLI: resolve('dist/cli.js') } };
}
test('SSH to a Linux destination: complete result keeps pre-effect refusal; partial preparation sends nothing', linuxNative, async t => {
  const f = await sshFixture(t);
  const invoke = async (args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const child = spawn(process.execPath, [resolve('dist/cli.js'), 'send', '--host', 'fixture', ...args.slice(1), '--json'], { env: { ...f.env, ...f.ssh, ...extra } });
    let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000); const [code, signal] = await once(child, 'close'); clearTimeout(timer);
    assert.equal(signal, null, stderr); return { code, value: JSON.parse(stdout), stdout };
  };
  const required = await invoke([...f.args, '--wait-for', 'delivered', '--wait-timeout', '15']);
  assert.equal(required.code, 1, required.stdout); assert.equal(required.value.submitted, false);
  assert.equal(required.value.handoff.wait.status, 'unsupported'); assert.deepEqual(f.queueCalls(), []);
  // One preparation and one send request; the destination refused before effect.
  assert.deepEqual(f.log().map(request => request.handoff?.preparation === true), [true, false]);
  const partial = await invoke([...f.args, '--observe-delivery'], { FIXTURE_PARTIAL_PREPARE: '1' });
  assert.equal(partial.code, 1, partial.stdout); assert.equal(partial.value.error, 'remote_preparation_unverified'); assert.deepEqual(f.queueCalls(), []);
  assert.deepEqual(f.log().map(request => request.handoff?.preparation === true), [true, false, true]);
  const best = await invoke([...f.args, '--observe-delivery']);
  assert.equal(best.code, 0, best.stdout); assert.equal(best.value.status, 'queued'); assert.equal(best.value.submitted, true);
  assert.equal(best.value.handoff.observation.status, 'unsupported'); assert.equal(best.value.consumptionConfirmed, false);
  assert.deepEqual(f.queueCalls(), [{ method: 'legacy' }]);
  assert.equal(f.nativeCalls().some(call => call.command === 'app-server'), false);
  for (const secret of ['PRIVATE_SSH_CODEX_BODY_SENTINEL', 'observationQualification', 'payloadDigest']) assert.equal(best.stdout.includes(secret), false);
});
