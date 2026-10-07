// Hermetic transport fixtures only. No Codex process, user home, native queue,
// thread start/resume, real owner endpoint, transcript or account is accessed.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { APP_SERVER_EVIDENCE, APP_SERVER_LIMITS, AppServerFault, BoundedAppServerClient,
  appServerCapability, connectAppServer, parseMetadataEvent, spawnOwnedMetadataFixture, nativeQueueCapability,
  nativeQueueOnce, NATIVE_QUEUE_NOTIFICATION_OPTOUTS,
  type AppServerScope, type MetadataOnlyTransport } from '../dist/app-server.js';

const scope: AppServerScope = { codexHome: join(tmpdir(), 'fixture-home'), threadId: 'fixture-thread', generation: 'fixture-generation', ownerIdentity: 'fixture-owner' };
const id = 'fixture-client-id';
function fixture(t: TestContext, onRequest?: (request: any, reply: (value: unknown) => void) => void) {
  const input = new PassThrough(), requests: any[] = []; let closes = 0;
  const reply = (value: unknown) => { if (!input.destroyed) input.write(JSON.stringify(value) + '\n'); };
  const output = new Writable({ write(chunk, _encoding, callback) {
    const request = JSON.parse(chunk.toString()); requests.push(request);
    callback();
    if (onRequest) onRequest(request, reply);
    else if (request.method.endsWith('/initialize')) reply({ id: request.id, result: { scope, metadataOnly: true } });
    else reply({ id: request.id, result: { scope, queueId: 'fixture-queue-id', clientUserMessageId: request.params.clientUserMessageId } });
  } });
  const transport: MetadataOnlyTransport = { qualification: 'hermetic_fixture_only', input, output,
    close: async () => { closes++; input.destroy(); output.destroy(); } };
  const clients: BoundedAppServerClient[] = [];
  t.after(async () => { for (const client of clients) await client.close(); input.destroy(); output.destroy(); });
  async function connect(timeout = 1000, owner: (value: AppServerScope) => Promise<boolean> = async () => true) {
    const client = await BoundedAppServerClient.connectMetadataFixture(scope, transport, performance.now() + timeout, owner);
    clients.push(client); return client;
  }
  const event = (params: unknown) => reply({ method: 'session-peer/metadata/event', params });
  return { transport, input, output, requests, reply, event, connect, closes: () => closes };
}
const injected = (changes: object = {}) => ({ kind: 'injected', scope, clientUserMessageId: id, itemId: 'fixture-item', turnId: 'fixture-turn', ...changes });
function fault(code: string, attempted: boolean) {
  return (error: unknown) => {
    assert.ok(error instanceof AppServerFault); assert.equal(error.code, code); assert.equal(error.attempted, attempted);
    assert.equal(error.fallbackEligible, !attempted && ['unsupported_transport', 'unsupported_version'].includes(code)); return true;
  };
}

test('production metadata observer remains unsupported without opening any endpoint', async () => {
  const context = { version: '0.160.1', platform: 'darwin-arm64', scope };
  assert.deepEqual(appServerCapability(context), { supported: false, schema: 'version_qualified', route: 'route_unsupported', reason: 'metadata_only_owner_route_unvalidated', attempted: false, queueSupported: true });
  let opens = 0;
  const result = await connectAppServer(context, async () => { opens++; throw new Error('must not open'); }, performance.now() + 1000);
  assert.equal(result.supported, false); assert.equal(opens, 0);
  for (const patch of [{ version: '0.160.2' }, { platform: 'linux-x64' }, { platform: 'win32-x64' }]) {
    assert.equal(appServerCapability({ ...context, ...patch }).schema, 'version_unqualified');
  }
});

