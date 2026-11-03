// Private actor/storage fixtures only; no agent input, process launch or inbox.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { ReceiptState, type PreparedReceipt, type MintedReceipt } from '../dist/receipt-state.js';
import { validateHandoff, HANDOFF_LIMITS } from '../dist/handoff.js';
import type { ReceiptBinding, ProducerEvidence } from '../dist/receipt-protocol.js';

const qualified = { skip: process.platform === 'win32' };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const refusal = (code: string) => (error: { code?: string }) => error.code === code;
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-receipt-state-'));
  const path = join(root, 'managed'), socket = join(root, 'collector.sock');
  let mono = 1000, utc = 100000;
  const clock = { monotonic: () => mono, utc: () => utc };
  const initialized = ReceiptState.initialize(path, socket), actors: ReceiptState[] = [];
  let actor = new ReceiptState(path, { clock }).open(); actors.push(actor);
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); for (const a of actors) a.close(); fs.rmSync(root, { recursive: true, force: true }); });
  function binding(agent: 'claude' | 'codex' = 'claude'): ReceiptBinding {
    const shared = { destination: 'local', payloadDigest: hash('PRIVATE ORIGINAL BODY') };
    return agent === 'claude' ? { ...shared, agent, target: '123', registryDirectory: join(root, 'sessions'),
      registryRecordPath: join(root, 'sessions/123.json'), registryIdentity: hash('registry'), socketPath: join(root, 'inbox.sock'),
      routeIdentity: hash('route'), generation: null } : { ...shared, agent, target: '01900000-0000-7000-8000-000000000001',
      home: join(root, 'codex'), writerIdentity: 'original-generation', generation: 'original-generation' };
  }
  function prepare(agent: 'claude' | 'codex' = 'claude') {
    const original = binding(agent), version = agent === 'claude' ? 2 : 1, scope = agent === 'claude' ? 'delegated_context' : 'original_generation';
    const producer: ProducerEvidence = { protocolVersion: 1, artifactSha256: hash('installed reviewed handler'), challengeId: randomUUID(), receiptSchemaVersion: version, receiptScope: scope };
    const prepared = actor.prepare({ binding: original, producerEvidence: producer, receiptSchemaVersion: version, receiptScope: scope });
    const handle = { ledgerEpoch: prepared.ledgerEpoch, correlationId: prepared.correlationId, receiptContextId: prepared.receiptContextId };
    const minted = actor.mint({ ...handle, producerProtocolVersion: 1 });
    return { original, prepared, handle, minted, selector: { ledgerEpoch: prepared.ledgerEpoch, correlationId: prepared.correlationId } };
  }
  function receipt(minted: MintedReceipt, receiptId = randomUUID()) {
    const base = { kind: 'receipt', ledgerEpoch: minted.ledgerEpoch, correlationId: minted.correlationId, receiptId, capability: minted.capability };
    return JSON.stringify(minted.receiptSchemaVersion === 1 ? { ...base, schemaVersion: 1, targetGeneration: minted.targetGeneration } :
      { ...base, schemaVersion: 2, receiptScope: 'delegated_context', receiptContextId: minted.receiptContextId });
  }
  return { root, path, socket, initialized, clock, binding, prepare, receipt, bytes: () => fs.readFileSync(join(path, 'ledger.json'), 'utf8'),
    get actor() { return actor; }, advance(ms: number) { mono += ms; utc += ms; }, rollback(ms: number) { mono -= ms; },
    reopen() { actor.close(); actor = new ReceiptState(path, { clock }).open(); actors.push(actor); return actor; } };
}

