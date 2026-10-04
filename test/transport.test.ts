import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { probeLock, inspectWriter } from '../dist/writer.js';
import { reply, envelope } from '../dist/protocol.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
// Answers `ssh -G` user metadata lookups without logging them as SSH dispatches.
const sshConfigUser = "if(process.argv.includes('-G')){console.log('user fixture-user');process.exit(0);}";
const python = process.env.PYTHON ?? 'python3';
const id = '11111111-1111-4111-8111-111111111111';
function setup(t: TestContext) {
  const path = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-send-')));
  mkdirSync(join(path, '.claude/sessions'), { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: path, USERPROFILE: path, CLAUDE_CONFIG_DIR: join(path, '.claude'), CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '' };
  t.after(() => rmSync(path, { recursive: true }));
  return { path, env };
}
async function invoke(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [cli, ...args, '--json'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', x => { stdout += x; }); child.stderr.resume();
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const [code, signal] = await once(child, 'close'); clearTimeout(timer);
  assert.equal(signal, null);
  return { code, ...JSON.parse(stdout) };
}
async function inbox(t: TestContext, path: string) {
  const messages: unknown[] = [];
  const socket = join(path, 'sock');
  const server = createServer(s => {
    let data = ''; s.on('data', chunk => { data += chunk; });
    s.on('end', () => { messages.push(JSON.parse(data)); s.end(); });
  });
  server.listen(socket); await once(server, 'listening');
  t.after(() => new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())));
  writeFileSync(join(path, '.claude/sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'fixture', messagingSocketPath: socket }));
  return messages;
}
test('real Unix inbox: dry-run does not write, send writes exactly one framed message', async t => {
  const { path, env } = setup(t), messages = await inbox(t, path);
  const args = ['send', '--to', String(process.pid), '--message', '한글\nsecond', '--no-from', '--no-reply-to'];
  const dry = await invoke([...args, '--dry-run'], env);
  assert.equal(dry.status, 'validated'); assert.equal(dry.submitted, false); assert.equal(messages.length, 0);
  const sent = await invoke(args, env);
  assert.equal(sent.status, 'posted'); assert.equal(sent.consumptionConfirmed, false);
  assert.deepEqual(messages, [{ type: 'user', message: { role: 'user', content: '한글\nsecond' } }]);
});
test('structured replies are inert data and reject conflicting/unsafe fields', () => {
  assert.deepEqual(reply('session-peer://v1/reply?agent=claude&session=worker&transport=local'), { to: 'worker' });
  assert.equal(reply(`session-peer://v1/reply?agent=codex&session=${id}&transport=ssh&host=user%40host&codexHome=%2Ftmp%2Fhome`).host, 'user@host');
  for (const suffix of ['&agent=claude', '&host=bad', '&extra=x', '&codexHome=/tmp', '&x=%ZZ']) {
    assert.throws(() => reply('session-peer://v1/reply?agent=claude&session=worker&transport=local' + suffix));
  }
  assert.throws(() => reply('session-peer://v1/reply?agent=claude&session=x&transport=ssh&host=-oProxyCommand%3Did'));
  // #53: codexHome must be POSIX or Windows absolute, as in the Python reference.
  const codexReply = (home: string) => reply(`session-peer://v1/reply?agent=codex&session=${id}&transport=local&codexHome=${encodeURIComponent(home)}`);
  for (const home of ['/srv/codex', 'C:\\Users\\u\\.codex', 'D:/codex', '\\\\server\\share\\codex']) assert.equal(codexReply(home).home, home);
  for (const home of ['rel/dir', '~/.codex', '.codex', 'C:codex', '\\codex']) assert.throws(() => codexReply(home), /invalid_reply_uri/);
  assert.equal(envelope('hello', true), 'hello');
});

function database(home: string) {
  mkdirSync(join(home, 'thread-writer-locks'), { recursive: true });
  const result = spawnSync(python, ['-c',
    'import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]); c.execute("CREATE TABLE threads(id TEXT)"); c.execute("INSERT INTO threads VALUES (?)",(sys.argv[2],)); c.commit(); c.close()',
    join(home, 'state_5.sqlite'), id]);
  assert.equal(result.status, 0, result.stderr.toString());
}
async function holder(t: TestContext, path: string, home: string, name = 'codex-fixture') {
  // Actual OS flock held by a separate native process, not a mocked lock probe.
  const source = join(path, 'holder.c'), binary = join(path, name);
  writeFileSync(source, '#include <sys/file.h>\n#include <fcntl.h>\n#include <unistd.h>\n#include <stdio.h>\nint main(int argc,char**argv){int f=open(argv[1],O_RDWR|O_CREAT,0600); if(f<0||flock(f,LOCK_EX|LOCK_NB))return 1;puts("ready");fflush(stdout); sleep(60);return 0;}\n');
  const built = spawnSync('cc', [source, '-o', binary]);
  assert.equal(built.status, 0, built.stderr.toString());
  const child = spawn(binary, [join(home, 'thread-writer-locks', `${id}.lock`)], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'close'); } });
  await once(child.stdout, 'data');
  return child;
}
test('actual kernel lock + owner correlation; symlink and non-Codex owner fail closed', async t => {
  const { path } = setup(t), home = join(path, 'home'); database(home);
  const lock = join(home, 'thread-writer-locks', `${id}.lock`);
  assert.equal(await probeLock(lock), 'absent');
  writeFileSync(lock, ''); assert.equal(await probeLock(lock), 'free');
  symlinkSync(lock, join(path, 'alias')); assert.equal(await probeLock(join(path, 'alias')), 'unknown');
  await holder(t, path, home, 'not-codex');
  assert.equal(await probeLock(lock), 'held');
  await assert.rejects(inspectWriter(home, id), /active_writer_unverified/);
});
test('Codex guarded queue runs once, refuses inactive or competing live writers', async t => {
  const { path, env } = setup(t), home = join(path, 'home'); database(home);
  const queue = join(path, 'queue'), count = join(path, 'count');
  writeFileSync(queue, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(count)},'1'); console.log('Queued message queue-17 for thread '+process.argv[4]+'.');`, { mode: 0o700 });
  const args = ['send', '--to', `codex:${id}`, '--codex-home', home, '--codex-bin', queue, '--message', 'fixture', '--no-from'];
  assert.equal((await invoke(args, env)).error, 'inactive_writer');
  const inactive = await invoke([...args, '--allow-inactive-codex-home'], env);
  assert.equal(inactive.status, 'queued'); assert.equal(inactive.codexHomeResolution.reason, 'explicit_inactive_opt_in');
  assert.equal(inactive.queueId, 'queue-17');
  rmSync(count);
  await holder(t, path, home);
  const dry = await invoke([...args, '--dry-run'], env); assert.equal(dry.status, 'validated', JSON.stringify(dry));
  const sent = await invoke(args, env); assert.equal(sent.status, 'queued', JSON.stringify(sent));
  assert.equal(readFileSync(count, 'utf8'), '1'); assert.equal(sent.consumptionConfirmed, false);
  const implicitArgs = args.filter((_, index) => index !== 3 && index !== 4);
  const implicit = await invoke([...implicitArgs, '--dry-run'], { ...env, CODEX_HOME: home });
  assert.equal(implicit.status, 'validated', JSON.stringify(implicit));
  assert.equal(implicit.codexHomeResolution.status, 'selected');
  assert.equal(implicit.codexHomeResolution.reason, 'single_stable_live_writer');
  const second = join(path, 'second'); database(second);
  const conflict = await invoke([...args.slice(0, 4), second, ...args.slice(5)], { ...env, CODEX_HOME: home });
  assert.equal(conflict.error, 'explicit_home_conflicts_with_live_writer');
  await holder(t, path, second, 'codex-second');
  const ambiguous = await invoke(args, { ...env, SESSION_PEER_CODEX_HOMES: JSON.stringify([second]) });
  assert.equal(ambiguous.error, 'multiple_live_writers'); assert.equal(readFileSync(count, 'utf8'), '1');
  const deleted = spawnSync(python, ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("DELETE FROM threads"); c.commit(); c.close()', join(second, 'state_5.sqlite')]);
  assert.equal(deleted.status, 0);
  const unsavedCompetitor = await invoke([...args, '--allow-inactive-codex-home'], { ...env, SESSION_PEER_CODEX_HOMES: JSON.stringify([second]) });
  assert.equal(unsavedCompetitor.error, 'multiple_live_writers'); assert.equal(readFileSync(count, 'utf8'), '1');
});
test('queue failure after spawn is unknown, never retried or leaked', async t => {
  const { path, env } = setup(t), home = join(path, 'home'); database(home); await holder(t, path, home);
  const queue = join(path, 'queue'), count = join(path, 'count');
  writeFileSync(queue, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(count)},'1'); console.error('SECRET-SENTINEL');process.exit(1);`, { mode: 0o700 });
  const result = await invoke(['send', '--to', `codex:${id}`, '--codex-home', home, '--codex-bin', queue, '--message', 'SECRET-SENTINEL'], env);
  assert.equal(result.status, 'unknown'); assert.equal(result.submitted, null); assert.equal(result.retryAllowed, false);
  assert.equal(result.codexHomeResolution.reason, 'explicit_live_writer');
  assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false); assert.equal(readFileSync(count, 'utf8'), '1');
});
test('SSH refuses a different implementation with the same command name before submission', async t => {
  const { path, env } = setup(t);
  const calls = join(path, 'ssh-calls');
  writeFileSync(join(path, 'ssh'), `#!${process.execPath}\n${sshConfigUser}const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},process.argv.at(-1)+'\\n');console.log('session-peer 1.0.2');`, { mode: 0o700 });
  const result = await invoke(['send', '--host', 'fixture', '--to', 'fixture', '--message', 'not-sent'], { ...env, PATH: path + delimiter + env.PATH });
  assert.equal(result.status, 'refused');
  assert.equal(result.submitted, false);
  const commands = readFileSync(calls, 'utf8').trim().split('\n');
  assert.equal(commands.length, 1);
  assert.match(commands[0], /session-peer.*--version$/);
  assert.equal(commands[0].includes('--stdio-request'), false);
});
test('SSH preflight reports allowlisted causes without leaking stderr or sending', async t => {
  const { path, env } = setup(t);
  const calls = join(path, 'ssh-calls');
  const cases = [
    ['Host key verification failed. SECRET-SENTINEL', 255, 'ssh_host_key_untrusted'],
    ['Permission denied (publickey,password). SECRET-SENTINEL', 255, 'ssh_authentication_refused'],
    ['Could not resolve hostname fixture: nodename nor servname provided. SECRET-SENTINEL', 255, 'ssh_unreachable'],
    ['session-peer: command not found. SECRET-SENTINEL', 127, 'remote_cli_missing'],
    ['Unexpected SSH failure SECRET-SENTINEL', 255, 'ssh_preflight_failed']
  ];
  for (const [detail, code, expected] of cases) {
    writeFileSync(join(path, 'ssh'), `#!${process.execPath}\n${sshConfigUser}require('node:fs').appendFileSync(${JSON.stringify(calls)},process.argv.at(-1)+'\\n'); console.error(${JSON.stringify(detail)});process.exit(${code});`, { mode: 0o700 });
    const result = await invoke(['send', '--host', 'fixture', '--to', 'fixture', '--message', 'not-sent'], { ...env, PATH: path + delimiter + env.PATH });
    assert.equal(result.error, expected);
    assert.equal(result.submitted, false);
    assert.equal(result.retryAllowed, false);
    assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false);
  }
  assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, cases.length);
});
test('SSH request framing: no message in remote command; response loss never retries', async t => {
  const { path, env } = setup(t), messages = await inbox(t, path);
  const ssh = join(path, 'ssh');
  writeFileSync(ssh, `#!${process.execPath}\n${sshConfigUser}const {spawnSync}=require('node:child_process'); const a=process.argv.slice(2);if(a.at(-1).endsWith('--version')){console.log('session-peer 0.3.0 (typescript)');process.exit(0);}if(a.at(-1).includes('SECRET-SENTINEL'))process.exit(99);const input=require('node:fs').readFileSync(0,'utf8');const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},'--stdio-request'],{input,encoding:'utf8',env:process.env});process.stdout.write(r.stdout);process.exit(r.status);`, { mode: 0o700 });
  const result = await invoke(['send', '--host', 'fixture', '--to', String(process.pid), '--message', 'SECRET-SENTINEL', '--no-from'], { ...env, PATH: path + delimiter + env.PATH });
  assert.equal(result.status, 'posted'); assert.equal(messages.length, 1);
  // Valid JSON mixed with banner/trailing output is not a verified response.
  for (const command of ['send', 'list']) for (const prefix of [true, false]) {
    const response = JSON.stringify({ schemaVersion: 1, command, host: 'fixture', ok: true, status: 'posted', submitted: true, consumptionConfirmed: false });
    const stdout = prefix ? 'untrusted banner\n' + response : response + '\ntrailing junk';
    writeFileSync(ssh, `#!${process.execPath}\n${sshConfigUser}if(process.argv.at(-1).endsWith('--version'))console.log('session-peer 0.3.0 (typescript)');else console.log(${JSON.stringify(stdout)});`, { mode: 0o700 });
    const unverified = await invoke([command, '--host', 'fixture', ...(command === 'send' ? ['--to', 'fixture', '--message', 'not-provable'] : [])], { ...env, PATH: path + delimiter + env.PATH });
    assert.equal(unverified.status, command === 'send' ? 'unknown' : 'refused');
    assert.equal(unverified.submitted, command === 'send' ? null : false);
    assert.equal(unverified.retryAllowed, false);
  }
  writeFileSync(ssh, `#!${process.execPath}\n${sshConfigUser}if(process.argv.at(-1).endsWith('--version'))console.log('session-peer 0.3.0 (typescript)');else process.exit(255);`, { mode: 0o700 });
  const lost = await invoke(['send', '--host', 'fixture', '--to', 'fixture', '--message', 'lost'], { ...env, PATH: path + delimiter + env.PATH });
  assert.equal(lost.status, 'unknown'); assert.equal(lost.retryAllowed, false); assert.equal(messages.length, 1);
});

