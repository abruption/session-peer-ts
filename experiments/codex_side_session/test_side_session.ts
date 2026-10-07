import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { Rpc, Refused, Unknown, RpcRejected, loadedIds, send, ownedSocket } from './side_session.ts';

const ID = '00000000-0000-4000-8000-000000000001';
class Fake {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  ephemeral = true; status = 'idle'; direct: unknown = true; loaded = true; mismatch = false;
  fail: Error | undefined;
  async call(method: string, params: Record<string, unknown>) {
    this.calls.push({ method, params });
    if (method === 'thread/loaded/list') return { data: this.loaded ? [ID] : [], nextCursor: null };
    if (method === 'thread/read') return { thread: { id: this.mismatch ? 'other' : ID, ephemeral: this.ephemeral, status: { type: this.status }, canAcceptDirectInput: this.direct } };
    if (this.fail) throw this.fail;
    return { turn: { id: 'test-turn' } };
  }
}
test('explicit single-producer opt-in before any RPC', async () => {
  const f = new Fake(); await assert.rejects(send(f, ID, 'hello'), /exclusive/); assert.equal(f.calls.length, 0);
});
test('dry-run never starts a turn', async () => {
  const f = new Fake(); const r = await send(f, ID, 'hello', { exclusive: true, dryRun: true });
  assert.equal(r.status, 'validated'); assert.equal(r.submitted, false); assert.equal(f.calls.length, 2);
});
test('accepted remains distinct from ACK and no policy/fork/resume fields', async () => {
  const f = new Fake(); const r = await send(f, 'codex:' + ID, '한글 hello', { exclusive: true });
  assert.equal(r.submitted, true); assert.equal(r.consumptionConfirmed, false);
  assert.deepEqual(f.calls.map(c => c.method), ['thread/loaded/list', 'thread/read', 'turn/start']);
  assert.equal(f.calls[1]!.params.includeTurns, false);
  assert.deepEqual(Object.keys(f.calls[2]!.params).sort(), ['clientUserMessageId', 'input', 'threadId']);
});
for (const [name, mutate, reason] of [
  ['persistent parent', (f: Fake) => { f.ephemeral = false; }, 'ephemeral'],
  ['busy target', (f: Fake) => { f.status = 'active'; }, 'idle'],
  ['unloaded target', (f: Fake) => { f.loaded = false; }, 'not_loaded'],
  ['unknown direct-input capability', (f: Fake) => { f.direct = null; }, 'unverified'],
  ['wrong read target', (f: Fake) => { f.mismatch = true; }, 'mismatch'],
] as const) test(name + ' refused before input', async () => {
  const f = new Fake(); mutate(f);
  await assert.rejects(send(f, ID, 'hello', { exclusive: true }), new RegExp(reason));
  assert.ok(!f.calls.some(c => c.method === 'turn/start'));
});
test('loaded idle does NOT prove that the side UI is open', async () => {
  const f = new Fake();
  assert.equal((await send(f, ID, 'hello', { exclusive: true, dryRun: true })).status, 'validated');
  assert.equal(f.calls.length, 2); // Records the known limitation, not a lifetime guarantee.
});
for (const error of [new Refused('rpc_timeout'), new RpcRejected('turn/start', -32603), new Refused('invalid_rpc_response')]) {
  test(error.message + ' after start is unknown without retry', async () => {
    const f = new Fake(); f.fail = error;
    await assert.rejects(send(f, ID, 'hello', { exclusive: true }), Unknown);
    assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1);
  });
}
test('definite native rejection remains refused without retry', async () => {
  const f = new Fake(); f.fail = new RpcRejected('turn/start', -32600);
  await assert.rejects(send(f, ID, 'hello', { exclusive: true }), RpcRejected);
  assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1);
});
test('malformed start response is unknown', async () => {
  const f = new Fake(); const call = f.call.bind(f);
  f.call = async (m, p) => m === 'turn/start' ? { turn: { id: '' } } : call(m, p);
  await assert.rejects(send(f, ID, 'hello', { exclusive: true }), Unknown);
});
test('invalid message and ID refused', async () => {
  for (const text of ['', '  ', '\0', '가'.repeat(22000)]) await assert.rejects(send(new Fake(), ID, text, { exclusive: true }), Refused);
  await assert.rejects(send(new Fake(), 'bad', 'hello', { exclusive: true }), /uuid/);
});
test('cyclic pagination is bounded', async () => {
  let calls = 0;
  await assert.rejects(loadedIds({ async call() { calls++; return { data: [], nextCursor: 'cycle' }; } }), /cursor/);
  assert.equal(calls, 2);
});

async function server(action: (method: string, id: number, respond: (value: unknown) => void) => void, run: (path: string) => Promise<void>) {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'ws-')); chmodSync(root, 0o700);
  const path = join(root, 's');
  const http = createServer(); const wss = new WebSocketServer({ server: http });
  wss.on('connection', ws => ws.on('message', data => {
    const m = JSON.parse(data.toString());
    if (m.method === 'initialize') ws.send(JSON.stringify({ id: m.id, result: { userAgent: 'codex-tui/0.159.2 fixture' } }));
    else if (m.id !== undefined) action(m.method, m.id, value => ws.send(JSON.stringify(value)));
  }));
  try {
    http.listen(path); await once(http, 'listening'); await run(path);
  } finally {
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(done => wss.close(() => done()));
    await new Promise<void>(done => http.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  }
}
test('actual WebSocket-over-Unix handshake and owned rendezvous symlink', async () => {
  await server((m, id, done) => done({ id, result: { data: [], nextCursor: null } }), async path => {
    const link = join(path, '..', 'link'); symlinkSync(path, link); assert.equal(ownedSocket(link), path);
    const rpc = await Rpc.connect(link); try { assert.deepEqual(await loadedIds(rpc), []); } finally { rpc.close(); }
  });
});
test('transport timeout closes without replay', async () => {
  let calls = 0;
  await server(() => { calls++; }, async path => {
    const rpc = await Rpc.connect(path, 50);
    try { await assert.rejects(rpc.call('probe', {}), /timeout/); await assert.rejects(rpc.call('probe', {})); }
    finally { rpc.close(); }
  }); assert.equal(calls, 1);
});
test('unexpected server approval request is refused, never answered', async () => {
  let calls = 0;
  await server((m, id, done) => { calls++; done({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} }); }, async path => {
    const rpc = await Rpc.connect(path); try { await assert.rejects(rpc.call('probe', {}), Refused); } finally { rpc.close(); }
  }); assert.equal(calls, 1);
});
test('insecure socket directory refused before connecting', async () => {
  await server(() => {}, async path => {
    chmodSync(join(path, '..'), 0o755);
    await assert.rejects(Rpc.connect(path), /private_socket_directory/);
  });
});
