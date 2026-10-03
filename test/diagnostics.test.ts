import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { doctor, diagnoseCodex, diagnoseClaude, inspectSkills } from '../dist/diagnostics.js';
const cli = resolve('dist/cli.js');
// Answers `ssh -G` user metadata lookups without logging them as SSH dispatches.
const sshConfigUser = "if(process.argv.includes('-G')){console.log('user fixture-user');process.exit(0);}";
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-doctor-')));
  const previous = { ...process.env };
  Object.assign(process.env, { HOME: root, USERPROFILE: root, CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]',
    CLAUDE_CONFIG_DIR: join(root, '.claude'), ANTHROPIC_CONFIG_DIR: '' });
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); rmSync(root, { recursive: true, force: true });
  });
  const home = join(root, '.codex');
  const db = (schema = 'CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, rollout_path TEXT)', path = home) => {
    mkdirSync(path, { recursive: true }); const file = join(path, 'state_5.sqlite');
    const database = new DatabaseSync(file); database.exec(schema); database.close(); return file;
  };
  const invoke = (args: string[], wire?: string) => {
    const child = spawnSync(process.execPath, [cli, ...args], { env: process.env, encoding: 'utf8', input: wire, timeout: 45000 });
    assert.ifError(child.error); assert.equal(child.signal, null); return { code: child.status, value: JSON.parse(child.stdout), stderr: child.stderr };
  };
  return { root, home, db, invoke };
}

test('doctor succeeds independently of unavailable agents and truthfully declares capabilities', async t => {
  const f = fixture(t);
  const { code, value } = f.invoke(['doctor', '--json', '--codex-bin', join(f.root, 'absent')]);
  assert.equal(code, 0); assert.equal(value.ok, true); assert.equal(value.ready, false);
  assert.equal(value.agents.claude.code, 'sessions_dir_missing');
  assert.equal(value.agents.codex.tool.code, 'executable_unavailable');
  assert.equal(value.agents.codex.homes[0].code, 'state_db_missing');
  for (const key of ['wake', 'wait', 'ack', 'consumptionConfirmation']) assert.equal(value.capabilities[key], false);
  assert.equal(value.capabilities.doctor, true); assert.equal(value.implementation, 'typescript');
  assert.equal(value.diagnosticCompleted, true);
  assert.deepEqual(readdirSync(f.root), []); // no missing home/skill directories created
});

test('per-home schema, missing, malformed, permission and unknown diagnostics stay sanitized', async t => {
  const f = fixture(t); const file = f.db();
  const missing = join(f.root, 'missing'), unsupported = join(f.root, 'unsupported'), malformed = join(f.root, 'malformed');
  f.db('CREATE TABLE threads(id TEXT)', unsupported);
  mkdirSync(malformed); writeFileSync(join(malformed, 'state_5.sqlite'), 'private-native-detail');
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([missing, unsupported, malformed]);
  const result = await diagnoseCodex(undefined, process.execPath) as any;
  assert.deepEqual(result.homes.map((h: any) => h.code), ['state_db_readable', 'state_db_missing', 'unsupported_threads_schema', 'state_db_unreadable']);
  assert.equal(result.ready, false); assert.equal(result.homes[0].sessionCount, 0);
  assert.equal(JSON.stringify(result).includes('private-native-detail'), false);
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', ((path: any, ...args: any[]) => {
    if (path === file) throw Object.assign(new Error('credential=secret'), { code: 'EACCES' });
    return (stat as any)(path, ...args);
  }) as typeof fs.statSync); syncBuiltinESMExports();
  const denied = await diagnoseCodex(f.home, process.execPath) as any;
  assert.equal(denied.homes[0].status, 'permission_denied'); assert.equal(JSON.stringify(denied).includes('secret'), false);
});

test('explicit doctor home bypasses unrelated invalid inventory and never executes codex binary', async t => {
  const f = fixture(t); const file = f.db();
  process.env.SESSION_PEER_CODEX_HOMES = 'bad-secret-config';
  const before = readFileSync(file); const contents = readdirSync(f.home);
  const result = await diagnoseCodex(f.home, process.execPath) as any;
  assert.equal(result.ready, true); assert.equal(result.tool.executed, false); assert.equal(result.writerVerified, false);
  assert.equal(result.sendAuthorized, false); assert.deepEqual(readFileSync(file), before); assert.deepEqual(readdirSync(f.home), contents);
  const automatic = await diagnoseCodex(undefined, process.execPath) as any;
  assert.equal(automatic.ready, false); assert.equal(automatic.errors[0].code, 'invalid_home_configuration');
  assert.equal(JSON.stringify(automatic).includes('bad-secret'), false);
});

