import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HandoffBudget, type Clock } from '../dist/handoff.js';
import { HandoffLedger, payloadDigest, type HandoffBinding } from '../dist/handoff-ledger.js';
const posix = { skip: process.platform === 'win32' };
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-ho-observe-')));
  chmodSync(root, 0o700); t.after(() => rmSync(root, { recursive: true, force: true }));
  let mono = 10;
  const clock: Clock = { monotonic: () => mono, utc: () => 100000 + mono };
  const ledger = new HandoffLedger(join(root, 'ledger'), { clock }); ledger.init();
  const binding: HandoffBinding = { agent: 'codex', destination: 'fixture', target: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    home: '/fixture/home', generation: 'fixture-generation', payloadDigest: payloadDigest('fixture body') };
  const h = ledger.prepare(binding, { observeDelivery: true, observationSupported: true });
  ledger.mintCapability(h.correlationId, { privateConsumerValidated: true, compatibleProducerValidated: true });
  ledger.commitEffect(h.correlationId, binding); ledger.recordSubmission(h.correlationId, 'submitted');
  const waits = () => JSON.parse(readFileSync(join(ledger.path, 'ledger.json'), 'utf8')).data.records[h.correlationId].waits.map((w: any) => w.public);
  const observe = (reader = ledger) => reader.recordObservation(h.correlationId, { clientUserMessageId: h.correlationId, injectionObserved: true }, binding);
  return { ledger, clock, h, waits, observe, advance: (ms: number) => { mono += ms; } };
}
test('one injection resolves every pending delivery wait using its own cutoff even when ACK is newest', posix, t => {
  const f = fixture(t);
  const first = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.advance(500);
  const second = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  const ack = f.ledger.beginWait(f.h.correlationId, 'acknowledged', new HandoffBudget(6, f.clock));
  f.advance(500); // First cutoff is inclusive; second cutoff is still in the future.
  const result = f.observe();
  assert.equal(result.state, 'delivered'); assert.equal(result.ack.status, 'pending');
  assert.equal(result.wait.operationId, ack.wait.operationId); assert.equal(result.wait.status, 'pending');
  assert.deepEqual(f.waits().map((w: any) => [w.operationId, w.status]), [
    [first.wait.operationId, 'timed_out_unknown'], [second.wait.operationId, 'satisfied'], [ack.wait.operationId, 'pending'],
  ]);
});
test('injection preserves terminal delivery waits and never resets their deadlines', posix, t => {
  const f = fixture(t);
  const stopped = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.ledger.recordWait(f.h.correlationId, 'stopped', 'stopped_by_operator');
  const completed = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.advance(1000); f.ledger.recordWait(f.h.correlationId, 'timed_out_unknown');
  const before = f.waits();
  const pending = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.observe(); const observed = f.waits();
  assert.deepEqual(observed.slice(0, 2), before);
  assert.equal(observed[0].operationId, stopped.wait.operationId);
  assert.equal(observed[1].operationId, completed.wait.operationId);
  assert.equal(observed[2].operationId, pending.wait.operationId); assert.equal(observed[2].status, 'satisfied');
  f.advance(1000); f.observe(); assert.deepEqual(f.waits(), observed);
});
test('independent observer retains injection without classifying another owner delivery deadlines', posix, t => {
  const f = fixture(t);
  f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(30, f.clock));
  const ack = f.ledger.beginWait(f.h.correlationId, 'acknowledged', new HandoffBudget(30, f.clock));
  const result = f.observe(new HandoffLedger(f.ledger.path, { clock: f.clock }));
  assert.equal(result.state, 'delivered'); assert.equal(result.observation.injectionObserved, true);
  assert.notEqual(result.ack.status, 'acknowledged'); assert.equal(result.wait.operationId, ack.wait.operationId);
  // Resumed/concurrent observation is introduced by #72. Another observer
  // cannot prove these owners stopped or compare their monotonic cutoffs.
  assert.deepEqual(f.waits().slice(0, 2).map((w: any) => [w.status, w.reason]), [
    ['pending', undefined], ['pending', undefined],
  ]);
  assert.equal(f.waits()[2].status, 'pending');
});
test('explicit operation timeout resolves the older cutoff without changing a newer pending wait', posix, t => {
  const f = fixture(t);
  const first = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.advance(500);
  const second = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.advance(500);
  const settled = f.ledger.recordWait(f.h.correlationId, 'timed_out_unknown', undefined, first.wait.operationId);
  assert.equal(settled.wait.operationId, first.wait.operationId); assert.equal(settled.wait.status, 'timed_out_unknown');
  assert.deepEqual(f.waits().map((w: any) => [w.operationId, w.status]), [
    [first.wait.operationId, 'timed_out_unknown'], [second.wait.operationId, 'pending'],
  ]);
  const status = f.ledger.status(f.h.correlationId); assert.ok('handoff' in status);
  assert.deepEqual(status.handoff.wait, second.wait);
  const before = f.waits();
  assert.throws(() => f.ledger.recordWait(f.h.correlationId, 'stopped', 'stopped_by_operator', first.wait.operationId), /handoff_wait_terminal/);
  assert.deepEqual(f.waits(), before);
});
test('explicit wait selection rejects unknown IDs and cannot timeout a foreign monotonic clock', posix, t => {
  const f = fixture(t);
  const first = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.advance(1000);
  const foreign = new HandoffLedger(f.ledger.path, { clock: f.clock });
  assert.throws(() => foreign.recordWait(f.h.correlationId, 'timed_out_unknown', undefined, first.wait.operationId), /receipt_order_unprovable/);
  assert.throws(() => f.ledger.recordWait(f.h.correlationId, 'stopped', 'stopped_by_operator', 'not-a-uuid'), /invalid_wait_operation_id/);
  assert.throws(() => f.ledger.recordWait(f.h.correlationId, 'stopped', 'stopped_by_operator', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), /handoff_wait_unknown/);
  assert.equal(f.waits()[0].status, 'pending');
});
test('same-owner delivery cutoffs resolve while a newer unsupported foreign ACK wait stays terminal', posix, t => {
  const f = fixture(t);
  const first = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.advance(500);
  const second = f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  const foreign = new HandoffLedger(f.ledger.path, { clock: f.clock });
  const newest = foreign.beginWait(f.h.correlationId, 'acknowledged', new HandoffBudget(30, f.clock));
  // This unqualified foreign ACK operation is terminal unsupported; it must not
  // hide the earlier delivery operations or become ACK through injection.
  assert.equal(newest.wait.status, 'unsupported');
  f.advance(500); f.observe();
  assert.deepEqual(f.waits().map((w: any) => [w.operationId, w.status]), [
    [first.wait.operationId, 'timed_out_unknown'], [second.wait.operationId, 'satisfied'], [newest.wait.operationId, 'unsupported'],
  ]);
});
