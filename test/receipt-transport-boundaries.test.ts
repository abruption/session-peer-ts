// Adversarial owner-private transport fixtures only. No agent, model, transcript,
// SSH, real profile or arbitrary-PID cleanup. Replaced listeners run in children.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net, { createConnection, createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ReceiptState } from '../dist/receipt-state.js';
import { receiptExchange, startReceiptCollector } from '../dist/receipt-collector.js';
import { RECEIPT_LIMITS, RECEIPT_PAIRS } from '../dist/receipt-protocol.js';

const posix = { skip: process.platform === 'win32' };
const tick = () => new Promise<void>(ok => setImmediate(ok));
const wire = (value: unknown) => JSON.stringify(value) + '\n';
function prepare(context: string) {
  return { ipcVersion: 2, requestId: randomUUID(), collectorContextId: context, op: 'prepare', body: {
    binding: { agent: 'claude', destination: 'fixture-local', target: '123', generation: null,
      registryDirectory: '/fixture/transport/sessions', registryRecordPath: '/fixture/transport/sessions/123.json',
      registryIdentity: 'a'.repeat(64), socketPath: '/fixture/transport/inbox.sock', routeIdentity: 'b'.repeat(64),
      payloadDigest: createHash('sha256').update('PRIVATE_BOUNDARY_BODY').digest('hex') },
    receiptSchemaVersion: 2, receiptScope: 'delegated_context', producerEvidence: {
      protocolVersion: 1, artifactSha256: 'c'.repeat(64), challengeId: randomUUID(),
      receiptSchemaVersion: 2, receiptScope: 'delegated_context' }
  } };
}
async function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-boundary-'))); fs.chmodSync(root, 0o700);
  const state = join(root, 'state'), path = join(state, 's'); ReceiptState.initialize(state, path);
  const collector = await startReceiptCollector(state, path);
  t.after(async () => { assert.equal((await collector.close()).cleanup, 'confirmed'); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, state, path, collector, history: () => fs.readFileSync(join(state, 'ledger.json')) };
}
function connected(path: string): Promise<Socket> {
  return new Promise((ok, reject) => {
    const socket = createConnection(path); socket.on('error', () => {});
    socket.once('connect', () => ok(socket)); socket.once('error', reject);
  });
}
// The hard bound is a test failure, never a successful forced EOF.
function collected(socket: Socket, timeoutMs = 7000): Promise<Buffer> {
  return new Promise((ok, reject) => {
    const chunks: Buffer[] = []; let length = 0;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('fixture transport did not close within its bound')); }, timeoutMs);
    socket.on('data', (data: Buffer) => {
      length += data.length;
      if (length > RECEIPT_LIMITS.frame * 2) { clearTimeout(timer); socket.destroy(); reject(new Error('fixture received excess transport output')); return; }
      chunks.push(data);
    });
    socket.once('close', () => { clearTimeout(timer); ok(Buffer.concat(chunks)); });
  });
}
async function raw(path: string, value: string | Uint8Array): Promise<Buffer> {
  const socket = await connected(path), result = collected(socket); socket.end(value); return result;
}
async function fakeOwner(t: TestContext, reply: (socket: Socket, request: any) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-fake-owner-'))); fs.chmodSync(root, 0o700);
  const path = join(root, 's'), connections = new Set<Socket>(); let calls = 0;
  const server = createServer({ allowHalfOpen: true }, socket => {
    connections.add(socket); socket.on('error', () => {}); socket.once('close', () => connections.delete(socket));
    const input: Buffer[] = []; socket.on('data', chunk => input.push(chunk));
    socket.once('end', () => { calls++; reply(socket, JSON.parse(Buffer.concat(input).toString('utf8'))); });
  });
  server.listen(path); await once(server, 'listening'); fs.chmodSync(path, 0o600);
  t.after(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise<void>(ok => server.close(() => ok())); fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, path, calls: () => calls };
}
function helloResponse(request: { requestId: string }, context = randomUUID()) {
  return { ipcVersion: 2, requestId: request.requestId, collectorContextId: context, ok: true,
    body: { receiptSchemas: RECEIPT_PAIRS, managedStoreVersion: 2, clockReferenceMs: 0, endpointOwner: { uid: process.getuid!(), pid: process.pid } } };
}

