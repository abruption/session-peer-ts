import { test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { metadataCapability, observeMetadata, METADATA_SOURCE, type MetadataScope } from '../dist/metadata-observation.js';

const posix = { skip: process.platform === 'win32' };
const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clientId = 'client-message-fixture-1';
// Structural fixture from the official 0.160.1 migrations 0001/0002. Later
// migrations add unrelated columns/indexes; no transcript or live home is used.
const schema = `CREATE TABLE thread_turns(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,
  rollout_ordinal INTEGER NOT NULL,status TEXT NOT NULL,error_json TEXT,started_at INTEGER,completed_at INTEGER,
  duration_ms INTEGER,first_user_item_id TEXT,final_agent_item_id TEXT,PRIMARY KEY(thread_id,turn_id));
CREATE TABLE thread_items(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,item_id TEXT NOT NULL,
  rollout_ordinal INTEGER NOT NULL,created_at_ms INTEGER NOT NULL,item_json TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT '',PRIMARY KEY(thread_id,turn_id,item_id));
CREATE UNIQUE INDEX idx_thread_items_page ON thread_items(thread_id,rollout_ordinal);
CREATE INDEX idx_thread_items_user_messages ON thread_items(thread_id,rollout_ordinal) WHERE item_type='userMessage';
CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER NOT NULL,next_rollout_ordinal INTEGER NOT NULL);`;
function fixture(t: TestContext, wal = false) {
  const home = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-metadata-')));
  chmodSync(home, 0o700);
  const file = join(home, METADATA_SOURCE.database), db = new DatabaseSync(file);
  chmodSync(file, 0o600); if (wal) db.exec('PRAGMA journal_mode=WAL;'); db.exec(schema);
  db.prepare('INSERT INTO thread_history_projection_state VALUES(?,?,?)').run(threadId, 100, 100);
  db.prepare('INSERT INTO thread_turns(thread_id,turn_id,rollout_ordinal,status,error_json) VALUES(?,?,?,?,?)')
    .run(threadId, 'turn-fixture-1', 1, 'inProgress', '{"message":"ERROR_BODY_SENTINEL"}');
  const scope: MetadataScope = { home, threadId, generation: 'fixture-original-writer-generation' };
  t.after(() => { db.close(); rmSync(home, { recursive: true, force: true }); });
  const item = (ordinal: number, client: string | null = clientId, body = 'PRIVATE_BODY_SENTINEL', turn = 'turn-fixture-1') =>
    db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?,?)').run(threadId, turn, 'native-item-' + ordinal, ordinal,
      1000, JSON.stringify({ type: 'userMessage', id: 'native-item-' + ordinal, clientId: client,
        content: [{ type: 'text', text: body }] }), 'userMessage');
  return { home, file, db, scope, item };
}
const budget = () => ({ observationRemainingMs: () => 5000 });
const owner = () => true;
const observe = (scope: MetadataScope, clientUserMessageId = clientId) => observeMetadata({ ...scope, clientUserMessageId }, budget(), owner);