test('managed initialization is explicit, private and incompatible with legacy storage', qualified, t => {
  const f = fixture(t);
  assert.equal(f.actor.ledgerEpoch, f.initialized.ledgerEpoch); assert.equal(f.actor.endpointSelector, f.socket);
  assert.deepEqual(fs.readdirSync(f.path).sort(), ['collector.lock', 'ledger.json', 'ledger.key', 'managed.json']);
  for (const entry of fs.readdirSync(f.path)) assert.equal(fs.statSync(join(f.path, entry)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.path).mode & 0o777, 0o700); assert.equal(fs.statSync(join(f.path, 'ledger.key')).size, 32);
  assert.equal(JSON.parse(f.bytes()).data.version, 2);
  const before = f.bytes(); assert.throws(() => ReceiptState.initialize(f.path, f.socket), refusal('receipt_state_exists')); assert.equal(f.bytes(), before);
  const legacy = join(f.root, 'legacy'); fs.mkdirSync(legacy, { mode: 0o700 }); fs.writeFileSync(join(legacy, 'ledger.json'), '{"version":1}', { mode: 0o600 });
  assert.throws(() => ReceiptState.initialize(legacy, f.socket), refusal('receipt_state_exists'));
  assert.deepEqual(fs.readdirSync(legacy), ['ledger.json']);
});

test('one lifetime owner holds the kernel lock; replacement owners cannot mint or fence old intent', qualified, t => {
  const f = fixture(t), p = f.prepare();
  assert.throws(() => new ReceiptState(f.path, { clock: f.clock }).open(), refusal('receipt_collector_busy'));
  const oldContext = f.actor.collectorContextId; f.reopen(); assert.notEqual(f.actor.collectorContextId, oldContext);
  assert.equal(f.actor.status(p.selector).ack.status, 'unsupported');
  assert.throws(() => f.actor.fence({ ...p.handle, binding: p.original }), refusal('receipt_authority_unavailable'));
  assert.throws(() => f.actor.mint({ ...p.handle, producerProtocolVersion: 1 }), refusal('receipt_authority_unavailable'));
});

test('Claude delegated receipt never fabricates native generation; digest and capability are not persisted raw', qualified, t => {
  const f = fixture(t), p = f.prepare();
  assert.equal(p.prepared.handoff.schemaVersion, 2); assert.equal(p.prepared.handoff.targetGeneration, null);
  assert.throws(() => validateHandoff(p.prepared.handoff));
  f.actor.fence({ ...p.handle, binding: p.original }); f.actor.submission({ ...p.handle, status: 'submitted' });
  const result = f.actor.receipt(f.receipt(p.minted));
  assert.equal(result.status, 'acknowledged'); assert.equal(result.handoff.ack.assurance, 'token_possession');
  assert.equal(result.handoff.targetGeneration, null); assert.equal(result.handoff.observation.injectionObserved, false);
  for (const value of [p.minted.capability, p.original.payloadDigest, 'PRIVATE ORIGINAL BODY']) {
    assert.equal(f.bytes().includes(value), false); assert.equal(JSON.stringify(result.handoff).includes(value), false);
  }
  assert.equal(f.bytes().includes('sealed-v2:'), true);
});

test('Codex uses exact original-generation v1, never the collector or Claude context', qualified, t => {
  const f = fixture(t), p = f.prepare('codex'); assert.equal(p.handle.receiptContextId, null);
  f.actor.fence({ ...p.handle, binding: p.original }); f.actor.submission({ ...p.handle, status: 'submitted' });
  const result = f.actor.receipt(f.receipt(p.minted));
  assert.equal(result.handoff.schemaVersion, 1); assert.equal(result.handoff.targetGeneration, 'original-generation'); validateHandoff(result.handoff);
  const wrong = { ...JSON.parse(f.receipt(p.minted)), targetGeneration: 'successor-generation' };
  assert.throws(() => f.actor.receipt(JSON.stringify(wrong)), refusal('receipt_authentication_failed'));
});

test('fast receipt is one bounded authenticated candidate and duplicates cannot rewrite its bytes', qualified, t => {
  const f = fixture(t), p = f.prepare(), wire = f.receipt(p.minted);
  assert.throws(() => f.actor.receipt(wire), refusal('receipt_authority_unavailable'));
  f.actor.fence({ ...p.handle, binding: p.original });
  const pending = f.actor.receipt(wire); assert.equal(pending.status, 'awaiting_submission');
  assert.equal(pending.handoff.submission.status, 'unknown'); assert.equal(pending.handoff.ack.status, 'pending');
  const before = f.bytes(); assert.deepEqual(f.actor.receipt(wire), pending); assert.equal(f.bytes(), before);
  assert.throws(() => f.actor.receipt(f.receipt(p.minted)), refusal('receipt_candidate_conflict')); assert.equal(f.bytes(), before);
  const committed = f.actor.submission({ ...p.handle, status: 'submitted' }); assert.equal(committed.ack.status, 'acknowledged');
});

