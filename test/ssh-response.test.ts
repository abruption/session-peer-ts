import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, validateResponse, responseOutcome, RESPONSE_BYTES, RESPONSE_DEPTH, RESPONSE_NODES } from '../dist/ssh-response.js';
import { run, type Done } from '../dist/process.js';
import { renderOutput } from '../dist/output.js';

const id = '11111111-1111-1111-8111-111111111111'; // Native UUID need not be v4.
const codex = { schemaVersion: 1, host: 'fixture', command: 'send', ok: true, status: 'queued',
  submitted: true, consumptionConfirmed: false, target: { id }, queueId: 'queue-17', codexHome: '/fixture/home' };
const request = { command: 'send', to: `codex:${id}` };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function done(value: unknown, extra: Partial<Done> = {}): Done {
  return { code: 0, stdout: '', stdoutBytes: encode(value), stderr: '', spawned: true, interrupted: false, ...extra };
}

test('response protocol accepts only one complete object and JSON whitespace, with no BOM', () => {
  for (const text of ['{}', ' \t\r\n{"x":"🚀"}\n']) assert.deepEqual(parseResponse(Buffer.from(text)), JSON.parse(text));
  for (const text of ['', '[]', 'null', '42', 'true', '\ufeff{}', 'banner\n{}', '{}{}', '{} trailing', '{}\u00a0', '{"x":NaN}',
    '{"x":Infinity}', '{"x":01}', '{"x":1.}', '{"x":1e}', '{"x":truefalse}', '{"x":}', '{"x":1,}', '[}', '{"x":"\n"}', '{"x":"\\q"}', '{"x":1']) {
    assert.throws(() => parseResponse(Buffer.from(text)), /remote_response_unverified/, text);
  }
});

test('fatal UTF-8 rejects invalid/truncated bytes without repairing string values', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}')]),
    Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xe2, 0x82]), Buffer.from('"}')])]) assert.throws(() => parseResponse(bytes));
  assert.equal(parseResponse(Buffer.from('{"x":"�"}')).x, '�'); // An actual U+FFFD is valid UTF-8.
});

test('duplicate keys are rejected at all depths after JSON escape decoding', () => {
  for (const text of ['{"ok":true,"ok":false}', '{"a":{"x":1,"x":1}}', '{"a":[{"x":1,"\\u0078":2}]}',
    '{"a":1,"\\u0061":2}', '{"🚀":1,"\\ud83d\\ude80":2}', '{"__proto__":{},"__proto__":{}}']) assert.throws(() => parseResponse(Buffer.from(text)));
  assert.deepEqual(parseResponse(Buffer.from('{"a":{"x":1},"b":{"x":2}}')), { a: { x: 1 }, b: { x: 2 } });
});

test('byte, nesting and node budgets accept their boundary and refuse overflow', () => {
  const boundary = '{"x":"' + 'a'.repeat(RESPONSE_BYTES - 8) + '"}';
  assert.equal(Buffer.byteLength(boundary), RESPONSE_BYTES); assert.equal((parseResponse(Buffer.from(boundary)).x as string).length, RESPONSE_BYTES - 8);
  assert.throws(() => parseResponse(Buffer.from(boundary + ' ')));
  const nested = (depth: number) => '{"x":' + '['.repeat(depth - 1) + '0' + ']'.repeat(depth - 1) + '}';
  assert.doesNotThrow(() => parseResponse(Buffer.from(nested(RESPONSE_DEPTH))));
  assert.throws(() => parseResponse(Buffer.from(nested(RESPONSE_DEPTH + 1))));
  // Object + key + array + N values = N+3 nodes.
  const many = (count: number) => Buffer.from('{"x":[' + Array(count).fill('0').join(',') + ']}');
  assert.doesNotThrow(() => parseResponse(many(RESPONSE_NODES - 3)));
  assert.throws(() => parseResponse(many(RESPONSE_NODES - 2)));
});

test('request validation preserves nullable Claude names, optional agent/queueId and native UUID case', () => {
  const { queueId: _queue, ...base } = codex;
  const claude = { ...base, target: { pid: 123, name: null }, status: 'posted' };
  validateResponse(claude, { command: 'send', to: 'claude:123' });
  validateResponse({ ...claude, target: { pid: 123, name: 'Straße' } }, { command: 'send', to: 'STRASSE' });
  const noQueue = { ...codex }; delete (noQueue as Partial<typeof codex>).queueId;
  validateResponse(noQueue, request); assert.equal('queueId' in responseOutcome(done(noQueue, { code: 255 }), request).value, false);
  validateResponse({ ...codex, target: { id: id.toUpperCase(), agent: 'codex' } }, request);
  validateResponse({ ...codex, codexHomeResolution: { schemaVersion: 1, status: 'explicit', selected: '/fixture/home' } }, { ...request, home: '/fixture/home' });
});