test('qualified warm metadata is projected without body/error output and without DB/WAL writes', posix, async t => {
  const f = fixture(t, true); f.item(1);
  const files = readdirSync(f.home).sort(), before = new Map(files.filter(name => !name.endsWith('-shm')).map(name => [name, readFileSync(join(f.home, name))]));
  const spawn = childProcess.spawn; let stdout = '', stderr = '';
  mock.method(childProcess, 'spawn', (...args: Parameters<typeof childProcess.spawn>) => {
    const child = spawn(...args); child.stdout?.on('data', part => { stdout += part; });
    child.stderr?.on('data', part => { stderr += part; }); return child;
  }); t.after(() => mock.restoreAll());
  assert.deepEqual(await metadataCapability(f.scope, '0.160.1', budget(), owner), { supported: true });
  assert.deepEqual(await observe(f.scope), { supported: true, injectionObserved: true,
    clientUserMessageId: clientId, turn: { id: 'turn-fixture-1', status: 'running' } });
  for (const sentinel of ['PRIVATE_BODY_SENTINEL', 'ERROR_BODY_SENTINEL']) {
    assert.equal(stdout.includes(sentinel), false); assert.equal(stderr.includes(sentinel), false);
  }
  assert.deepEqual(readdirSync(f.home).sort(), files);
  for (const [name, bytes] of before) assert.deepEqual(readFileSync(join(f.home, name)), bytes, name);
});
test('native clientId, not item_id or correlation body, controls injection evidence', posix, async t => {
  const f = fixture(t); f.item(1, 'unrelated-client', 'Handoff: ' + clientId);
  assert.deepEqual(await observe(f.scope), { supported: true, injectionObserved: false });
  assert.deepEqual(await observe(f.scope, 'native-item-1'), { supported: true, injectionObserved: false });
  f.item(2); assert.equal((await observe(f.scope)).injectionObserved, true);
});
test('queue deletion, missing row and missing turn completion never manufacture delivery or ACK', posix, async t => {
  const f = fixture(t);
  f.db.exec('CREATE TABLE unrelated_queue(client_id TEXT);');
  f.db.prepare('INSERT INTO unrelated_queue VALUES(?)').run(clientId);
  f.db.exec("UPDATE thread_turns SET status='completed'; DELETE FROM unrelated_queue;");
  assert.deepEqual(await observe(f.scope), { supported: true, injectionObserved: false });
  f.item(1); assert.equal((await observe(f.scope)).turn?.status, 'completed');
  f.db.exec('DELETE FROM thread_items;');
  assert.deepEqual(await observe(f.scope), { supported: true, injectionObserved: false });
});
test('stored status allowlist leaves unknown statuses unknown and adds no receipt fields', posix, async t => {
  const f = fixture(t); f.item(1);
  for (const [native, expected] of [['inProgress', 'running'], ['completed', 'completed'], ['failed', 'failed'],
    ['interrupted', 'interrupted'], ['future-complete-ish', 'unknown']]) {
    f.db.prepare('UPDATE thread_turns SET status=?').run(native!);
    const result = await observe(f.scope); assert.equal(result.turn?.status, expected);
    assert.deepEqual(Object.keys(result).sort(), ['clientUserMessageId', 'injectionObserved', 'supported', 'turn']);
  }
});
test('old client outside the bounded recent-user window, oversized and malformed cells do not become delivery', posix, async t => {
  const f = fixture(t); f.item(1);
  for (let n = 2; n <= 257; n++) f.item(n, 'other-' + n);
  assert.deepEqual(await observe(f.scope), { supported: true, injectionObserved: false });
  f.item(258, clientId, 'x'.repeat(METADATA_SOURCE.maxCellBytes));
  assert.deepEqual(await observe(f.scope), { supported: true, injectionObserved: false });
  f.db.prepare('UPDATE thread_items SET item_json=? WHERE item_id=?').run('{invalid PRIVATE_BODY_SENTINEL', 'native-item-258');
  assert.deepEqual(await observe(f.scope), { supported: true, injectionObserved: false });
});
test('duplicate native client IDs fail closed instead of choosing a turn', posix, async t => {
  const f = fixture(t); f.item(1); f.item(2);
  assert.deepEqual(await observe(f.scope), { supported: false, injectionObserved: false, reason: 'metadata_ambiguous' });
});
test('version/platform scope and unknown generation refuse before starting any probe', posix, async t => {
  const f = fixture(t); let called = 0;
  const verify = () => { called++; return true; };
  for (const version of ['0.159.0', '0.160.2', '0.160.1+unknown', 'garbage']) {
    assert.deepEqual(await metadataCapability(f.scope, version, budget(), verify), { supported: false, reason: 'metadata_version_unsupported' });
  }
  assert.deepEqual(await metadataCapability({ ...f.scope, generation: null }, '0.160.1', budget(), verify),
    { supported: false, reason: 'metadata_scope_invalid' });
  assert.equal(called, 0);
});
test('schema drift and missing warm projection refuse capability without warming storage', posix, async t => {
  const f = fixture(t); f.db.exec('ALTER TABLE thread_turns RENAME COLUMN status TO future_status;');
  assert.deepEqual(await metadataCapability(f.scope, '0.160.1', budget(), owner), { supported: false, reason: 'metadata_schema_unsupported' });
  const g = fixture(t); g.db.exec('DELETE FROM thread_history_projection_state;');
  const before = readFileSync(g.file);
  assert.deepEqual(await metadataCapability(g.scope, '0.160.1', budget(), owner), { supported: false, reason: 'metadata_history_unavailable' });
  assert.deepEqual(readFileSync(g.file), before);
  const h = fixture(t); h.db.exec('DROP INDEX idx_thread_items_user_messages;');
  assert.deepEqual(await metadataCapability(h.scope, '0.160.1', budget(), owner), { supported: false, reason: 'metadata_schema_unsupported' });
});
test('views, symlink files, unsafe permissions and absent DB cannot become supported', posix, async t => {
  const f = fixture(t); f.db.exec('ALTER TABLE thread_items RENAME TO original_items; CREATE VIEW thread_items AS SELECT * FROM original_items;');
  assert.equal((await metadataCapability(f.scope, '0.160.1', budget(), owner)).reason, 'metadata_schema_unsupported');
  const g = fixture(t); renameSync(g.file, g.file + '.original'); symlinkSync(g.file + '.original', g.file);
  assert.equal((await metadataCapability(g.scope, '0.160.1', budget(), owner)).reason, 'metadata_storage_untrusted');
  const h = fixture(t); chmodSync(h.file, 0o666);
  assert.equal((await metadataCapability(h.scope, '0.160.1', budget(), owner)).reason, 'metadata_storage_untrusted');
  const empty = join(h.home, 'empty'); mkdirSync(empty, { mode: 0o700 });
  assert.equal((await metadataCapability({ ...h.scope, home: empty }, '0.160.1', budget(), owner)).reason, 'metadata_storage_untrusted');
  assert.deepEqual(readdirSync(empty), []);
});
test('owner must prove the immutable original generation both before and after the read', posix, async t => {
  const f = fixture(t); f.item(1); let calls = 0;
  const result = await observeMetadata({ ...f.scope, clientUserMessageId: clientId }, budget(), (scope, signal) => {
    assert.equal(scope.generation, f.scope.generation); assert.equal(Object.isFrozen(scope), true);
    assert.equal(signal.aborted, false); return ++calls === 1;
  });
  assert.equal(calls, 2); assert.deepEqual(result, { supported: false, injectionObserved: false, reason: 'metadata_owner_changed' });
  calls = 0; assert.equal((await metadataCapability(f.scope, '0.160.1', budget(), () => { calls++; return false; })).reason, 'metadata_owner_changed');
  assert.equal(calls, 1);
});
test('replaced database inode after read invalidates otherwise matching metadata', posix, async t => {
  const f = fixture(t); f.item(1); const g = fixture(t); g.item(1); let calls = 0;
  const result = await observeMetadata({ ...f.scope, clientUserMessageId: clientId }, budget(), () => {
    if (++calls === 2) { renameSync(f.file, f.file + '.old'); renameSync(g.file, f.file); }
    return true;
  });
  assert.deepEqual(result, { supported: false, injectionObserved: false, reason: 'metadata_storage_untrusted' });
});
test('expired caller budget starts no process and aborts a hanging owner verifier', posix, async t => {
  const f = fixture(t); let calls = 0;
  assert.equal((await metadataCapability(f.scope, '0.160.1', { observationRemainingMs: () => 0 }, () => { calls++; return true; })).reason, 'metadata_deadline');
  assert.equal(calls, 0);
  // Budget includes the separate snapshot worker's cold start. The verifier
  // itself remains bounded by METADATA_SOURCE.childMs (1 s); a 35 ms total
  // budget can correctly expire before the verifier is ever invoked on CI.
  const deadline = performance.now() + 5000; let aborted = false;
  const result = await metadataCapability(f.scope, '0.160.1', { observationRemainingMs: () => deadline - performance.now() }, (_scope, signal) =>
    new Promise<boolean>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(false); }, { once: true })));
  assert.equal(result.supported, false); assert.equal(aborted, true);
});
test('deadline kills only the owned probe process group including its descendant', posix, async t => {
  const f = fixture(t), marker = join(f.home, 'owned-pids.json');
  const realSpawn = childProcess.spawn;
  mock.method(childProcess, 'spawn', (binary: string, _args: readonly string[], options: any) => realSpawn(binary, ['-e',
    `const cp=require('node:child_process');const fs=require('node:fs');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`], options));
  t.after(() => mock.restoreAll());
  const started = performance.now(), deadline = started + 500;
  const result = await observeMetadata({ ...f.scope, clientUserMessageId: clientId }, { observationRemainingMs: () => deadline - performance.now() }, owner);
  assert.deepEqual(result, { supported: false, injectionObserved: false, reason: 'metadata_deadline' });
  assert.ok(performance.now() - started < 1500); assert.equal(existsSync(marker), true);
  const pids: number[] = JSON.parse(readFileSync(marker, 'utf8'));
  for (let n = 0; n < 50 && pids.some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }); n++) await new Promise(resolve => setTimeout(resolve, 10));
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});
test('actual SQLite uses memory-only temp storage and materializes keys and bounded scalars only', posix, async t => {
  const f = fixture(t), marker = join(f.home, 'sql-policy.json'), temp = join(f.home, 'sqlite-temp');
  mkdirSync(temp, { mode: 0o700 });
  f.item(1, clientId, 'PRIVATE_OVERSIZED_BODY_SENTINEL'.repeat(80000));
  f.item(2, 'other-client');
  f.db.prepare('UPDATE thread_items SET item_json=? WHERE item_id=?').run(JSON.stringify({ type: 'userMessage',
    clientId: { content: 'PRIVATE_OBJECT_BODY_SENTINEL' } }), 'native-item-2');
  f.item(3, 'x'.repeat(129));
  const preload = `import sqlite from 'node:sqlite';import fs from 'node:fs';
const prepare=sqlite.DatabaseSync.prototype.prepare;sqlite.DatabaseSync.prototype.prepare=function(sql){
 if(sql.startsWith('WITH recent')) fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({
  tempStore:prepare.call(this,'PRAGMA temp_store').get().temp_store,
  recentProjection:sql.match(/WITH recent AS MATERIALIZED \\(\\s*SELECT ([\\s\\S]*?) FROM thread_items/)[1],sql
 }));return prepare.call(this,sql);};`;
  const realSpawn = childProcess.spawn;
  mock.method(childProcess, 'spawn', (binary: string, args: readonly string[], options: any) => realSpawn(binary,
    ['--import', 'data:text/javascript,' + encodeURIComponent(preload), ...args], { ...options, env: { ...options.env, SQLITE_TMPDIR: temp } }));
  t.after(() => mock.restoreAll());
  const result = await observe(f.scope);
  assert.deepEqual(result, { supported: true, injectionObserved: false });
  const policy = JSON.parse(readFileSync(marker, 'utf8'));
  assert.equal(policy.tempStore, 2);
  assert.equal(policy.recentProjection, 'rowid AS item_rowid');
  assert.ok(policy.sql.includes("json_type(item_json,'$.clientId')='text'"));
  assert.deepEqual(readdirSync(temp), []);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});
