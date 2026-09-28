import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import timers from 'node:timers/promises';
import { syncBuiltinESMExports } from 'node:module';
import { send } from '../dist/send.js';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectWriter, probeLock, resolveWriter } from '../dist/writer.js';
import { inspectWindows } from '../dist/windows.js';

const id = '00000000-0000-4000-8000-000000000001';
const cli = resolve('dist/cli.js');

async function fixture(t: TestContext) {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-win-contract-'));
  const children = new Set<ChildProcess>();
  const saved = { ...process.env };
  async function closeChildren() {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close'); child.kill(); await closed;
      }
    }
    children.clear();
  }
  t.after(async () => {
    await closeChildren();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(root, { recursive: true, force: true });
  });
  const binary = join(root, 'codex-fixture.exe');
  const csc = join(process.env.WINDIR!, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const built = spawnSync(csc, ['/nologo', '/reference:System.Web.Extensions.dll', `/out:${binary}`, resolve('test/fixtures/windows-native.cs')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(built.status, 0, `fixture compiler: ${built.error ?? built.stdout + built.stderr}`);
  for (const name of ['wrong-owner.exe', 'codex-opener.exe', 'ssh.exe']) copyFileSync(binary, join(root, name));
  const user = join(root, 'user'); mkdirSync(user);
  Object.assign(process.env, { USERPROFILE: user, HOME: user, CODEX_HOME: '',
    SESSION_PEER_CODEX_HOMES: '[]', CLAUDE_CONFIG_DIR: join(user, '.claude'), ANTHROPIC_CONFIG_DIR: '',
    CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', FIXTURE_QUEUE_LOG: join(root, 'queue.jsonl'),
    FIXTURE_QUEUE_MODE: '', FIXTURE_SSH_LOG: join(root, 'ssh.jsonl'), FIXTURE_SSH_MODE: '',
    FIXTURE_REMOTE_PROFILE: '', FIXTURE_REMOTE_HOMES: '',
    PATH: root + ';' + (process.env.PATH ?? '') });
  const home = join(root, 'selected');
  function database(path: string) {
    mkdirSync(join(path, 'thread-writer-locks'), { recursive: true });
    const db = new DatabaseSync(join(path, 'state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, rollout_path TEXT)');
    db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(id, 'fixture', '/project', 1, 0, 'unused'); db.close();
  }
  database(home);
  const lock = join(home, 'thread-writer-locks', id + '.lock');
  async function holder(path = lock, name = 'codex-fixture.exe', mode = 'hold') {
    const child = spawn(join(root, name), [mode, path], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let detail = ''; child.stderr!.on('data', part => { detail += part; });
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture readiness timeout: ${detail}`)), 10000);
      const fail = (code: number | null) => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${detail}`)); };
      child.once('error', reject); child.once('exit', fail);
      child.stdout!.once('data', part => {
        clearTimeout(timer); child.removeListener('exit', fail);
        if (String(part).trim() === 'ready') resolveReady(); else reject(new Error(`invalid fixture readiness: ${part}`));
      });
    });
    return child;
  }
  async function stop(child: ChildProcess) {
    const closed = once(child, 'close'); child.stdin!.end('stop\n'); await closed; children.delete(child);
  }
  function log(key: string) {
    const path = process.env[key]!;
    return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  }
  async function invoke(args: string[], env: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, [cli, ...args, '--json', '--no-update-notice'], { env: { ...process.env, ...env } });
    children.add(child);
    let stdout = '', stderr = ''; child.stdout!.on('data', part => { stdout += part; }); child.stderr!.on('data', part => { stderr += part; });
    child.stdin!.end();
    const timer = setTimeout(() => child.kill(), 120000);
    const [code, signal] = await once(child, 'close'); clearTimeout(timer); children.delete(child);
    assert.equal(signal, null, `CLI fixture deadline: ${stderr}`);
    assert.ok([0, 1, 2].includes(code as number), `CLI exit ${code}: ${stderr}`);
    const result = JSON.parse(stdout);
    assert.equal(result.schemaVersion, 1); assert.equal(result.ok, code === 0);
    return result;
  }
  const args = ['send', '--to', `codex:${id}`, '--codex-home', home, '--codex-bin', binary, '--message', 'fixture 🚀', '--no-from'];
  return { root, binary, home, lock, database, holder, stop, log, invoke, args, closeChildren };
}