test('unsaved first-turn writer is diagnosed and never queued', async t => {
  const { path, env } = setup(t), home = join(path, 'home'); database(home); await holder(t, path, home);
  const deleted = spawnSync(python, ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("DELETE FROM threads"); c.commit(); c.close()', join(home, 'state_5.sqlite')]);
  assert.equal(deleted.status, 0);
  const result = await invoke(['send', '--to', `codex:${id}`, '--codex-bin', process.execPath, '--message', 'fixture'], { ...env, CODEX_HOME: home });
  assert.equal(result.error, 'thread_not_yet_persisted'); assert.equal(result.submitted, false);
  const row = result.codexHomeResolution.candidates.find((c: {codexHome: string}) => c.codexHome === home);
  assert.equal(row.savedThread, false); assert.equal(row.activity, 'live_writer');
});

test('SSH resolves Codex homes at destination and preserves resolution/queue metadata', async t => {
  const { path, env } = setup(t), home = join(path, 'remote-home'); database(home);
  const owner = await holder(t, path, home);
  const queue = join(path, 'queue'), count = join(path, 'count');
  writeFileSync(queue, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(count)},'1'); if(process.env.QUEUE_FAIL){console.error('SECRET-SENTINEL');process.exit(1);} console.log('Queued message ssh-17 for thread ${id}.');`, { mode: 0o700 });
  writeFileSync(join(path, 'ssh'), `#!${process.execPath}\n${sshConfigUser}const {spawnSync}=require('node:child_process'); const flag=process.argv.at(-1).endsWith('--version')?'--version':'--stdio-request'; const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},flag],{input:require('node:fs').readFileSync(0),encoding:'utf8',env:{...process.env,CODEX_HOME:${JSON.stringify(home)},SESSION_PEER_CODEX_HOMES:'[]'}});process.stdout.write(r.stdout);process.exit(r.status);`, { mode: 0o700 });
  const local = { ...env, PATH: path + delimiter + env.PATH, SESSION_PEER_CODEX_HOMES: '{invalid-local' };
  const args = ['send', '--host', 'fixture', '--to', `codex:${id}`, '--codex-bin', queue, '--message', 'fixture', '--no-from'];
  const sent = await invoke(args, local);
  assert.equal(sent.status, 'queued'); assert.equal(sent.queueId, 'ssh-17');
  assert.equal(sent.codexHomeResolution.reason, 'single_stable_live_writer');
  const unknown = await invoke(args, { ...local, QUEUE_FAIL: '1' });
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.submitted, null);
  assert.equal(unknown.codexHomeResolution.reason, 'single_stable_live_writer'); assert.equal(unknown.queueId, undefined);
  assert.equal(JSON.stringify(unknown).includes('SECRET-SENTINEL'), false);
  owner.kill(); await once(owner, 'close');
  const refused = await invoke(args, local);
  assert.equal(refused.error, 'inactive_writer'); assert.equal(refused.submitted, false);
  assert.equal(refused.codexHomeResolution.reason, 'inactive_queue_requires_opt_in');
  const inactive = await invoke([...args, '--codex-home', home, '--allow-inactive-codex-home'], local);
  assert.equal(inactive.queueId, 'ssh-17'); assert.equal(inactive.codexHomeResolution.reason, 'explicit_inactive_opt_in');
  assert.equal(readFileSync(count, 'utf8'), '111');
});

