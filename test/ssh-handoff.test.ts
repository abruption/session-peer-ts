// Owned fake SSH, recording socket and scripted native fixture; no live agent or remote host.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { responseOutcome, type ResponseRequest } from '../dist/ssh-response.js';
import { HandoffBudget, validateHandoff, type Handoff } from '../dist/handoff.js';
import { VERSION_LINE } from '../dist/protocol.js';
import type { Done } from '../dist/process.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const posix = { skip: process.platform === 'win32' };
const qualified = { skip: process.platform !== 'darwin' || process.arch !== 'arm64' };
const wireArgs = (ms: number) => ['--stdio-request', `--handoff-remaining-ms=${ms}`];
const cid = '11111111-1111-4111-8111-111111111111', epoch = '22222222-2222-4222-8222-222222222222';
const thread = '33333333-3333-4333-8333-333333333333';
const prepared = { correlationId: cid, ledgerEpoch: epoch, targetGeneration: 'original-generation' };
const native = { schemaVersion: 1, host: 'fixture', command: 'send', ok: true, status: 'queued', submitted: true,
  consumptionConfirmed: false, queueId: 'queue-1', target: { id: thread }, codexHome: '/fixture/home' };
function evidence(): Handoff {
  return { schemaVersion: 1, ...prepared, state: 'submitted', submission: { status: 'submitted' },
    observation: { status: 'unsupported', injectionObserved: false }, ack: { status: 'not_requested' },
    wait: { for: 'delivered', status: 'timed_out_unknown', operationId: '44444444-4444-4444-8444-444444444444', deadlineAtUtcMs: 1000 },
    decisionOwner: 'sender_operator', retry: { allowed: false, reason: 'receiver_dedup_unavailable' }, nextActions: ['reconcile'] };
}
const requested: ResponseRequest = { command: 'send', to: `codex:${thread}`, home: '/fixture/home',
  handoff: { prepared, correlationId: cid, waitFor: 'delivered', observeDelivery: true, destinationHost: 'fixture' } };
function result(value: unknown, code = 1, extra: Partial<Done> = {}): Done {
  return { spawned: true, interrupted: false, code, stdout: '', stderr: '', stdoutBytes: Buffer.from(JSON.stringify(value)), ...extra };
}

test('SSH wait failures retain native facts only under original request and prepared bindings', () => {
  const timedOut = { ...native, ok: false, error: 'wait_timed_out_unknown', handoff: evidence() };
  const accepted = responseOutcome(result(timedOut), requested);
  assert.equal(accepted.exitCode, 1); assert.equal(accepted.value.submitted, true); assert.equal(accepted.value.queueId, native.queueId);
  assert.deepEqual(accepted.value.handoff, timedOut.handoff);
  assert.throws(() => responseOutcome(result(timedOut), { command: 'send', to: `codex:${thread}` }));
  for (const patch of [{ target: { id: cid } }, { codexHome: '/other' }, { status: 'posted' }, { consumptionConfirmed: true }, { host: 'wrong-destination' }]) {
    assert.throws(() => responseOutcome(result({ ...timedOut, ...patch }), requested));
  }
  for (const patch of [{ correlationId: epoch }, { ledgerEpoch: cid }, { targetGeneration: 'successor' },
    { ack: { status: 'unsupported' } }, { wait: { ...evidence().wait, for: 'acknowledged' } }]) {
    const invalid = responseOutcome(result({ ...timedOut, handoff: { ...evidence(), ...patch } }), requested);
    assert.equal(invalid.value.handoff, undefined); assert.equal(invalid.value.handoffWarning, 'invalid_handoff');
    assert.equal(invalid.value.submitted, true); assert.equal(invalid.exitCode, 1);
  }
  for (const error of [undefined, null, {}]) {
    const invalid = responseOutcome(result({ ...timedOut, error }), requested);
    assert.equal(invalid.value.handoff, undefined); assert.equal(invalid.value.error, 'invalid_handoff');
    assert.equal(invalid.value.submitted, true); assert.equal(invalid.value.queueId, native.queueId); assert.equal(invalid.exitCode, 1);
  }
  const stopped = { ...timedOut, handoff: { ...evidence(), wait: { ...evidence().wait, status: 'stopped', reason: 'stopped_by_operator' } } };
  assert.equal(responseOutcome(result(stopped, 130), requested).exitCode, 130);
  for (const code of [0, 1]) {
    const invalid = responseOutcome(result(stopped, code), requested);
    assert.equal(invalid.exitCode, 1); assert.equal(invalid.value.handoff, undefined);
    assert.equal(invalid.value.handoffWarning, 'invalid_handoff');
    assert.equal(invalid.value.submitted, true); assert.equal(invalid.value.queueId, native.queueId);
  }
});

