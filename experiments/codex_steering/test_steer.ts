import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { Rpc, RpcRejected, Refused, Unknown, steer, type Caller, type ObjectValue } from './steer.ts';

const THREAD = '00000000-0000-4000-8000-000000000001', TURN = 'fixture-turn';
function fixture(t: TestContext, cleanup = true) {
  const base = process.env.TASK_TEMP ?? tmpdir();
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = realpathSync(mkdtempSync(join(base, 'codex-ts-steer-')));
  chmodSync(root, 0o700);
  const home = join(root, 'home'); mkdirSync(home, { mode: 0o700 });
  if (cleanup) t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home };
}
class Fake implements Caller {
  info: ObjectValue;
  calls: { method: string; params: ObjectValue }[] = [];
  active = true; loaded = true; direct = true; flag: unknown = true;
  activeFlags: unknown = []; effectError?: Error; returnedTurn = TURN;
  constructor(home: string) { this.info = { codexHome: home }; }
  async call(method: string, params: ObjectValue): Promise<ObjectValue> {
    this.calls.push({ method, params });
    if (method === 'thread/loaded/list') return { data: this.loaded ? [THREAD] : [], nextCursor: null };
    if (method === 'thread/read') return { thread: { id: THREAD,
      status: { type: this.active ? 'active' : 'idle', activeFlags: this.activeFlags }, canAcceptDirectInput: this.direct } };
    if (method === 'experimentalFeature/list') return { data: [{ name: 'instant_interrupt', enabled: this.flag }], nextCursor: null };
    assert.equal(method, 'turn/steer');
    if (this.effectError) throw this.effectError;
    return { turnId: this.returnedTurn };
  }
}
const input = 'private fixture input';
function send(rpc: Caller, home: string, extra: Partial<Parameters<typeof steer>[4]> = {}) {
  return steer(rpc, THREAD, TURN, input, { expectedHome: home, optIn: true, ...extra });
}
const effects = (rpc: Fake) => rpc.calls.filter(c => c.method === 'turn/steer');

test('successful input targets the exact original turn once and is never an ACK', async t => {
  const { home } = fixture(t), rpc = new Fake(home), result = await send(rpc, home);
  assert.equal(result.status, 'accepted'); assert.equal(result.submitted, true);
  assert.equal(result.turnId, TURN); assert.equal(result.consumptionConfirmed, false);
  assert.equal(result.retryAllowed, false);
  assert.equal(effects(rpc).length, 1);
  const params = effects(rpc)[0]!.params;
  assert.equal(params.threadId, THREAD); assert.equal(params.expectedTurnId, TURN);
  assert.deepEqual(params.input, [{ type: 'text', text: input }]);
  for (const key of ['model', 'cwd', 'sandboxPolicy', 'approvalPolicy']) assert.equal(key in params, false);
  assert.equal(JSON.stringify(result).includes(input), false);
  await assert.rejects(send(rpc, home), Refused);
  assert.equal(effects(rpc).length, 1);
});

test('dry-run checks metadata but makes zero submissions and cannot prove the expected turn', async t => {
  const { home } = fixture(t), rpc = new Fake(home), result = await send(rpc, home, { dryRun: true });
  assert.equal(result.status, 'validated'); assert.equal(result.submitted, false);
  assert.equal(result.expectedTurnValidated, false); assert.equal(result.consumptionConfirmed, false);
  assert.equal(effects(rpc).length, 0);
  assert.deepEqual(rpc.calls.find(c => c.method === 'thread/read')?.params, { threadId: THREAD, includeTurns: false });
});

test('explicit opt-in, valid message, full thread and expected turn are required before effect', async t => {
  const { home } = fixture(t);
  for (const [target, turn, text, optIn] of [
    [THREAD, TURN, input, false], ['prefix', TURN, input, true],
    [THREAD, '', input, true], [THREAD, 'x'.repeat(129), input, true],
    [THREAD, TURN, '', true], [THREAD, TURN, '\0', true],
    [THREAD, TURN, 'é'.repeat(32769), true],
  ] as const) {
    const rpc = new Fake(home);
    await assert.rejects(steer(rpc, target, turn, text, { expectedHome: home, optIn }), Refused);
    assert.equal(effects(rpc).length, 0);
  }
});