test('Codex queue passes dash bodies as one --message= argv and drops inherited CODEX_SQLITE_HOME', async t => {
  const { path, env } = setup(t), home = join(path, 'home'); database(home); await holder(t, path, home);
  const queue = join(path, 'queue'), calls = join(path, 'calls');
  writeFileSync(queue, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:process.argv.slice(2),sqlite:process.env.CODEX_SQLITE_HOME??null})+'\\n'); console.log('Queued message q-1 for thread '+process.argv[4]+'.');`, { mode: 0o700 });
  const bodies = ['- first item', '--help', '-x', '--', '-1', '-\nsecond line'];
  for (const body of bodies) {
    const sent = await invoke(['send', '--to', `codex:${id}`, '--codex-home', home, '--codex-bin', queue, `--message=${body}`, '--no-from'], { ...env, CODEX_SQLITE_HOME: join(path, 'elsewhere') });
    assert.equal(sent.status, 'queued', JSON.stringify(sent));
  }
  const recorded = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(recorded.map(call => call.args), bodies.map(body => ['queue', '--thread', id, `--message=${body}`]));
  assert.ok(recorded.every(call => call.sqlite === null));
});

test('a configured Codex sqlite_home is refused before dry-run or queue', async t => {
  const { path, env } = setup(t), home = join(path, 'home'); database(home); await holder(t, path, home);
  const queue = join(path, 'queue'), count = join(path, 'count');
  writeFileSync(queue, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(count)},'1');`, { mode: 0o700 });
  const args = ['send', '--to', `codex:${id}`, '--codex-home', home, '--codex-bin', queue, '--message', 'fixture', '--no-from'];
  writeFileSync(join(home, 'config.toml'), 'model = "x"\n# sqlite_home = "/commented"\n[profiles.p]\nmodel = "y"\n');
  assert.equal((await invoke([...args, '--dry-run'], env)).status, 'validated');
  writeFileSync(join(home, 'config.toml'), 'model = "x"\nsqlite_home = "/relocated"\n');
  for (const extra of [['--dry-run'], []]) {
    const refused = await invoke([...args, ...extra], env);
    assert.equal(refused.error, 'unsupported_codex_sqlite_home'); assert.equal(refused.submitted, false);
  }
  writeFileSync(join(home, 'config.toml'), '"sqlite\\u005fhome" = "/relocated"\n');
  for (const extra of [['--dry-run'], []]) {
    const refused = await invoke([...args, '--allow-inactive-codex-home', ...extra], env);
    assert.equal(refused.error, 'unsupported_codex_sqlite_home'); assert.equal(refused.submitted, false);
  }
  assert.throws(() => readFileSync(count));
});