test('wrong token, original epoch or delegated context never writes history or reflects secret input', qualified, t => {
  const f = fixture(t), p = f.prepare(); f.actor.fence({ ...p.handle, binding: p.original });
  const valid = JSON.parse(f.receipt(p.minted)), before = f.bytes();
  for (const change of [{ capability: Buffer.alloc(32, 9).toString('base64url') }, { ledgerEpoch: randomUUID() }, { receiptContextId: randomUUID() }]) {
    let failure: unknown;
    try { f.actor.receipt(JSON.stringify({ ...valid, ...change })); } catch (error) { failure = error; }
    assert.ok(failure); assert.equal(String(failure).includes(p.minted.capability), false); assert.equal(f.bytes(), before);
  }
});

for (const outcome of ['unknown', 'refused'] as const) test(`authenticated candidate cannot promote ${outcome} native outcome`, qualified, t => {
  const f = fixture(t), p = f.prepare(); f.actor.fence({ ...p.handle, binding: p.original });
  const wire = f.receipt(p.minted); f.actor.receipt(wire);
  const result = f.actor.submission({ ...p.handle, status: outcome });
  assert.equal(result.submission.status, outcome); assert.notEqual(result.ack.status, 'acknowledged');
  const waiting = f.actor.waitOpen({ ...p.selector, goal: 'acknowledged', timeoutSeconds: 30 });
  assert.equal(waiting.wait.status, 'unsupported'); assert.equal(waiting.nextActions.includes('keep_waiting'), false);
  assert.throws(() => f.actor.submission({ ...p.handle, status: 'submitted' }), refusal('receipt_outcome_not_authorized'));
  assert.throws(() => f.actor.receipt(wire), refusal('receipt_authority_unavailable'));
  assert.throws(() => f.actor.fence({ ...p.handle, binding: p.original }), refusal('receipt_already_attempted'));
});

test('eligibility commit after original cutoff is late; a prior arrival never backdates ACK or timeout', qualified, t => {
  const f = fixture(t), p = f.prepare();
  const original = f.actor.waitOpen({ ...p.selector, goal: 'acknowledged', timeoutSeconds: 10 });
  assert.equal(original.wait.status, 'pending'); assert.equal(original.nextActions.includes('keep_waiting'), false);
  f.actor.fence({ ...p.handle, binding: p.original }); f.advance(4000); f.actor.receipt(f.receipt(p.minted));
  f.advance(1000); const cutoff = f.actor.waitStatus({ ...p.selector, operationId: original.wait.operationId! });
  assert.equal(cutoff.wait.status, 'timed_out_unknown');
  const accepted = f.actor.submission({ ...p.handle, status: 'submitted' });
  assert.equal(accepted.ack.status, 'acknowledged'); assert.equal(accepted.ack.late, true); assert.equal(accepted.ack.receivedAtUtcMs, 105000);
  assert.deepEqual(f.actor.waitStatus({ ...p.selector, operationId: original.wait.operationId! }).wait, cutoff.wait);
});

test('separate wait operations retain their own deadlines and stopped results', qualified, t => {
  const f = fixture(t), p = f.prepare();
  const first = f.actor.waitOpen({ ...p.selector, goal: 'acknowledged', timeoutSeconds: 10 });
  f.actor.fence({ ...p.handle, binding: p.original }); f.actor.submission({ ...p.handle, status: 'submitted' });
  f.advance(1000); const stopped = f.actor.waitStop({ ...p.selector, operationId: first.wait.operationId! });
  const second = f.actor.waitOpen({ ...p.selector, goal: 'acknowledged', timeoutSeconds: 20 });
  f.actor.receipt(f.receipt(p.minted));
  assert.deepEqual(f.actor.waitStatus({ ...p.selector, operationId: first.wait.operationId! }).wait, stopped.wait);
  assert.equal(f.actor.waitStatus({ ...p.selector, operationId: second.wait.operationId! }).wait.status, 'satisfied');
  assert.throws(() => f.actor.waitStop({ ...p.selector, operationId: first.wait.operationId! }), refusal('receipt_wait_terminal'));
});