test('SSH persistence failure preserves the last verified pending wait without inventing a terminal record', () => {
  const pending = { ...evidence(), wait: { ...evidence().wait, status: 'pending' as const } };
  const value = { ...native, ok: false, error: 'handoff_persistence_failed', handoffWarning: 'persistence_failed', handoff: pending };
  const accepted = responseOutcome(result(value), requested);
  assert.equal(accepted.exitCode, 1); assert.equal(accepted.value.ok, false);
  assert.deepEqual(accepted.value.handoff, pending); assert.equal(accepted.value.handoffWarning, 'persistence_failed');
  assert.equal(accepted.value.submitted, true); assert.equal(accepted.value.queueId, native.queueId);
  for (const patch of [{ handoffWarning: undefined }, { error: 'another_error' }]) {
    const invalid = responseOutcome(result({ ...value, ...patch }), requested);
    assert.equal(invalid.value.handoff, undefined); assert.equal(invalid.value.submitted, true); assert.equal(invalid.exitCode, 1);
  }
  assert.throws(() => responseOutcome(result(value), { ...requested, handoff: undefined }));
});

test('strict handoff lexemes, malformed metadata and transport uncertainty preserve independent native evidence', () => {
  const value = { ...native, ok: false, error: 'wait_timed_out_unknown', handoff: evidence(), nativeNumber: 1.25 };
  const bytes = JSON.stringify(value).replace('"deadlineAtUtcMs":1000', '"deadlineAtUtcMs":1e3');
  const invalid = responseOutcome(result(value, 1, { stdoutBytes: Buffer.from(bytes) }), requested);
  assert.equal(invalid.value.handoff, undefined); assert.equal(invalid.value.nativeNumber, 1.25); assert.equal(invalid.value.submitted, true);
  for (const extra of [{ code: 255 }, { code: null, interrupted: true, stopReason: 'timeout' as const }]) {
    const complete = responseOutcome(result(value, 1, extra), requested);
    assert.equal(complete.value.submitted, true); assert.equal(complete.exitCode, 1); assert.deepEqual(complete.value.handoff, evidence());
    assert.throws(() => responseOutcome(result(value, 1, { ...extra, stdoutBytes: Buffer.from(JSON.stringify(value).slice(0, -1)) }), requested));
  }
  const best = responseOutcome(result({ ...native, handoff: { capability: 'forged' } }, 0),
    { ...requested, handoff: { prepared, observeDelivery: true } });
  assert.equal(best.value.ok, true); assert.equal(best.exitCode, 0); assert.equal(best.value.handoff, undefined);
  const optOut = responseOutcome(result({ ...native, handoff: evidence(), handoffQuery: {}, handoffWarning: 'forged' }, 0),
    { command: 'send', to: `codex:${thread}` });
  for (const field of ['handoff', 'handoffQuery', 'handoffWarning']) assert.equal(optOut.value[field], undefined);
});

