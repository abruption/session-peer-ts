import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HandoffBudget, parseStrictJson, parseWaitTimeout, validateHandoff, validateHandoffQuery, validateReceipt, validateConfirmation, HANDOFF_LIMITS, type Clock, type Handoff } from '../dist/handoff.js';
import { HandoffLedger, payloadDigest, type HandoffBinding } from '../dist/handoff-ledger.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/handoff-v1.json', import.meta.url), 'utf8'));
const posix = { skip: process.platform === 'win32' };
function fixtureLedger(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-ho-')));
  chmodSync(root, 0o700); t.after(() => rmSync(root, { recursive: true, force: true }));
  let mono = 10, utc = 100000;
  const clock: Clock = { monotonic: () => mono, utc: () => utc };
  const ledger = new HandoffLedger(join(root, 'ledger'), { clock });
  const binding: HandoffBinding = { agent: 'codex', destination: 'fixture', target: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', home: '/fixture/home',
    writerIdentity: 'fixture-writer', generation: 'fixture-generation', payloadDigest: payloadDigest('private fixture body') };
  return { root, clock, ledger, binding, advance: (ms: number) => { mono += ms; utc += ms; }, jumpUtc: (ms: number) => { utc += ms; } };
}
function handoff(ledger: HandoffLedger, id: string): Handoff {
  const value = ledger.status(id); assert.ok('handoff' in value); return value.handoff;
}
function receipt(h: Handoff, capability: string, receiptId = randomUUID()) {
  return JSON.stringify({ schemaVersion: 1, kind: 'receipt', ledgerEpoch: h.ledgerEpoch, correlationId: h.correlationId,
    targetGeneration: h.targetGeneration, receiptId, capability });
}
function confirmation(h: Handoff) {
  return JSON.stringify({ schemaVersion: 1, ledgerEpoch: h.ledgerEpoch, correlationId: h.correlationId,
    targetGeneration: h.targetGeneration, confirmed: true });
}
function submit(f: ReturnType<typeof fixtureLedger>, h: Handoff) {
  f.ledger.commitEffect(h.correlationId, f.binding); return f.ledger.recordSubmission(h.correlationId, 'submitted');
}
const bootstrap = { privateConsumerValidated: true, compatibleProducerValidated: true } as const;

test('all pinned positive public schema fixtures validate without rewriting native fields', () => {
  for (const sample of fixture.accepted) {
    const original = JSON.stringify(sample.result);
    assert.deepEqual(validateHandoff(sample.result.handoff), sample.result.handoff, sample.name);
    assert.equal(JSON.stringify(sample.result), original);
  }
});
test('all pinned negative handoff schema fixtures fail closed', () => {
  for (const sample of fixture.rejected) {
    const base = fixture.accepted.find((item: any) => item.name === sample.base);
    const h = structuredClone(base.result.handoff);
    for (const [path, value] of Object.entries(sample.set)) {
      const keys = path.split('.'); let target = h;
      for (const key of keys.slice(0, -1)) target = target[key];
      target[keys.at(-1)!] = value;
    }
    assert.throws(() => validateHandoff(h), /invalid_handoff/, sample.name);
  }
});
test('raw strict JSON rejects duplicate keys, lossy integer tokens, invalid UTF-8 and trailing data', () => {
  for (const sample of fixture.wireRejected) assert.throws(() => parseStrictJson(sample.raw ?? Buffer.from(sample.bytesHex, 'hex')), /invalid_handoff_json/, sample.name);
  assert.throws(() => parseStrictJson('{"schemaVersion":-0}'));
  assert.throws(() => parseStrictJson('{"n":9007199254740993}'));
  assert.equal((parseStrictJson('{"native":1e0,"handoff":{"schemaVersion":1}}', { scope: 'outer' }) as any).native, 1);
  assert.throws(() => parseStrictJson('{"native":1.0,"handoff":{"schemaVersion":1e0}}', { scope: 'outer' }));
  assert.throws(() => parseStrictJson('{"handoffQuery":{"schemaVersion":1.0}}', { scope: 'outer' }));
  assert.throws(() => parseStrictJson('['.repeat(65) + '0' + ']'.repeat(65)));
  assert.throws(() => parseStrictJson('"\ud800"'));
  assert.throws(() => parseStrictJson(Buffer.from('\ufeff{}', 'utf8')));
});
test('closed missing-history query schemas have no fabricated epoch or native facts', () => {
  for (const sample of fixture.queryErrors) {
    assert.deepEqual(validateHandoffQuery(sample.result.handoffQuery), sample.result.handoffQuery);
    assert.throws(() => validateHandoffQuery({ ...sample.result.handoffQuery, ledgerEpoch: randomUUID() }));
  }
});
test('private frame bound counts every byte and no extra trailing LF allowance', () => {
  const frame = '{}' + ' '.repeat(HANDOFF_LIMITS.privateFrame - 2);
  assert.deepEqual(Object.keys(parseStrictJson(frame) as object), []);
  assert.throws(() => parseStrictJson(frame + '\n'), /handoff_frame_too_large/);
});
test('strict timeout grammar and monotonic budget reserve obey all cutoff boundaries', () => {
  for (let n = 1; n <= 60; n++) assert.equal(parseWaitTimeout(String(n)), n);
  for (const value of ['', '0', '01', '61', '+1', '-1', '1.0', '1e0', ' 1', '1 ', '١', '１']) assert.throws(() => parseWaitTimeout(value), /invalid_wait_timeout/);
  let mono = 10, utc = 10000; const clock = { monotonic: () => mono, utc: () => utc };
  const budget = new HandoffBudget(6, clock); assert.equal(budget.deadlineAtUtcMs, 11000);
  utc += 1000000000; assert.equal(budget.observationRemainingMs(), 1000);
  mono = 1009; budget.beforeEffect(); mono = 1010; assert.throws(() => budget.beforeEffect(), /deadline_before_effect/);
  for (let n = 1; n <= 5; n++) assert.throws(() => new HandoffBudget(n, clock).beforeEffect(), /insufficient_budget/);
});

