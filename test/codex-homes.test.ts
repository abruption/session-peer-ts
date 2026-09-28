import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import childProcess, { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { HomeRefusal, resolveWriter, revalidateWriter } from '../dist/writer.js';
import { queueId, send } from '../dist/send.js';
const id = '11111111-1111-4111-8111-111111111111';
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-homes-')));
  const saved = { ...process.env };
  Object.assign(process.env, { HOME: root, USERPROFILE: root, CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]' });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); rmSync(root, { recursive: true, force: true }); });
  function database(home: string, savedThread = true) {
    mkdirSync(home, { recursive: true });
    const db = new DatabaseSync(join(home, 'state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT)');
    if (savedThread) db.prepare('INSERT INTO threads VALUES (?)').run(id);
    db.close(); return home;
  }
  const home = database(join(root, '.codex'));
  return { root, home, database };
}
function refusal(code: string, reason = code) {
  return (error: unknown) => {
    assert.ok(error instanceof HomeRefusal); assert.equal(error.code, code);
    assert.equal(error.codexHomeResolution.reason, reason);
    assert.equal(error.codexHomeResolution.selected, null);
    return true;
  };
}
test('inactive queue requires explicit saved home and opt-in; no implicit fallback', async t => {
  const f = fixture(t);
  await assert.rejects(resolveWriter(undefined, id), refusal('inactive_writer', 'inactive_queue_requires_opt_in'));
  await assert.rejects(resolveWriter(undefined, id, true), refusal('inactive_opt_in_requires_explicit_home'));
  const second = f.database(join(f.root, 'second'));
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([second]);
  const selected = await resolveWriter(f.home, id, true);
  assert.equal(selected.home, f.home); assert.equal(selected.resolution.status, 'explicit');
  assert.equal(selected.resolution.reason, 'explicit_inactive_opt_in');
  assert.equal(selected.resolution.candidates.length, 2);
  assert.ok(selected.resolution.candidates.every(c => c.activity === 'inactive' && c.savedThread));
  await revalidateWriter(selected, f.home, id, true);
  const empty = f.database(join(f.root, 'empty'), false);
  await assert.rejects(resolveWriter(empty, id, true), refusal('thread_not_saved_in_explicit_home'));
});
test('send configuration truth table agrees with list; explicit selection cannot bypass invalid extras', async t => {
  const f = fixture(t);
  for (const value of ['', ' ', '{bad', '["relative"]', '[1]', '["/nul\\u0000"]']) {
    process.env.SESSION_PEER_CODEX_HOMES = value;
    await assert.rejects(resolveWriter(f.home, id, true), refusal('invalid_home_configuration'));
  }
  for (const value of [undefined, '[]', JSON.stringify([f.home]), '["~/.codex"]']) {
    if (value === undefined) delete process.env.SESSION_PEER_CODEX_HOMES; else process.env.SESSION_PEER_CODEX_HOMES = value;
    assert.equal((await resolveWriter(f.home, id, true)).home, f.home);
  }
});
test('missing named homes refuse; absent optional default is allowed; corrupt competitor refuses', async t => {
  const f = fixture(t), missing = join(f.root, 'missing');
  for (const explicit of [undefined, f.home]) {
    process.env.CODEX_HOME = missing;
    await assert.rejects(resolveWriter(explicit, id, true), explicit === undefined ? refusal('inactive_opt_in_requires_explicit_home') : refusal('home_inventory_unreadable'));
    await assert.rejects(resolveWriter(explicit, id), refusal('home_inventory_unreadable'));
  }
  process.env.CODEX_HOME = '';
  await assert.rejects(resolveWriter(missing, id, true), refusal('home_inventory_unreadable'));
  const other = f.database(join(f.root, 'other'));
  rmSync(f.home, { recursive: true });
  assert.equal((await resolveWriter(other, id, true)).home, other);
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([missing]);
  await assert.rejects(resolveWriter(other, id, true), refusal('home_inventory_unreadable'));
  mkdirSync(missing); writeFileSync(join(missing, 'state_5.sqlite'), 'SECRET-SENTINEL');
  await assert.rejects(resolveWriter(other, id, true), error => {
    assert.ok(refusal('home_inventory_unreadable')(error));
    assert.equal(JSON.stringify(error).includes('SECRET-SENTINEL'), false); return true;
  });
});
test('revalidation binds inventory, saved rows, DB identity and free lock identity', async t => {
  const f = fixture(t);
  let previous = await resolveWriter(f.home, id, true);
  const other = f.database(join(f.root, 'other'));
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([other]);
  await assert.rejects(revalidateWriter(previous, f.home, id, true), refusal('writer_evidence_changed_before_queue'));
  previous = await resolveWriter(f.home, id, true);
  const db = new DatabaseSync(join(other, 'state_5.sqlite')); db.exec('DELETE FROM threads'); db.close();
  await assert.rejects(revalidateWriter(previous, f.home, id, true), refusal('writer_evidence_changed_before_queue'));
  previous = await resolveWriter(f.home, id, true);
  renameSync(join(other, 'state_5.sqlite'), join(other, 'old.sqlite')); f.database(other, false);
  await assert.rejects(revalidateWriter(previous, f.home, id, true), refusal('writer_evidence_changed_before_queue'));
  previous = await resolveWriter(f.home, id, true);
  mkdirSync(join(f.home, 'thread-writer-locks')); writeFileSync(join(f.home, 'thread-writer-locks', id + '.lock'), 'new');
  await assert.rejects(revalidateWriter(previous, f.home, id, true), refusal('writer_evidence_changed_before_queue'));
});
test('queue ID accepts one bounded native confirmation for the requested UUID only', () => {
  const line = `Queued message q-1:abc for thread ${id}.`;
  assert.equal(queueId('notice\n' + line + '\r\n', id), 'q-1:abc');
  for (const output of ['queued', line + '\n' + line, line.replace(id, id.replace(/^1/, '2')), line.replace('q-1:abc', 'x'.repeat(129)), line.replace('q-1:abc', 'bad\u001b[31m')]) assert.equal(queueId(output, id), undefined);
});
test('CLI validates inactive option scope and stdio dry-run includes sanitized diagnostics', t => {
  const f = fixture(t);
  const args = ['send', '--to', `codex:${id}`, '--codex-bin', process.execPath, '--message', 'fixture', '--no-from', '--json'];
  function invoke(extra: string[], wire = false) {
    const all = [...args, ...extra];
    const result = spawnSync(process.execPath, [resolve('dist/cli.js'), ...(wire ? ['--stdio-request'] : all)], {
      encoding: 'utf8', input: wire ? JSON.stringify({ schemaVersion: 1, args: all }) : undefined });
    return JSON.parse(result.stdout);
  }
  assert.equal(invoke(['--allow-inactive-codex-home']).error, 'inactive_opt_in_requires_explicit_home');
  const result = invoke(['--codex-home', f.home, '--allow-inactive-codex-home', '--dry-run'], true);
  assert.equal(result.status, 'validated'); assert.equal(result.submitted, false);
  assert.equal(result.codexHomeResolution.reason, 'explicit_inactive_opt_in');
  assert.equal(result.queueId, undefined);
  for (const c of result.codexHomeResolution.candidates) assert.deepEqual(Object.keys(c).sort(), ['activity', 'codexHome', 'reason', 'savedThread', 'sources', 'writerLock']);
});

// Inject portable filesystem failures; native ownership tests use real OS locks.
test('unreadable or unresolved competitors refuse without spawning the queue', async t => {
  const f = fixture(t), blocked = f.database(join(f.root, 'blocked'));
  process.env.SESSION_PEER_CODEX_HOMES = JSON.stringify([blocked]);
  const stat = fs.statSync, real = fs.realpathSync;
  let queueCalls = 0, unresolved = false;
  t.mock.method(childProcess, 'spawn', () => { queueCalls++; throw new Error('unexpected queue'); });
  t.mock.method(fs, 'statSync', (...args: Parameters<typeof fs.statSync>) => {
    if (args[0] === join(blocked, 'state_5.sqlite')) throw Object.assign(new Error('SECRET-SENTINEL'), { code: 'EACCES' });
    return stat(...args);
  });
  t.mock.method(fs, 'realpathSync', (...args: Parameters<typeof fs.realpathSync>) => {
    if (unresolved && args[0] === blocked) throw Object.assign(new Error('SECRET-SENTINEL'), { code: 'ELOOP' });
    return real(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const options = { to: `codex:${id}`, home: f.home, codexBin: process.execPath, message: 'fixture', allowInactive: true };
  await assert.rejects(send(options), error => {
    assert.ok(refusal('home_inventory_unreadable')(error));
    assert.equal(JSON.stringify(error).includes('SECRET-SENTINEL'), false); return true;
  });
  unresolved = true;
  await assert.rejects(send(options), refusal('home_resolution_failed'));
  assert.equal(queueCalls, 0);
});