test('SSH remaining duration charges setup/frame time and never renews cleanup or UTC authority', () => {
  let mono = 100, utc = 10000;
  const clock = { monotonic: () => mono, utc: () => utc };
  const budget = HandoffBudget.fromRemainingMs(6010, clock, 90);
  assert.equal(budget.remainingMs(), 6000); assert.equal(budget.observationRemainingMs(), 1000);
  assert.equal(budget.cutoff, 1100); assert.equal(budget.deadline, 6100);
  utc += 999999; mono = 1100; assert.throws(() => budget.beforeEffect(), /deadline_before_effect/);
  assert.throws(() => HandoffBudget.fromRemainingMs(5000, clock).beforeEffect(), /insufficient_budget/);
  for (const ms of [0, -1, 60001, 5.5, NaN, Infinity]) assert.throws(() => HandoffBudget.fromRemainingMs(ms, clock));
});

async function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-ssh-handoff-'))); chmodSync(root, 0o700);
  const destination = join(root, 'destination'), origin = join(root, 'origin'), socket = join(root, 'socket'), log = join(root, 'calls.jsonl');
  const preparationLog = join(root, 'preparations.jsonl');
  mkdirSync(origin); mkdirSync(join(destination, '.claude', 'sessions'), { recursive: true }); writeFileSync(log, ''); writeFileSync(preparationLog, '');
  const messages: string[] = [];
  const server = createServer(s => { let body = ''; s.on('data', part => { body += part; }); s.on('end', () => { messages.push(body); s.end(); }); });
  server.listen(socket); await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(join(destination, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'fixture', messagingSocketPath: socket }));
  writeFileSync(join(root, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);
if(args.includes('-G')){console.log('user fixture-user');process.exit(0);}
if(args.at(-1).endsWith('--version')){console.log(process.env.FIXTURE_VERSION);process.exit(0);}
const input=fs.readFileSync(0,'utf8'),request=JSON.parse(input);
fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(request)+'\\n');
if(process.env.FIXTURE_PARTIAL_PREPARE&&request.handoff?.preparation){process.stdout.write('{');process.exit(0);}
const env={...process.env,HOME:process.env.FIXTURE_DEST,USERPROFILE:process.env.FIXTURE_DEST,CLAUDE_CONFIG_DIR:process.env.FIXTURE_DEST+'/.claude',SESSION_PEER_HANDOFF_HOME:process.env.FIXTURE_DEST+'/state/handoff'};
const selector=args.at(-1).match(/ --handoff-remaining-ms=([1-9][0-9]{0,4})$/);
const child=cp.spawn(process.execPath,[process.env.FIXTURE_CLI,'--stdio-request',...(selector?['--handoff-remaining-ms='+selector[1]]:[])],{env,stdio:['pipe','pipe','inherit']});
let output='';child.stdout.on('data',part=>{output+=part;process.stdout.write(part);});
child.stdin.end(input);child.on('close',(code,signal)=>{if(request.handoff?.preparation)fs.appendFileSync(process.env.FIXTURE_PREPARATIONS,output);if(signal)process.kill(process.pid,signal);else process.exitCode=request.handoff?.preparation&&process.env.FIXTURE_PREPARE_EXIT255?255:code;});
`, { mode: 0o700 });
  const common = { ...process.env, CODEX_HOME: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', SESSION_PEER_TAILSCALE: 'off', SESSION_PEER_UPDATE_NOTICE: '',
    PATH: root + delimiter + process.env.PATH, FIXTURE_VERSION: VERSION_LINE, FIXTURE_LOG: log, FIXTURE_PREPARATIONS: preparationLog, FIXTURE_CLI: cli, FIXTURE_DEST: destination };
  const destEnv = { ...common, HOME: destination, USERPROFILE: destination, CLAUDE_CONFIG_DIR: join(destination, '.claude'), SESSION_PEER_HANDOFF_HOME: join(destination, 'state', 'handoff') };
  const originEnv = { ...common, HOME: origin, USERPROFILE: origin, CLAUDE_CONFIG_DIR: join(origin, '.claude'), SESSION_PEER_HANDOFF_HOME: join(origin, 'state', 'handoff') };
  async function invoke(args: string[], destinationSide = false, input?: string, extra: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...(destinationSide ? destEnv : originEnv), ...extra } });
    let stdout = '', stderr = ''; child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; }); child.stdin.end(input);
    // Harness margin permits cleanup/reporting; the request budget is unchanged.
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    const [code, signal] = await once(child, 'close'); clearTimeout(timer); assert.equal(signal, null, stderr);
    return { code, value: JSON.parse(stdout), stdout, stderr };
  }
  return { root, destination, origin, destEnv, messages, invoke, calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    preparations: () => readFileSync(preparationLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    args: ['send', '--host', 'fixture', '--to', String(process.pid), '--message=fixture body', '--no-from', '--no-reply-to', '--json'] };
}

async function codexFixture(t: TestContext, mode: 'inject' | 'none' | 'loss') {
  const f = await fixture(t), home = join(f.destination, 'codex-home'), bin = join(f.root, 'codex-bin');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(bin, { mode: 0o700 });
  mkdirSync(join(home, 'thread-writer-locks'), { mode: 0o700 });
  const state = new DatabaseSync(join(home, 'state_5.sqlite'));
  state.exec('CREATE TABLE threads(id TEXT)'); state.prepare('INSERT INTO threads VALUES(?)').run(thread); state.close();
  const warm = new DatabaseSync(join(home, 'thread_history_1.sqlite'));
  warm.exec(`CREATE TABLE thread_turns(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id));
