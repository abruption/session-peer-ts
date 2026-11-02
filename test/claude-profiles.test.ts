// Hermetic metadata/fixture sockets only. No real profile inventory or inbox input.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { claude, CLAUDE_PROFILE_LIMIT, CLAUDE_ENTRY_LIMIT } from '../dist/discovery.js';
import { send } from '../dist/send.js';
import { sender } from '../dist/replies.js';
import { diagnoseClaude } from '../dist/diagnostics.js';
import { help } from '../dist/help.js';

function fixture(t: TestContext, platform = 'darwin') {
  const root = fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-profiles-'));
  const prior = { ...process.env }, descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.assign(process.env, { HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: '', ANTHROPIC_CONFIG_DIR: '',
    CLAUDE_CODE_MESSAGING_SOCKET: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '' });
  Object.defineProperty(process, 'platform', { value: platform });
  const base = join(root, 'Library/Application Support/orca/claude-profiles');
  const defaultDir = join(root, '.claude/sessions');
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports(); Object.defineProperty(process, 'platform', descriptor);
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior); fs.rmSync(root, { recursive: true, force: true });
  });
  function directory(profile?: string) {
    const path = profile ? join(base, profile, 'home/sessions') : defaultDir;
    fs.mkdirSync(path, { recursive: true }); return path;
  }
  function record(dir: string, pid: number, socket: string, name = 'fixture') {
    const file = join(dir, `${pid}.json`);
    fs.writeFileSync(file, JSON.stringify({ pid, name, messagingSocketPath: socket, startedAt: 42 })); return file;
  }
  return { root, base, defaultDir, directory, record };
}
async function inbox(t: TestContext, root: string) {
  // Real fixture socket, never a real agent inbox. Every test asserts zero input.
  const path = join(root, 's'); let connections = 0;
  const server = createServer(client => { connections++; client.destroy(); });
  server.listen(path); await once(server, 'listening');
  t.after(() => new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())));
  return { path, untouched: () => assert.equal(connections, 0) };
}
const found = () => claude(true) as { sessions: Record<string, unknown>[]; discovery: { claude: { status: string; errors?: string[] } } };
const refuse = (code: string) => (error: { code?: string }) => error.code === code;

test('profile-only discovery, doctor, sender and dry-run share original registry without inbox effects', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root);
  f.record(f.directory('z'), process.pid, socket.path, 'profile-only');
  const value = found(); assert.equal(value.discovery.claude.status, 'ok'); assert.equal(value.sessions.length, 1);
  assert.deepEqual(Object.keys(value.sessions[0]!).sort(), ['agent','alive','cwd','kind','name','pid','reachable','socket','status','tmux','version'].sort());
  assert.equal(JSON.stringify(value).includes('claude-profiles'), false, 'private provenance must not leak in rows');
  const diagnostic = diagnoseClaude(); assert.equal(diagnostic.ready, true); assert.equal(diagnostic.availableInboxes, 1);
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = socket.path;
  assert.deepEqual(sender(), { agent: 'claude', id: 'profile-only' });
  let identity: string | undefined;
  const dry = await send({ to: 'profile-only', message: 'fixture', dryRun: true, hooks: {
    resolved(context) { identity = context.writerIdentity; assert.equal(context.generation, null); }
  } });
  assert.equal(dry.submitted, false); assert.match(identity!, /^[0-9a-f]{64}$/); socket.untouched();
});

test('explicit overrides isolate one registry and non-macOS does not scan Orca convention', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, 'linux'), socket = await inbox(t, f.root);
  f.record(f.directory(), process.pid, socket.path, 'default');
  const profile = f.directory('profile'); f.record(profile, process.pid, socket.path, 'profile');
  assert.deepEqual(found().sessions.map(row => row.name), ['default']);
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  process.env.CLAUDE_CONFIG_DIR = join(profile, '..');
  assert.deepEqual(found().sessions.map(row => row.name), ['profile']);
  process.env.ANTHROPIC_CONFIG_DIR = join(f.defaultDir, '..');
  assert.deepEqual(found().sessions.map(row => row.name), ['profile'], 'CLAUDE override has precedence');
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.deepEqual(found().sessions.map(row => row.name), ['default']); socket.untouched();
});

