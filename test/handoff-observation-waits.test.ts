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
test('restarted observer retains injection but fails every unorderable delivery wait conservatively', posix, t => {
  const f = fixture(t);
  f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(6, f.clock));
  f.ledger.beginWait(f.h.correlationId, 'delivered', new HandoffBudget(30, f.clock));
  const ack = f.ledger.beginWait(f.h.correlationId, 'acknowledged', new HandoffBudget(30, f.clock));
  const result = f.observe(new HandoffLedger(f.ledger.path, { clock: f.clock }));
  assert.equal(result.state, 'delivered'); assert.equal(result.observation.injectionObserved, true);
  assert.notEqual(result.ack.status, 'acknowledged'); assert.equal(result.wait.operationId, ack.wait.operationId);
  assert.deepEqual(f.waits().slice(0, 2).map((w: any) => [w.status, w.reason]), [
    ['failed', 'history_unavailable'], ['failed', 'history_unavailable'],
  ]);
  assert.equal(f.waits()[2].status, 'pending');
});
