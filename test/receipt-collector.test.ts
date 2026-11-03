// Real owner-private fixture sockets only; no agent, transcript, model or SSH.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ReceiptState } from '../dist/receipt-state.js';
import { receiptExchange, startReceiptCollector } from '../dist/receipt-collector.js';
import type { ReceiptRequestBody, ReceiptOperation, ReceiptResponse } from '../dist/receipt-protocol.js';

const posix = { skip: process.platform === 'win32' };
const binding = () => ({ agent: 'claude' as const, destination: 'fixture-local', target: '123', generation: null,
  registryDirectory: '/fixture/sessions', registryRecordPath: '/fixture/sessions/123.json',
  registryIdentity: 'a'.repeat(64), socketPath: '/fixture/inbox.sock', routeIdentity: 'b'.repeat(64),
  payloadDigest: createHash('sha256').update('original fixture').digest('hex') });
const producer = () => ({ protocolVersion: 1 as const, artifactSha256: 'c'.repeat(64), challengeId: randomUUID(),
  receiptSchemaVersion: 2 as const, receiptScope: 'delegated_context' as const });
function body(result: ReceiptResponse): Record<string, any> {
  assert.equal(result.ok, true, result.ok ? undefined : result.error); return (result as any).body;
}
async function fixture(t: TestContext, expectedCleanup = 'confirmed') {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-ipc-'))); fs.chmodSync(root, 0o700);
  const state = join(root, 'state'), socket = join(state, 's');
  ReceiptState.initialize(state, socket);
  const collector = await startReceiptCollector(state, socket);
  t.after(async () => { const stopped = await collector.close(); assert.equal(stopped.cleanup, expectedCleanup); fs.rmSync(root, { recursive: true, force: true }); });
  const rpc = <K extends ReceiptOperation>(op: K, value: ReceiptRequestBody[K]) => receiptExchange(socket, op === 'hello' ? null : collector.contextId, op, value);
  return { root, state, socket, collector, rpc };
}
test('private one-shot IPC binds contexts and accepts only an explicit correlated receipt', posix, async t => {
  const f = await fixture(t), hello = body(await f.rpc('hello', {}));
  assert.equal(hello.managedStoreVersion, 2); assert.equal(hello.receiptSchemas.length, 2);
  const before = fs.readFileSync(join(f.state, 'ledger.json'));
  await f.rpc('hello', {}); assert.deepEqual(fs.readFileSync(join(f.state, 'ledger.json')), before);
  const prepared = body(await f.rpc('prepare', { binding: binding(), receiptSchemaVersion: 2, receiptScope: 'delegated_context', producerEvidence: producer() }));
  const handle = { ledgerEpoch: prepared.ledgerEpoch, correlationId: prepared.correlationId, receiptContextId: prepared.receiptContextId };
  const minted = body(await f.rpc('mint', { ...handle, producerProtocolVersion: 1 }));
  const wait = body(await f.rpc('wait-open', { ledgerEpoch: handle.ledgerEpoch, correlationId: handle.correlationId, goal: 'acknowledged', timeoutSeconds: 30, clockReferenceMs: hello.clockReferenceMs, remainingMs: 30000 }));
  assert.equal(wait.handoff.wait.status, 'pending');
  await f.rpc('fence', { ...handle, binding: binding() });
  const receipt = JSON.stringify({ schemaVersion: 2, kind: 'receipt', receiptScope: 'delegated_context', ...handle, receiptId: randomUUID(), capability: minted.capability });
  const early = body(await f.rpc('receipt', { receipt })); assert.equal(early.status, 'awaiting_submission');
  const submitted = body(await f.rpc('submission', { ...handle, status: 'submitted' }));
  assert.equal(submitted.handoff.ack.status, 'acknowledged'); assert.equal(submitted.handoff.targetGeneration, null);
  const duplicate = body(await f.rpc('receipt', { receipt })); assert.equal(duplicate.status, 'acknowledged');
  assert.equal(JSON.stringify(duplicate).includes(minted.capability), false);
  assert.equal(fs.readFileSync(join(f.state, 'ledger.json'), 'utf8').includes(minted.capability), false);
  assert.equal(fs.readFileSync(join(f.state, 'ledger.json'), 'utf8').includes(binding().payloadDigest), false);
});
test('delayed trailing pollution and malformed frames never authorize a transition', posix, async t => {
  const f = await fixture(t), before = fs.readFileSync(join(f.state, 'ledger.json'));
  const client = createConnection(f.socket); client.on('error', () => {}); await once(client, 'connect');
  client.write(JSON.stringify({ ipcVersion: 2, requestId: randomUUID(), collectorContextId: f.collector.contextId,
    op: 'prepare', body: { binding: binding(), receiptSchemaVersion: 2, receiptScope: 'delegated_context', producerEvidence: producer() } }) + '\n');
  await new Promise<void>(ok => setImmediate(ok));
  assert.deepEqual(fs.readFileSync(join(f.state, 'ledger.json')), before, 'LF without EOF must not commit a request');
  client.end('not-another-frame'); await once(client, 'close');
  assert.deepEqual(fs.readFileSync(join(f.state, 'ledger.json')), before);
});
test('unknown contexts refuse without mutating history or discovering a replacement collector', posix, async t => {
  const f = await fixture(t), before = fs.readFileSync(join(f.state, 'ledger.json'));
  await assert.rejects(receiptExchange(f.socket, randomUUID(), 'revoke', { ledgerEpoch: f.collector.ledgerEpoch, correlationId: randomUUID() }));
  assert.deepEqual(fs.readFileSync(join(f.state, 'ledger.json')), before);
});
test('unsafe endpoint permissions refuse before a request can reach the collector', posix, async t => {
  const f = await fixture(t, 'unconfirmed'), before = fs.readFileSync(join(f.state, 'ledger.json'));
  fs.chmodSync(f.socket, 0o666);
  try { await assert.rejects(f.rpc('hello', {})); }
  finally { fs.chmodSync(f.socket, 0o600); }
  assert.deepEqual(fs.readFileSync(join(f.state, 'ledger.json')), before);
  // A mode change invalidates the original listener evidence even after restore.
  // The cleanup guard includes ctime and conservatively refuses it; use an
  // isolated child for replacement/unknown-cleanup tests instead of weakening it.
});
test('a second collector cannot steal the original store or endpoint', posix, async t => {
  const f = await fixture(t);
  await assert.rejects(startReceiptCollector(f.state, f.socket));
  assert.equal(body(await f.rpc('hello', {})).endpointOwner.pid, process.pid);
});
test('unconfirmed listener cleanup preserves an unrelated replacement file', posix, t => {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-close-'))); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const module = pathToFileURL(resolve('dist/receipt-collector.js')).href, state = pathToFileURL(resolve('dist/receipt-state.js')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import {ReceiptState} from ${JSON.stringify(state)};
    import {startReceiptCollector} from ${JSON.stringify(module)};
    const dir=${JSON.stringify(root)}, path=dir+'/s'; ReceiptState.initialize(dir,path);
    const collector=await startReceiptCollector(dir,path);
    fs.unlinkSync(path);fs.writeFileSync(path,'unrelated replacement',{mode:0o600});
    const result=await collector.close();console.log(JSON.stringify(result));process.exit(0);
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { cleanup: 'unconfirmed' });
  assert.equal(fs.readFileSync(join(root, 's'), 'utf8'), 'unrelated replacement');
});
