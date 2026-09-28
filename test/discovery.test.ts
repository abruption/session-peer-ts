// Port of Python 1.0.2 unified-list/multi-home-list contracts. No live user homes.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { codex, listing, listingCandidates } from '../dist/discovery.js';
import { homes } from '../dist/writer.js';

const cli = resolve('dist/cli.js');
const id = '01900000-0000-7000-8000-000000000001';
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-list-')));
  const prior = { ...process.env };
  Object.assign(process.env, { HOME: root, USERPROFILE: root, CODEX_HOME: '',
    SESSION_PEER_CODEX_HOMES: '[]', CLAUDE_CONFIG_DIR: join(root, '.claude'), ANTHROPIC_CONFIG_DIR: '',
    PYTHONDONTWRITEBYTECODE: '1' });
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior); rmSync(root, { recursive: true, force: true });
  });
  const home = join(root, '.codex');
  function database(path = home, updated: number | string = 1, archived = 0, thread = id) {
    mkdirSync(path, { recursive: true });
    const db = new DatabaseSync(join(path, 'state_5.sqlite'));
    try {
      db.exec('CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, rollout_path TEXT)');
      db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(thread, 'fixture', '/project', updated, archived, 'unused');
    } finally { db.close(); }
    return path;
  }
  function invoke(args: string[] = ['list'], env: NodeJS.ProcessEnv = process.env, wire?: string) {
    const child = spawnSync(process.execPath, [cli, ...args, ...(wire === undefined ? ['--json'] : [])],
      { env, input: wire, encoding: 'utf8', timeout: 45000 });
    assert.ifError(child.error); assert.equal(child.signal, null);
    const value = JSON.parse(child.stdout);
    assert.equal(value.schemaVersion, 1); assert.equal(value.command, 'list');
    assert.equal(child.status, value.ok ? 0 : 1, child.stdout);
    return value;
  }
  function oracle(args: string[], node: any) {
    if (!process.env.SESSION_PEER_PYTHON_ROOT) return; // Python oracle is POSIX CI only.
    const child = spawnSync(process.env.PYTHON ?? 'python3', [join(process.env.SESSION_PEER_PYTHON_ROOT, 'session_peer.py'),
      ...args, '--json', '--no-update-notice'], { env: process.env, encoding: 'utf8', timeout: 15000 });
    assert.ifError(child.error);
    const reference = JSON.parse(child.stdout);
    assert.equal(node.ok, reference.ok); assert.deepEqual(node.sessions, reference.sessions);
    assert.equal(node.codexHome, reference.codexHome);
    function diagnostics(value: any) {
      const c = value.discovery.codex;
      return c && { status: c.status, homes: c.homes.map(({ error, ...home }: any) => home),
        errors: c.errors?.map(({ error, ...item }: any) => item) };
    }
    assert.deepEqual(diagnostics(node), diagnostics(reference));
  }
  return { root, home, database, invoke, oracle };
}

test('optional absent, empty installed DB, and required absent homes have distinct outcomes', t => {
  const f = fixture(t);
  const empty = f.invoke();
  assert.deepEqual(empty.sessions, []); assert.equal(empty.discovery.codex.status, 'not_installed');
  assert.equal(empty.discovery.claude.status, 'ok'); f.oracle(['list'], empty);
  for (const source of ['argument', 'environment', 'configured']) {
    process.env.CODEX_HOME = source === 'environment' ? f.home : '';
    process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify(source === 'configured' ? [f.home] : []);
    const args = ['list', '--agent', 'codex', ...(source === 'argument' ? ['--codex-home', f.home] : [])];
    const failed = f.invoke(args);
    assert.equal(failed.ok, false); assert.equal(failed.discovery.codex.homes[0].code, 'state_db_missing');
    f.oracle(args, failed);
  }
  f.database();
  const db = new DatabaseSync(join(f.home, 'state_5.sqlite')); db.exec('DELETE FROM threads'); db.close();
  const installed = f.invoke(['list', '--agent', 'codex']);
  assert.equal(installed.ok, true); assert.equal(installed.discovery.codex.status, 'ok');
  assert.equal(installed.discovery.codex.homes[0].sessionCount, 0);
});

