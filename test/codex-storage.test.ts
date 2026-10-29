import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { classifyCodexStorage, codexWriterStorage, storageDiagnostic, STORAGE_LOADER_VERSIONS } from '../dist/codex-storage.js';
import { send } from '../dist/send.js';
import { diagnoseCodex } from '../dist/diagnostics.js';
import { handoffSend } from '../dist/handoff-operations.js';
import { HandoffBudget } from '../dist/handoff.js';
import { HandoffLedger } from '../dist/handoff-ledger.js';

const id = '11111111-1111-4111-8111-111111111111';
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-storage-')));
  const home = join(root, 'home'), systemBase = join(root, 'system'), cwd = join(root, 'work'), consumer = join(root, 'consumer');
  for (const path of [home, systemBase, cwd, consumer]) mkdirSync(path);
  const previous = { ...process.env };
  Object.assign(process.env, { HOME: root, USERPROFILE: root, CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]' });
  const options = { home, systemBase, queueCwd: cwd, consumerCwds: [consumer], platform: 'linux', version: '0.165.0' };
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); rmSync(root, { recursive: true, force: true }); });
  const config = (path: string, text: string | Buffer) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
  return { root, home, systemBase, cwd, consumer, options, config };
}
test('exact source loader tags are separate from observation qualification; unsupported platforms/versions close', t => {
  const f = fixture(t);
  for (const version of STORAGE_LOADER_VERSIONS) {
    const check = classifyCodexStorage({ ...f.options, version });
    assert.equal(check.status, 'classified'); assert.equal(check.loaderVersionVerified, true);
  }
  for (const version of ['', '0.165.1', '0.162.1-vendor']) assert.equal(classifyCodexStorage({ ...f.options, version }).code, 'codex_storage_loader_unsupported');
  assert.equal(classifyCodexStorage({ ...f.options, platform: 'win32' }).code, 'codex_storage_platform_unqualified');
  const check = classifyCodexStorage({ ...f.options, version: undefined });
  assert.equal(check.loaderVersionVerified, false); assert.equal(check.loaderVersion, null);
  assert.equal(JSON.stringify(storageDiagnostic(check)).includes(f.root), false);
  assert.equal('fingerprint' in storageDiagnostic(check), false);
});
test('home/system/requirements/legacy each reject semantic escaped root keys, malformed UTF8/TOML and unreadable files', t => {
  const f = fixture(t);
  const paths = [join(f.home, 'config.toml'), ...['config.toml', 'requirements.toml', 'managed_config.toml'].map(name => join(f.systemBase, name))];
  for (const path of paths) {
    for (const text of ['sqlite_home="SECRET-LOCATION"', String.raw`"sqlite\u005fhome"="SECRET-LOCATION"`, String.raw`"sqlite\U0000005fhome"="SECRET-LOCATION"`]) {
      f.config(path, text); const result = classifyCodexStorage(f.options);
      assert.equal(result.code, 'unsupported_codex_sqlite_home'); assert.equal(JSON.stringify(result).includes('SECRET'), false);
    }
    for (const text of ['sqlite_home=[', 'setting=3e++20', Buffer.from([0xff])]) {
      f.config(path, text); assert.equal(classifyCodexStorage(f.options).status, 'unknown');
    }
    f.config(path, '[profiles.p]\nsqlite_home="nested-only"\n'); assert.equal(classifyCodexStorage(f.options).status, 'classified');
    rmSync(path);
  }
  f.config(paths[1]!, 'model="ok"');
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', ((path: any, ...args: any[]) => {
    if (path === paths[1]) throw Object.assign(new Error('SECRET-detail'), { code: 'EACCES' });
    return (open as any)(path, ...args);
  }) as typeof fs.openSync); syncBuiltinESMExports();
  const result = classifyCodexStorage(f.options); assert.equal(result.status, 'unknown'); assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('configuration reads reject symlinks, directories, oversized files, replacements and FIFO without opening', t => {
  const f = fixture(t), path = join(f.home, 'config.toml'), target = join(f.root, 'target');
  writeFileSync(target, 'model="ok"'); symlinkSync(target, path);
  assert.equal(classifyCodexStorage(f.options).status, 'unknown'); rmSync(path);
  mkdirSync(path); assert.equal(classifyCodexStorage(f.options).status, 'unknown'); rmSync(path, { recursive: true });
  if (process.platform !== 'win32') {
    childProcess.execFileSync('/usr/bin/mkfifo', [path]);
    assert.equal(classifyCodexStorage(f.options).status, 'unknown'); rmSync(path);
  }
  writeFileSync(path, 'x'.repeat(1024 * 1024 + 1)); assert.equal(classifyCodexStorage(f.options).status, 'unknown');
  writeFileSync(path, 'model="ok"');
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', ((file: any, ...args: any[]) => {
    if (file === path) { rmSync(path); writeFileSync(path, 'model="replacement"'); }
    return (open as any)(file, ...args);
  }) as typeof fs.openSync); syncBuiltinESMExports();
  assert.equal(classifyCodexStorage(f.options).status, 'unknown');
});
test('project layers inspect physical queue and consumer cwd, nearest git boundaries and custom markers', t => {
  const f = fixture(t), inner = join(f.cwd, 'nested'); mkdirSync(inner);
  const alias = join(f.root, 'alias'); symlinkSync(inner, alias);
  f.config(join(f.cwd, '.git', 'HEAD'), 'ref: refs/heads/main');
  f.config(join(f.cwd, '.codex', 'config.toml'), 'sqlite_home="SECRET-project"');
  assert.equal(classifyCodexStorage({ ...f.options, queueCwd: alias }).status, 'unsupported');
  rmSync(join(f.cwd, '.codex'), { recursive: true });
  f.config(join(f.consumer, '.codex', 'config.toml'), 'sqlite_home="SECRET-consumer"');
  assert.equal(classifyCodexStorage({ ...f.options, queueCwd: alias }).status, 'unsupported');
  rmSync(join(f.consumer, '.codex'), { recursive: true });
  f.config(join(f.root, '.codex', 'config.toml'), 'sqlite_home="above-default-boundary"');
  assert.equal(classifyCodexStorage(f.options).status, 'classified');
  f.config(join(f.home, 'config.toml'), 'project_root_markers=["custom"]');
  assert.equal(classifyCodexStorage(f.options).status, 'unsupported');
  assert.equal(classifyCodexStorage({ ...f.options, queueCwd: join(f.root, 'missing') }).status, 'unknown');
});
test('an early EOF never classifies an observed nonempty configuration; the descriptor closes exactly once', t => {
  const f = fixture(t); f.config(join(f.home, 'config.toml'), 'sqlite_home="SECRET"');
  const close = fs.closeSync; let closes = 0;
  t.mock.method(fs, 'readSync', () => 0);
  t.mock.method(fs, 'closeSync', (fd: number) => { closes++; close(fd); }); syncBuiltinESMExports();
  const result = classifyCodexStorage(f.options);
  assert.equal(result.status, 'unknown'); assert.equal(closes, 1);
});
test('configuration identity uses exact bigint inode values beyond Number precision and closes once on mismatch', t => {
  const f = fixture(t), file = join(f.home, 'config.toml'); f.config(file, 'model="fixture"');
  const lstat = fs.lstatSync, fstat = fs.fstatSync, close = fs.closeSync; let closes = 0;
  t.mock.method(fs, 'lstatSync', ((path: any, ...args: any[]) => {
    const info = (lstat as any)(path, ...args);
    return path === file ? Object.assign(Object.create(info), { ino: 9007199254740992n }) : info;
  }) as typeof fs.lstatSync);
  t.mock.method(fs, 'fstatSync', ((...args: any[]) => Object.assign(Object.create((fstat as any)(...args)), { ino: 9007199254740993n })) as typeof fs.fstatSync);
  t.mock.method(fs, 'closeSync', (fd: number) => { closes++; close(fd); }); syncBuiltinESMExports();
  assert.equal(classifyCodexStorage(f.options).status, 'unknown'); assert.equal(closes, 1);
});
test('live consumer storage uses retained PID opened-inode evidence independently of sender loader version', t => {
  const f = fixture(t), file = join(f.home, 'state_5.sqlite'); writeFileSync(file, 'fixture-metadata');
  const info = fs.lstatSync(file, { bigint: true }); let reported = file, inode = info.ino;
  t.mock.method(childProcess, 'execFileSync', (() => `p123\0f3\0D0x${info.dev.toString(16)}\0i${inode}\0n${reported}\0`) as unknown as typeof childProcess.execFileSync); syncBuiltinESMExports();
  assert.doesNotThrow(() => codexWriterStorage(123, f.home));
  reported = join(f.root, 'elsewhere', 'state_5.sqlite'); assert.throws(() => codexWriterStorage(123, f.home));
  reported = file; inode++; assert.throws(() => codexWriterStorage(123, f.home));
  reported = file + ' (deleted)'; assert.throws(() => codexWriterStorage(123, f.home));
});
test('all supported macOS tags ignore ordinary preferences and inspect forced config/requirements with bounded base64 TOML', t => {
  const f = fixture(t), encoded = (text: string) => Buffer.from(text).toString('base64');
  for (const version of STORAGE_LOADER_VERSIONS) {
    const options = { ...f.options, platform: 'darwin', version };
    assert.equal(classifyCodexStorage({ ...options, preferences: () => [{ forced: false, value: encoded('sqlite_home="ordinary"') }] }).status, 'classified');
    for (const value of [encoded('sqlite_home="forced"'), encoded(String.raw`"sqlite\u005fhome"="forced"`)]) {
      assert.equal(classifyCodexStorage({ ...options, preferences: () => [{ forced: true, value }] }).status, 'unsupported');
    }
    for (const value of [1, 'not-base64!', encoded('sqlite_home=['), 'A'.repeat(2 * 1024 * 1024 + 1)]) {
      assert.equal(classifyCodexStorage({ ...options, preferences: () => [{ forced: true, value }] }).status, 'unknown');
    }
    assert.equal(classifyCodexStorage({ ...options, preferences: () => { throw new Error('SECRET'); } }).status, 'unknown');
  }
});
test('ordinary queue refuses a retained daemon; owned stdio classification is separate', t => {
  const f = fixture(t); f.config(join(f.home, 'app-server-control', 'app-server-control.sock'), 'metadata-only');
  assert.equal(classifyCodexStorage(f.options).code, 'codex_daemon_storage_unverified');
  assert.equal(classifyCodexStorage({ ...f.options, ownedAppServer: true }).status, 'classified');
});
test('possible cloud policy requires owned binding: metadata, keyring/auto, external identity and config server', t => {
  const f = fixture(t);
  for (const name of ['auth.json', 'cloud-config-bundle-cache.json']) {
    const path = join(f.home, name); writeFileSync(path, 'SECRET-NEVER-READ');
    assert.equal(classifyCodexStorage(f.options).code, 'codex_cloud_storage_unverified');
    const owned = classifyCodexStorage({ ...f.options, ownedAppServer: true });
    assert.equal(owned.status, 'classified'); assert.equal(owned.cloudConfiguration, 'requires_owned_storage_binding'); rmSync(path);
    symlinkSync(join(f.root, 'missing-target'), path);
    assert.equal(classifyCodexStorage(f.options).code, 'codex_cloud_storage_unverified'); rmSync(path);
  }
  for (const mode of ['keyring', 'auto']) {
    f.config(join(f.home, 'config.toml'), `cli_auth_credentials_store="${mode}"`);
    assert.equal(classifyCodexStorage(f.options).code, 'codex_cloud_storage_unverified');
  }
  f.config(join(f.home, 'config.toml'), 'cli_auth_credentials_store="file"');
  assert.equal(classifyCodexStorage(f.options).status, 'classified');
  f.config(join(f.home, 'config.toml'), '[profiles.selected]\ncli_auth_credentials_store="keyring"');
  assert.equal(classifyCodexStorage(f.options).code, 'codex_cloud_storage_unverified');
  f.config(join(f.home, 'config.toml'), '[config_server]\nurl="https://fixture.invalid"');
  assert.equal(classifyCodexStorage(f.options).code, 'codex_cloud_storage_unverified'); rmSync(join(f.home, 'config.toml'));
  for (const name of ['CODEX_ACCESS_TOKEN', 'OPENAI_FEDERATION_RULE_ID', 'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_WORKLOAD_IDENTITY_CONTEXT']) {
    const check = classifyCodexStorage({ ...f.options, environment: { [name]: 'SECRET-MARKER' } });
    assert.equal(check.code, 'codex_cloud_storage_unverified'); assert.equal(JSON.stringify(check).includes('SECRET'), false);
  }
});
test('unreadable auth metadata fails closed without reading credentials; remote environment markers and environment files refuse', t => {
  const f = fixture(t);
  for (const name of ['CODEX_EXEC_SERVER_URL', 'CODEX_EXEC_SERVER_NOISE_REGISTRY_URL', 'CODEX_EXEC_SERVER_NOISE_ENVIRONMENT_ID', 'CODEX_EXEC_SERVER_NOISE_AUTH_TOKEN', 'CODEX_EXEC_SERVER_NOISE_CHATGPT_ACCOUNT_ID']) {
    for (const ownedAppServer of [false, true]) assert.equal(classifyCodexStorage({ ...f.options, ownedAppServer, environment: { [name]: 'SECRET-REMOTE' } }).status, 'unknown');
  }
  f.config(join(f.home, 'environments.toml'), 'SECRET-NEVER-READ');
  assert.equal(classifyCodexStorage(f.options).status, 'unknown'); rmSync(join(f.home, 'environments.toml'));
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', ((path: any, ...args: any[]) => {
    if (path === join(f.home, 'auth.json')) throw Object.assign(new Error('SECRET-error'), { code: 'EACCES' });
    return (lstat as any)(path, ...args);
  }) as typeof fs.lstatSync); syncBuiltinESMExports();
  assert.equal(classifyCodexStorage(f.options).code, 'codex_cloud_storage_unverified');
});