// Replace only the production sampling delay with an explicit barrier. Waiting
// for arrival proves a native sample completed, without guessing event-loop turns.
function samplingBarrier(t: TestContext) {
  let arrived: (() => void) | undefined;
  const releases: (() => void)[] = [];
  t.mock.method(timers, 'setTimeout', (ms: number) => {
    assert.equal(ms, 250);
    return new Promise<void>(release => { releases.push(release); arrived?.(); });
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return async () => {
    if (!releases.length) await new Promise<void>(resolve => { arrived = resolve; });
    arrived = undefined;
    return releases.shift()!;
  };
}

test('Windows native writer, CLI and SSH contracts', { skip: process.platform !== 'win32', timeout: 540000 }, async t => {
  const f = await fixture(t);
  t.afterEach(f.closeChildren); // A failed assertion must not leave a held lock for the next case.
  await t.test('held lock and stable native PID/SID/start identity', async () => {
    assert.equal(await probeLock(f.lock), 'absent');
    const owner = await f.holder();
    assert.equal(await probeLock(f.lock), 'held');
    const rows = inspectWindows('openers', f.lock);
    assert.equal(rows.length, 1); assert.equal(rows[0].pid, owner.pid);
    assert.equal(rows[0].uid, inspectWindows('identity', String(process.pid))[0].uid);
    assert.equal((await inspectWriter(f.home, id)).activity, 'live_writer');
    assert.ok(await resolveWriter(f.home, id));
    await f.stop(owner); assert.equal(await probeLock(f.lock), 'free');
  });
  await t.test('wrong executable and a competing native opener refuse ownership', async () => {
    const wrong = await f.holder(f.lock, 'wrong-owner.exe');
    await assert.rejects(inspectWriter(f.home, id), /active_writer_unverified/); await f.stop(wrong);
    const owner = await f.holder(); const opener = await f.holder(f.lock, 'codex-opener.exe', 'open');
    assert.equal(inspectWindows('openers', f.lock).length, 2);
    await assert.rejects(inspectWriter(f.home, id), /active_writer_unverified/);
    await f.stop(opener); await f.stop(owner);
  });
  await t.test('lock replacement between native samples fails closed', { timeout: 60000 }, async t => {
    const owner = await f.holder();
    const sample = samplingBarrier(t);
    const rejected = assert.rejects(inspectWriter(f.home, id), /active_writer_unverified/);
    const resume = await sample();
    renameSync(f.lock, f.lock + '.old'); writeFileSync(f.lock, 'replacement');
    resume();
    await rejected;
    await f.stop(owner); rmSync(f.lock + '.old');
  });
  await t.test('owner replacement during pre-submit revalidation refuses without queueing', { timeout: 60000 }, async t => {
    const owner = await f.holder();
    const sample = samplingBarrier(t);
    const before = f.log('FIXTURE_QUEUE_LOG').length;
    const rejected = assert.rejects(send({ to: `codex:${id}`, home: f.home,
      codexBin: f.binary, message: 'pre-submit owner race' }), /active_writer_unverified/);
    (await sample())(); // Complete first resolveWriter's two native samples.
    const resume = await sample(); // Revalidation's first native sample completed.
    await f.stop(owner);
    const replacement = await f.holder();
    assert.notEqual(replacement.pid, owner.pid);
    resume();
    await rejected;
    assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before);
    await f.stop(replacement);
  });
  await t.test('dry-run submits nothing; stable owner queues once; inactive and ambiguous refuse', async () => {
    assert.equal((await f.invoke(f.args)).error, 'inactive_writer'); assert.equal(f.log('FIXTURE_QUEUE_LOG').length, 0);
    const owner = await f.holder();
    assert.equal((await f.invoke([...f.args, '--dry-run'])).submitted, false); assert.equal(f.log('FIXTURE_QUEUE_LOG').length, 0);
    const sent = await f.invoke(f.args);
    assert.equal(sent.status, 'queued'); assert.equal(sent.submitted, true); assert.equal(sent.consumptionConfirmed, false);
    const calls = f.log('FIXTURE_QUEUE_LOG'); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['queue', '--thread', id, '--message', 'fixture 🚀']); assert.equal(calls[0].home, f.home);
    const other = join(f.root, 'other'); f.database(other);
    const competing = await f.holder(join(other, 'thread-writer-locks', id + '.lock'));
    const refused = await f.invoke(f.args, { SESSION_PEER_CODEX_HOMES: JSON.stringify([other]) });
    assert.equal(refused.error, 'multiple_live_writers'); assert.equal(refused.submitted, false); assert.equal(f.log('FIXTURE_QUEUE_LOG').length, 1);
    await f.stop(competing); await f.stop(owner);
  });
  await t.test('implicit selection, explicit conflict, unsaved first turn and inactive opt-in', async () => {
    const before = f.log('FIXTURE_QUEUE_LOG').length;
    const owner = await f.holder();
    const implicit = f.args.filter((_, index) => index !== 3 && index !== 4);
    const dry = await f.invoke([...implicit, '--dry-run'], { CODEX_HOME: f.home });
    assert.equal(dry.status, 'validated'); assert.equal(dry.codexHomeResolution.reason, 'single_stable_live_writer');
    const other = join(f.root, 'inactive-17'); f.database(other);
    const conflict = await f.invoke([...f.args.slice(0, 4), other, ...f.args.slice(5)], { CODEX_HOME: f.home });
    assert.equal(conflict.error, 'explicit_home_conflicts_with_live_writer');
    const db = new DatabaseSync(join(f.home, 'state_5.sqlite')); db.exec('DELETE FROM threads'); db.close();
    const unsaved = await f.invoke(implicit, { CODEX_HOME: f.home });
    assert.equal(unsaved.error, 'thread_not_yet_persisted'); assert.equal(unsaved.submitted, false);
    assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before);
    const restored = new DatabaseSync(join(f.home, 'state_5.sqlite'));
    restored.prepare('INSERT INTO threads(id) VALUES (?)').run(id); restored.close();
    await f.stop(owner);
    const queued = await f.invoke([...f.args, '--allow-inactive-codex-home']);
    assert.equal(queued.status, 'queued'); assert.equal(queued.queueId, 'fixture-17');
    assert.equal(queued.codexHomeResolution.reason, 'explicit_inactive_opt_in');
    assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before + 1);
  });
  await t.test('nonzero and timeout after queue spawn stay unknown without retry or stderr leak', async () => {
    const owner = await f.holder();
    for (const mode of ['fail', 'timeout']) {
      const before = f.log('FIXTURE_QUEUE_LOG').length;
      const result = await f.invoke(f.args, { FIXTURE_QUEUE_MODE: mode });
      assert.equal(result.status, 'unknown'); assert.equal(result.submitted, null); assert.equal(result.retryAllowed, false);
      assert.equal(result.codexHomeResolution.reason, 'explicit_live_writer');
      assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false);
      assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before + 1);
    }
    await f.stop(owner);
  });
  await t.test('Windows SSH executes encoded PowerShell/.cmd with stdin JSON and preserves refused/unknown', async () => {
    const remote = join(f.root, 'remote cli.cmd');
    writeFileSync(remote, `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`);
    const args = ['send', '--host', 'fixture', '--remote-platform', 'win32', '--remote-bin', remote,
      '--to', `codex:${id}`, '--codex-home', f.home, '--codex-bin', f.binary, '--message', 'SSH SECRET-SENTINEL 🚀', '--no-from'];
    const owner = await f.holder();
    const before = f.log('FIXTURE_QUEUE_LOG').length;
    const sent = await f.invoke(args); assert.equal(sent.status, 'queued', JSON.stringify(sent)); assert.equal(sent.consumptionConfirmed, false);
    assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before + 1);
    assert.equal(f.log('FIXTURE_QUEUE_LOG').at(-1).args.at(-1), 'SSH SECRET-SENTINEL 🚀');
    const calls = f.log('FIXTURE_SSH_LOG'); assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.ok(call.args.includes('BatchMode=yes')); assert.ok(call.args.includes('StrictHostKeyChecking=yes'));
      const command = call.args.at(-1); assert.match(command, /powershell.exe.*-EncodedCommand/);
      const decoded = Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le');
      assert.ok(decoded.includes(remote)); assert.ok(!decoded.includes('SECRET-SENTINEL'));
    }
    assert.equal(calls[0].input, '');
    const request = JSON.parse(calls[1].input); assert.equal(request.schemaVersion, 1);
    assert.ok(request.args.includes('SSH SECRET-SENTINEL 🚀'));
    for (const [mode, error] of [['mismatch', 'remote_version_mismatch'], ['auth', 'ssh_authentication_refused']]) {
      const count = f.log('FIXTURE_SSH_LOG').length;
      const result = await f.invoke(args, { FIXTURE_SSH_MODE: mode });
      assert.equal(result.error, error); assert.equal(result.submitted, false);
      assert.equal(f.log('FIXTURE_SSH_LOG').length, count + 1);
      assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false);
    }
    const lost = await f.invoke(args, { FIXTURE_SSH_MODE: 'loss' });
    assert.equal(lost.status, 'unknown'); assert.equal(lost.submitted, null); assert.equal(lost.retryAllowed, false);
    assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before + 1);
    const remoteProfile = join(f.root, 'remote-user');
    const remoteHome = join(remoteProfile, '.codex'); f.database(remoteHome);
    const listed = await f.invoke(['list', '--host', 'fixture', '--remote-platform', 'win32', '--remote-bin', remote],
      { SESSION_PEER_CODEX_HOMES: '{invalid-local-config', FIXTURE_REMOTE_PROFILE: remoteProfile,
        FIXTURE_REMOTE_HOMES: JSON.stringify([join(remoteProfile, 'missing')]) });
    assert.equal(listed.ok, false); assert.equal(listed.sessions.length, 1);
    assert.equal(listed.sessions[0].codexHome, remoteHome);
    assert.equal(listed.discovery.claude.status, 'ok');
    assert.equal(listed.discovery.codex.homes.at(-1).code, 'state_db_missing');
    assert.equal(listed.sshHost, 'fixture'); assert.equal('submitted' in listed, false);
    assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before + 1);
    const diagnosed = await f.invoke(['doctor', '--host', 'fixture', '--remote-platform', 'win32', '--remote-bin', remote,
      '--agent', 'codex', '--codex-bin', f.binary], { FIXTURE_REMOTE_PROFILE: remoteProfile, FIXTURE_REMOTE_HOMES: '[]' });
    assert.equal(diagnosed.ok, true); assert.equal(diagnosed.ready, true); assert.equal(diagnosed.command, 'doctor');
    assert.equal(diagnosed.agents.codex.homes[0].codexHome, remoteHome);
    assert.equal(diagnosed.agents.codex.tool.executed, false); assert.equal(diagnosed.sshHost, 'fixture');
    assert.equal(f.log('FIXTURE_QUEUE_LOG').length, before + 1);
    await f.stop(owner);
    const inactive = await f.invoke([...args, '--allow-inactive-codex-home']);
    assert.equal(inactive.status, 'queued'); assert.equal(inactive.queueId, 'fixture-17');
    assert.equal(inactive.codexHomeResolution.reason, 'explicit_inactive_opt_in');
    assert.ok(JSON.parse(f.log('FIXTURE_SSH_LOG').at(-1).input).args.includes('--allow-inactive-codex-home'));
  });
});