test('Claude process/inbox inspection never connects or exposes record fields', async t => {
  const f = fixture(t); const dir = join(f.root, '.claude/sessions'); mkdirSync(dir, { recursive: true });
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\session-peer-doctor-${process.pid}` : join(f.root, 'inbox');
  let connections = 0; const server = createServer(client => { connections++; client.destroy(); });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(socket, ok); });
  try {
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, startedAt: Date.now(), messagingSocketPath: socket, name: 'SECRET', cwd: 'CREDENTIAL' }));
    writeFileSync(join(dir, '2.json'), '{malformed');
    const result = diagnoseClaude();
    assert.equal(result.ready, true); assert.equal(result.inboxConnected, false); assert.equal(result.availableInboxes, 1);
    assert.equal(result.invalidRecords, 1); assert.equal(JSON.stringify(result).includes('SECRET'), false);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(connections, 0);
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    assert.equal(diagnoseClaude().code, 'inbox_unavailable');
  } finally { await new Promise<void>(done => server.close(() => done())); }
});

test('permissions and unknown process inspection cannot authorize readiness', t => {
  const f = fixture(t); const dir = join(f.root, '.claude/sessions'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid }));
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', ((path: any, ...args: any[]) => {
    if (String(path).endsWith(`${process.pid}.json`)) throw Object.assign(new Error('native-secret'), { code: 'EACCES' });
    return (read as any)(path, ...args);
  }) as typeof fs.readFileSync); syncBuiltinESMExports();
  const result = diagnoseClaude(); assert.equal(result.code, 'permission_denied'); assert.equal(result.ready, false);
  assert.equal(JSON.stringify(result).includes('native-secret'), false);
});

test('stdio doctor has identical read-only result boundaries and rejects dispatch options', t => {
  const f = fixture(t); f.db();
  const wire = f.invoke(['--stdio-request'], JSON.stringify({ schemaVersion: 1, args: ['doctor', '--json', '--agent', 'codex', '--codex-home', f.home, '--codex-bin', process.execPath] }));
  assert.equal(wire.code, 0); assert.equal(wire.value.command, 'doctor'); assert.equal(wire.value.ready, true);
  assert.deepEqual(Object.keys(wire.value.agents), ['codex']);
  for (const args of [['--to', 'codex:id'], ['--all'], ['--dry-run'], ['--message', 'SECRET'], ['--allow-inactive-codex-home']]) {
    const result = f.invoke(['doctor', '--json', ...args]); assert.equal(result.code, 2); assert.equal(result.value.status, 'refused');
  }
  const nested = f.invoke(['--stdio-request'], JSON.stringify({ schemaVersion: 1, args: ['doctor', '--json', '--host', 'example.invalid'] }));
  assert.equal(nested.value.error, 'nested_transport_forbidden');
});

test('skill compatibility reads only bounded TS metadata and rejects Python/malformed contracts', t => {
  const f = fixture(t); const path = join(f.root, '.agents/skills/session-peer-ts'); mkdirSync(path, { recursive: true });
  assert.equal(inspectSkills(f.home)[0]!.status, 'missing');
  const metadata = '---\nname: session-peer-ts\nmetadata:\n  version: "0.1.0"\n  runtime-implementation: "typescript"\n  runtime-min-version: "0.1.0"\n  runtime-full-version: "0.1.0"\n  runtime-capability-policy: "probe-help"\n---\nDo not run this secret body';
  writeFileSync(join(path, 'SKILL.md'), metadata);
  assert.equal(inspectSkills(f.home)[0]!.status, 'compatible');
  writeFileSync(join(path, 'SKILL.md'), metadata.replace('metadata:', 'version: ignored-root-value\nmetadata:').replace('version: "0.1.0"', 'version: "0.1.0" # contract version'));
  assert.equal(inspectSkills(f.home)[0]!.status, 'compatible');
  writeFileSync(join(path, 'SKILL.md'), metadata.replace('typescript', 'python'));
  assert.equal(inspectSkills(f.home)[0]!.status, 'incompatible');
  writeFileSync(join(path, 'SKILL.md'), 'no frontmatter'); assert.equal(inspectSkills(f.home)[0]!.status, 'unknown');
  assert.equal(JSON.stringify(inspectSkills(f.home)).includes('secret'), false);
});


test('POSIX SSH doctor version-checks then sends JSON stdin and performs zero dispatch', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); f.db();
  const calls = join(f.root, 'calls');
  const source = `#!${process.execPath}\n${sshConfigUser}const fs=require('node:fs');const {spawnSync}=require('node:child_process');
const flag=process.argv.at(-1).endsWith('--version')?'--version':'--stdio-request';
const input=fs.readFileSync(0,'utf8');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({flag,input})+'\\n');
const child=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},flag],{input,encoding:'utf8',env:process.env});process.stdout.write(child.stdout);process.exit(child.status);`;
  writeFileSync(join(f.root, 'ssh'), source, { mode: 0o700 });
  process.env.PATH = f.root + delimiter + process.env.PATH;
  const { code, value } = f.invoke(['doctor', '--json', '--agent', 'codex', '--codex-home', f.home, '--codex-bin', process.execPath, '--host', 'fixture']);
  assert.equal(code, 0); assert.equal(value.ready, true); assert.equal(value.sshHost, 'fixture');
  const log = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(log.length, 2); assert.equal(log[0].flag, '--version'); assert.equal(log[0].input, '');
  assert.deepEqual(JSON.parse(log[1].input).args.slice(0, 2), ['doctor', '--json']);
  assert.equal(value.agents.codex.tool.executed, false); assert.equal(value.agents.codex.sendAuthorized, false);
});

test('doctor distinguishes denied/unknown executable inspection without invoking it', async t => {
  const f = fixture(t); f.db();
  const access = fs.accessSync; let code = 'EACCES';
  t.mock.method(fs, 'accessSync', ((path: any, ...args: any[]) => {
    if (path === process.execPath) throw Object.assign(new Error('secret native arguments'), { code });
    return (access as any)(path, ...args);
  }) as typeof fs.accessSync); syncBuiltinESMExports();
  const denied = await diagnoseCodex(f.home, process.execPath) as any;
  assert.equal(denied.ready, false); assert.equal(denied.tool.status, 'permission_denied'); assert.equal(denied.tool.executed, false);
  code = 'EIO'; const unknown = await diagnoseCodex(f.home, process.execPath) as any;
  assert.equal(unknown.tool.status, 'unknown'); assert.equal(JSON.stringify(unknown).includes('secret'), false);
});

test('uninspectable POSIX process is unknown, not live or stale', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const dir = join(f.root, '.claude/sessions'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, messagingSocketPath: 'never-probed' }));
  t.mock.method(process, 'kill', () => { throw Object.assign(new Error('secret'), { code: 'EPERM' }); });
  const result = diagnoseClaude(); assert.equal(result.code, 'inspection_unknown'); assert.equal(result.ready, false);
  assert.equal(result.unknownInspections, 1); assert.equal(result.staleRecords, 0); assert.equal(result.aliveSessions, 0);
});


test('unreadable Claude metadata is unknown while malformed JSON is invalid', t => {
  const f = fixture(t); const dir = join(f.root, '.claude/sessions'); mkdirSync(dir, { recursive: true });
  const path = join(dir, `${process.pid}.json`); writeFileSync(path, '{}');
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', ((item: any, ...args: any[]) => {
    if (item === path) throw Object.assign(new Error('native-detail'), { code: 'EIO' });
    return (stat as any)(item, ...args);
  }) as typeof fs.statSync); syncBuiltinESMExports();
  const result = diagnoseClaude(); assert.equal(result.code, 'inspection_unknown'); assert.equal(result.unknownInspections, 1);
  assert.equal(result.invalidRecords, 0); assert.equal(JSON.stringify(result).includes('native-detail'), false);
});

test('doctor reports a relocated Codex sqlite_home as unsupported instead of reading a stale state DB', async t => {
  const f = fixture(t); f.db();
  for (const key of ['sqlite_home', '"sqlite_home"', "'sqlite_home'", '"sqlite\\u005fhome"']) {
    writeFileSync(join(f.home, 'config.toml'), `${key} = "/relocated"\n`);
    const result = await diagnoseCodex(f.home, process.execPath) as any;
    assert.equal(result.homes[0].status, 'unsupported', key);
    assert.equal(result.homes[0].code, 'unsupported_codex_sqlite_home', key);
    assert.equal(result.ready, false);
  }
  writeFileSync(join(f.home, 'config.toml'), 'model = "sqlite_home = /relocated"\n# sqlite_home = "/commented"\n[profiles.p]\nmodel = "fixture"\n');
  assert.equal(((await diagnoseCodex(f.home, process.execPath)) as any).homes[0].code, 'state_db_readable');
  writeFileSync(join(f.home, 'config.toml'), 'sqlite_home = [\n');
  const invalid = await diagnoseCodex(f.home, process.execPath) as any;
  assert.equal(invalid.homes[0].status, 'unknown');
  assert.equal(invalid.homes[0].code, 'codex_config_unreadable');
});