test('default and profile inventory is deterministic; absent or unused profiles are optional', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root);
  const originalKill = process.kill; t.mock.method(process, 'kill', ((pid: number, signal?: number | NodeJS.Signals) => {
    if (signal === 0 && [101, 102, 103].includes(pid)) return true; return originalKill(pid, signal);
  }) as typeof process.kill);
  f.record(f.directory('z'), 103, socket.path + '-missing', 'z');
  f.record(f.directory('a'), 102, socket.path + '-missing2', 'a');
  f.record(f.directory(), 101, socket.path, 'default');
  fs.mkdirSync(join(f.base, 'unused')); fs.writeFileSync(join(f.base, '.DS_Store'), 'ignored');
  assert.deepEqual(found().sessions.map(row => row.name), ['default', 'a', 'z']);
  assert.equal(found().discovery.claude.status, 'ok'); socket.untouched();
});

test('canonical registry alias scans once; divergent live PID, socket and endpoint claims refuse', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), profile = f.directory('a');
  f.record(profile, process.pid, socket.path);
  fs.mkdirSync(join(f.root, '.claude')); fs.symlinkSync(profile, f.defaultDir, 'dir');
  assert.equal(found().sessions.length, 1); assert.equal(found().discovery.claude.status, 'ok');
  const other = f.directory('b');
  f.record(other, process.pid, socket.path, 'different');
  let value = found(); assert.equal(value.discovery.claude.status, 'error');
  assert.ok(value.sessions.every(row => row.reachable === false));
  await assert.rejects(send({ to: String(process.pid), message: 'fixture', dryRun: true }), refuse('claude_discovery_incomplete'));
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = socket.path; assert.equal(sender(), undefined);
  fs.unlinkSync(join(other, `${process.pid}.json`));
  const kill = process.kill; t.mock.method(process, 'kill', ((pid: number, signal?: number | NodeJS.Signals) => pid === 123 && signal === 0 ? true : kill(pid, signal)) as typeof process.kill);
  f.record(other, 123, socket.path, 'other-pid');
  assert.equal(found().discovery.claude.status, 'error', 'same socket string with distinct PIDs conflicts');
  fs.unlinkSync(join(other, '123.json')); const alias = join(f.root, 'alias'); fs.symlinkSync(socket.path, alias);
  f.record(other, 123, alias, 'socket-alias');
  value = found(); assert.equal(value.discovery.claude.status, 'error', 'underlying socket aliases conflict');
  assert.equal(diagnoseClaude().ready, false); socket.untouched();
});

test('profile symlinks, permission failures and malformed multi-registry records retain healthy rows but block sends', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root); f.record(f.directory(), process.pid, socket.path);
  const profile = f.directory('a'); fs.writeFileSync(join(profile, '123.json'), '{invalid');
  let value = found(); assert.equal(value.sessions.length, 1); assert.equal(value.discovery.claude.status, 'error');
  fs.rmSync(join(f.base, 'a'), { recursive: true });
  fs.symlinkSync(join(f.root, '.claude'), join(f.base, 'bad'), 'dir');
  assert.equal(found().discovery.claude.status, 'error');
  await assert.rejects(send({ to: 'fixture', message: 'fixture', dryRun: true }), refuse('claude_discovery_incomplete'));
  fs.unlinkSync(join(f.base, 'bad')); f.directory('denied');
  const open = fs.opendirSync;
  t.mock.method(fs, 'opendirSync', ((path: any, ...args: any[]) => {
    if (String(path).endsWith('denied/home/sessions')) throw Object.assign(new Error('private-native-detail'), { code: 'EACCES' });
    return (open as any)(path, ...args);
  }) as typeof fs.opendirSync); syncBuiltinESMExports();
  value = found(); assert.equal(value.sessions.length, 1); assert.equal(value.discovery.claude.status, 'error');
  assert.equal(JSON.stringify(value).includes('private-native-detail'), false); socket.untouched();
});