test('combined/filter/all listing never connects to a reachable inbox or mutates saved state', async t => {
  const f = fixture(t); f.database();
  const sessions = join(f.root, '.claude', 'sessions'); mkdirSync(sessions, { recursive: true });
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\session-peer-list-${process.pid}` : join(f.root, 'inbox');
  let connections = 0;
  const server = createServer(client => { connections++; client.destroy(); });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(socket, ok); });
  const record = { pid: process.pid, startedAt: Date.now(), name: 'fixture', messagingSocketPath: socket };
  writeFileSync(join(sessions, `${process.pid}.json`), JSON.stringify(record));
  writeFileSync(join(sessions, '1.json'), JSON.stringify({ pid: 1, name: 'stale' }));
  const before = readFileSync(join(f.home, 'state_5.sqlite'));
  try {
    const combined = f.invoke();
    assert.deepEqual(combined.sessions.map((r: any) => r.agent), ['claude', 'codex']); f.oracle(['list'], combined);
    for (const agent of ['claude', 'codex']) {
      const result = f.invoke(['list', '--agent', agent]);
      assert.deepEqual(Object.keys(result.discovery), [agent]); assert.equal(result.sessions.length, 1);
      assert.equal(result.sessions[0].agent, agent);
    }
    assert.equal(f.invoke(['list', '--all']).sessions.length, 3);
    process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([join(f.root, 'missing')]);
    const partial = f.invoke();
    assert.equal(partial.ok, false); assert.deepEqual(partial.sessions, combined.sessions);
    f.oracle(['list'], partial);
    await new Promise(ok => setImmediate(ok)); assert.equal(connections, 0);
    assert.deepEqual(readFileSync(join(f.home, 'state_5.sqlite')), before);
    assert.deepEqual(fs.readdirSync(f.home), ['state_5.sqlite']);
    assert.equal(fs.existsSync(join(f.home, 'thread-writer-locks')), false);
  } finally { await new Promise<void>(ok => server.close(() => ok())); }
});

test('bounded sources retain duplicate UUIDs, merge aliases, and sort globally across homes', t => {
  const f = fixture(t); f.database(f.home, 2);
  const env = f.database(join(f.root, 'environment'), 4);
  const extra = f.database(join(f.root, 'extra'), 2);
  const alias = join(f.root, 'alias'); symlinkSync(f.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  process.env.CODEX_HOME = env;
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([extra, alias, f.home]);
  const accounts = join(f.root, 'Library/Application Support/orca/codex-accounts');
  const orca = f.database(join(accounts, 'a', 'home'), 3);
  mkdirSync(join(accounts, 'z', 'home'), { recursive: true });
  f.database(join(f.root, 'unlisted', 'nested', 'home'), 99); // Must never recursively discover.
  const result = f.invoke(['list', '--agent', 'codex']);
  const expected = [env, ...(process.platform === 'darwin' ? [orca] : []), ...[f.home, extra].sort()];
  assert.deepEqual(result.sessions.map((r: any) => r.codexHome), expected);
  assert.equal('codexHome' in result, false);
  for (const row of result.sessions) { assert.equal(row.id, id); assert.equal(row.stateDb, join(row.codexHome, 'state_5.sqlite')); assert.equal('alive' in row, false); }
  assert.deepEqual(result.discovery.codex.homes[0].sources, ['default', 'configured']);
  if (process.platform === 'darwin') assert.equal(result.discovery.codex.homes.find((h: any) => h.codexHome === join(accounts, 'z', 'home')).status, 'absent');
  f.oracle(['list', '--agent', 'codex'], result);
  process.env.CODEX_HOME = alias;
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([alias, f.home]);
  const candidates = listingCandidates();
  assert.deepEqual(candidates.homes[0]!.sources, ['default', 'environment', 'configured']);
});

test('global ordering handles Unicode home/id ties and all applies independently per home', t => {
  const f = fixture(t); f.database(f.home, 9, 1);
  const astral = f.database(join(f.root, '🚀'), 3, 0, '🚀');
  const bmp = f.database(join(f.root, '\ue000'), 3, 0, '\ue000');
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([astral, bmp]);
  const visible = f.invoke(['list', '--agent', 'codex']);
  assert.deepEqual(visible.sessions.map((r: any) => r.codexHome), [bmp, astral]); f.oracle(['list', '--agent', 'codex'], visible);
  const all = f.invoke(['list', '--agent', 'codex', '--all']);
  assert.equal(all.sessions[0].codexHome, f.home); assert.equal(all.sessions.length, 3); f.oracle(['list', '--agent', 'codex', '--all'], all);
});

test('explicit selection bypasses invalid inventory; Claude filtering never inventories Codex', async t => {
  const f = fixture(t), selected = f.database(join(f.root, 'selected'));
  process.env.SESSION_PEER_CODEX_HOMES = '{SECRET-SENTINEL';
  process.env.CODEX_HOME = join(f.root, 'missing');
  const args = ['list', '--codex-home', selected];
  const result = f.invoke(args); assert.equal(result.ok, true); assert.equal(result.sessions.length, 1); f.oracle(args, result);
  assert.deepEqual(result.discovery.codex.homes[0].sources, ['argument']);
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (...args: Parameters<typeof fs.statSync>) => {
    assert.equal(String(args[0]).endsWith('state_5.sqlite'), false, 'Claude-only must skip Codex'); return stat(...args);
  }); syncBuiltinESMExports();
  assert.equal((await listing('claude', undefined, false)).ok, true);
});

test('invalid configuration is rejected as a whole while other sources survive', t => {
  const f = fixture(t); f.database();
  const extra = f.database(join(f.root, 'extra'), 99);
  for (const value of ['', '{SECRET-SENTINEL', '{}', 'null', JSON.stringify([extra, 'relative']), JSON.stringify([extra, null]), JSON.stringify([extra, '/bad\0path'])]) {
    process.env.SESSION_PEER_CODEX_HOMES = value;
    const result = f.invoke(['list', '--agent', 'codex']);
    assert.equal(result.ok, false); assert.equal(result.sessions.length, 1); assert.equal(result.sessions[0].codexHome, f.home);
    assert.equal(result.discovery.codex.errors[0].code, 'invalid_home_configuration');
    assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false);
  }
  // Writer validation still fails closed on invalid configured candidates.
  assert.throws(() => homes(f.home), /invalid_home_configuration/);
});

test('corrupt, incompatible, missing, and invalid-row DBs preserve readable homes', t => {
  const f = fixture(t); f.database();
  const corrupt = join(f.root, 'corrupt'); mkdirSync(corrupt); writeFileSync(join(corrupt, 'state_5.sqlite'), 'SECRET-SENTINEL');
  const schema = join(f.root, 'schema'); mkdirSync(schema); new DatabaseSync(join(schema, 'state_5.sqlite')).close();
  const invalid = f.database(join(f.root, 'invalid'), 'bad timestamp');
  const directory = join(f.root, 'directory'); mkdirSync(join(directory, 'state_5.sqlite'), { recursive: true });
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([corrupt, schema, invalid, directory, join(f.root, 'missing')]);
  const result = f.invoke();
  assert.equal(result.ok, false); assert.equal(result.sessions.length, 1); assert.equal(result.discovery.claude.status, 'ok');
  assert.deepEqual(result.discovery.codex.homes.slice(1).map((h: any) => h.code),
    ['state_db_read_failed', 'state_db_read_failed', 'state_db_read_failed', 'state_db_not_regular', 'state_db_missing']);
  assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false);
  f.oracle(['list'], result);
});

test('permission, canonicalization and agent errors preserve other sources with non-success status', async t => {
  const f = fixture(t); f.database();
  const blocked = f.database(join(f.root, 'blocked'));
  const unresolved = join(f.root, 'unresolved');
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([blocked, unresolved]);
  const stat = fs.statSync, real = fs.realpathSync, read = fs.readdirSync;
  const denied = () => Object.assign(new Error('SECRET-SENTINEL'), { code: 'EACCES' });
  t.mock.method(fs, 'statSync', (...args: Parameters<typeof fs.statSync>) => {
    if (args[0] === join(blocked, 'state_5.sqlite')) throw denied(); return stat(...args);
  });
  t.mock.method(fs, 'realpathSync', (...args: Parameters<typeof fs.realpathSync>) => {
    if (args[0] === unresolved) throw denied(); return real(...args);
  });
  t.mock.method(fs, 'readdirSync', (...args: Parameters<typeof fs.readdirSync>) => {
    if (args[0] === join(f.root, '.claude', 'sessions')) throw denied(); return read(...args);
  }); syncBuiltinESMExports();
  const result = await listing(undefined, undefined, false);
  assert.equal(result.ok, false); assert.equal(result.sessions.length, 1);
  const discovery = result.discovery.codex as any;
  assert.equal(discovery.homes[1].code, 'permission_denied');
  assert.equal(discovery.errors[0].code, 'home_resolution_failed');
  assert.equal(result.discovery.claude!.status, 'error'); assert.equal('codexHome' in result, false);
  assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false);
});

test('Orca enumeration failure is partial and explicit home bypasses it', async t => {
  const f = fixture(t); f.database();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  t.after(() => Object.defineProperty(process, 'platform', platform));
  const read = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (...args: Parameters<typeof fs.readdirSync>) => {
    if (String(args[0]).endsWith('codex-accounts')) throw Object.assign(new Error('SECRET-SENTINEL'), { code: 'EACCES' });
    return read(...args);
  }); syncBuiltinESMExports();
  const partial = await codex(undefined, false);
  assert.equal(partial.ok, false); assert.equal(partial.sessions.length, 1);
  assert.equal((partial.discovery.codex!.errors as any[])[0].code, 'candidate_enumeration_failed');
  assert.equal((await codex(f.home, false)).ok, true);
});

test('stdio listing uses destination inventory and preserves partial rows', t => {
  const f = fixture(t); f.database();
  const remoteRoot = join(f.root, 'remote'); mkdirSync(remoteRoot);
  const remoteHome = f.database(join(remoteRoot, '.codex'));
  const env = { ...process.env, HOME: remoteRoot, USERPROFILE: remoteRoot,
    SESSION_PEER_CODEX_HOMES: JSON.stringify([join(remoteRoot, 'missing')]) };
  const result = f.invoke(['--stdio-request'], env, JSON.stringify({ schemaVersion: 1, args: ['list', '--json'] }));
  assert.equal(result.ok, false); assert.equal(result.sessions[0].codexHome, remoteHome);
  assert.equal(result.discovery.codex.homes[1].code, 'state_db_missing');
});

test('POSIX SSH preserves destination ordering, filters, all and nonzero partial envelopes', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); f.database(f.home, 99);
  const remoteRoot = join(f.root, 'remote'); mkdirSync(remoteRoot);
  const remoteHome = f.database(join(remoteRoot, '.codex'), 3, 1);
  const extra = f.database(join(remoteRoot, 'extra'), 2);
  const remoteEnv = { ...process.env, HOME: remoteRoot, USERPROFILE: remoteRoot,
    SESSION_PEER_CODEX_HOMES: JSON.stringify([extra, join(remoteRoot, 'missing')]) };
  writeFileSync(join(f.root, 'ssh'), `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');\nconst flag=process.argv.at(-1).endsWith('--version')?'--version':'--stdio-request';\nconst result=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},flag],{input:require('node:fs').readFileSync(0),encoding:'utf8',env:{...process.env,...${JSON.stringify({HOME: remoteRoot, USERPROFILE: remoteRoot, SESSION_PEER_CODEX_HOMES: remoteEnv.SESSION_PEER_CODEX_HOMES})}}});\nprocess.stdout.write(result.stdout);process.exit(result.status);`, { mode: 0o700 });
  const env = { ...process.env, PATH: f.root + delimiter + process.env.PATH };
  for (const all of [[], ['--all']]) {
    const args = ['list', '--agent', 'codex', ...all];
    const local = f.invoke(args, remoteEnv), remote = f.invoke([...args, '--host', 'fixture'], env);
    assert.deepEqual(remote.sessions, local.sessions); assert.deepEqual(remote.discovery, local.discovery);
    assert.equal(remote.ok, false); assert.equal(remote.sshHost, 'fixture'); assert.equal('submitted' in remote, false);
    assert.equal(remote.sessions.length, all.length ? 2 : 1);
  }
  assert.equal(f.invoke(['list', '--host', 'fixture', '--codex-home', remoteHome, '--all'], env).ok, true);
});