test('home, loaded/active target and direct input are pre-effect guards', async t => {
  const { root, home } = fixture(t), other = join(root, 'other'); mkdirSync(other, { mode: 0o700 });
  for (const change of [
    (r: Fake) => { r.info.codexHome = other; }, (r: Fake) => { r.loaded = false; },
    (r: Fake) => { r.active = false; }, (r: Fake) => { r.direct = false; },
    (r: Fake) => { r.activeFlags = ['waitingOnApproval']; },
  ]) {
    const rpc = new Fake(home); change(rpc);
    await assert.rejects(send(rpc, home), Refused); assert.equal(effects(rpc).length, 0);
  }
});

test('instant feature is a boolean snapshot and required unsupported snapshots refuse', async t => {
  const { home } = fixture(t);
  for (const flag of [false, null, undefined, 'true', 1]) {
    const rpc = new Fake(home); rpc.flag = flag;
    const result = await send(rpc, home, { dryRun: true });
    assert.equal(result.instantInterruptEnabledSnapshot, flag === false ? false : null);
    await assert.rejects(send(rpc, home, { requireInstant: true }), Refused);
    assert.equal(effects(rpc).length, 0);
  }
});

test('native wrong-turn/method rejection is refused; other failures after attempt are unknown without fallback', async t => {
  const { home } = fixture(t);
  for (const [error, expected] of [
    [new RpcRejected('turn/steer', -32600), Refused], [new RpcRejected('turn/steer', -32601), Refused],
    [new RpcRejected('turn/steer', -32603), Unknown], [new Error('private provider detail'), Unknown],
    [new Refused('rpc_timeout'), Unknown],
  ] as const) {
    const rpc = new Fake(home); rpc.effectError = error;
    await assert.rejects(send(rpc, home), expected);
    await assert.rejects(send(rpc, home), Refused);
    assert.equal(effects(rpc).length, 1);
    assert.equal(rpc.calls.some(c => ['turn/start', 'turn/interrupt', 'thread/queue/add'].includes(c.method)), false);
  }
  const rpc = new Fake(home); rpc.returnedTurn = 'replaced-turn';
  await assert.rejects(send(rpc, home), Unknown); assert.equal(effects(rpc).length, 1);
});

test('a simultaneous operation cannot submit through the same caller', async t => {
  const { home } = fixture(t), rpc = new Fake(home), original = rpc.call.bind(rpc);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  rpc.call = async (method, params) => { if (method === 'thread/loaded/list') { entered(); await gate; } return original(method, params); };
  const first = send(rpc, home); await started;
  try { await assert.rejects(send(rpc, home), Refused); } finally { release(); }
  await first; assert.equal(effects(rpc).length, 1);
});