// No timer or admission guard is mocked: the first sixteen real sockets occupy
// the service while the seventeenth attempts a mutating, otherwise valid frame.
test('connection admission refuses the seventeenth request without reserving an intent', posix, async t => {
  const f = await fixture(t), before = f.history();
  const occupied = await Promise.all(Array.from({ length: RECEIPT_LIMITS.connections }, () => connected(f.path)));
  try {
    for (const socket of occupied) socket.write('{');
    await tick(); await tick();
    const reply = await raw(f.path, wire(prepare(f.collector.contextId)));
    assert.equal(reply.length, 0); assert.deepEqual(f.history(), before);
  } finally {
    const closed = occupied.map(socket => new Promise<void>(ok => { if (socket.closed) ok(); else socket.once('close', () => ok()); }));
    for (const socket of occupied) socket.destroy(); await Promise.all(closed); await tick(); await tick();
  }
  const healthy = await receiptExchange(f.path, null, 'hello', {});
  assert.equal(healthy.ok, true, 'admission release must not leak active-connection slots');
  assert.deepEqual(f.history(), before);
});

test('oversized and invalid UTF-8 request frames close without actor effects or reflection', posix, async t => {
  const f = await fixture(t), before = f.history(), secret = 'PRIVATE_FRAME_SENTINEL';
  const valid = wire(prepare(f.collector.contextId));
  const oversized = valid + secret + 'x'.repeat(RECEIPT_LIMITS.frame);
  for (const bytes of [Buffer.from(oversized), Buffer.from([123,255,125,10])]) {
    assert.equal((await raw(f.path, bytes)).length, 0); assert.deepEqual(f.history(), before);
  }
  assert.equal((await receiptExchange(f.path, null, 'hello', {})).ok, true);
  const atBoundary = JSON.stringify(prepare(f.collector.contextId));
  const padded = atBoundary + ' '.repeat(RECEIPT_LIMITS.frame - Buffer.byteLength(atBoundary) - 1) + '\n';
  assert.equal(Buffer.byteLength(padded), RECEIPT_LIMITS.frame);
  const accepted = JSON.parse((await raw(f.path, padded)).toString('utf8'));
  assert.equal(accepted.ok, true); assert.equal(accepted.body.handoff.state, 'validated');
  assert.notDeepEqual(f.history(), before, 'the exact limit is admitted; only overflow is refused');
});

test('a complete JSON line without EOF expires at the read budget without mutation', { ...posix, timeout: 10000 }, async t => {
  const f = await fixture(t), before = f.history(), socket = await connected(f.path);
  const outcome = collected(socket), started = performance.now();
  socket.write(wire(prepare(f.collector.contextId))); // Deliberately never half-close.
  const reply = await outcome;
  assert.equal(reply.length, 0); assert.deepEqual(f.history(), before);
  assert.ok(performance.now() - started >= RECEIPT_LIMITS.readMs - 100, 'fixture must exercise the read deadline rather than immediate malformed input');
});

test('observed first request data cannot commit before delayed trailing pollution arrives', posix, async t => {
  const original = net.createServer; let observe!: () => void;
  const observed = new Promise<void>(ok => { observe = ok; }); let first = false;
  t.mock.method(net, 'createServer', ((...args: any[]) => {
    const listener = args.pop();
    return (original as any)(...args, (socket: Socket) => {
      listener(socket);
      // Registered after the real handler, so this observes its completed data
      // callback. This spy changes no framing, clock, buffer or admission rule.
      socket.on('data', () => { if (!first) { first = true; queueMicrotask(observe); } });
    });
  }) as typeof net.createServer); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const f = await fixture(t), before = f.history(), socket = await connected(f.path), result = collected(socket);
  socket.write(wire(prepare(f.collector.contextId))); await observed;
  assert.deepEqual(f.history(), before, 'the real server processed the first LF chunk and still must not dispatch');
  socket.end('PRIVATE_TRAILING_POLLUTION');
  assert.equal((await result).length, 0); assert.deepEqual(f.history(), before);
});