test('wrong command/schema/target/status/context never proves submission', () => {
  for (const patch of [{ schemaVersion: true }, { schemaVersion: 2 }, { command: 'list' }, { host: 5 }, { host: '' },
    { consumptionConfirmed: true }, { submitted: false }, { dryRun: true }, { retryAllowed: true }, { status: 'posted' }, { error: 'native_failed' },
    { queueId: null }, { queueId: 'bad\nqueue' }, { codexHome: '/ok', codexHomeResolution: { schemaVersion: 1, status: 'selected', selected: '/wrong' } },
    { target: { agent: 'claude', id } }, { target: { id: '22222222-2222-4222-8222-222222222222' } }, { target: [] }]) {
    assert.throws(() => responseOutcome(done({ ...codex, ...patch }, { code: 255 }), request), JSON.stringify(patch));
  }
  for (const target of [{ pid: 456, name: null }, { pid: 123, name: {} }, { pid: 123, name: 'wrong' }]) {
    const to = target.name === 'wrong' ? 'requested' : '123';
    const { queueId: _queue, ...base } = codex;
    const value = { ...base, status: 'posted', target };
    assert.throws(() => validateResponse(value, { command: 'send', to }));
  }
});

test('Codex explicit home/opt-in context binds returned resolution, including receiver-canonicalized aliases', () => {
  const resolution = { schemaVersion: 1, status: 'explicit', selected: '/fixture/home', reason: 'explicit_inactive_opt_in' };
  const value = { ...codex, codexHomeResolution: resolution };
  assert.throws(() => validateResponse(value, { ...request, home: '/fixture/home' }));
  assert.throws(() => validateResponse(value, { ...request, allowInactive: true }));
  assert.throws(() => validateResponse(value, { ...request, home: '/wrong', allowInactive: true }));
  validateResponse(value, { ...request, home: '/fixture/home', allowInactive: true });
  const alias = { ...value, requestedCodexHome: '/fixture/alias' };
  const bound = { ...request, home: '/fixture/alias', allowInactive: true };
  validateResponse(alias, bound);
  assert.equal('requestedCodexHome' in responseOutcome(done(alias), bound).value, false);
  assert.throws(() => validateResponse(alias, { ...bound, home: '/other-alias' }));
  assert.throws(() => validateResponse(alias, request));
  const { codexHome: _home, ...withoutHome } = { ...codex, requestedCodexHome: '/fixture/home' };
  assert.throws(() => validateResponse(withoutHome, { ...request, home: '/fixture/home' }));
  assert.throws(() => validateResponse({ ...codex, status: 'validated', submitted: false }, { ...request, dryRun: true }));
});

test('peer-supplied transport diagnosis is removed, preserving unrelated extra fields', () => {
  const forged = { ...codex, sshTransport: { status: 'timed_out', reason: 'forged' }, remoteMarker: 'kept' };
  const normal = responseOutcome(done(forged), request);
  assert.equal('sshTransport' in normal.value, false); assert.equal(normal.value.remoteMarker, 'kept');
  const shutdown = responseOutcome(done(forged, { code: 255 }), request);
  assert.deepEqual(shutdown.value.sshTransport, { status: 'failed', reason: 'ssh_exit_nonzero', exitCode: 255 });
  assert.equal(shutdown.value.remoteMarker, 'kept');
  assert.throws(() => responseOutcome(done({ ...codex, error: 'native_failed' }), request));
  assert.throws(() => responseOutcome(done({ ...codex, ok: false, submitted: false, status: 'refused', error: 'native_failed' }), request));
});

test('failed-send and remote-doctor evidence cannot contradict the original request', () => {
  const unknown = { schemaVersion: 1, host: 'fixture', command: 'send', ok: false, status: 'unknown',
    submitted: null, consumptionConfirmed: false, error: 'outcome_unknown' };
  const doctor = { schemaVersion: 1, host: 'fixture', command: 'doctor', ok: true, diagnosticCompleted: true,
    ready: true, implementation: 'typescript', agents: {},
    returnRoute: { status: 'verified', transport: 'ssh', host: 'user@origin' } };
  const routeRequest = { command: 'doctor', returnTo: 'user@origin' };
  for (const extra of [{ code: 0 }, { code: 255 }, { code: null, interrupted: true, stopReason: 'timeout' as const }]) {
    for (const to of [`codex:${id}`, 'claude:123']) {
      for (const queueId of ['queue-17', 'x'.repeat(129), {}]) {
        assert.throws(() => responseOutcome(done({ ...unknown, queueId }, extra), { command: 'send', to }));
      }
      assert.throws(() => responseOutcome(done({ ...unknown, dryRun: true }, extra), { command: 'send', to, dryRun: true }));
    }
    const { codexHome: _home, ...withoutHome } = codex;
    assert.throws(() => responseOutcome(done(withoutHome, extra), request));
    for (const patch of [{ host: 'other@origin' }, { transport: 'local' }]) {
      assert.throws(() => responseOutcome(done({ ...doctor, returnRoute: { ...doctor.returnRoute, ...patch } }, extra), routeRequest));
    }
    assert.deepEqual(responseOutcome(done(doctor, extra), routeRequest).value.returnRoute, doctor.returnRoute);
  }
  assert.equal(responseOutcome(done(unknown, { code: 255 }), request).value.status, 'unknown');
  assert.equal(responseOutcome(done({ ...doctor, returnRoute: { ...doctor.returnRoute, status: 'failed', reason: 'timeout' } }), routeRequest).value.ok, true);
});