type Handler = (request: ObjectValue, ws: WebSocket, base: ObjectValue) => void;
async function owner(t: TestContext, change?: Handler) {
  const f = fixture(t, false), socket = join(f.root, 'owner.sock');
  const http = createServer(), wss = new WebSocketServer({ server: http, perMessageDeflate: false });
  const requests: ObjectValue[] = [], sockets = new Set<WebSocket>();
  wss.on('connection', ws => {
    sockets.add(ws); ws.on('close', () => sockets.delete(ws));
    ws.on('message', async bytes => {
      const request = JSON.parse(bytes.toString()) as ObjectValue;
      requests.push(request); if (!('id' in request)) return;
      const model = new Fake(f.home);
      const result = request.method === 'initialize'
        ? { userAgent: 'codex-tui/0.159.2 fixture', codexHome: f.home }
        : await model.call(request.method as string, request.params as ObjectValue);
      const base = { id: request.id, result };
      if (change) change(request, ws, base); else ws.send(JSON.stringify(base));
    });
  });
  // Register before listening so a failed setup also cleans its own resources.
  t.after(async () => {
    try {
      for (const ws of sockets) ws.terminate();
      await new Promise<void>(done => wss.close(() => done()));
      if (http.listening) await new Promise<void>((done, reject) => http.close(error => error ? reject(error) : done()));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  await new Promise<void>((done, reject) => { http.once('error', reject); http.listen(socket, done); });
  chmodSync(socket, 0o600);
  return { ...f, socket, requests };
}

test('real Unix WebSocket transport sends one exact steering request and refuses unsafe methods', async t => {
  const f = await owner(t), rpc = await Rpc.connect(f.socket, 1000); t.after(() => rpc.close());
  try {
    await assert.rejects(rpc.call('turn/start', {}), Refused);
    const result = await send(rpc, f.home);
    assert.equal(result.submitted, true); assert.equal(result.consumptionConfirmed, false);
    const effect = f.requests.filter(r => r.method === 'turn/steer'); assert.equal(effect.length, 1);
    assert.equal((effect[0]!.params as ObjectValue).expectedTurnId, TURN);
    assert.equal(f.requests.some(r => r.method === 'turn/start'), false);
  } finally { rpc.close(); }
});

test('private owned socket checks refuse permissive directories/socket and symlink entries', async t => {
  const f = await owner(t);
  chmodSync(f.socket, 0o666); await assert.rejects(Rpc.connect(f.socket, 1000), Refused);
  chmodSync(f.socket, 0o600); chmodSync(f.root, 0o755); await assert.rejects(Rpc.connect(f.socket, 1000), Refused);
  chmodSync(f.root, 0o700); const alias = join(f.root, 'alias.sock'); symlinkSync(f.socket, alias);
  await assert.rejects(Rpc.connect(alias, 1000), Refused);
});

test('wrong server version fails during initialization with zero steering', async t => {
  const f = await owner(t, (request, ws, base) => {
    if (request.method === 'initialize') base.result = { userAgent: 'codex-tui/0.999.0 fixture', codexHome: 'private-home' };
    ws.send(JSON.stringify(base));
  });
  await assert.rejects(Rpc.connect(f.socket, 1000), Refused);
  assert.equal(f.requests.filter(r => r.method === 'turn/steer').length, 0);
});

test('wire schema failure, binary/invalid UTF8, response loss and server interaction after attempt stay unknown', async t => {
  const changes: Handler[] = [
    (r, ws, base) => ws.send(JSON.stringify({ ...base, error: { code: '-32600', message: 'private' } })),
    (r, ws, base) => ws.send(JSON.stringify({ ...base, error: { code: -32600 }, result: base.result })),
    (r, ws) => ws.send(Buffer.from([0xc3, 0x28]), { binary: false }),
    (r, ws) => ws.send(Buffer.from('binary fixture')),
    (r, ws) => ws.send(JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval', params: {} })),
    (r, ws) => ws.terminate(),
    (r, ws) => ws.send(JSON.stringify({ id: r.id, result: { turnId: 'wrong-turn' } })),
  ];
  for (let i = 0; i < changes.length; i++) await t.test('case ' + i, async st => {
    const f = await owner(st, (r, ws, base) => r.method === 'turn/steer' ? changes[i]!(r, ws, base) : ws.send(JSON.stringify(base)));
    const rpc = await Rpc.connect(f.socket, 1000);
    try { await assert.rejects(send(rpc, f.home), Unknown); }
    finally { rpc.close(); }
    assert.equal(f.requests.filter(r => r.method === 'turn/steer').length, 1);
    assert.equal(f.requests.some(r => ['turn/start', 'turn/interrupt', 'thread/queue/add'].includes(r.method as string)), false);
  });
});

test('total deadline expires on unanswered initialization and cleans the connection', async t => {
  const f = await owner(t, () => {}), start = performance.now();
  await assert.rejects(Rpc.connect(f.socket, 100), Refused);
  assert.ok(performance.now() - start < 2000);
  assert.equal(f.requests.filter(r => r.method === 'turn/steer').length, 0);
});

test('a cyclic inventory cursor refuses before steering', async t => {
  const { home } = fixture(t), rpc = new Fake(home);
  rpc.call = async (method, params) => {
    rpc.calls.push({ method, params });
    assert.equal(method, 'thread/loaded/list');
    return { data: [THREAD], nextCursor: 'same-cursor' };
  };
  await assert.rejects(send(rpc, home), /invalid_cursor/);
  assert.equal(rpc.calls.length, 2); assert.equal(effects(rpc).length, 0);
});

test('post-attempt deadline expires without a second submission', async t => {
  const f = await owner(t, (r, ws, base) => {
    if (r.method !== 'turn/steer') ws.send(JSON.stringify(base));
  });
  const start = performance.now(), rpc = await Rpc.connect(f.socket, 200);
  try {
    await assert.rejects(send(rpc, f.home), Unknown);
    await assert.rejects(send(rpc, f.home), Refused);
  } finally { rpc.close(); }
  assert.ok(performance.now() - start < 2000);
  assert.equal(f.requests.filter(r => r.method === 'turn/steer').length, 1);
});

test('notification flood and oversized frame fail closed before submission', async t => {
  for (const mode of ['notifications', 'oversize']) await t.test(mode, async st => {
    const f = await owner(st, (_r, ws) => {
      if (mode === 'oversize') ws.send(' '.repeat(1_048_577));
      else for (let i = 0; i < 101; i++) ws.send(JSON.stringify({ method: 'fixture/event', params: {} }));
    });
    await assert.rejects(Rpc.connect(f.socket, 1000), Refused);
    assert.equal(f.requests.filter(r => r.method === 'turn/steer').length, 0);
  });
});