test('native queue capability qualifies exact mechanics only, never live delivery or observation', () => {
  assert.deepEqual(nativeQueueCapability({ version: '0.160.1', platform: 'darwin-arm64', scope }), {
    queueSupported: true, observationSupported: false, qualification: 'mechanics_from_isolated_fixture', reason: 'queue_only',
  });
  for (const patch of [{ version: '0.160.2' }, { platform: 'linux-x64' }, { platform: 'win32-x64' }]) {
    assert.equal(nativeQueueCapability({ version: '0.160.1', platform: 'darwin-arm64', scope, ...patch }).queueSupported, false);
  }
});

test('generated schema evidence explicitly records body-bearing APIs as unsupported', () => {
  const evidence = JSON.parse(readFileSync(new URL('./fixtures/app-server-schema-evidence.json', import.meta.url), 'utf8'));
  assert.equal(evidence.version, APP_SERVER_EVIDENCE.version); assert.equal(evidence.qualification, 'generated_schema_only');
  assert.equal(evidence.methods.queueAdd.responseSha256, APP_SERVER_EVIDENCE.queueAddResponseSha256);
  assert.deepEqual(evidence.methods.queueAdd.bodyPath, ['queuedSubmission', 'input']);
  assert.deepEqual(evidence.methods.itemStarted.bodyPath, ['item', 'content']);
  assert.deepEqual(evidence.methods.turnCompleted.bodyPath, ['turn', 'items']);
  assert.equal(evidence.productionRouteQualified, false); assert.equal(evidence.liveExperimentPerformed, false);
});

test('fixture initializes an immutable original scope and writes own input only once', async t => {
  const f = fixture(t), client = await f.connect();
  assert.ok(Object.isFrozen(client.scope));
  const queued = await client.queueOnce({ clientUserMessageId: id, message: 'PRIVATE-OWN-INPUT' });
  assert.deepEqual(queued, { queueId: 'fixture-queue-id', clientUserMessageId: id });
  assert.equal(JSON.stringify(queued).includes('PRIVATE-OWN-INPUT'), false);
  assert.deepEqual(f.requests.map(r => r.method), ['session-peer/metadata/initialize', 'session-peer/metadata/queue']);
  assert.equal(f.requests[1].params.input[0].text, 'PRIVATE-OWN-INPUT');
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'again' }), fault('already_attempted', true));
  assert.equal(f.requests.length, 2); await client.close(); await client.close(); assert.equal(f.closes(), 1);
});

test('concurrent queue calls cannot issue a second effect', async t => {
  const f = fixture(t), client = await f.connect();
  const results = await Promise.allSettled([client.queueOnce({ clientUserMessageId: id, message: 'one' }), client.queueOnce({ clientUserMessageId: 'other', message: 'two' })]);
  assert.equal(results[0]!.status, 'fulfilled'); assert.equal(results[1]!.status, 'rejected');
  assert.equal(f.requests.filter(r => r.method.endsWith('/queue')).length, 1);
});

test('owner revalidation fails before effect and closes the connection', async t => {
  const f = fixture(t); let checks = 0;
  const client = await f.connect(1000, async original => { assert.deepEqual(original, scope); return ++checks === 1; });
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'never sent' }), fault('owner_changed', false));
  assert.equal(f.requests.length, 1); assert.equal(f.closes(), 1);
});

test('a stalled owner check shares the original deadline and is disposed', async t => {
  const f = fixture(t);
  await assert.rejects(f.connect(35, () => new Promise(() => {})), fault('deadline', false));
  assert.equal(f.requests.length, 0); assert.equal(f.closes(), 1);
});

test('lost queue response is attempted/unknown and never authorizes fallback', async t => {
  const f = fixture(t, (r, reply) => { if (r.method.endsWith('/initialize')) reply({ id: r.id, result: { scope, metadataOnly: true } }); });
  const client = await f.connect(60);
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'one' }), fault('deadline', true));
  assert.equal(f.requests.length, 2); assert.equal(f.closes(), 1);
});