test('complete native evidence is retained after exit255/timeout; normal exit contracts remain', () => {
  for (const extra of [{ code: 255 }, { code: null, interrupted: true, stopReason: 'timeout' as const },
    { code: null, interrupted: true, stopReason: 'process_error' as const }]) {
    const result = responseOutcome(done(codex, extra), request);
    for (const [key, value] of Object.entries(codex)) assert.deepEqual(result.value[key], value);
    assert.equal(result.exitCode, 1); assert.equal(result.value.retryAllowed, false);
    assert.match(renderOutput(result.value, 'text'), /Submitted; consumption\/ACK is not confirmed/);
    assert.match(renderOutput(result.value, 'text'), /SSH transport:.*verified remote facts retained/);
  }
  assert.deepEqual(responseOutcome(done(codex), request), { value: codex, exitCode: 0 });
  assert.throws(() => responseOutcome(done(codex, { code: 1 }), request));
  const refused = { schemaVersion: 1, host: 'fixture', command: 'send', ok: false, status: 'refused', submitted: false,
    consumptionConfirmed: false, error: 'no_reachable_target' };
  for (const code of [1, 2, 255]) assert.equal(responseOutcome(done(refused, { code }), request).value.status, 'refused');
  const partialDiscovery = { schemaVersion: 1, host: 'fixture', command: 'list', ok: false, sessions: [], errors: ['fixture'] };
  assert.deepEqual(responseOutcome(done(partialDiscovery, { code: 1 }), { command: 'list' }).value, partialDiscovery);
});

test('empty/partial/polluted/overflow prefixes and unspawned responses never become success', () => {
  for (const text of ['', JSON.stringify(codex).slice(0, -1), JSON.stringify(codex) + '\nnoise']) {
    for (const code of [0, 255, null]) assert.throws(() => responseOutcome(done(codex, { code, stdoutBytes: Buffer.from(text) }), request));
  }
  assert.throws(() => responseOutcome(done(codex, { interrupted: true, stopReason: 'output_limit' }), request));
  assert.throws(() => responseOutcome(done(codex, { spawned: false, stopReason: 'process_error' }), request));
});

test('raw process collection handles split UTF-8 and separately bounded replacement diagnostics', async () => {
  const payload = Buffer.from('{"x":"🚀"}'); const at = payload.indexOf(0xf0) + 2;
  const split = await run(process.execPath, ['-e', 'const b=Buffer.from(process.argv[1],"base64"),n=Number(process.argv[2]);process.stdout.write(b.subarray(0,n));setTimeout(()=>process.stdout.write(b.subarray(n)),20);', payload.toString('base64'), String(at)], { rawStdout: true });
  assert.deepEqual(split.stdoutBytes, payload); assert.equal(parseResponse(split.stdoutBytes!).x, '🚀');
  for (const code of [0, 255]) {
    const result = await run(process.execPath, ['-e', 'process.stderr.write(Buffer.from([255]));process.stderr.write("x".repeat(10000));process.stdout.write(process.argv[1]);process.exitCode=Number(process.argv[2]);', JSON.stringify(codex), String(code)], { rawStdout: true, limit: 1024 });
    assert.equal(result.interrupted, false); assert.ok(result.stderr.length <= 4097); assert.match(result.stderr, /�/);
    assert.equal(responseOutcome(result, request).value.queueId, 'queue-17');
  }
});

test('real process timeout keeps complete evidence; byte overflow always invalidates it', async () => {
  const result = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1]);setInterval(()=>{},1000);', JSON.stringify(codex)], { rawStdout: true, timeout: process.platform === 'win32' ? 2000 : 300 });
  assert.equal(result.stopReason, 'timeout'); assert.equal(responseOutcome(result, request).value.submitted, true);
  const overflow = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1]);setTimeout(()=>process.stdout.write(" ".repeat(4096)),20);', JSON.stringify(codex)], { rawStdout: true, limit: 1024 });
  assert.equal(overflow.stopReason, 'output_limit'); assert.throws(() => responseOutcome(overflow, request));
  const rawLimit = await run(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(300,255));'], { rawStdout: true, limit: 300 });
  assert.equal(rawLimit.interrupted, false); assert.equal(rawLimit.stdoutBytes!.length, 300); assert.throws(() => parseResponse(rawLimit.stdoutBytes!));
});