test('profile and global entry limits produce explicit incomplete inventory and zero inbox writes', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root); f.record(f.directory(), process.pid, socket.path);
  for (let i = 0; i <= CLAUDE_PROFILE_LIMIT; i++) fs.mkdirSync(join(f.base, String(i)), { recursive: true });
  let value = found(); assert.ok(value.discovery.claude.errors?.includes('profile_inventory_limit'));
  assert.equal(value.sessions.length, 1);
  fs.rmSync(f.base, { recursive: true });
  for (let i = 0; i < CLAUDE_ENTRY_LIMIT; i++) fs.writeFileSync(join(f.defaultDir, `metadata-${i}`), '');
  value = found(); assert.ok(value.discovery.claude.errors?.includes('session_inventory_limit'));
  await assert.rejects(send({ to: 'fixture', message: 'fixture', dryRun: true }), refuse('claude_discovery_incomplete'));
  socket.untouched();
});

for (const stage of ['resolved', 'beforeEffect'] as const) test(`registry, record and socket changes after ${stage} are refused before inbox connection`, { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), directory = f.directory('a');
  const file = f.record(directory, process.pid, socket.path);
  for (const change of ['record', 'directory', 'socket']) {
    f.record(directory, process.pid, socket.path);
    const mutation = async () => {
      await Promise.resolve();
      if (change === 'record') { fs.unlinkSync(file); f.record(directory, process.pid, socket.path); }
      else if (change === 'directory') { fs.renameSync(directory, directory + '.old'); fs.mkdirSync(directory); f.record(directory, process.pid, socket.path); }
      else { const alias = socket.path + '-alias'; fs.symlinkSync(socket.path, alias); f.record(directory, process.pid, alias); }
    };
    const hooks = { resolved() {}, [stage]: mutation };
    await assert.rejects(send({ to: 'fixture', message: 'fixture', hooks }), refuse('target_changed'));
    if (change === 'directory') fs.rmSync(directory + '.old', { recursive: true });
    socket.untouched();
  }
});

test('list help explains bounded profiles, explicit isolation and incomplete refusal', () => {
  const text = help('list'); assert.match(text, /bounded known Orca profiles/);
  assert.match(text, /CLAUDE_CONFIG_DIR/); assert.match(text, /Incomplete\/conflicting inventory refuses send/);
});

test('new competing profile after the final async hook refuses instead of choosing inventory order', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root); f.record(f.directory(), process.pid, socket.path);
  await assert.rejects(send({ to: 'fixture', message: 'fixture', hooks: {
    resolved() {}, async beforeEffect() { await Promise.resolve(); f.record(f.directory('late'), process.pid, socket.path); }
  } }), refuse('claude_discovery_incomplete'));
  socket.untouched();
});

test('timeout hook runs before the final registry continuity check and cannot retarget an inbox', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), dir = f.directory('a');
  const path = f.record(dir, process.pid, socket.path);
  let calls = 0;
  await assert.rejects(send({ to: 'fixture', message: 'fixture', hooks: {
    resolved() {}, timeoutMs() { calls++; fs.unlinkSync(path); f.record(dir, process.pid, socket.path); return 1000; }
  } }), refuse('target_changed'));
  assert.equal(calls, 1); socket.untouched();
});

test('observable session-directory mutation during inventory is reported incomplete', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), dir = f.directory('a'); f.record(dir, process.pid, socket.path);
  const read = fs.readSync; let changed = false;
  t.mock.method(fs, 'readSync', ((...args: any[]) => {
    const result = (read as any)(...args);
    if (!changed) { changed = true; fs.writeFileSync(join(dir, 'added'), ''); }
    return result;
  }) as typeof fs.readSync); syncBuiltinESMExports();
  const value = found(); assert.equal(value.sessions.length, 1);
  assert.ok(value.discovery.claude.errors?.includes('sessions_directory_changed')); socket.untouched();
});