test('blocking realpath/lstat validation remains in a killable worker and never blocks the supervisor', posix, async t => {
  for (const method of ['realpathSync', 'lstatSync']) {
    const f = fixture(t), marker = join(f.home, method + '-started'); let parentCalls = 0, ticks = 0;
    const preload = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
fs.writeFileSync(${JSON.stringify(marker)},'ready');const original=fs.${method};const blocked=()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);throw new Error('PRIVATE_FS_SENTINEL');};blocked.native=original.native;fs.${method}=blocked;syncBuiltinESMExports();`;
    const realSpawn = childProcess.spawn; let pid: number | undefined;
    mock.method(childProcess, 'spawn', (binary: string, args: readonly string[], options: any) => {
      const child = realSpawn(binary, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), ...args], options);
      pid = child.pid; return child;
    });
    mock.method(fs, method as 'realpathSync', () => { parentCalls++; throw new Error('supervisor synchronous filesystem validation'); });
    syncBuiltinESMExports();
    const timer = setInterval(() => { ticks++; }, 20), start = performance.now(), deadline = start + 400;
    let result;
    try { result = await observeMetadata({ ...f.scope, clientUserMessageId: clientId },
      { observationRemainingMs: () => deadline - performance.now() }, owner); }
    finally { clearInterval(timer); mock.restoreAll(); syncBuiltinESMExports(); }
    assert.deepEqual(result, { supported: false, injectionObserved: false, reason: 'metadata_deadline' });
    assert.equal(parentCalls, 0); assert.ok(ticks >= 3); assert.equal(existsSync(marker), true);
    assert.ok(performance.now() - start < 1200);
    for (let n = 0; n < 50; n++) { try { process.kill(pid!, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' });
  }
});
