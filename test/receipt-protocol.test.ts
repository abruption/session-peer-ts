// Pure contract fixtures: no socket, filesystem, native process, model or ACK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHandoff, validateReceipt } from '../dist/handoff.js';
import { RECEIPT_LIMITS, parseReceiptRequest, parseReceiptResponse, validateBinding, validateReceiptPair,
  validateProducerEvidence, validateManagedReceipt, validateReceiptV2, validateHandoffV2,
  validateManagedHandoff, parseManagedHandoff, validateReceiptRequest, validateReceiptResponse,
  validateProducerProbeRequest, validateProducerProbeResponse, parseProducerProbeRequest,
  parseProducerProbeResponse, publicReceiptError, type ReceiptBinding } from '../dist/receipt-protocol.js';

const epoch = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const receiptId = '33333333-3333-4333-8333-333333333333';
const context = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const collector = '66666666-6666-4666-8666-666666666666';
const token = Buffer.alloc(32, 7).toString('base64url');
const hash = 'a'.repeat(64);
const wire = (value: unknown) => JSON.stringify(value) + '\n';
const refused = (f: () => unknown) => assert.throws(f);
function binding(agent: 'claude' | 'codex' = 'claude'): ReceiptBinding {
  return agent === 'claude' ? { agent, destination: 'local', target: '123', registryDirectory: '/fixture/profile/home/sessions',
    registryRecordPath: '/fixture/profile/home/sessions/123.json', registryIdentity: hash, socketPath: '/fixture/inbox.sock',
    routeIdentity: hash, generation: null, payloadDigest: hash } : { agent, destination: 'local', target: '01900000-0000-7000-8000-000000000001',
    home: '/fixture/codex', writerIdentity: hash, generation: hash, payloadDigest: hash };
}
function receipt(version: 1 | 2 = 2): Record<string, unknown> {
  return version === 2 ? { schemaVersion: 2, kind: 'receipt', receiptScope: 'delegated_context', ledgerEpoch: epoch,
    correlationId: id, receiptContextId: context, receiptId, capability: token } : { schemaVersion: 1, kind: 'receipt',
    ledgerEpoch: epoch, correlationId: id, targetGeneration: hash, receiptId, capability: token };
}
function handoff(version: 1 | 2 = 2): Record<string, any> {
  return { schemaVersion: version, correlationId: id, ledgerEpoch: epoch, state: 'acknowledged',
    submission: { status: 'submitted' }, observation: { status: 'not_requested', injectionObserved: false },
    ack: { status: 'acknowledged', assurance: 'token_possession', receivedAtUtcMs: 1, late: false },
    wait: { for: 'none', status: 'not_requested' }, targetGeneration: version === 1 ? hash : null,
    ...(version === 2 ? { receiptContext: { kind: 'delegated_context', id: context } } : {}),
    decisionOwner: 'sender_operator', retry: { allowed: false, reason: 'receiver_dedup_unavailable' }, nextActions: ['reconcile'] };
}
function producer(version: 1 | 2 = 2) {
  return { protocolVersion: 1, artifactSha256: hash, challengeId: context, receiptSchemaVersion: version,
    receiptScope: version === 1 ? 'original_generation' : 'delegated_context' };
}
function request(op = 'hello', body: unknown = {}): any {
  return { ipcVersion: 2, requestId, collectorContextId: op === 'hello' ? null : collector, op, body };
}
function response(body: unknown): any { return { ipcVersion: 2, requestId, collectorContextId: collector, ok: true, body }; }

test('separate Claude v2 receipt/handoff accepts null native generation without weakening v1', () => {
  const raw = wire(receipt()), publicResult = handoff();
  assert.equal(validateReceiptV2(raw).receiptContextId, context);
  assert.equal(validateManagedReceipt(raw).schemaVersion, 2);
  assert.equal(validateHandoffV2(publicResult).targetGeneration, null);
  assert.equal(parseManagedHandoff(wire(publicResult)).schemaVersion, 2);
  refused(() => validateReceipt(raw)); refused(() => validateHandoff(publicResult));
  const old = handoff(1);
  assert.deepEqual(validateManagedHandoff(old), validateHandoff(old));
  assert.deepEqual(validateManagedReceipt(wire(receipt(1))), validateReceipt(wire(receipt(1))));
  old.targetGeneration = null; refused(() => validateManagedHandoff(old));
});