function dispatchFixture(t: TestContext) {
  const f = fixture(t), log = join(f.root, 'native-log'), binary = join(f.root, 'codex-fixture');
  const db = new DatabaseSync(join(f.home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT)'); db.prepare('INSERT INTO threads VALUES(?,?)').run(id, f.consumer); db.close();
  writeFileSync(binary, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),sqlite:process.env.CODEX_SQLITE_HOME})+'\\n');console.log('Queued message fixture-q for thread ${id}.');`, { mode: 0o700 });
  const lstat = fs.lstatSync, open = fs.openSync, exec = childProcess.execFileSync;
  t.mock.method(fs, 'lstatSync', ((path: any, ...args: any[]) => {
    if (typeof path === 'string' && path.startsWith('/etc/codex/')) return (lstat as any)(join(f.systemBase, path.slice('/etc/codex/'.length)), ...args);
    return (lstat as any)(path, ...args);
  }) as typeof fs.lstatSync);
  t.mock.method(fs, 'openSync', ((path: any, ...args: any[]) => (open as any)(typeof path === 'string' && path.startsWith('/etc/codex/') ? join(f.systemBase, path.slice('/etc/codex/'.length)) : path, ...args)) as typeof fs.openSync);
  t.mock.method(childProcess, 'execFileSync', ((file: any, ...args: any[]) => file === '/usr/bin/osascript' ? '[]' : (exec as any)(file, ...args)) as typeof childProcess.execFileSync);
  syncBuiltinESMExports();
  return { ...f, binary, log, sendOptions: { to: `codex:${id}`, home: f.home, codexBin: binary, message: 'fixture', allowInactive: true } };
}
test('ordinary dispatch submits once with inspected cwd and stripped storage override; dry-run never executes binary', async t => {
  const f = dispatchFixture(t); process.env.CODEX_SQLITE_HOME = 'SECRET-inherited';
  await send({ ...f.sendOptions, dryRun: true }); assert.equal(existsSync(f.log), false);
  const result = await send(f.sendOptions); assert.equal(result.submitted, true);
  const rows = fs.readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 1); assert.equal(rows[0].cwd, realpathSync(process.cwd())); assert.equal(rows[0].sqlite, undefined);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('each unsupported layer and a config mutation after beforeEffect makes zero native queue submissions', async t => {
  const f = dispatchFixture(t);
  for (const path of [join(f.home, 'config.toml'), join(f.systemBase, 'config.toml'), join(f.systemBase, 'requirements.toml'), join(f.systemBase, 'managed_config.toml'), join(f.consumer, '.codex', 'config.toml')]) {
    f.config(path, '"sqlite\\u005fhome"="SECRET-location"');
    await assert.rejects(send(f.sendOptions), { code: 'unsupported_codex_sqlite_home' }); assert.equal(existsSync(f.log), false); rmSync(path);
  }
  await assert.rejects(send({ ...f.sendOptions, hooks: { resolved() {}, beforeEffect() { f.config(join(f.home, 'config.toml'), 'model="changed-during-guard"'); } } }), { code: 'codex_storage_changed_before_queue' });
  assert.equal(existsSync(f.log), false);
});
test('doctor and dispatch share system classification while doctor never executes the agent binary', async t => {
  const f = dispatchFixture(t); f.config(join(f.systemBase, 'requirements.toml'), 'sqlite_home="SECRET-system"');
  const result = await diagnoseCodex(f.home, f.binary) as any;
  assert.equal(result.homes[0].storage.code, 'unsupported_codex_sqlite_home'); assert.equal(result.tool.executed, false);
  assert.equal(result.homes[0].storage.loaderVersionVerified, false);
  assert.equal(existsSync(f.log), false); assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('unsupported loader version and executable replacement never submit a native queue', async t => {
  const f = dispatchFixture(t);
  writeFileSync(f.binary, `#!${process.execPath}\nconsole.log('codex-cli 0.165.1');`, { mode: 0o700 });
  await assert.rejects(send(f.sendOptions), { code: 'codex_storage_loader_unsupported' }); assert.equal(existsSync(f.log), false);
  writeFileSync(f.binary, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}require('node:fs').writeFileSync(${JSON.stringify(f.log)},'unexpected');`, { mode: 0o700 });
  await assert.rejects(send({ ...f.sendOptions, hooks: { resolved() {}, beforeEffect() { fs.appendFileSync(f.binary, '\n// replacement'); } } }), { code: 'codex_storage_loader_changed' });
  assert.equal(existsSync(f.log), false);
});
test('consumer cwd and same-content config replacement after validation refuse before submission', async t => {
  const f = dispatchFixture(t), config = join(f.home, 'config.toml'); f.config(config, 'model="fixture"');
  await assert.rejects(send({ ...f.sendOptions, hooks: { resolved() {}, beforeEffect() {
    const replacement = join(f.home, 'config-replacement.toml'); writeFileSync(replacement, 'model="fixture"'); fs.renameSync(replacement, config);
  } } }), { code: 'codex_storage_changed_before_queue' }); assert.equal(existsSync(f.log), false);
  await assert.rejects(send({ ...f.sendOptions, hooks: { resolved() {}, beforeEffect() {
    const db = new DatabaseSync(join(f.home, 'state_5.sqlite')); db.prepare('UPDATE threads SET cwd=?').run(f.cwd); db.close();
  } } }), { code: 'codex_storage_changed_before_queue' }); assert.equal(existsSync(f.log), false);
});
test('ordinary auth/cache/credential-route changes refuse with zero native queue calls and no credential reads', { skip: process.platform === 'win32' }, async t => {
  const f = dispatchFixture(t), open = fs.openSync;
  t.mock.method(fs, 'openSync', ((path: any, ...args: any[]) => {
    assert.notEqual(path, join(f.home, 'auth.json')); assert.notEqual(path, join(f.home, 'cloud-config-bundle-cache.json'));
    return (open as any)(path, ...args);
  }) as typeof fs.openSync); syncBuiltinESMExports();
  for (const name of ['auth.json', 'cloud-config-bundle-cache.json']) {
    const path = join(f.home, name); writeFileSync(path, 'SECRET-NEVER-READ');
    await assert.rejects(send(f.sendOptions), { code: 'codex_cloud_storage_unverified' }); assert.equal(existsSync(f.log), false); rmSync(path);
    await assert.rejects(send({ ...f.sendOptions, hooks: { resolved() {}, beforeEffect() { writeFileSync(path, 'SECRET-NEVER-READ'); } } }), { code: 'codex_cloud_storage_unverified' });
    assert.equal(existsSync(f.log), false); rmSync(path);
  }
  for (const mode of ['keyring', 'auto']) {
    f.config(join(f.home, 'config.toml'), `cli_auth_credentials_store="${mode}"`);
    await assert.rejects(send(f.sendOptions), { code: 'codex_cloud_storage_unverified' }); assert.equal(existsSync(f.log), false);
  }
});
test('Windows Codex send and dry-run refuse an unqualified storage adapter before any native execution', { skip: process.platform !== 'win32' }, async t => {
  const f = dispatchFixture(t); let calls = 0;
  t.mock.method(childProcess, 'spawn', () => { calls++; throw new Error('unexpected native execution'); }); syncBuiltinESMExports();
  for (const dryRun of [false, true]) await assert.rejects(send({ ...f.sendOptions, codexBin: process.execPath, dryRun }), { code: 'codex_storage_platform_unqualified' });
  assert.equal(calls, 0);
});
test('binary replacement during the final consumer-query await refuses before native submission', { skip: process.platform === 'win32' }, async t => {
  const f = dispatchFixture(t), prepare = DatabaseSync.prototype.prepare; let armed = false, mutated = false;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (armed && !mutated && sql.startsWith('SELECT cwd FROM threads')) {
      mutated = true; queueMicrotask(() => fs.appendFileSync(f.binary, '\n// swapped during consumer await'));
    }
    return prepare.call(this, sql);
  });
  await assert.rejects(send({ ...f.sendOptions, hooks: { resolved() {}, beforeEffect() { armed = true; } } }), { code: 'codex_storage_loader_changed' });
  assert.equal(mutated, true); assert.equal(existsSync(f.log), false);
});
test('same-cwd inactive state database replacement during the final consumer-query await refuses before submission', { skip: process.platform === 'win32' }, async t => {
  const f = dispatchFixture(t), replacement = join(f.root, 'replacement.sqlite'), prepare = DatabaseSync.prototype.prepare;
  fs.copyFileSync(join(f.home, 'state_5.sqlite'), replacement);
  let armed = false, mutated = false;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (armed && !mutated && sql.startsWith('SELECT cwd FROM threads')) {
      mutated = true; queueMicrotask(() => fs.renameSync(replacement, join(f.home, 'state_5.sqlite')));
    }
    return prepare.call(this, sql);
  });
  await assert.rejects(send({ ...f.sendOptions, hooks: { resolved() {}, beforeEffect() { armed = true; } } }), { code: 'codex_storage_changed_before_queue' });
  assert.equal(mutated, true); assert.equal(existsSync(f.log), false);
});
test('handoff fallback executes the retained canonical binary when its input symlink changes during authorization', { skip: process.platform === 'win32' }, async t => {
  const f = dispatchFixture(t), link = join(f.root, 'selected-binary'), other = join(f.root, 'unverified-binary'), otherLog = join(f.root, 'unverified-log');
  fs.copyFileSync(f.binary, other); fs.chmodSync(other, 0o700);
  writeFileSync(other, fs.readFileSync(other, 'utf8').replaceAll(f.log, otherLog));
  symlinkSync(f.binary, link);
  new HandoffLedger(join(f.root, 'ledger')).init();
  const commit = HandoffLedger.prototype.commitEffect; let retargeted = false;
  t.mock.method(HandoffLedger.prototype, 'commitEffect', function(this: HandoffLedger, ...args: Parameters<typeof commit>) {
    const value = commit.apply(this, args);
    queueMicrotask(() => { rmSync(link); symlinkSync(other, link); retargeted = true; }); return value;
  });
  const result = await handoffSend({ ...f.sendOptions, codexBin: link }, { ledgerPath: join(f.root, 'ledger'), seconds: 30 });
  assert.equal(result.value.submitted, true); assert.equal(retargeted, true);
  assert.equal(fs.readFileSync(f.log, 'utf8').trim().split('\n').length, 1); assert.equal(existsSync(otherLog), false);
});
test('handoff fallback rechecks the original cutoff after durable authorization and never queues late', { skip: process.platform === 'win32' }, async t => {
  const f = dispatchFixture(t); let now = 0;
  new HandoffLedger(join(f.root, 'ledger')).init();
  const budget = new HandoffBudget(30, { monotonic: () => now, utc: () => 100000 });
  const commit = HandoffLedger.prototype.commitEffect; let committed = false;
  t.mock.method(HandoffLedger.prototype, 'commitEffect', function(this: HandoffLedger, ...args: Parameters<typeof commit>) {
    const value = commit.apply(this, args); committed = true; now = budget.cutoff; return value;
  });
  const result = await handoffSend(f.sendOptions, { ledgerPath: join(f.root, 'ledger'), budget });
  assert.equal(committed, true); assert.equal(result.value.error, 'deadline_before_effect'); assert.equal(existsSync(f.log), false);
});