test('insufficient or expired pre-effect waits cannot authorize a native effect', qualified, t => {
  const f = fixture(t), short = f.prepare();
  const failed = f.actor.waitOpen({ ...short.selector, goal: 'acknowledged', timeoutSeconds: 5 });
  assert.equal(failed.wait.reason, 'insufficient_budget'); assert.equal(failed.submission.status, 'refused');
  assert.throws(() => f.actor.fence({ ...short.handle, binding: short.original }), refusal('receipt_already_attempted'));
  const late = f.prepare(); f.actor.waitOpen({ ...late.selector, goal: 'acknowledged', timeoutSeconds: 6 }); f.advance(1000);
  assert.throws(() => f.actor.fence({ ...late.handle, binding: late.original }), refusal('receipt_already_attempted'));
});

test('all cleanup-insufficient budgets remain terminal without corrupting young-process history', qualified, t => {
  const f = fixture(t);
  for (const seconds of [1,2,3,4,5]) {
    const p = f.prepare();
    const refused = f.actor.waitOpen({ ...p.selector, goal:'acknowledged', timeoutSeconds:seconds });
    assert.equal(refused.wait.status,'failed'); assert.equal(refused.wait.reason,'insufficient_budget');
    assert.equal(refused.submission.status,'refused');
    assert.throws(()=>f.actor.fence({...p.handle,binding:p.original}),refusal('receipt_already_attempted'));
    const sent=f.prepare(); f.actor.fence({...sent.handle,binding:sent.original}); f.actor.submission({...sent.handle,status:'submitted'});
    const waited=f.actor.waitOpen({...sent.selector,goal:'acknowledged',timeoutSeconds:seconds});
    assert.equal(waited.wait.status,'failed'); assert.equal(waited.wait.reason,'insufficient_budget');
    assert.equal(waited.submission.status,'submitted');
  }
});

test('TTL loss and monotonic rollback refuse new receipts; committed duplicates remain authenticated read-only retrieval', qualified, t => {
  const f = fixture(t), p = f.prepare(); f.actor.fence({ ...p.handle, binding: p.original }); f.actor.submission({ ...p.handle, status: 'submitted' });
  const wire = f.receipt(p.minted); f.actor.receipt(wire); const committed = f.bytes(); f.advance(HANDOFF_LIMITS.capabilityMs);
  assert.equal(f.actor.receipt(wire).handoff.ack.status, 'acknowledged'); assert.equal(f.bytes(), committed);
  const expiring = f.prepare(); f.actor.fence({ ...expiring.handle, binding: expiring.original }); f.actor.submission({ ...expiring.handle, status: 'submitted' }); f.advance(HANDOFF_LIMITS.capabilityMs);
  assert.throws(() => f.actor.receipt(f.receipt(expiring.minted)), refusal('receipt_authority_expired'));
  const rollback = f.prepare(); f.rollback(1);
  assert.throws(() => f.actor.fence({ ...rollback.handle, binding: rollback.original }), refusal('receipt_authority_expired'));
  f.advance(1);
  assert.throws(() => f.actor.fence({ ...rollback.handle, binding: rollback.original }), refusal('receipt_collector_closed'));
  f.reopen(); assert.equal(f.actor.status(rollback.selector).ack.status, 'unsupported');
  assert.throws(() => f.actor.fence({ ...rollback.handle, binding: rollback.original }), refusal('receipt_authority_unavailable'));
  assert.equal(f.actor.receipt(wire).handoff.ack.status, 'acknowledged', 'committed evidence survives the new owner');
});

test('restart cannot finish an old attempt or promote its pending receipt, but committed ACK survives', qualified, t => {
  const f = fixture(t), done = f.prepare(); f.actor.fence({ ...done.handle, binding: done.original }); f.actor.submission({ ...done.handle, status: 'submitted' });
  const doneWire = f.receipt(done.minted); const accepted = f.actor.receipt(doneWire);
  const pending = f.prepare(); f.actor.fence({ ...pending.handle, binding: pending.original }); const pendingWire = f.receipt(pending.minted); f.actor.receipt(pendingWire);
  f.reopen(); assert.deepEqual(f.actor.receipt(doneWire).handoff, accepted.handoff);
  assert.equal(f.actor.status(pending.selector).ack.status, 'unsupported');
  assert.throws(() => f.actor.submission({ ...pending.handle, status: 'submitted' }), refusal('receipt_outcome_not_authorized'));
  assert.throws(() => f.actor.receipt(pendingWire), refusal('receipt_authority_expired'));
});