test('Claude context cannot forge native generation, injection, completion, operator confirmation or receipt-to-submission promotion', () => {
  const cases: ((v: Record<string, any>) => void)[] = [
    v => { v.targetGeneration = context; }, v => { v.receiptContext.id = 'not-a-context'; },
    v => { v.receiptContext.extra = 'secret'; }, v => { v.state = 'delivered'; },
    v => { v.observation = { status: 'observed', injectionObserved: true, clientUserMessageId: id }; },
    v => { v.observation.turn = { id, status: 'completed' }; }, v => { v.ack.assurance = 'operator_confirmed'; },
    v => { v.submission.status = 'unknown'; }, v => { v.state = 'unknown'; }, v => { v.consumptionConfirmed = true; },
    v => { v.receiptContext.kind = 'original_generation'; }, v => { v.ack.receivedAtUtcMs = 0.5; }
  ];
  for (const mutate of cases) { const sample = handoff(); mutate(sample); refused(() => validateHandoffV2(sample)); }
  const pending = handoff(); pending.state = 'submitted'; pending.ack = { status: 'pending' };
  pending.wait = { for: 'acknowledged', status: 'pending', operationId: receiptId, deadlineAtUtcMs: 100 };
  pending.nextActions = ['keep_waiting','stop_waiting']; assert.equal(validateHandoffV2(pending).ack.status, 'pending');
  pending.wait.status = 'timed_out_unknown'; refused(() => validateHandoffV2(pending));
  pending.nextActions = ['reconcile']; assert.equal(validateHandoffV2(pending).wait.status, 'timed_out_unknown');
  pending.wait.for = 'delivered'; pending.wait.status = 'pending'; refused(() => validateHandoffV2(pending));
});

test('private tagged binding preserves original payload and rejects cross-agent scope or replacement generation', () => {
  assert.deepEqual(validateBinding(binding()), binding()); assert.deepEqual(validateBinding(binding('codex')), binding('codex'));
  const cases = [ { ...binding(), generation: context }, { ...binding('codex'), generation: null },
    { ...binding(), payloadDigest: 'A'.repeat(64) }, { ...binding(), payloadDigest: undefined },
    { ...binding(), registryRecordPath: '../sessions/123.json' }, { ...binding(), rawPayload: 'private body' },
    { ...binding(), home: '/wrong-agent' }, { ...binding(), target: '01' }, { ...binding(), target: '2147483648' },
    { ...binding(), registryDirectory: '/fixture/../escape' }, { ...binding(), destination: 'x'.repeat(513) } ];
  for (const sample of cases) refused(() => validateBinding(sample));
  assert.deepEqual(validateReceiptPair('codex', 1, 'original_generation'), {agent:'codex',receiptSchemaVersion:1,receiptScope:'original_generation'});
  for (const [agent,version,scope] of [['claude',1,'original_generation'],['codex',2,'delegated_context'],['claude',3,'delegated_context']]) refused(() => validateReceiptPair(agent,version,scope));
});

test('private receipt grammar and limits retain canonical capability, UTF-8, duplicate and integer defenses', () => {
  const raw = wire(receipt());
  for (const bad of [raw.replace('"schemaVersion":2','"schemaVersion":2e0'), raw.replace('"kind":"receipt"','"kind":"receipt","kind":"receipt"'),
    raw.replace('"kind":"receipt"','"kind":"receipt","k\\u0069nd":"receipt"'), raw + ' '.repeat(4096),
    wire({ ...receipt(), capability: token+'=' }), wire({ ...receipt(), capability: 'x' }),
    wire({ ...receipt(), targetGeneration: hash }), wire({ ...receipt(), receiptScope: 'original_generation' }),
    wire({ ...receipt(), schemaVersion: 3 }), wire({ ...receipt(), receiptContextId: context.toUpperCase() + 'x' })]) refused(() => validateManagedReceipt(bad));
  refused(() => validateManagedReceipt(Uint8Array.from([123,255,125])));
  const old = receipt(1); old.receiptContextId = context; refused(() => validateManagedReceipt(wire(old)));
});

test('IPC exposes only finite closed operations and binds scope/producer/handle fields', () => {
  const bodies: Record<string, unknown> = {
    hello: {}, prepare: { binding: binding(), receiptSchemaVersion: 2, receiptScope: 'delegated_context', producerEvidence: producer() },
    mint: { ledgerEpoch: epoch, correlationId: id, receiptContextId: context, producerProtocolVersion: 1 },
    fence: { ledgerEpoch: epoch, correlationId: id, receiptContextId: context, binding: binding() },
    submission: { ledgerEpoch: epoch, correlationId: id, receiptContextId: context, status: 'submitted' },
    status: { ledgerEpoch: epoch, correlationId: id }, 'wait-open': { ledgerEpoch: epoch, correlationId: id, goal: 'acknowledged', timeoutSeconds: 6, clockReferenceMs: 0, remainingMs: 6000 },
    'wait-status': { ledgerEpoch: epoch, correlationId: id, operationId: receiptId }, 'wait-stop': { ledgerEpoch: epoch, correlationId: id, operationId: receiptId },
    revoke: { ledgerEpoch: epoch, correlationId: id }, receipt: { receipt: JSON.stringify(receipt(), null, 2) + '\n' }
  };
  for (const [op, body] of Object.entries(bodies)) assert.equal(parseReceiptRequest(wire(request(op,body))).op, op);
  for (const op of ['exec','send','confirm','repair','recover','retry','replace','import','stop']) refused(() => validateReceiptRequest(request(op)));
  refused(() => validateReceiptRequest(request('prepare', { ...(bodies.prepare as object), receiptSchemaVersion: 1 })));
  refused(() => validateReceiptRequest(request('prepare', { ...(bodies.prepare as object), producerEvidence: producer(1) })));
  refused(() => validateReceiptRequest(request('fence', { ...(bodies.fence as object), receiptContextId: null })));
  refused(() => validateReceiptRequest({ ...request(), collectorContextId: collector }));
  refused(() => validateReceiptRequest({ ...request('status',bodies.status), collectorContextId: null }));
  refused(() => validateReceiptRequest(request('wait-open', { ...(bodies['wait-open'] as object), timeoutSeconds: 1.5 })));
  refused(() => validateReceiptRequest({ ...request(), unknown: token }));
});