test('ledger use never auto-initializes and missing/unknown queries invent no epoch', posix, t => {
  const f = fixtureLedger(t), id = randomUUID();
  const missing = f.ledger.status(id); assert.ok('handoffQuery' in missing); assert.equal(missing.handoffQuery.context, 'ledger_missing');
  assert.equal('ledgerEpoch' in missing, false); assert.equal('handoff' in missing, false);
  assert.throws(() => f.ledger.prepare(f.binding), /handoff_history_unavailable/); assert.equal(existsSync(f.ledger.path), false);
  f.ledger.init(); const unknown = f.ledger.status(id); assert.ok('handoffQuery' in unknown); assert.equal(unknown.handoffQuery.context, 'id_unknown');
  assert.throws(() => f.ledger.prepare(f.binding, { correlationId: id }), /handoff_id_unknown/);
  assert.throws(() => f.ledger.init(), /handoff_ledger_exists/);
});
test('prepared exact bindings and correlation-only dry runs reserve authority without effect', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const before = readFileSync(join(f.ledger.path, 'ledger.json'), 'utf8');
  assert.equal(f.ledger.prepare(f.binding, { correlationId: h.correlationId, dryRun: true }).state, 'validated');
  assert.equal(readFileSync(join(f.ledger.path, 'ledger.json'), 'utf8'), before);
  for (const binding of [{ ...f.binding, generation: 'successor' }, { ...f.binding, payloadDigest: payloadDigest('other') }, { ...f.binding, home: '/different' }]) {
    assert.throws(() => f.ledger.commitEffect(h.correlationId, binding), /handoff_binding_conflict/);
  }
  assert.equal(handoff(f.ledger, h.correlationId).state, 'validated'); submit(f, h);
  assert.throws(() => f.ledger.commitEffect(h.correlationId, f.binding), /handoff_already_attempted/);
});
test('durable effect fence recovers unknown after a crash and never authorizes another attempt', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  f.ledger.commitEffect(h.correlationId, f.binding);
  const restarted = new HandoffLedger(f.ledger.path, { clock: f.clock });
  assert.equal(handoff(restarted, h.correlationId).state, 'unknown');
  assert.throws(() => restarted.commitEffect(h.correlationId, f.binding), /handoff_already_attempted/);
  assert.throws(() => restarted.recordSubmission(h.correlationId, 'submitted'), /handoff_outcome_not_authorized/);
});
test('process crash after synced intent still fences the native effect and releases the OS lock', posix, async t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const moduleUrl = new URL('../dist/handoff-ledger.js', import.meta.url).href;
  const script = `import { HandoffLedger } from ${JSON.stringify(moduleUrl)};
let input=''; for await (const chunk of process.stdin) input+=chunk;
const request=JSON.parse(input); new HandoffLedger(request.path,{clock:{monotonic:()=>10,utc:()=>100000}}).commitEffect(request.id,request.binding);
process.kill(process.pid,'SIGKILL');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stdout.resume(); child.stderr.on('data', chunk => { stderr += chunk; }); child.stdin.end(JSON.stringify({ path: f.ledger.path, id: h.correlationId, binding: f.binding }));
  const [, signal] = await once(child, 'close'); assert.equal(signal, 'SIGKILL', stderr);
  assert.equal(handoff(f.ledger, h.correlationId).state, 'unknown');
  assert.throws(() => f.ledger.commitEffect(h.correlationId, f.binding), /handoff_already_attempted/);
});
test('cross-process private advisory lock serializes mutations without overwriting history', posix, async t => {
  const f = fixtureLedger(t); f.ledger.init();
  const native = createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');
  const script = `const fs=require('node:fs'), locks=require(${JSON.stringify(native)});
const fd=fs.openSync(process.argv[1],'r+'); locks.flockSync(fd,'exnb');console.log('ready');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', script, join(f.ledger.path, 'ledger.lock')], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'close'); } });
  await once(child.stdout, 'data');
  assert.throws(() => f.ledger.prepare(f.binding), /handoff_ledger_busy/);
  child.kill('SIGTERM'); await once(child, 'close');
  assert.equal(f.ledger.prepare(f.binding).state, 'validated');
});
test('required channels and null generation refuse before durable effect, including supplied prepared IDs', posix, t => {
  const f = fixtureLedger(t); f.ledger.init();
  for (const waitFor of ['delivered', 'acknowledged'] as const) {
    const binding = { ...f.binding, generation: null }, h = f.ledger.prepare(binding);
    const refused = f.ledger.prepare(binding, { correlationId: h.correlationId, waitFor });
    assert.equal(refused.state, 'refused'); assert.equal(refused.wait.status, 'unsupported');
    assert.throws(() => f.ledger.commitEffect(h.correlationId, binding), /handoff_already_attempted/);
    assert.throws(() => f.ledger.mintCapability(h.correlationId, bootstrap), /receipt_authority_unavailable/);
  }
  const best = f.ledger.prepare({ ...f.binding, generation: null }, { requestAck: true, observeDelivery: true });
  assert.equal(best.ack.status, 'unsupported'); assert.equal(best.observation.status, 'unsupported');
});
test('qualified internal delivery supports required waits while receipt flags cannot qualify ACK', posix, t => {
  const f = fixtureLedger(t); f.ledger.init();
  const pending = f.ledger.prepare(f.binding, { waitFor: 'delivered', observationSupported: true, requestAck: true, budget: new HandoffBudget(6, f.clock) });
  assert.equal(pending.wait.status, 'pending'); assert.equal(pending.observation.status, 'pending'); assert.equal(pending.ack.status, 'unsupported');
  submit(f, pending);
  const observed = f.ledger.recordObservation(pending.correlationId, { clientUserMessageId: pending.correlationId, injectionObserved: true, turn: { id: 'turn', status: 'completed' } }, f.binding);
  assert.equal(observed.state, 'delivered'); assert.equal(observed.wait.status, 'satisfied'); assert.equal(observed.ack.status, 'unsupported');
  const refused = f.ledger.prepare(f.binding, { waitFor: 'acknowledged', channels: { delivery: true, receipt: true } });
  assert.equal(refused.wait.status, 'unsupported'); assert.equal(refused.state, 'refused');
});
test('observation requires qualified original generation, exact binding/message ID and known submission', posix, t => {
  const f = fixtureLedger(t); f.ledger.init();
  const h = f.ledger.prepare(f.binding, { observeDelivery: true, channels: { delivery: true }, clientUserMessageId: 'original-user-message' });
  const evidence = { clientUserMessageId: 'original-user-message', injectionObserved: true };
  assert.throws(() => f.ledger.recordObservation(h.correlationId, evidence, f.binding), /handoff_observation_unverified/);
  submit(f, h);
  assert.throws(() => f.ledger.recordObservation(h.correlationId, { ...evidence, clientUserMessageId: 'different-user-message' }, f.binding), /handoff_observation_unverified/);
  for (const binding of [{ ...f.binding, generation: 'successor' }, { ...f.binding, destination: 'different' }, { ...f.binding, payloadDigest: payloadDigest('different') }]) {
    assert.throws(() => f.ledger.recordObservation(h.correlationId, evidence, binding), /handoff_binding_conflict/);
  }
  const observed = f.ledger.recordObservation(h.correlationId, evidence, f.binding);
  assert.equal(observed.state, 'delivered'); assert.equal(observed.submission.status, 'submitted'); assert.equal(observed.observation.clientUserMessageId, evidence.clientUserMessageId);
  assert.equal(f.ledger.recordObservation(h.correlationId, { ...evidence, injectionObserved: false }, f.binding).state, 'delivered');
  assert.throws(() => f.ledger.commitEffect(h.correlationId, f.binding), /handoff_already_attempted/);
  const unqualified = f.ledger.prepare(f.binding); submit(f, unqualified);
  assert.throws(() => f.ledger.recordObservation(unqualified.correlationId, { clientUserMessageId: unqualified.correlationId, injectionObserved: true }, f.binding), /handoff_observation_unverified/);
  const nullBinding = { ...f.binding, generation: null }, nullH = f.ledger.prepare(nullBinding, { observeDelivery: true, observationSupported: true });
  f.ledger.commitEffect(nullH.correlationId, nullBinding); f.ledger.recordSubmission(nullH.correlationId, 'submitted');
  assert.throws(() => f.ledger.recordObservation(nullH.correlationId, { clientUserMessageId: nullH.correlationId, injectionObserved: true }, nullBinding), /handoff_observation_unverified/);
});
test('delivery at cutoff preserves timed-out wait; repeated observation cannot change original turn', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding, { waitFor: 'delivered', observationSupported: true, budget: new HandoffBudget(6, f.clock) });
  submit(f, h); f.advance(1000);
  const evidence = { clientUserMessageId: h.correlationId, injectionObserved: true, turn: { id: 'turn', status: 'completed' as const } };
  const observed = f.ledger.recordObservation(h.correlationId, evidence, f.binding);
  assert.equal(observed.wait.status, 'timed_out_unknown'); assert.equal(observed.state, 'delivered');
  assert.throws(() => f.ledger.recordObservation(h.correlationId, { ...evidence, turn: { id: 'successor-turn', status: 'completed' } }, f.binding), /handoff_turn_conflict/);
  assert.throws(() => f.ledger.recordObservation(h.correlationId, { ...evidence, turn: { id: 'turn', status: 'running' } }, f.binding), /handoff_turn_conflict/);
  const later = f.ledger.beginWait(h.correlationId, 'delivered', new HandoffBudget(6, f.clock)); assert.equal(later.wait.status, 'satisfied');
});
test('exact injection evidence survives observer restart without inventing old wait ordering or ACK', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding, { waitFor: 'delivered', observationSupported: true }); submit(f, h);
  const restarted = new HandoffLedger(f.ledger.path, { clock: f.clock });
  const observed = restarted.recordObservation(h.correlationId, { clientUserMessageId: h.correlationId, injectionObserved: true }, f.binding);
  assert.equal(observed.state, 'delivered'); assert.equal(observed.wait.status, 'failed'); assert.equal(observed.wait.reason, 'history_unavailable');
  assert.equal(observed.ack.status, 'not_requested'); assert.equal(observed.observation.injectionObserved, true);
});
test('late final resolution refusal consumes only a valid bound prepared reservation and fences restart', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding, { waitFor: 'delivered', observationSupported: true });
  assert.throws(() => f.ledger.refusePrepared(randomUUID(), f.binding), /handoff_id_unknown/);
  assert.throws(() => f.ledger.refusePrepared(h.correlationId, { ...f.binding, generation: 'successor' }), /handoff_binding_conflict/);
  assert.equal(handoff(f.ledger, h.correlationId).state, 'validated');
  const refused = f.ledger.refusePrepared(h.correlationId, f.binding, 'evidence_failed');
  assert.equal(refused.state, 'refused'); assert.equal(refused.submission.status, 'refused'); assert.equal(refused.wait.status, 'failed');
  const restarted = new HandoffLedger(f.ledger.path, { clock: f.clock });
  assert.throws(() => restarted.commitEffect(h.correlationId, f.binding), /handoff_already_attempted/);
  assert.throws(() => restarted.prepare(f.binding, { correlationId: h.correlationId }), /handoff_already_attempted/);
});
test('insufficient budget consumes a real send reservation but dry runs do not', posix, t => {
  const f = fixtureLedger(t); f.ledger.init();
  const h = f.ledger.prepare(f.binding, { waitFor: 'acknowledged', budget: new HandoffBudget(5, f.clock) });
  assert.equal(h.state, 'refused'); assert.equal(h.wait.reason, 'insufficient_budget');
  assert.throws(() => f.ledger.commitEffect(h.correlationId, f.binding), /handoff_already_attempted/);
  const other = f.ledger.prepare(f.binding);
  assert.throws(() => f.ledger.commitEffect(other.correlationId, f.binding, new HandoffBudget(5, f.clock)), /insufficient_budget/);
  assert.equal(handoff(f.ledger, other.correlationId).state, 'refused');
});
test('owned 0700/0600 storage rejects permissive paths and symlink records', posix, t => {
  const f = fixtureLedger(t); f.ledger.init();
  assert.equal(statSync(f.ledger.path).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.ledger.path, 'ledger.json')).mode & 0o777, 0o600);
  chmodSync(f.ledger.path, 0o755); assert.throws(() => f.ledger.prepare(f.binding), /handoff_storage_untrusted/); chmodSync(f.ledger.path, 0o700);
  const target = join(f.root, 'external'); writeFileSync(target, 'private', { mode: 0o600 });
  rmSync(join(f.ledger.path, 'ledger.json')); symlinkSync(target, join(f.ledger.path, 'ledger.json'));
  assert.throws(() => f.ledger.prepare(f.binding), /handoff_storage_untrusted/);
  assert.equal(readFileSync(target, 'utf8'), 'private');
});
test('corrupt ledger status remains a query error and does not silently recreate history', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  writeFileSync(join(f.ledger.path, 'ledger.json'), '{}');
  const value = f.ledger.status(h.correlationId); assert.ok('handoffQuery' in value); assert.equal(value.handoffQuery.context, 'ledger_corrupt');
  assert.throws(() => f.ledger.prepare(f.binding), /handoff_ledger_corrupt/);
  assert.equal(readFileSync(join(f.ledger.path, 'ledger.json'), 'utf8'), '{}');
});
test('operator confirmation is metadata-only, correlated and never manufactures injection', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding); submit(f, h);
  assert.throws(() => f.ledger.confirm(confirmation({ ...h, targetGeneration: 'successor' })), /confirmation_binding_invalid/);
  assert.throws(() => validateConfirmation(JSON.stringify({ ...JSON.parse(confirmation(h)), body: 'transcript' })), /invalid_handoff/);
  const acknowledged = f.ledger.confirm(confirmation(h));
  assert.equal(acknowledged.ack.assurance, 'operator_confirmed'); assert.equal(acknowledged.ack.late, false);
  assert.equal(acknowledged.observation.injectionObserved, false);
  const restarted = new HandoffLedger(f.ledger.path, { clock: { monotonic: () => 0, utc: () => 1 } });
  assert.deepEqual(handoff(restarted, h.correlationId).ack, acknowledged.ack);
});
test('private receipt authority is hash-only, bound to original tuple and first receipt', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap); assert.equal(capability.length, 43);
  assert.equal(readFileSync(join(f.ledger.path, 'ledger.json'), 'utf8').includes(capability), false);
  assert.equal(JSON.stringify(handoff(f.ledger, h.correlationId)).includes(capability), false);
  submit(f, h);
  const raw = receipt(h, capability), wrong = receipt(h, Buffer.alloc(32).toString('base64url'));
  assert.throws(() => f.ledger.acceptReceipt(wrong), /receipt_authentication_failed/);
  assert.throws(() => f.ledger.acceptReceipt(receipt({ ...h, targetGeneration: 'successor' }, capability)), /receipt_authentication_failed/);
  const accepted = f.ledger.acceptReceipt(raw);
  assert.equal(accepted.ack.assurance, 'token_possession'); assert.equal(accepted.observation.injectionObserved, false);
  assert.deepEqual(f.ledger.acceptReceipt(raw), accepted);
  assert.throws(() => f.ledger.acceptReceipt(receipt(h, capability)), /receipt_already_committed/);
  f.advance(HANDOFF_LIMITS.capabilityMs + 1);
  const restarted = new HandoffLedger(f.ledger.path, { clock: f.clock });
  assert.deepEqual(restarted.acceptReceipt(raw).ack, accepted.ack);
  assert.throws(() => restarted.acceptReceipt(wrong), /receipt_authentication_failed/);
  restarted.revoke(h.correlationId); assert.throws(() => restarted.acceptReceipt(raw), /receipt_authentication_failed/);
});
test('restarted unused authority expires conservatively and never regenerates a secret', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h);
  const restarted = new HandoffLedger(f.ledger.path, { clock: f.clock });
  assert.throws(() => restarted.acceptReceipt(receipt(h, capability)), /receipt_authority_expired/);
  assert.throws(() => restarted.mintCapability(h.correlationId, bootstrap), /receipt_authority_unavailable/);
  assert.equal(handoff(restarted, h.correlationId).ack.status, 'unsupported');
});
test('a new native effect owner cannot revive receipt authority minted before process restart', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap);
  const restarted = new HandoffLedger(f.ledger.path, { clock: { monotonic: () => 0, utc: f.clock.utc } });
  restarted.commitEffect(h.correlationId, f.binding); restarted.recordSubmission(h.correlationId, 'submitted');
  assert.throws(() => restarted.acceptReceipt(receipt(h, capability)), /receipt_authority_expired/);
  assert.equal(handoff(restarted, h.correlationId).ack.status, 'unsupported');
});
test('expired unspent receipt authority never offers keep_waiting or accepts a new receipt', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h);
  f.ledger.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(6, f.clock)); f.advance(HANDOFF_LIMITS.capabilityMs);
  assert.equal(handoff(f.ledger, h.correlationId).nextActions.includes('keep_waiting'), false);
  assert.throws(() => f.ledger.acceptReceipt(receipt(h, capability)), /receipt_authority_expired/);
  assert.equal(f.ledger.beginWait(h.correlationId, 'acknowledged').wait.status, 'unsupported');
  assert.equal(handoff(f.ledger, h.correlationId).wait.status, 'unsupported');
});
test('receipt at cutoff is late, preserves original terminal wait, and satisfies a later wait', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h);
  const pending = f.ledger.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(6, f.clock));
  assert.equal(pending.wait.status, 'pending'); f.advance(1000);
  const accepted = f.ledger.acceptReceipt(receipt(h, capability));
  assert.equal(accepted.ack.late, true); assert.equal(accepted.wait.status, 'timed_out_unknown');
  const later = f.ledger.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(6, f.clock));
  assert.equal(later.wait.status, 'satisfied'); assert.notEqual(later.wait.operationId, pending.wait.operationId); assert.equal(later.ack.late, true);
});
test('strictly-before-cutoff receipt satisfies wait and terminal results cannot be rewritten', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h);
  f.ledger.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(6, f.clock)); f.advance(999);
  assert.equal(f.ledger.acceptReceipt(receipt(h, capability)).wait.status, 'satisfied');
  assert.throws(() => f.ledger.recordWait(h.correlationId, 'stopped', 'stopped_by_operator'), /handoff_wait_terminal/);
});
test('manual confirmation with unprovable restarted pending wait ordering refuses without ACK', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h);
  f.ledger.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(6, f.clock));
  const restarted = new HandoffLedger(f.ledger.path, { clock: f.clock });
  assert.throws(() => restarted.confirm(confirmation(h)), /receipt_order_unprovable/);
  assert.notEqual(handoff(restarted, h.correlationId).ack.status, 'acknowledged');
});
test('known durable timeout proves a new late manual event after restart without rewriting that wait', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h);
  const pending = f.ledger.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(6, f.clock)); f.advance(1000);
  f.ledger.recordWait(h.correlationId, 'timed_out_unknown');
  const restarted = new HandoffLedger(f.ledger.path, { clock: f.clock });
  const accepted = restarted.confirm(confirmation(h)); assert.equal(accepted.ack.late, true); assert.equal(accepted.wait.status, 'timed_out_unknown');
  assert.equal(accepted.wait.operationId, pending.wait.operationId);
});
test('wait quota exhaustion and insufficient new-wait budget preserve native submission facts', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding); submit(f, h);
  for (let i = 0; i < 64; i++) {
    const wait = f.ledger.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(5, f.clock));
    assert.equal(wait.wait.reason, 'insufficient_budget'); assert.equal(wait.submission.status, 'submitted');
  }
  assert.throws(() => f.ledger.beginWait(h.correlationId, 'acknowledged'), /handoff_wait_quota/);
  assert.equal(handoff(f.ledger, h.correlationId).state, 'submitted');
});
test('expired details compact to an epoch-bound fence, never restoring send or receipt authority', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h);
  const raw = receipt(h, capability); f.ledger.acceptReceipt(raw); f.advance(HANDOFF_LIMITS.detailMs); f.ledger.prune();
  const tombstone = handoff(f.ledger, h.correlationId); assert.equal(tombstone.state, 'unknown'); assert.equal(tombstone.ledgerEpoch, h.ledgerEpoch);
  assert.equal(tombstone.targetGeneration, h.targetGeneration); assert.equal(tombstone.ack.status, 'unsupported');
  assert.throws(() => f.ledger.commitEffect(h.correlationId, f.binding), /handoff_history_unavailable/);
  assert.throws(() => f.ledger.acceptReceipt(raw), /handoff_history_unavailable/);
});
test('known restoration quarantines original intents and authentic receipts', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, bootstrap); submit(f, h); f.ledger.quarantine();
  assert.equal(handoff(f.ledger, h.correlationId).state, 'unknown');
  assert.throws(() => f.ledger.prepare(f.binding), /handoff_ledger_quarantined/);
  assert.throws(() => f.ledger.acceptReceipt(receipt(h, capability)), /handoff_ledger_quarantined/);
});
test('byte admission reserves terminal/wait/receipt room and never evicts an existing fence', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const file = join(f.ledger.path, 'ledger.json'), wrapper = JSON.parse(readFileSync(file, 'utf8'));
  const template = wrapper.data.records[h.correlationId];
  for (let i = 1; i < 511; i++) {
    const id = randomUUID(), item = structuredClone(template); item.handoff.correlationId = id;
    wrapper.data.records[id] = item;
  }
  writeFileSync(file, JSON.stringify({ digest: payloadDigest(JSON.stringify(wrapper.data)), data: wrapper.data }));
  const before = readFileSync(file, 'utf8');
  assert.throws(() => f.ledger.prepare(f.binding), /handoff_ledger_full/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(handoff(f.ledger, h.correlationId).state, 'validated');
  // Reserved terminal space still permits the existing intent's one transition.
  submit(f, h); assert.equal(handoff(f.ledger, h.correlationId).state, 'submitted');
});
test('retained tombstones count toward the 10,000 intent limit with no LRU replacement', posix, t => {
  const f = fixtureLedger(t); f.ledger.init(); const h = f.ledger.prepare(f.binding);
  const file = join(f.ledger.path, 'ledger.json'), wrapper = JSON.parse(readFileSync(file, 'utf8'));
  const template = wrapper.data.records[h.correlationId]; template.reserve = 0; template.expired = true;
  for (let i = 1; i < HANDOFF_LIMITS.intents; i++) {
    const id = randomUUID(), item = structuredClone(template); item.handoff.correlationId = id;
    wrapper.data.records[id] = item;
  }
  writeFileSync(file, JSON.stringify({ digest: payloadDigest(JSON.stringify(wrapper.data)), data: wrapper.data }));
  const before = readFileSync(file, 'utf8');
  assert.throws(() => f.ledger.prepare(f.binding), /handoff_ledger_full/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(handoff(f.ledger, h.correlationId).state, 'unknown');
});
test('private receipt rejects incorrect capability encoding, extra fields and lexical versions', () => {
  const sample = { schemaVersion: 1, kind: 'receipt', ledgerEpoch: randomUUID(), correlationId: randomUUID(), targetGeneration: 'g', receiptId: randomUUID(), capability: Buffer.alloc(32).toString('base64url') };
  assert.equal(validateReceipt(JSON.stringify(sample)).capability, sample.capability);
  for (const capability of ['x'.repeat(42), 'x'.repeat(44), sample.capability + '=', 'A'.repeat(42) + 'B']) assert.throws(() => validateReceipt(JSON.stringify({ ...sample, capability })));
  assert.throws(() => validateReceipt(JSON.stringify({ ...sample, receivedAtUtcMs: 1 })));
  assert.throws(() => validateReceipt(JSON.stringify(sample).replace('"schemaVersion":1', '"schemaVersion":1.0')));
});