test('binding mismatch and revocation preserve the durable one-attempt fence', qualified, t => {
  const f = fixture(t), p = f.prepare(); const before = f.bytes();
  assert.throws(() => f.actor.fence({ ...p.handle, binding: { ...p.original, payloadDigest: hash('different body') } }), refusal('receipt_binding_conflict'));
  assert.equal(f.bytes(), before); f.actor.fence({ ...p.handle, binding: p.original }); f.actor.revoke(p.selector);
  assert.equal(f.actor.status(p.selector).submission.status, 'unknown');
  assert.throws(() => f.actor.fence({ ...p.handle, binding: p.original }), refusal('receipt_already_attempted'));
});

test('retained wait quota cannot be bypassed by stopping old waits', qualified, t => {
  const f = fixture(t), p = f.prepare(); f.actor.fence({ ...p.handle, binding: p.original }); f.actor.submission({ ...p.handle, status: 'submitted' });
  for (let i = 0; i < HANDOFF_LIMITS.waits; i++) {
    const wait = f.actor.waitOpen({ ...p.selector, goal: 'acknowledged', timeoutSeconds: 30 }); f.actor.waitStop({ ...p.selector, operationId: wait.wait.operationId! });
  }
  const before = f.bytes(); assert.throws(() => f.actor.waitOpen({ ...p.selector, goal: 'acknowledged', timeoutSeconds: 30 }), refusal('receipt_wait_quota')); assert.equal(f.bytes(), before);
});

test('external state/key replacement is refused instead of overwritten or repaired', qualified, t => {
  const f = fixture(t), p = f.prepare(); const file = join(f.path, 'ledger.json');
  fs.appendFileSync(file, '{'); const changed = f.bytes(); assert.throws(() => f.actor.status(p.selector), refusal('receipt_history_changed')); assert.equal(f.bytes(), changed);
  f.actor.close(); assert.throws(() => new ReceiptState(f.path, { clock: f.clock }).open(), refusal('receipt_history_corrupt'));
  assert.equal(f.bytes(), changed);
});

test('missing or replaced private key cannot initialize a replacement history', qualified, t => {
  const f = fixture(t); f.prepare(); const before = f.bytes(); f.actor.close();
  fs.writeFileSync(join(f.path, 'ledger.key'), Buffer.alloc(32, 7));
  assert.throws(() => new ReceiptState(f.path, { clock: f.clock }).open(), refusal('receipt_history_corrupt'));
  assert.throws(() => ReceiptState.initialize(f.path, f.socket), refusal('receipt_state_exists')); assert.equal(f.bytes(), before);
});

test('encrypted payload digests are bound to original epoch and intent even if a checksum is recomputed', qualified, t => {
  const f = fixture(t), first = f.prepare(), second = f.prepare(); f.actor.close();
  const wrapper = JSON.parse(f.bytes());
  wrapper.data.records[second.handle.correlationId].binding.payloadDigest = wrapper.data.records[first.handle.correlationId].binding.payloadDigest;
  wrapper.digest = hash(JSON.stringify(wrapper.data)); fs.writeFileSync(join(f.path, 'ledger.json'), JSON.stringify(wrapper));
  assert.throws(() => new ReceiptState(f.path, { clock: f.clock }).open(), refusal('receipt_history_corrupt'));
});

test('sync failure after durable fence rename poisons admission and restart still cannot replay', qualified, t => {
  const f = fixture(t), p = f.prepare();
  const rename = fs.renameSync, fsync = fs.fsyncSync; let renamed = false;
  t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => { const result = rename(...args); renamed = true; return result; });
  t.mock.method(fs, 'fsyncSync', (fd: number) => { if (renamed) throw Object.assign(new Error('fixture EIO'), { code: 'EIO' }); return fsync(fd); }); syncBuiltinESMExports();
  assert.throws(() => f.actor.fence({ ...p.handle, binding: p.original }), (e: { code?: string }) => e.code === 'EIO');
  assert.throws(() => f.actor.status(p.selector), refusal('receipt_collector_closed'));
  t.mock.restoreAll(); syncBuiltinESMExports(); f.reopen();
  assert.equal(f.actor.status(p.selector).submission.status, 'unknown');
  assert.throws(() => f.actor.fence({ ...p.handle, binding: p.original }), refusal('receipt_already_attempted'));
});