test('automatic profile owner mismatch retains defaults but prevents target selection', { skip: process.platform === 'win32' || !process.getuid }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root); f.record(f.directory(), process.pid, socket.path);
  f.directory('foreign'); const path = join(f.base, 'foreign');
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', ((item: any, ...args: any[]) => {
    const info = (lstat as any)(item, ...args);
    if (item === path) Object.defineProperty(info, 'uid', { value: process.getuid!() + 1 });
    return info;
  }) as typeof fs.lstatSync); syncBuiltinESMExports();
  const value = found(); assert.equal(value.sessions.length, 1);
  assert.ok(value.discovery.claude.errors?.includes('profile_directory_unavailable'));
  await assert.rejects(send({ to: 'fixture', message: 'fixture', dryRun: true }), refuse('claude_discovery_incomplete'));
  socket.untouched();
});

test('profile-only malformed records make automatic inventory incomplete while isolated legacy roots retain skip behavior', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), profile = f.directory('a');
  f.record(profile, process.pid, socket.path);
  fs.writeFileSync(join(profile, '123.json'), '{invalid');
  const value = found(); assert.equal(value.sessions.length, 1);
  assert.ok(value.discovery.claude.errors?.includes('session_record_unavailable'));
  await assert.rejects(send({ to: 'fixture', message: 'fixture', dryRun: true }), refuse('claude_discovery_incomplete'));
  process.env.CLAUDE_CONFIG_DIR = join(profile, '..');
  assert.equal(found().discovery.claude.status, 'ok', 'explicit single-root legacy skip is preserved');
  assert.equal((await send({ to: 'fixture', message: 'fixture', dryRun: true })).submitted, false);
  delete process.env.CLAUDE_CONFIG_DIR;
  fs.mkdirSync(join(f.root, '.claude'), { recursive: true });
  fs.renameSync(profile, f.defaultDir); fs.rmSync(f.base, { recursive: true });
  assert.equal(found().discovery.claude.status, 'ok', 'single default legacy skip is preserved');
  socket.untouched();
});

for (const existingBase of [false, true]) test(`whole-inventory fence catches a late competing profile during final default-record read (base ${existingBase ? 'present' : 'absent'})`, { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), directory = f.directory();
  f.record(directory, process.pid, socket.path);
  if (existingBase) fs.mkdirSync(f.base, { recursive: true });
  let armed = false, changed = false;
  const read = fs.readSync;
  t.mock.method(fs, 'readSync', ((...args: any[]) => {
    const count = (read as any)(...args);
    if (armed && !changed && count > 0) {
      changed = true;
      f.record(f.directory('late'), process.pid, socket.path, 'competing-profile');
    }
    return count;
  }) as typeof fs.readSync); syncBuiltinESMExports();
  await assert.rejects(send({ to: 'fixture', message: 'fixture', hooks: {
    resolved() {}, beforeEffect() { armed = true; }
  } }), refuse('claude_discovery_incomplete'));
  assert.equal(changed, true); socket.untouched();
});

for (const existingBase of [false, true]) test(`metadata-only final fence catches a competing profile added during a later identity read (base ${existingBase ? 'present' : 'absent'})`, { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), directory = f.directory();
  f.record(directory, process.pid, socket.path);
  if (existingBase) fs.mkdirSync(f.base, { recursive: true });
  let armed = false, reads = 0, changed = false;
  const read = fs.readSync;
  t.mock.method(fs, 'readSync', ((...args: any[]) => {
    const count = (read as any)(...args);
    if (armed && count > 0 && ++reads === 2) {
      // Read 1 is the final rediscovery. Read 2 validates the original row's
      // record identity AFTER that inventory has already fenced its sources.
      changed = true;
      f.record(f.directory('late'), process.pid, socket.path, 'competing-profile');
    }
    return count;
  }) as typeof fs.readSync); syncBuiltinESMExports();
  await assert.rejects(send({ to: 'fixture', message: 'fixture', hooks: {
    resolved() {}, beforeEffect() { armed = true; }
  } }), refuse('claude_discovery_incomplete'));
  assert.equal(changed, true); assert.equal(reads, 3, 'the fence must not recursively read registry records');
  socket.untouched();
});