test('wrong collector context returns a fixed error without reflecting binding or changing history', posix, async t => {
  const f = await fixture(t), before = f.history(), request = prepare(randomUUID());
  const result = JSON.parse((await raw(f.path, wire(request))).toString('utf8'));
  assert.equal(result.ok, false); assert.equal(result.error, 'receipt_context_mismatch');
  assert.deepEqual(Object.keys(result).sort(), ['ipcVersion','requestId','collectorContextId','ok','error'].sort());
  assert.equal(JSON.stringify(result).includes(request.body.binding.payloadDigest), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_BOUNDARY_BODY'), false);
  assert.deepEqual(f.history(), before);
});

test('oversized owner response is post-attempt unknown and never retried or reflected', posix, async t => {
  const owner = await fakeOwner(t, (socket, request) => {
    socket.end(wire(helloResponse(request)) + 'PRIVATE_RESPONSE_SENTINEL' + 'x'.repeat(RECEIPT_LIMITS.frame));
  });
  await assert.rejects(receiptExchange(owner.path, null, 'hello', {}), (error: any) => {
    assert.equal(error.code, 'receipt_transport_unknown'); assert.equal(String(error).includes('PRIVATE_RESPONSE_SENTINEL'), false); return true;
  });
  assert.equal(owner.calls(), 1);
});

test('the client waits for owner EOF and rejects delayed response pollution', posix, async t => {
  const original = net.createConnection; let observe!: () => void;
  const observed = new Promise<void>(ok => { observe = ok; }); let first = false;
  t.mock.method(net, 'createConnection', ((...args: any[]) => {
    const socket = (original as any)(...args) as Socket;
    socket.on('data', () => { if (!first) { first = true; queueMicrotask(observe); } }); return socket;
  }) as typeof net.createConnection); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  let release!: () => void; const trailing = new Promise<void>(ok => { release = ok; });
  const owner = await fakeOwner(t, (socket, request) => {
    socket.write(wire(helloResponse(request)));
    void trailing.then(() => { if (!socket.destroyed) socket.end('PRIVATE_RESPONSE_POLLUTION'); });
  });
  let settled = false;
  const result = receiptExchange(owner.path, null, 'hello', {}).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await observed; await tick();
    assert.equal(settled, false, 'a valid response prefix is not a completed one-frame response');
  } finally { release(); }
  const done = await result;
  assert.ok('error' in done); assert.equal((done as any).error.code, 'receipt_transport_unknown'); assert.equal(owner.calls(), 1);
});

test('truncated owner response remains unknown after the private request was submitted', posix, async t => {
  const owner = await fakeOwner(t, socket => socket.end('{"ipcVersion":2'));
  await assert.rejects(receiptExchange(owner.path, null, 'hello', {}), (error: any) => error.code === 'receipt_transport_unknown');
  assert.equal(owner.calls(), 1);
});

// A child confines orphaned listener handles. It exits without server.close(),
// which would unlink an unrelated replacement pathname in Node's implementation.
test('endpoint replacement before dispatch preserves the foreign file and refuses actor effects', posix, t => {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-boundary-child-'))); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const collectorModule = pathToFileURL(resolve('dist/receipt-collector.js')).href;
  const stateModule = pathToFileURL(resolve('dist/receipt-state.js')).href;
  const script = join(root, 'child.mjs'), state = join(root, 'state'), socket = join(state, 's');
  fs.writeFileSync(script, `
    import fs from 'node:fs'; import {createConnection} from 'node:net'; import {once} from 'node:events';
    import {ReceiptState} from ${JSON.stringify(stateModule)};
    import {startReceiptCollector} from ${JSON.stringify(collectorModule)};
    const state=${JSON.stringify(state)}, path=${JSON.stringify(socket)};
    ReceiptState.initialize(state,path); const collector=await startReceiptCollector(state,path);
    const before=fs.readFileSync(state+'/ledger.json');
    const client=createConnection(path); client.on('error',()=>{}); await once(client,'connect');
    const chunks=[];client.on('data',data=>chunks.push(data));
    const closed=once(client,'close');
    fs.unlinkSync(path);fs.writeFileSync(path,'foreign fixture replacement',{mode:0o600});
    const identity=fs.lstatSync(path,{bigint:true}).ino;
    const request=${JSON.stringify(prepare('CONTEXT_PLACEHOLDER'))}; request.collectorContextId=collector.contextId;
    client.end(JSON.stringify(request)+'\\n'); await closed;
    const response=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const cleanup=await collector.close();
    const result={cleanup:cleanup.cleanup,error:response.error,sameHistory:before.equals(fs.readFileSync(state+'/ledger.json')),
      preserved:fs.readFileSync(path,'utf8')==='foreign fixture replacement'&&fs.lstatSync(path,{bigint:true}).ino===identity};
    process.stdout.write(JSON.stringify(result)+'\\n',()=>process.exit(0));
  `, { mode: 0o600 });
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { cleanup: 'unconfirmed', error: 'receipt_endpoint_untrusted', sameHistory: true, preserved: true });
  assert.equal(fs.readFileSync(socket, 'utf8'), 'foreign fixture replacement');
});