test('a saved inactive home needs opt-in and still rejects relocated or unreadable storage', async t => {
  const { path, env } = setup(t), home = join(path, 'inactive-home'); database(home);
  // No holder is started: distinguish an inactive saved thread from a missing DB.
  const inactive = await inspectWriter(home, id);
  assert.equal(inactive.activity, 'inactive'); assert.equal(inactive.writerLock, 'absent');
  const queue = join(path, 'inactive-queue'), calls = join(path, 'inactive-calls');
  writeFileSync(queue, `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');console.log('Queued message inactive-queue-96 for thread '+process.argv[4]+'.');`, { mode: 0o700 });
  const recorded = (): string[][] => {
    try { return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  };
  const args = ['send', '--to', `codex:${id}`, '--codex-home', home, '--codex-bin', queue,
    '--message', 'inactive fixture', '--no-from', '--no-reply-to'];
  const config = join(home, 'config.toml');
  const assertSelectedInactive = (value: any) => {
    const resolution = value.codexHomeResolution;
    assert.equal(resolution.status, 'explicit'); assert.equal(resolution.selected, home);
    const candidate = resolution.candidates.find((item: any) => item.codexHome === home);
    assert.ok(candidate); assert.equal(candidate.savedThread, true);
    assert.equal(candidate.activity, 'inactive'); assert.equal(candidate.writerLock, 'absent');
  };
  writeFileSync(config, 'model = "fixture"\n');
  for (const extra of [['--dry-run'], []]) {
    const refused = await invoke([...args, ...extra], env);
    assert.equal(refused.error, 'inactive_writer'); assert.equal(refused.status, 'refused');
    assert.equal(refused.submitted, false);
    assert.equal(refused.codexHomeResolution.reason, 'inactive_queue_requires_opt_in');
    assert.equal(recorded().length, 0);
  }
  const dry = await invoke([...args, '--allow-inactive-codex-home', '--dry-run'], env);
  assert.equal(dry.status, 'validated'); assert.equal(dry.submitted, false);
  assert.equal(dry.codexHomeResolution.reason, 'explicit_inactive_opt_in'); assert.equal(recorded().length, 0);
  assertSelectedInactive(dry);
  const sent = await invoke([...args, '--allow-inactive-codex-home'], env);
  assert.equal(sent.status, 'queued'); assert.equal(sent.submitted, true);
  assert.equal(sent.codexHomeResolution.reason, 'explicit_inactive_opt_in');
  assertSelectedInactive(sent);
  assert.equal(sent.queueId, 'inactive-queue-96');
  assert.deepEqual(recorded(), [['queue', '--thread', id, '--message=inactive fixture']]);
  const baselineCalls = recorded().length;
  for (const key of ['sqlite_home', String.raw`"sqlite\u005fhome"`, String.raw`"sqlite\U0000005fhome"`]) {
    const text = `${key} = "/fixture/relocated"\n`; writeFileSync(config, text);
    assert.equal(readFileSync(config, 'utf8'), text); // Keep the actual TOML escape bytes.
    for (const extra of [['--dry-run'], []]) {
      const refused = await invoke([...args, ...extra], env);
      assert.equal(refused.error, 'inactive_writer', key); assert.equal(refused.code, 1);
      assert.equal(refused.status, 'refused'); assert.equal(refused.submitted, false);
      assert.equal(refused.codexHomeResolution.reason, 'inactive_queue_requires_opt_in');
      assert.equal(recorded().length, baselineCalls);
    }
    for (const extra of [['--dry-run'], []]) {
      const refused = await invoke([...args, '--allow-inactive-codex-home', ...extra], env);
      assert.equal(refused.error, 'unsupported_codex_sqlite_home', key);
      assert.equal(refused.code, 1); assert.equal(refused.status, 'refused'); assert.equal(refused.submitted, false);
      assert.equal(refused.codexHomeResolution.reason, 'explicit_inactive_opt_in');
      assertSelectedInactive(refused);
      assert.equal(recorded().length, baselineCalls);
    }
  }
  writeFileSync(config, 'sqlite_home = [\n');
  for (const extra of [['--dry-run'], []]) {
    const refused = await invoke([...args, '--allow-inactive-codex-home', ...extra], env);
    assert.equal(refused.error, 'codex_config_unreadable'); assert.equal(refused.status, 'refused');
    assert.equal(refused.submitted, false); assert.equal(recorded().length, baselineCalls);
  }
  assert.equal((await inspectWriter(home, id)).writerLock, 'absent');
});

test('SSH preflight accepts a verified version despite noisy stderr and propagates remote exit codes', async t => {
  const { path, env } = setup(t), messages = await inbox(t, path);
  const ssh = join(path, 'ssh');
  writeFileSync(ssh, `#!${process.execPath}\n${sshConfigUser}const {spawnSync}=require('node:child_process');if(process.argv.at(-1).endsWith('--version')){console.error('curl: (7) Failed to connect: Connection refused');console.log('session-peer 0.3.0 (typescript)');process.exit(0);}const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},'--stdio-request'],{input:require('node:fs').readFileSync(0,'utf8'),encoding:'utf8',env:process.env});process.stdout.write(r.stdout);process.exit(r.status);`, { mode: 0o700 });
  const remoteEnv = { ...env, PATH: path + delimiter + env.PATH };
  // #55 + #49/#51 over SSH: a flag-like body travels as --message=<text> and posts literally.
  const sent = await invoke(['send', '--host', 'fixture', '--to', String(process.pid), '--message=--dry-run', '--no-from'], remoteEnv);
  assert.equal(sent.status, 'posted', JSON.stringify(sent)); assert.equal(sent.code, 0);
  assert.equal(messages.length, 1); assert.equal((messages[0] as { message: { content: string } }).message.content, '--dry-run');
  // #52: a verified remote usage refusal keeps exit 2, like the local refusal.
  const local = await invoke(['send', '--to', 'codex:not-a-uuid', '--message', 'x'], env);
  const remote = await invoke(['send', '--host', 'fixture', '--to', 'codex:not-a-uuid', '--message', 'x'], remoteEnv);
  assert.equal(local.error, 'codex_uuid_required'); assert.equal(remote.error, local.error);
  assert.equal(local.code, 2); assert.equal(remote.code, 2);
  assert.equal(messages.length, 1);
});

test('Windows --remote-bin doubles every PowerShell single-quote variant', async t => {
  const { path, env } = setup(t), calls = join(path, 'ssh-calls');
  writeFileSync(join(path, 'ssh'), `#!${process.execPath}\n${sshConfigUser}require('node:fs').appendFileSync(${JSON.stringify(calls)},process.argv.at(-1)+'\\n');process.exit(255);`, { mode: 0o700 });
  const binary = "C:\\a'\u2018\u2019\u201a\u201b;calc;#";
  const result = await invoke(['list', '--host', 'fixture', '--remote-platform', 'win32', '--remote-bin', binary], { ...env, PATH: path + delimiter + env.PATH });
  assert.equal(result.error, 'ssh_preflight_failed');
  const decoded = Buffer.from(readFileSync(calls, 'utf8').trim().split(' ').at(-1)!, 'base64').toString('utf16le');
  assert.equal(decoded, "& 'C:\\a''\u2018\u2018\u2019\u2019\u201a\u201a\u201b\u201b;calc;#' --version");
});