for (const component of ['base', 'profile', 'home', 'sessions'] as const) test(`automatic ${component} directory rejects group/world writes while healthy defaults remain visible`, { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root); f.record(f.directory(), process.pid, socket.path);
  const profile = f.directory('a');
  const path = component === 'base' ? f.base : component === 'profile' ? join(f.base, 'a') : component === 'home' ? join(f.base, 'a/home') : profile;
  for (const mode of [0o775, 0o777]) {
    fs.chmodSync(path, mode);
    const value = found(); assert.equal(value.sessions.length, 1);
    assert.equal(value.discovery.claude.status, 'error');
    await assert.rejects(send({ to: 'fixture', message: 'fixture', dryRun: true }), refuse('claude_discovery_incomplete'));
  }
  fs.chmodSync(path, 0o755); socket.untouched();
});

test('canonical default alias cannot downgrade writable automatic record policy; isolated explicit/default admission stays legacy', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), profile = f.directory('a');
  const file = f.record(profile, process.pid, socket.path); fs.chmodSync(file, 0o666);
  fs.mkdirSync(join(f.root, '.claude')); fs.symlinkSync(profile, f.defaultDir, 'dir');
  const value = found(); assert.equal(value.sessions.length, 0);
  assert.ok(value.discovery.claude.errors?.includes('session_record_unavailable'));
  await assert.rejects(send({ to: 'fixture', message: 'fixture', dryRun: true }), refuse('claude_discovery_incomplete'));
  process.env.CLAUDE_CONFIG_DIR = join(profile, '..');
  assert.equal(found().discovery.claude.status, 'ok', 'explicit single-root legacy policy remains unchanged');
  assert.equal((await send({ to: 'fixture', message: 'fixture', dryRun: true })).submitted, false);
  delete process.env.CLAUDE_CONFIG_DIR;
  fs.unlinkSync(f.defaultDir); fs.renameSync(profile, f.defaultDir); fs.rmSync(f.base, { recursive: true });
  assert.equal(found().discovery.claude.status, 'ok', 'single-default legacy policy remains unchanged');
  socket.untouched();
});

for (const phase of ['before', 'opened', 'final'] as const) for (const field of ['uid', 'mode'] as const) test(`automatic record ${field} is checked at ${phase} without hiding healthy default rows`, { skip: process.platform === 'win32' || !process.getuid }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root); f.record(f.directory(), process.pid, socket.path);
  const path = f.record(f.directory('a'), 123, socket.path + '-missing', 'unsafe');
  const open = fs.openSync, lstat = fs.lstatSync, fstat = fs.fstatSync;
  let descriptor = -1, inspections = 0;
  const alter = (info: fs.Stats) => {
    Object.defineProperty(info, field, { value: field === 'uid' ? process.getuid!() + 1 : info.mode | 0o022 }); return info;
  };
  t.mock.method(fs, 'openSync', ((item: any, ...args: any[]) => {
    const fd = (open as any)(item, ...args); if (item === path) descriptor = fd; return fd;
  }) as typeof fs.openSync);
  t.mock.method(fs, 'lstatSync', ((item: any, ...args: any[]) => {
    const info = (lstat as any)(item, ...args); return phase === 'before' && item === path ? alter(info) : info;
  }) as typeof fs.lstatSync);
  t.mock.method(fs, 'fstatSync', ((fd: number, ...args: any[]) => {
    const info = (fstat as any)(fd, ...args);
    if (fd === descriptor && ++inspections === (phase === 'opened' ? 1 : 2) && phase !== 'before') return alter(info);
    return info;
  }) as typeof fs.fstatSync); syncBuiltinESMExports();
  const value = found(); assert.deepEqual(value.sessions.map(row => row.name), ['fixture']);
  assert.ok(value.discovery.claude.errors?.includes('session_record_unavailable'));
  if (phase === 'before') assert.equal(descriptor, -1, 'unsafe automatic metadata must be refused before open');
  else assert.equal(inspections, phase === 'opened' ? 1 : 2);
  socket.untouched();
});