test('response errors never return native error/body details after an attempt', async t => {
  const f = fixture(t, (r, reply) => {
    if (r.method.endsWith('/initialize')) reply({ id: r.id, result: { scope, metadataOnly: true } });
    else reply({ id: r.id, error: { code: 'failed', message: 'PRIVATE-NATIVE-ERROR' } });
  });
  const client = await f.connect();
  const error = await client.queueOnce({ clientUserMessageId: id, message: 'PRIVATE-OWN-INPUT' }).catch(e => e);
  fault('frame_invalid', true)(error);
  assert.equal(String(error).includes('PRIVATE'), false); assert.equal(JSON.stringify(error).includes('PRIVATE'), false);
  assert.equal(f.closes(), 1);
});

test('attempt marker precedes even a synchronous queue write failure', async t => {
  const f = fixture(t), client = await f.connect();
  t.mock.method(f.output, 'write', () => { throw new Error('PRIVATE-WRITE-DETAIL'); });
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'one' }), fault('write_failed', true));
  assert.equal(f.requests.length, 1); assert.equal(f.closes(), 1);
});

test('encoded effect frame limits are checked before marking a native attempt', async t => {
  const f = fixture(t), client = await f.connect();
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: '\x01'.repeat(APP_SERVER_LIMITS.messageBytes) }), fault('frame_limit', false));
  assert.equal(f.requests.length, 1); assert.equal(f.closes(), 1);
});

test('injection evidence is scoped to the exact original client ID and generation', async t => {
  const f = fixture(t), client = await f.connect(); await client.queueOnce({ clientUserMessageId: id, message: 'one' });
  f.event(injected({ clientUserMessageId: 'unrelated' }));
  const pending = client.observe(id); f.event(injected());
  assert.deepEqual(await pending, { injectionObserved: true, clientUserMessageId: id, turn: { id: 'fixture-turn', status: 'unknown' } });
  f.event({ kind: 'turn', scope, clientUserMessageId: id, turnId: 'fixture-turn', status: 'failed' });
  f.event(injected()); // Duplicate injection cannot erase known turn facts.
  assert.equal((await client.observe(id)).turn!.status, 'failed');
  assert.equal('acknowledged' in await client.observe(id), false);
});

test('a completed turn without injection is not delivered or acknowledged', async t => {
  const f = fixture(t), client = await f.connect(60); await client.queueOnce({ clientUserMessageId: id, message: 'one' });
  f.event({ kind: 'turn', scope, clientUserMessageId: id, turnId: 'fixture-turn', status: 'completed' });
  await assert.rejects(client.observe(id), fault('deadline', true)); assert.equal(f.requests.length, 2);
});

test('home, thread, generation and owner substitutions cannot advance observation', async t => {
  for (const patch of [{ codexHome: join(tmpdir(), 'other') }, { threadId: 'other' }, { generation: 'new' }, { ownerIdentity: 'other' }]) {
    const f = fixture(t), client = await f.connect(); await client.queueOnce({ clientUserMessageId: id, message: 'one' });
    const pending = client.observe(id); f.event(injected({ scope: { ...scope, ...patch } }));
    await assert.rejects(pending, fault('owner_changed', true)); assert.equal(f.closes(), 1);
  }
});

test('pure metadata parser rejects bodies, queue deletion and unsafe IDs', () => {
  assert.deepEqual(parseMetadataEvent(injected(), scope), injected());
  for (const event of [injected({ content: 'PRIVATE' }), injected({ text: 'PRIVATE' }), injected({ turnId: '\ud800' }), injected({ kind: 'queue_removed' }), injected({ scope: { ...scope, generation: null } })]) {
    assert.throws(() => parseMetadataEvent(event, scope), AppServerFault);
  }
});