CREATE TABLE thread_items(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,item_id TEXT NOT NULL,rollout_ordinal INTEGER NOT NULL,item_json TEXT NOT NULL,item_type TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id,item_id));
CREATE INDEX idx_thread_items_user_messages ON thread_items(thread_id,rollout_ordinal) WHERE item_type='userMessage';
CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER NOT NULL,next_rollout_ordinal INTEGER NOT NULL);`);
  warm.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run(thread, 'ssh-turn-fixture', 'completed');
  warm.prepare('INSERT INTO thread_history_projection_state VALUES(?,?,?)').run(thread, 100, 100); warm.close();
  const holder = fileURLToPath(new URL('./fixtures/ssh-codex-lock-holder.cjs', import.meta.url));
  const held = spawn(process.execPath, [holder, join(home, 'thread-writer-locks', thread + '.lock'), createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt')]);
  held.stderr.resume();
  t.after(async () => { if (held.exitCode === null && held.signalCode === null) { held.kill('SIGKILL'); await once(held, 'close'); } });
  const readyTimer = setTimeout(() => held.kill('SIGKILL'), 3000);
  try { await Promise.race([once(held.stdout, 'data'), once(held, 'close').then(() => { throw new Error('fixture lock holder exited before readiness'); })]); }
  finally { clearTimeout(readyTimer); }
  const lsof = join(bin, 'lsof');
  writeFileSync(lsof + '.data', 'p' + held.pid + '\0ccodex-fixture\0u' + process.getuid?.() + '\0', { mode: 0o600 });
  writeFileSync(lsof, '#!/bin/sh\nexec /bin/cat "$0.data"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "Fixture stable start\\n"\n', { mode: 0o700 });
  const queueLog = join(f.root, 'codex-queue.jsonl'), nativeLog = join(f.root, 'codex-native.jsonl'), codex = join(bin, 'codex');
  writeFileSync(queueLog, ''); writeFileSync(nativeLog, '');
  copyFileSync(fileURLToPath(new URL('./fixtures/ssh-codex-native.cjs', import.meta.url)), codex); chmodSync(codex, 0o700);
  writeFileSync(codex + '.json', JSON.stringify({ mode, version: '0.160.1', queueLog, nativeLog }), { mode: 0o600 });
  const env = { CODEX_HOME: home, SESSION_PEER_CODEX_HOMES: '[]', PATH: bin + delimiter + f.destEnv.PATH };
  assert.equal((await f.invoke(['handoff', 'init', '--json'], true, undefined, env)).code, 0);
  const readLog = (path: string) => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { ...f, home, env, queueCalls: () => readLog(queueLog), nativeCalls: () => readLog(nativeLog),
    ledger: () => JSON.parse(readFileSync(join(f.destination, 'state', 'handoff', 'ledger.json'), 'utf8')),
    args: ['send', '--host', 'fixture', '--to', `codex:${thread}`, '--codex-home', home, '--codex-bin', codex,
      '--message=fixture request', '--no-from', '--no-reply-to', '--wait-for', 'delivered', '--wait-timeout', '15', '--json'] };
}

for (const mode of ['inject', 'none', 'loss'] as const) {
  test(`qualified SSH Codex ${mode} keeps destination preparation binding and at most one native queue`, qualified, async t => {
    const f = await codexFixture(t, mode), started = performance.now();
    const sent = await f.invoke(f.args, false, undefined, f.env);
    assert.equal(sent.code, mode === 'inject' ? 0 : 1, sent.stdout);
    const calls = f.calls(); assert.equal(calls.length, 2);
    assert.equal(calls[0].handoff.preparation, true); assert.equal(calls[1].handoff.preparation, undefined);
    assert.ok(calls[1].handoff.remainingMs < calls[0].handoff.remainingMs);
    const original = f.preparations()[0], initial = validateHandoff(original.handoff);
    assert.equal(original.ok, true); assert.equal(original.status, 'validated'); assert.equal(original.submitted, false);
    assert.equal(original.target.id, thread); assert.equal(original.codexHome, f.home);
    assert.ok(initial.targetGeneration);
    assert.equal(calls[1].args[calls[1].args.indexOf('--correlation-id') + 1], initial.correlationId);
    assert.equal(calls[1].args[calls[1].args.indexOf('--codex-home') + 1], original.codexHome);
    assert.equal(calls[1].args[calls[1].args.indexOf('--to') + 1], `codex:${original.target.id}`);
    assert.deepEqual(f.queueCalls(), [{ method: 'thread/queue/add', clientId: initial.correlationId, threadId: thread, codexHome: f.home }]);
    assert.equal(f.nativeCalls().some(call => call.command === 'queue'), false);
    assert.equal(f.messages.length, 0); assert.equal(existsSync(join(f.origin, 'state', 'handoff')), false);
    const retained = f.ledger().data.records[initial.correlationId];
    assert.equal(retained.binding.agent, 'codex'); assert.equal(retained.binding.target, thread);
    assert.equal(retained.binding.home, original.codexHome); assert.equal(retained.binding.generation, initial.targetGeneration);
    assert.equal(retained.handoff.ledgerEpoch, initial.ledgerEpoch);
    if (mode === 'loss') {
      assert.equal(sent.value.status, 'unknown'); assert.equal(sent.value.submitted, null);
      assert.equal(retained.handoff.submission.status, 'unknown');
    } else {
      assert.equal(sent.value.status, 'queued'); assert.equal(sent.value.submitted, true);
      assert.equal(sent.value.consumptionConfirmed, false); assert.equal(sent.value.queueId, 'ssh-queue-fixture');
      assert.equal(sent.value.target.id, original.target.id); assert.equal(sent.value.codexHome, original.codexHome);
      const h = validateHandoff(sent.value.handoff);
      for (const key of ['correlationId', 'ledgerEpoch', 'targetGeneration'] as const) assert.equal(h[key], initial[key]);
      assert.equal(h.submission.status, 'submitted'); assert.equal(h.retry.allowed, false); assert.equal(h.ack.status, 'not_requested');
      assert.equal(h.wait.status, mode === 'inject' ? 'satisfied' : 'timed_out_unknown');
      assert.equal(h.observation.injectionObserved, mode === 'inject');
      if (mode === 'inject') {
        assert.equal(h.state, 'delivered'); assert.equal(h.observation.clientUserMessageId, initial.correlationId);
        assert.equal(h.observation.turn?.status, 'completed');
      } else { assert.equal(sent.value.ok, false); assert.equal(sent.value.error, 'timed_out_unknown'); }
      const beforeStatus = f.nativeCalls();
      const status = await f.invoke(['handoff', 'status', '--correlation-id', initial.correlationId, '--json'], true, undefined, f.env);
      assert.equal(status.code, 0); assert.deepEqual(status.value.handoff.wait, h.wait); assert.deepEqual(f.nativeCalls(), beforeStatus);
    }
    assert.ok(performance.now() - started < 20000);
    for (const secret of ['PRIVATE_SSH_CODEX_BODY_SENTINEL', 'payloadDigest', 'observationQualification']) assert.equal(sent.stdout.includes(secret), false);
    const duplicate = await f.invoke([...f.args, '--correlation-id', initial.correlationId], false, undefined, f.env);
    assert.equal(duplicate.code, 1); assert.equal(duplicate.value.error, 'handoff_already_attempted');
    assert.equal(f.calls().length, 3); assert.equal(f.calls()[2].handoff.preparation, true);
    assert.equal(f.queueCalls().length, 1); assert.equal(f.nativeCalls().some(call => call.command === 'queue'), false);
  });
}

test('SSH uses only an explicitly initialized destination ledger, prepares before one effect, and leaves origin untouched', posix, async t => {
  const f = await fixture(t);
  const missing = await f.invoke([...f.args, '--request-ack']);
  assert.equal(missing.code, 1); assert.equal(missing.value.submitted, false); assert.equal(f.messages.length, 0);
  assert.equal(f.calls().length, 1); assert.equal(existsSync(join(f.destination, 'state', 'handoff', 'ledger.json')), false);
  assert.equal((await f.invoke(['handoff', 'init', '--json'], true)).code, 0);
  const sent = await f.invoke([...f.args, '--request-ack']);
  assert.equal(sent.code, 0); assert.equal(sent.value.status, 'posted'); assert.equal(sent.value.handoff.ack.status, 'unsupported'); assert.equal(f.messages.length, 1);
  assert.equal(existsSync(join(f.origin, 'state', 'handoff')), false);
  const calls = f.calls().slice(1); assert.equal(calls.length, 2); assert.equal(calls[0].handoff.preparation, true); assert.equal(calls[1].handoff.preparation, undefined);
  assert.ok(calls[1].handoff.remainingMs < calls[0].handoff.remainingMs);
  assert.equal(calls[1].args[calls[1].args.indexOf('--correlation-id') + 1], sent.value.handoff.correlationId);
  const repeated = await f.invoke([...f.args, '--correlation-id', sent.value.handoff.correlationId]);
  assert.equal(repeated.code, 1); assert.equal(repeated.value.error, 'handoff_already_attempted'); assert.equal(f.messages.length, 1);
  const ack = await f.invoke([...f.args, '--wait-for', 'acknowledged']);
  assert.equal(ack.code, 1); assert.equal(ack.value.handoff.wait.status, 'unsupported'); assert.equal(f.messages.length, 1);
});

test('SSH refuses incomplete preparation, unknown supplied IDs, reused fanout IDs and exhausted budgets before effect', posix, async t => {
  const f = await fixture(t); await f.invoke(['handoff', 'init', '--json'], true);
  const partial = await f.invoke([...f.args, '--request-ack'], false, undefined, { FIXTURE_PARTIAL_PREPARE: '1' });
  assert.equal(partial.value.error, 'remote_preparation_unverified'); assert.equal(f.calls().length, 1);
  const unknown = await f.invoke([...f.args, '--correlation-id', cid]);
  assert.equal(unknown.value.error, 'handoff_id_unknown'); assert.equal(f.calls().length, 2);
  const multi = await f.invoke([...f.args, '--host', 'other', '--correlation-id', cid]);
  assert.equal(multi.code, 2); assert.ok(multi.value.every((v: { error: string }) => v.error === 'handoff_correlation_fanout_forbidden')); assert.equal(f.calls().length, 2);
  const short = await f.invoke([...f.args, '--request-ack', '--wait-timeout', '5']);
  assert.equal(short.value.error, 'insufficient_budget'); assert.equal(f.calls().length, 2);
  const noContext = await f.invoke(['--stdio-request'], true, JSON.stringify({ schemaVersion: 1, args: ['send', '--to', String(process.pid), '--message=x', '--request-ack', '--json'] }));
  assert.equal(noContext.value.error, 'remote_handoff_context_required'); assert.equal(f.messages.length, 0);
});

test('complete successful preparation followed by SSH255 refuses actual send without an effect request', posix, async t => {
  const f = await fixture(t); await f.invoke(['handoff', 'init', '--json'], true);
  const rejected = await f.invoke([...f.args, '--request-ack'], false, undefined, { FIXTURE_PREPARE_EXIT255: '1' });
  assert.equal(rejected.code, 1); assert.equal(rejected.value.ok, false); assert.equal(rejected.value.error, 'remote_preparation_unverified');
  assert.equal(rejected.value.submitted, false); assert.equal(rejected.value.status, 'refused');
  assert.equal(f.calls().length, 1); assert.equal(f.calls()[0].handoff.preparation, true); assert.equal(f.messages.length, 0);
});

test('SSH fanout owns distinct destination intents and refuses excessive destinations before any request', posix, async t => {
  const f = await fixture(t); await f.invoke(['handoff', 'init', '--json'], true);
  const sent = await f.invoke([...f.args, '--host', 'second', '--request-ack']);
  assert.equal(sent.code, 0); assert.equal(sent.value.length, 2); assert.equal(f.messages.length, 2);
  assert.notEqual(sent.value[0].handoff.correlationId, sent.value[1].handoff.correlationId);
  const calls = f.calls(); assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(call => !!call.handoff.preparation), [true, false, true, false]);
  assert.ok(calls[3].handoff.remainingMs < calls[2].handoff.remainingMs);
  const excessive = await f.invoke([...f.args, ...Array.from({ length: 32 }, (_, index) => ['--host', `extra-${index}`]).flat(), '--request-ack']);
  assert.equal(excessive.code, 2); assert.equal(f.calls().length, 4); assert.equal(f.messages.length, 2);
});

test('private SSH frames cannot widen the requested duration or opt an ordinary request in', posix, async t => {
  const f = await fixture(t); await f.invoke(['handoff', 'init', '--json'], true);
  const args = ['send', '--to', String(process.pid), '--message=x', '--request-ack', '--wait-timeout', '6', '--json'];
  for (const handoff of [{ schemaVersion: 1, remainingMs: 7000 }, { schemaVersion: 1, remainingMs: 6000, preparation: false },
    { schemaVersion: 1, remainingMs: 6000, capability: 'forged' }]) {
    const invalid = await f.invoke(wireArgs(6000), true, JSON.stringify({ schemaVersion: 1, args, handoff }));
    assert.equal(invalid.value.error, 'invalid_remote_request');
  }
  const ordinary = args.filter(arg => !['--request-ack', '--wait-timeout', '6'].includes(arg));
  const invalid = await f.invoke(wireArgs(6000), true, JSON.stringify({ schemaVersion: 1, args: ordinary, handoff: { schemaVersion: 1, remainingMs: 6000 } }));
  assert.equal(invalid.value.error, 'remote_handoff_context_required'); assert.equal(f.messages.length, 0);
  const unprepared = await f.invoke(wireArgs(6000), true, JSON.stringify({ schemaVersion: 1, args, handoff: { schemaVersion: 1, remainingMs: 6000 } }));
  assert.equal(unprepared.value.error, 'remote_preparation_required'); assert.equal(f.messages.length, 0);
  const missingSelector = await f.invoke(['--stdio-request'], true, JSON.stringify({ schemaVersion: 1, args,
    handoff: { schemaVersion: 1, preparation: true, remainingMs: 6000 } }));
  assert.equal(missingSelector.value.error, 'invalid_remote_request');
  for (const selector of ['0', '06000', '60001', '+6000', '6e3', '6000.0']) {
    const invalid = await f.invoke(['--stdio-request', `--handoff-remaining-ms=${selector}`], true, '{}');
    assert.equal(invalid.value.error, 'invalid_remote_request');
  }
  const extraArg = await f.invoke([...wireArgs(6000), '--json'], true, '{}');
  assert.equal(extraArg.value.error, 'invalid_remote_request'); assert.equal(f.messages.length, 0);
});

test('private wire input has a deadline before EOF, with bootstrap charged and no intent or effect', posix, async t => {
  const f = await fixture(t), delayed = join(f.root, 'delayed-bootstrap.mjs');
  writeFileSync(delayed, 'await new Promise(resolve=>setTimeout(resolve,700));');
  for (const mode of ['empty', 'partial', 'delayed'] as const) {
    const started = performance.now();
    const child = spawn(process.execPath, [...(mode === 'delayed' ? ['--import', delayed] : []), cli, ...wireArgs(5500)], { env: f.destEnv });
    let stdout = ''; child.stdout.on('data', part => { stdout += part; }); child.stderr.resume();
    // Leave stdin open: no EOF or source-pipe closure can rescue this handler.
    if (mode !== 'empty') child.stdin.write('{"schemaVersion":1,"handoff":');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2500);
    t.after(() => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
    const [code, signal] = await once(child, 'close'); clearTimeout(timer);
    assert.equal(signal, null); assert.equal(code, 1);
    const response = JSON.parse(stdout);
    if (mode === 'delayed') assert.equal(response.error, 'deadline_before_effect');
    else assert.ok(['deadline_before_effect', 'invalid_remote_request'].includes(response.error));
    assert.ok(performance.now() - started < 2000);
    assert.equal(f.messages.length, 0); assert.equal(existsSync(join(f.destination, 'state', 'handoff')), false);
  }
});

test('destination hard watchdog terminates a hung handler and reaps its owned native process group', posix, async t => {
  const f = await fixture(t), pidFile = join(f.root, 'owned-worker.pid');
  // Replace only the operation with a hung owned-worker stand-in. The actual
  // wire parser, monotonic budget, watchdog and process signal cleanup run.
  // Paths are structured loader data/process arguments, never generated code.
  const loader = fileURLToPath(new URL('./fixtures/watchdog-bootstrap.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', loader, cli, ...wireArgs(6500)], {
    env: { ...f.destEnv, FIXTURE_WATCHDOG_PID_FILE: pidFile, FIXTURE_WATCHDOG_LOADER: JSON.stringify({
      targetUrl: new URL('../dist/handoff-operations.js', import.meta.url).href,
      replacementUrl: new URL('./fixtures/watchdog-operation.mjs', import.meta.url).href,
    }) },
  });
  child.stdout.resume(); child.stderr.resume();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  t.after(() => { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  child.stdin.end(JSON.stringify({ schemaVersion: 1, args: ['send', '--to', String(process.pid), '--message=x', '--request-ack', '--json'],
    handoff: { schemaVersion: 1, preparation: true, remainingMs: 6500 } }));
  const [code, signal] = await once(child, 'close'); clearTimeout(timeout);
  assert.equal(code, null); assert.equal(signal, 'SIGTERM'); assert.equal(existsSync(pidFile), true);
  const ownedPid = Number(readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let attempt = 0; attempt < 20 && alive; attempt++) {
    try { process.kill(ownedPid, 0); await new Promise(resolve => setTimeout(resolve, 25)); } catch { alive = false; }
  }
  if (alive) { try { process.kill(ownedPid, 'SIGKILL'); } catch {} }
  assert.equal(alive, false); assert.equal(f.messages.length, 0);
});