test('automatic record mode changes during the async effect hook refuse before connecting', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), file = f.record(f.directory('a'), process.pid, socket.path);
  await assert.rejects(send({ to: 'fixture', message: 'fixture', hooks: {
    resolved() {}, beforeEffect() { fs.chmodSync(file, 0o666); }
  } }), refuse('claude_discovery_incomplete'));
  socket.untouched();
});


test('Windows known-invalid PID 1 stays a stale record without invoking native inspection or marking discovery incomplete', t => {
  const f = fixture(t, 'win32'), directory = f.directory();
  fs.writeFileSync(join(directory, '1.json'), JSON.stringify({ pid: 1, name: 'known-stale' }));
  let inspections = 0;
  const kill = process.kill;
  t.mock.method(process, 'kill', ((pid: number, signal?: number | NodeJS.Signals) => pid === 123 && signal === 0 ? true : kill(pid, signal)) as typeof process.kill);
  t.mock.method(childProcess, 'spawnSync', () => { inspections++; throw new Error('fixture native inspector unavailable'); });
  syncBuiltinESMExports();
  let value = found();
  assert.equal(value.discovery.claude.status, 'ok'); assert.equal(inspections, 0);
  assert.equal(value.sessions.length, 1); assert.equal(value.sessions[0]!.alive, false);
  assert.equal(value.sessions[0]!.reachable, false); assert.deepEqual(claude(false).sessions, []);
  fs.unlinkSync(join(directory, '1.json'));
  fs.writeFileSync(join(directory, '123.json'), JSON.stringify({ pid: 123, name: 'uninspectable-valid-pid', startedAt: 42 }));
  value = found(); assert.equal(inspections, 1);
  assert.equal(value.discovery.claude.status, 'error', 'failed inspection of a valid PID must still fail closed');
  assert.ok(value.discovery.claude.errors?.includes('process_unverified'));
});