test('IPC frame boundary requires one LF-terminated value and enforces raw bytes before parsing', () => {
  const req = request(), line = JSON.stringify(req);
  const atLimit = line + ' '.repeat(RECEIPT_LIMITS.frame - Buffer.byteLength(line) - 1) + '\n';
  assert.equal(Buffer.byteLength(atLimit), RECEIPT_LIMITS.frame); assert.equal(parseReceiptRequest(atLimit).op, 'hello');
  for (const raw of [line, line+'\r\n', wire(req)+'\n', wire(req)+wire(req), atLimit+' ', '{\n"ipcVersion":2}\n',
    line.replace('"ipcVersion":2','"ipcVersion":2e0')+'\n', line.replace('"op":"hello"','"op":"hello","op":"hello"')+'\n']) refused(() => parseReceiptRequest(raw));
  refused(() => parseReceiptRequest(Uint8Array.from([255,10])));
  const deep = { ...req, body: { a: JSON.parse('['.repeat(17)+'0'+']'.repeat(17)) } }; refused(() => parseReceiptRequest(wire(deep)));
  const oversizedStructure = { ...req, body: Object.fromEntries(Array.from({length:1025},(_,i)=>['k'+i,0])) }; refused(() => parseReceiptRequest(wire(oversizedStructure)));
});

test('response rejects mismatched request/context, private fields and unsupported error reflection', () => {
  const req = validateReceiptRequest(request('status', { ledgerEpoch: epoch, correlationId: id }));
  const good = response({ handoff: handoff() }); assert.equal(parseReceiptResponse(wire(good),req).ok, true);
  const wrong = handoff(); wrong.correlationId = context;
  for (const sample of [ { ...good, requestId: receiptId }, { ...good, collectorContextId: epoch },
    response({ handoff: wrong }), response({ handoff: handoff(), capability: token }),
    { ...good, ok: true, error: 'receipt_id_unknown' }, { ...good, ok: false, error: 'receipt_id_unknown' } ]) refused(() => validateReceiptResponse(sample,req));
  const error = { ipcVersion:2,requestId,collectorContextId:collector,ok:false,error:'receipt_id_unknown' };
  assert.equal(parseReceiptResponse(wire(error),req).ok, false);
  refused(() => validateReceiptResponse({ ...error, error:'private_body_sentinel' },req));
  assert.equal(publicReceiptError(new Error(token)), 'receipt_collector_error');
});

test('mint authority is accepted only in its private response and receipt response cannot invent ACK', () => {
  const req = validateReceiptRequest(request('mint', {ledgerEpoch:epoch,correlationId:id,receiptContextId:context,producerProtocolVersion:1}));
  assert.equal(validateReceiptResponse(response({capability:token}),req).ok,true);
  const receiptRequest = validateReceiptRequest(request('receipt',{receipt:wire(receipt())}));
  const ack = response({status:'acknowledged',ledgerEpoch:epoch,correlationId:id,receiptId,handoff:handoff()});
  assert.equal(validateReceiptResponse(ack,receiptRequest).ok,true);
  refused(() => validateReceiptResponse(response({...ack.body,status:'awaiting_submission'}),receiptRequest));
  refused(() => validateReceiptResponse(response({...ack.body,receiptId:context}),receiptRequest));
  const pending = handoff(); pending.state='unknown'; pending.submission.status='unknown';pending.ack={status:'pending'};
  const staged = response({status:'awaiting_submission',ledgerEpoch:epoch,correlationId:id,receiptId,handoff:pending});
  assert.equal(validateReceiptResponse(staged,receiptRequest).ok,true);
});