test('unknown/body-bearing notifications fail closed without returning text', async t => {
  const f = fixture(t), client = await f.connect(); await client.queueOnce({ clientUserMessageId: id, message: 'one' });
  const pending = client.observe(id);
  f.reply({ method: 'item/started', params: { threadId: scope.threadId, item: { type: 'userMessage', content: 'PRIVATE-BODY' } } });
  await assert.rejects(pending, fault('frame_invalid', true)); assert.equal(f.closes(), 1);
});

test('strict framing rejects duplicates, float IDs, invalid UTF-8 and trailing payloads', async t => {
  for (const raw of ['{"id":1,"id":1,"result":{}}\n', '{"id":1e0,"result":{}}\n', '{"id":1.0,"result":{}}\n', '{}{}\n', Buffer.from([0xff, 10])]) {
    const f = fixture(t, () => {});
    const pending = f.connect(); setImmediate(() => f.input.write(raw));
    await assert.rejects(pending, fault('frame_invalid', false)); assert.equal(f.closes(), 1);
  }
});

test('frame boundary includes newline and a stream without newline remains bounded', async t => {
  const base = JSON.stringify({ id: 1, result: { scope, metadataOnly: true } });
  const good = fixture(t, () => {}), pending = good.connect();
  setImmediate(() => good.input.write(base + ' '.repeat(APP_SERVER_LIMITS.frameBytes - Buffer.byteLength(base) - 1) + '\n'));
  const client = await pending; await client.close();
  const bad = fixture(t, () => {}), rejected = bad.connect();
  setImmediate(() => bad.input.write(' '.repeat(APP_SERVER_LIMITS.frameBytes + 1)));
  await assert.rejects(rejected, fault('frame_limit', false)); assert.equal(bad.closes(), 1);
});

test('notification and total byte caps close a flooding transport', async t => {
  const f = fixture(t), client = await f.connect(); await client.queueOnce({ clientUserMessageId: id, message: 'one' });
  const pending = client.observe(id);
  for (let i = 0; i <= APP_SERVER_LIMITS.notifications; i++) f.event(injected({ clientUserMessageId: 'unrelated' }));
  await assert.rejects(pending, fault('notification_limit', true));
  const bytes = fixture(t, () => {}), connecting = bytes.connect();
  setImmediate(() => bytes.input.write(Buffer.alloc(APP_SERVER_LIMITS.receivedBytes + 1)));
  await assert.rejects(connecting, fault('traffic_limit', false)); assert.equal(bytes.closes(), 1);
});

test('pending observation callers are bounded and rejected when the quota fills', async t => {
  const f = fixture(t), client = await f.connect(); await client.queueOnce({ clientUserMessageId: id, message: 'one' });
  const waits = Array.from({ length: APP_SERVER_LIMITS.observations }, () => client.observe(id).catch(error => error));
  await assert.rejects(client.observe(id), fault('request_limit', true));
  for (const error of await Promise.all(waits)) fault('request_limit', true)(error);
  assert.equal(f.closes(), 1); assert.equal(f.requests.length, 2);
});

test('invalid scope/input and generation null cannot cause an effect', async t => {
  const f = fixture(t);
  await assert.rejects(BoundedAppServerClient.connectMetadataFixture({ ...scope, generation: null } as any,
    f.transport, performance.now() + 1000, async () => true), fault('invalid_scope', false)); assert.equal(f.requests.length, 0);
  const next = fixture(t), client = await next.connect();
  for (const message of ['\0', '\ud800', 'x'.repeat(APP_SERVER_LIMITS.messageBytes + 1)]) {
    await assert.rejects(client.queueOnce({ clientUserMessageId: id, message }), fault('invalid_input', false));
  }
  assert.equal(next.requests.length, 1);
});

test('a partial queue response followed by EOF remains attempted/unknown', async t => {
  const f = fixture(t, (r, reply) => {
    if (r.method.endsWith('/initialize')) reply({ id: r.id, result: { scope, metadataOnly: true } });
    else { f.input.write('{"id":2'); f.input.end(); }
  });
  const client = await f.connect();
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'one' }), fault('frame_invalid', true));
  assert.equal(f.requests.length, 2); assert.equal(f.closes(), 1);
});