test('opaque hello reference charges later IPC delay without renewing submitted observation', qualified, t => {
  const f=fixture(t),p=f.prepare(),clockReferenceMs=f.actor.clockReference();
  f.actor.fence({...p.handle,binding:p.original});f.actor.submission({...p.handle,status:'submitted'});
  // Client measured 5900ms after receiving a reference made 100ms earlier.
  f.advance(600);
  const h=f.actor.waitOpen({...p.selector,goal:'acknowledged',timeoutSeconds:6,clockReferenceMs,remainingMs:5900});
  assert.equal(h.wait.status,'pending');assert.equal(h.wait.deadlineAtUtcMs,100900);
  f.advance(299);assert.equal(f.actor.waitStatus({...p.selector,operationId:h.wait.operationId!}).wait.status,'pending');
  f.advance(1);assert.equal(f.actor.waitStatus({...p.selector,operationId:h.wait.operationId!}).wait.status,'timed_out_unknown');
});
test('opaque reference charges mint and prepare latency and expires before the original effect', qualified, t => {
  const f=fixture(t),clockReferenceMs=f.actor.clockReference();f.advance(600);
  const p=f.prepare();f.advance(400);
  const h=f.actor.waitOpen({...p.selector,goal:'acknowledged',timeoutSeconds:6,clockReferenceMs,remainingMs:5900});
  assert.equal(h.wait.status,'failed');assert.equal(h.wait.reason,'deadline_before_effect');assert.equal(h.submission.status,'refused');
  assert.throws(()=>f.actor.fence({...p.handle,binding:p.original}));
  const terminal=f.actor.waitStatus({...p.selector,operationId:h.wait.operationId!});assert.deepEqual(terminal.wait,h.wait);
});
test('reference pair validation rejects future, partial and over-span without recording an operation', qualified, t => {
  const f=fixture(t),p=f.prepare(),clockReferenceMs=f.actor.clockReference(),before=f.bytes();
  const base={...p.selector,goal:'acknowledged' as const,timeoutSeconds:6};
  for(const pair of [{clockReferenceMs:clockReferenceMs+1,remainingMs:6000},{clockReferenceMs},
      {remainingMs:6000},{clockReferenceMs,remainingMs:6001}])
    assert.throws(()=>f.actor.waitOpen({...base,...pair}),refusal('receipt_wait_unknown'));
  assert.equal(f.bytes(),before);
});

for(const submitted of [false,true]) test(`delayed hello with 4800ms remaining preserves original six second ${submitted?'submitted':'prepared'} classification`,qualified,t=>{
  const f=fixture(t),clockReferenceMs=f.actor.clockReference(),p=f.prepare();
  if(submitted){f.actor.fence({...p.handle,binding:p.original});f.actor.submission({...p.handle,status:'submitted'});}
  f.advance(1200);
  const h=f.actor.waitOpen({...p.selector,goal:'acknowledged',timeoutSeconds:6,clockReferenceMs,remainingMs:4800});
  assert.equal(h.wait.status,submitted?'timed_out_unknown':'failed');
  assert.equal(h.wait.reason,submitted?undefined:'deadline_before_effect');
});
test('expired reference creates its terminal operation even at active wait quota',qualified,t=>{
  const f=fixture(t),p=f.prepare(),owners=[f.prepare(),f.prepare()];
  for(const owner of owners)for(let i=0;i<64;i++)f.actor.waitOpen({...owner.selector,goal:'acknowledged',timeoutSeconds:60});
  const h=f.actor.waitOpen({...p.selector,goal:'acknowledged',timeoutSeconds:6,clockReferenceMs:f.actor.clockReference(),remainingMs:4800});
  assert.equal(h.wait.status,'failed');assert.equal(h.wait.reason,'deadline_before_effect');assert.ok(h.wait.operationId);
});