test('producer challenge validates exact typed pair, nonce and stable version without performing execution', () => {
  assert.equal(validateProducerEvidence(producer()).artifactSha256,hash);
  const challenge = { producerProtocolVersion:1,challengeId:context,receiptSchemaVersion:2,receiptScope:'delegated_context' };
  const req = validateProducerProbeRequest(challenge), answer = {...challenge,implementation:'typescript',runtimeVersion:'0.6.0'};
  assert.equal(parseProducerProbeRequest(wire(challenge)).challengeId,context);
  assert.equal(parseProducerProbeResponse(wire(answer),req).runtimeVersion,'0.6.0');
  for (const patch of [{challengeId:receiptId},{receiptSchemaVersion:1},{receiptScope:'original_generation'},
    {implementation:'python'},{runtimeVersion:'0.6.0-extra'},{runtimeVersion:'00.6.0'},{capability:token}]) refused(()=>validateProducerProbeResponse({...answer,...patch},req));
  refused(()=>validateProducerEvidence({...producer(),artifactSha256:'not-a-digest'}));
  refused(()=>validateProducerProbeRequest({...challenge,command:'native-send'}));
});


test('fence and submission response handles preserve the original schema, context and fence generation', () => {
  const claudeFence = validateReceiptRequest(request('fence',{ledgerEpoch:epoch,correlationId:id,receiptContextId:context,binding:binding()}));
  assert.equal(validateReceiptResponse(response({handoff:handoff()}),claudeFence).ok,true);
  refused(()=>validateReceiptResponse(response({handoff:handoff(1)}),claudeFence));
  const changedContext = handoff();changedContext.receiptContext.id=receiptId;
  refused(()=>validateReceiptResponse(response({handoff:changedContext}),claudeFence));
  const claudeSubmission = validateReceiptRequest(request('submission',{ledgerEpoch:epoch,correlationId:id,receiptContextId:context,status:'submitted'}));
  assert.equal(validateReceiptResponse(response({handoff:handoff()}),claudeSubmission).ok,true);
  refused(()=>validateReceiptResponse(response({handoff:handoff(1)}),claudeSubmission));
  refused(()=>validateReceiptResponse(response({handoff:changedContext}),claudeSubmission));
  const codexFence = validateReceiptRequest(request('fence',{ledgerEpoch:epoch,correlationId:id,receiptContextId:null,binding:binding('codex')}));
  assert.equal(validateReceiptResponse(response({handoff:handoff(1)}),codexFence).ok,true);
  refused(()=>validateReceiptResponse(response({handoff:handoff()}),codexFence));
  const wrongGeneration=handoff(1);wrongGeneration.targetGeneration=context;
  refused(()=>validateReceiptResponse(response({handoff:wrongGeneration}),codexFence));
  const codexSubmission = validateReceiptRequest(request('submission',{ledgerEpoch:epoch,correlationId:id,receiptContextId:null,status:'submitted'}));
  assert.equal(validateReceiptResponse(response({handoff:handoff(1)}),codexSubmission).ok,true);
  refused(()=>validateReceiptResponse(response({handoff:handoff()}),codexSubmission));
  // Status/wait selectors do not contain a context; do not manufacture one.
  const selector=validateReceiptRequest(request('status',{ledgerEpoch:epoch,correlationId:id}));
  assert.equal(validateReceiptResponse(response({handoff:handoff()}),selector).ok,true);
  assert.equal(validateReceiptResponse(response({handoff:handoff(1)}),selector).ok,true);
});

test('private IPC2 requires the closed reference pair and rejects prototype IPC1 before allocation', () => {
  const body = {ledgerEpoch:epoch,correlationId:id,goal:'acknowledged',timeoutSeconds:6,clockReferenceMs:0,remainingMs:5900};
  assert.equal(validateReceiptRequest(request('wait-open',body)).ipcVersion,2);
  for (const ipcVersion of [1,3]) refused(() => validateReceiptRequest({...request('prepare',{}),ipcVersion}));
  for (const bad of [{...body,remainingMs:6001},{...body,remainingMs:0},{...body,remainingMs:1.5},
      {...body,clockReferenceMs:-1},{...body,clockReferenceMs:undefined},{...body,remainingMs:undefined}]) {
    refused(() => validateReceiptRequest(request('wait-open',bad)));
  }
  const hello = {receiptSchemas:[{agent:'claude',receiptSchemaVersion:2,receiptScope:'delegated_context'}],managedStoreVersion:2,endpointOwner:{uid:0,pid:123},clockReferenceMs:0};
  const req=validateReceiptRequest(request());
  assert.equal(validateReceiptResponse(response(hello),req).ok,true);
  for(const bad of [{...hello,clockReferenceMs:undefined},{...hello,clockReferenceMs:-1},{...hello,extra:1}])
    refused(()=>validateReceiptResponse(response(bad),req));
});