test('owned POSIX fixture processes are reaped on explicit close and queue deadline', { skip: process.platform === 'win32' }, async t => {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-app-server-'));
  mkdirSync(join(root, 'home')); mkdirSync(join(root, 'codex'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const loseReply of [false, true]) {
    const pidFile = join(root, loseReply ? 'deadline.pid' : 'close.pid');
    const script = `
      const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
      let buffer='';setInterval(()=>{},1000);
      process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\n'))>=0){
        const r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
        if(r.method.endsWith('/initialize'))process.stdout.write(JSON.stringify({id:r.id,result:{scope:r.params.scope,metadataOnly:true}})+'\\n');
        else if(!${loseReply})process.stdout.write(JSON.stringify({id:r.id,result:{scope:r.params.scope,queueId:'q',clientUserMessageId:r.params.clientUserMessageId}})+'\\n');
      }});`;
    const transport = spawnOwnedMetadataFixture(process.execPath, ['-e', script], { PATH: process.env.PATH,
      HOME: join(root, 'home'), CODEX_HOME: join(root, 'codex'), SESSION_PEER_TAILSCALE: 'off' });
    const client = await BoundedAppServerClient.connectMetadataFixture(scope, transport, performance.now() + 300, async () => true);
    if (loseReply) await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'fixture' }), fault('deadline', true));
    else { await client.queueOnce({ clientUserMessageId: id, message: 'fixture' }); await client.close(); }
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), (error: any) => error.code === 'ESRCH');
  }
});

test('closing an owned POSIX fixture also kills its owned process-group descendant', { skip: process.platform === 'win32' }, async t => {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-app-server-group-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pidFile = join(root, 'pids.json');
  const script = `
    const fs=require('node:fs'),{spawn}=require('node:child_process');
    const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({parent:process.pid,descendant:descendant.pid}));
    let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\n'))>=0){
      const r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      process.stdout.write(JSON.stringify({id:r.id,result:{scope:r.params.scope,metadataOnly:true}})+'\\n');
    }});`;
  const transport = spawnOwnedMetadataFixture(process.execPath, ['-e', script], { PATH: process.env.PATH, HOME: root, CODEX_HOME: root });
  const client = await BoundedAppServerClient.connectMetadataFixture(scope, transport, performance.now() + 1000, async () => true);
  const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
  process.kill(pids.parent, 0); process.kill(pids.descendant, 0);
  await client.close();
  function running(pid: number): boolean {
    try {
      process.kill(pid, 0);
      // Linux may briefly retain an already killed orphan as a zombie.
      if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false;
      return true;
    } catch (error) {
      if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
      throw error;
    }
  }
  for (let i = 0; i < 20 && running(pids.descendant); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(running(pids.parent), false); assert.equal(running(pids.descendant), false);
});

function nativeFixture(t: TestContext, queueReply?: (r: any, reply: (v: unknown) => void) => void) {
  const f = fixture(t, (r, reply) => {
    if (r.method === 'initialize') reply({ id: r.id, result: { codexHome: scope.codexHome, platformFamily: 'unix', platformOs: 'macos', userAgent: 'fixture-native' } });
    else if (r.method === 'initialized') return;
    else if (queueReply) queueReply(r, reply);
    else reply({ id: r.id, result: { queuedSubmission: { id: 'fixture-native-q', input: r.params.input, clientUserMessageId: r.params.clientUserMessageId } } });
  });
  async function connect(beforeEffect: () => Promise<void> = async () => {}, timeout = 1000) {
    const client = await BoundedAppServerClient.connectNativeQueueFixture(scope, f.transport, performance.now() + timeout, async () => true, beforeEffect);
    t.after(() => client.close()); return client;
  }
  return { ...f, connect };
}

test('native fixture opts out all 83 notifications before one queue RPC and validates only its own echo', async t => {
  const f = nativeFixture(t); let guards = 0;
  const client = await f.connect(async () => { guards++; assert.equal(f.requests.length, 2); });
  assert.equal(NATIVE_QUEUE_NOTIFICATION_OPTOUTS.length, 83);
  assert.equal(new Set(NATIVE_QUEUE_NOTIFICATION_OPTOUTS).size, 83);
  assert.deepEqual(f.requests[0].params.capabilities.optOutNotificationMethods, NATIVE_QUEUE_NOTIFICATION_OPTOUTS);
  const result = await client.queueOnce({ clientUserMessageId: id, message: 'PRIVATE-OWN-ECHO' });
  assert.deepEqual(result, { queueId: 'fixture-native-q', clientUserMessageId: id }); assert.equal(guards, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(f.requests.map(r => r.method), ['initialize', 'initialized', 'thread/queue/add']);
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'again' }), fault('already_attempted', true));
});