test('Windows verified absent stale PID does not suppress healthy sessions; real inspection failures stay incomplete', t => {
  const f = fixture(t, 'win32'), directory = f.directory(), startedAt = Date.now();
  const stale = process.pid === 123 ? 124 : 123;
  fs.writeFileSync(join(directory, `${stale}.json`), JSON.stringify({ pid: stale, name: 'stale', startedAt, messagingSocketPath: String.raw`\\.\pipe\stale` }));
  fs.writeFileSync(join(directory, `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'healthy', startedAt, messagingSocketPath: String.raw`\\.\pipe\healthy` }));
  const ticks = String(116444736000000000n + BigInt(startedAt - 1000) * 10000n);
  let failHealthy = false, absence = true;
  const kill = process.kill;
  t.mock.method(process, 'kill', ((pid: number, signal?: number | NodeJS.Signals) => {
    if (pid === stale && signal === 0) throw Object.assign(new Error('fixture absent'), { code: absence ? 'ESRCH' : 'EPERM' });
    return kill(pid, signal);
  }) as typeof process.kill);
  t.mock.method(childProcess, 'spawnSync', ((_file: unknown, args: string[]) => {
    const healthy = args.some(arg => arg.includes(`GetProcessById(${process.pid})`));
    return { pid: 99, status: healthy && !failHealthy ? 0 : 1, signal: null, stdout: healthy && !failHealthy ? ticks : '', stderr: '', output: [] };
  }) as any); syncBuiltinESMExports();
  let value = found(); assert.equal(value.discovery.claude.status, 'ok');
  assert.equal(value.sessions.find(row => row.pid === stale)!.staleReason, 'process_absent');
  assert.deepEqual((claude(false).sessions as any[]).map(row => row.name), ['healthy']);
  assert.equal(diagnoseClaude().ready, true);
  failHealthy = true; value = found(); assert.equal(value.discovery.claude.status, 'error');
  assert.ok(value.discovery.claude.errors?.includes('process_unverified'));
  failHealthy = false; absence = false; value = found();
  assert.equal(value.discovery.claude.status, 'error', 'EPERM is not proof of absence');
});

test('final metadata fence catches another record edited in place into a target-name collision', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), directory = f.directory();
  const otherRoot = join(f.root, 'other'); fs.mkdirSync(otherRoot);
  const otherSocket = await inbox(t, otherRoot);
  f.record(directory, process.pid, socket.path, 'target');
  const other = process.pid === 123 ? 124 : 123;
  const path = f.record(directory, other, otherSocket.path, 'other!');
  const kill = process.kill;
  t.mock.method(process, 'kill', ((pid: number, signal?: number | NodeJS.Signals) => pid === other && signal === 0 ? true : kill(pid, signal)) as typeof process.kill);
  let armed = false, reads = 0, changed = false;
  const read = fs.readSync;
  t.mock.method(fs, 'readSync', ((...args: any[]) => {
    const count = (read as any)(...args);
    if (armed && count > 0 && ++reads === 3) {
      // Two numeric records are read in final rediscovery, then the selected
      // record is reread. Editing the OTHER inode changes no directory entry.
      const before = fs.statSync(path);
      f.record(directory, other, otherSocket.path, 'target');
      fs.utimesSync(path, before.atime, new Date(before.mtimeMs + 2000));
      const after = fs.statSync(path); assert.equal(after.ino, before.ino); assert.equal(after.size, before.size);
      changed = true;
    }
    return count;
  }) as typeof fs.readSync); syncBuiltinESMExports();
  await assert.rejects(send({ to: 'target', message: 'fixture', hooks: {
    resolved() {}, beforeEffect() { armed = true; }
  } }), refuse('claude_discovery_incomplete'));
  assert.equal(changed, true); socket.untouched(); otherSocket.untouched();
});

for (const priorAlias of [false, true]) test(`final metadata fence catches unselected endpoint ${priorAlias ? 'alias retarget' : 'appearance'} after inventory`, { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = await inbox(t, f.root), directory = f.directory();
  const otherRoot = join(f.root, 'other'); fs.mkdirSync(otherRoot);
  const otherSocket = await inbox(t, otherRoot), alias = join(f.root, 'unselected-alias');
  if (priorAlias) fs.symlinkSync(otherSocket.path, alias);
  f.record(directory, process.pid, socket.path, 'target');
  const other = process.pid === 123 ? 124 : 123;
  f.record(directory, other, alias, 'other');
  const kill = process.kill;
  t.mock.method(process, 'kill', ((pid: number, signal?: number | NodeJS.Signals) => pid === other && signal === 0 ? true : kill(pid, signal)) as typeof process.kill);
  let armed = false, reads = 0, changed = false;
  const read = fs.readSync;
  t.mock.method(fs, 'readSync', ((...args: any[]) => {
    const count = (read as any)(...args);
    if (armed && count > 0 && ++reads === 3) {
      if (priorAlias) fs.unlinkSync(alias);
      fs.symlinkSync(socket.path, alias); changed = true;
    }
    return count;
  }) as typeof fs.readSync); syncBuiltinESMExports();
  await assert.rejects(send({ to: 'target', message: 'fixture', hooks: {
    resolved() {}, beforeEffect() { armed = true; }
  } }), refuse('claude_discovery_incomplete'));
  assert.equal(changed, true); socket.untouched(); otherSocket.untouched();
});