test('root effect-guard refusal cannot authorize any native queue or fallback', async t => {
  const f = nativeFixture(t), client = await f.connect(async () => { throw new Error('PRIVATE-LEDGER-DETAIL'); });
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'one' }), fault('effect_guard_failed', false));
  assert.deepEqual(f.requests.map(r => r.method), ['initialize', 'initialized']); assert.equal(f.closes(), 1);
});

test('root effect guard shares original deadline and cannot write after it', async t => {
  const f = nativeFixture(t), client = await f.connect(() => new Promise(() => {}), 40);
  await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'one' }), fault('deadline', false));
  assert.equal(f.requests.length, 2); assert.equal(f.closes(), 1);
});

test('native own-input echo conflicts are post-attempt unknown, not observer evidence', async t => {
  for (const patch of [{ clientUserMessageId: 'wrong' }, { input: [{ type: 'text', text: 'PRIVATE-UNEXPECTED' }] }, { input: [] }]) {
    const f = nativeFixture(t, (r, reply) => reply({ id: r.id, result: { queuedSubmission: { id: 'q', input: r.params.input, clientUserMessageId: r.params.clientUserMessageId, ...patch } } }));
    const client = await f.connect(); await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'one' }), fault('frame_invalid', true));
    assert.equal(f.requests.length, 3); assert.equal(f.closes(), 1);
  }
});

test('unrequested native notification after opt-out aborts without inspecting or returning its body', async t => {
  const f = nativeFixture(t, (_r, reply) => reply({ method: 'item/started', params: { item: { content: 'PRIVATE-NATIVE-BODY' } } }));
  const client = await f.connect(); await assert.rejects(client.queueOnce({ clientUserMessageId: id, message: 'one' }), fault('unsupported_transport', true));
  assert.equal(f.requests.length, 3); assert.equal(f.closes(), 1);
});

test('native negative RPC error codes retain attempted state and never expose stderr/message', async t => {
  const f = nativeFixture(t, (r, reply) => reply({ id: r.id, error: { code: -32601, message: 'PRIVATE-RPC-ERROR', data: { body: 'PRIVATE' } } }));
  const client = await f.connect(); const error = await client.queueOnce({ clientUserMessageId: id, message: 'one' }).catch(e => e);
  fault('remote_refused', true)(error); assert.equal(String(error).includes('PRIVATE'), false);
});

test('nativeQueueOnce pins env/CLI SQLite home, checks opened paths and selected binary before a guarded effect', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async t => {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-native-queue-stub-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, 'metadata.jsonl'), binary = join(root, 'codex-fixture');
  const selected = join(root, 'selected "quoted" \\home'), other = join(root, 'other');
  mkdirSync(selected, { mode: 0o700 }); mkdirSync(other, { mode: 0o700 });
  const original = { ...scope, codexHome: selected, threadId: '01950000-0000-7000-8000-000000000071' };
  const script = `#!${process.execPath}\n
    const fs=require('node:fs'),log=${JSON.stringify(log)};
    fs.appendFileSync(log,JSON.stringify({argv:process.argv.slice(2),pid:process.pid,home:process.env.CODEX_HOME,sqliteHome:process.env.CODEX_SQLITE_HOME})+'\\n');
    if(process.argv.includes('--version')){console.log('codex-cli '+(process.env.FIXTURE_VERSION||'0.160.1'));process.exit(0);}
    // Synthetic descriptors model the service's already resolved SQLite home;
    // the negative case represents an exact policy overriding CLI/env pins.
    const storage=process.env.FIXTURE_STORAGE_HOME||process.env.CODEX_SQLITE_HOME;
    fs.openSync(require('node:path').join(storage,'state_5.sqlite'),'w+');
    fs.openSync(require('node:path').join(storage,'queue_1.sqlite'),'w+');
    let buffer='';setInterval(()=>{},1000);process.stderr.write('PRIVATE-STDERR-NOT-RETURNED');
    process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\n'))>=0){const r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      fs.appendFileSync(log,JSON.stringify({method:r.method,guardExists:fs.existsSync(${JSON.stringify(join(root, 'guard'))})})+'\\n');
      if(r.method==='initialize')process.stdout.write(JSON.stringify({id:r.id,result:{codexHome:process.env.CODEX_HOME,platformFamily:'unix',platformOs:'macos',userAgent:'fixture'}})+'\\n');
      if(r.method==='thread/queue/add')process.stdout.write(JSON.stringify({id:r.id,result:{queuedSubmission:{id:'fixture-q',clientUserMessageId:r.params.clientUserMessageId,input:r.params.input}}})+'\\n');
    }});`;
  writeFileSync(binary, script, { mode: 0o700 });
  let guards = 0;
  const options = { binary, scope: original, message: 'PRIVATE-OWN-EFFECT', clientUserMessageId: id, deadlineMs: performance.now() + 2000,
    verifyOwner: async (value: AppServerScope) => { assert.deepEqual(value, original); return true; },
    beforeEffect: async () => { guards++; writeFileSync(join(root, 'guard'), 'committed'); },
    env: { HOME: root, CODEX_HOME: 'must-be-replaced', CODEX_SQLITE_HOME: 'must-be-replaced', PATH: process.env.PATH } };
  assert.deepEqual(await nativeQueueOnce(options), { queueId: 'fixture-q', clientUserMessageId: id }); assert.equal(guards, 1);
  const rows = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 5); assert.deepEqual(rows.filter(r => r.method).map(r => r.method), ['initialize', 'initialized', 'thread/queue/add']);
  for (const row of rows.filter(r => r.pid)) { assert.equal(row.home, selected); assert.equal(row.sqliteHome, selected);
    assert.throws(() => process.kill(row.pid, 0), (e: any) => e.code === 'ESRCH'); }
  assert.deepEqual(rows[1].argv.slice(-2), ['-c', `sqlite_home=${JSON.stringify(selected)}`]);
  assert.equal(rows.at(-1).guardExists, true);
  await assert.rejects(nativeQueueOnce({ ...options, deadlineMs: performance.now() + 1000,
    env: { ...options.env, FIXTURE_VERSION: '0.160.2' } }), fault('unsupported_version', false));
  assert.equal(guards, 1);
  await assert.rejects(nativeQueueOnce({ ...options, deadlineMs: performance.now() + 2000,
    env: { ...options.env, FIXTURE_STORAGE_HOME: other } }), fault('storage_binding_unverified', false));
  assert.equal(guards, 1);
  const allRows = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(allRows.filter(r => r.method === 'thread/queue/add').length, 1);
  for (const row of allRows.filter(r => r.pid)) assert.throws(() => process.kill(row.pid, 0), (e: any) => e.code === 'ESRCH');
});
