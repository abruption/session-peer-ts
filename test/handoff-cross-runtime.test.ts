// Actual pure validators, not native interoperability, receipt auth or live ACK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHandoff } from '../dist/handoff.js';
import { validateResponse } from '../dist/ssh-response.js';

type Case = { kind: 'public' | 'native' | 'projection'; value: unknown; record?: Record<string, unknown> };
type Result = { valid: boolean; value?: Record<string, unknown>; reason?: string };
const root = process.env.SESSION_PEER_PYTHON_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
const pin = JSON.parse(readFileSync(new URL('./fixtures/python-reference.pin.json', import.meta.url), 'utf8'));
const hashes = {
  'session_peer.py': 'd36d83f3d6f59eb20c958aac530ca6d5d988a99f6ceabf2704c7c51db1fe524f',
  'session_peer_core/handoff.py': '138115b9cc8ee73c77ad1099625f2b6cc2e0a6bd343e864a6b5219328735a808',
};
const fixture = JSON.parse(readFileSync(new URL('./fixtures/handoff-v1.json', import.meta.url), 'utf8'));
const python = process.env.PYTHON ?? 'python3';
function reference(cases: Case[]): Result[] {
  assert.equal(pin.version, '1.1.0');
  assert.equal(pin.commit, '8ca77cf31254c8287a2593fe484bb30a7dba2727');
  assert.equal(pin.files['session_peer.py'], hashes['session_peer.py']);
  for (const [path, digest] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(readFileSync(join(root, path))).digest('hex'), digest, path);
  }
  const child = spawnSync(python, [fileURLToPath(new URL('./fixtures/handoff-python-validator.py', import.meta.url)), root], {
    input: JSON.stringify(cases), encoding: 'utf8', timeout: 10000, maxBuffer: 1048576,
    env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', HOME: '/fixture/unavailable-home',
      USERPROFILE: '/fixture/unavailable-home', SESSION_PEER_NO_UPDATE_NOTICE: '1' },
  });
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const response = JSON.parse(child.stdout);
  assert.equal(response.version, pin.version); assert.deepEqual(response.sourceHashes, hashes);
  assert.equal(response.results.length, cases.length);
  return response.results;
}

test('published Python and TS pure validators accept every frozen state without modifying native snapshots', () => {
  const cases: Case[] = fixture.accepted.map((sample: any) => ({ kind: 'public', value: sample.result.handoff }));
  const before = JSON.stringify(fixture.accepted), results = reference(cases);
  const states = new Set<string>();
  for (const [index, sample] of fixture.accepted.entries()) {
    states.add(sample.result.handoff.state);
    assert.equal(results[index]!.valid, true, sample.name);
    assert.deepEqual(results[index]!.value, sample.result.handoff, sample.name);
    assert.deepEqual(validateHandoff(sample.result.handoff), sample.result.handoff, sample.name);
    assert.equal(sample.result.handoff.retry.allowed, false);
  }
  assert.deepEqual([...states].sort(), [...fixture.enums.state].sort());
  assert.equal(JSON.stringify(fixture.accepted), before);
});

test('both published validators reject schema, privacy, forged ACK and retry authority violations', () => {
  const names = ['boolean_schema_version', 'fraction_schema_version', 'wrong_schema_version', 'noncanonical_uuid',
    'invalid_epoch', 'unknown_state', 'resend_action', 'native_retry_allowed', 'future_dedup_claim',
    'ack_without_receipt', 'secret_extra_field', 'unknown_nested_field'];
  const samples = names.map(name => {
    const sample = fixture.rejected.find((row: any) => row.name === name); assert.ok(sample, name);
    const base = fixture.accepted.find((row: any) => row.name === sample.base); assert.ok(base, sample.base);
    const value = structuredClone(base.result.handoff);
    for (const [path, replacement] of Object.entries(sample.set)) {
      const keys = path.split('.'); let owner = value;
      for (const key of keys.slice(0, -1)) owner = owner[key];
      owner[keys.at(-1)!] = replacement;
    }
    return { kind: 'public', value } as Case;
  });
  const results = reference(samples);
  for (const [index, sample] of samples.entries()) {
    // Published Python's UUID helper keeps its own reason code; do not force
    // cross-runtime error spelling parity on a shared rejection decision.
    const reason = ['noncanonical_uuid', 'invalid_epoch'].includes(names[index]!) ? 'invalid_correlation_id' : 'invalid_handoff';
    assert.deepEqual(results[index], { valid: false, reason }, names[index]);
    assert.throws(() => validateHandoff(sample.value), /invalid_handoff/, names[index]);
  }
});

test('published Python state projection validates in TS while unsupported observation remains explicit', () => {
  const epoch = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const statuses = ['not_attempted', 'refused', 'submitted', 'unknown'];
  const cases: Case[] = statuses.map(submission => ({ kind: 'projection', value: epoch, record: {
    id, generation: 'fixture-original-generation', submission, waits: [], ack: null, capability: null, observe: true,
  } }));
  for (const [index, result] of reference(cases).entries()) {
    assert.equal(result.valid, true); const value = validateHandoff(result.value);
    assert.equal(value.submission.status, statuses[index]);
    assert.deepEqual(value.observation, { status: 'unsupported', injectionObserved: false });
    assert.equal(value.retry.allowed, false);
  }
});

test('Python Claude optional absence and TS posted facts remain distinct actual native profiles', () => {
  const native = { ok: true, target: { pid: 4242, name: null }, chars: 0, dryRun: false };
  const record = { binding: { agent: 'claude', destination: ['local'], target: '4242' } };
  const tsNative = { ...native, status: 'posted', submitted: true, consumptionConfirmed: false };
  const cases: Case[] = [native, tsNative, { ...native, target: { pid: 4243, name: null } },
    { ...native, target: { pid: 4242, name: 7 } }].map(value => ({ kind: 'native', value, record }));
  const before = JSON.stringify(native), results = reference(cases);
  assert.equal(results[0]!.valid, true); assert.deepEqual(results[0]!.value, native);
  for (const result of results.slice(1)) assert.deepEqual(result, { valid: false, reason: 'invalid_native_profile' });
  const envelope = { schemaVersion: 1, host: 'fixture', command: 'send' };
  assert.throws(() => validateResponse({ ...envelope, ...native }, { command: 'send', to: '4242' }));
  assert.doesNotThrow(() => validateResponse({ ...envelope, ...tsNative }, { command: 'send', to: '4242' }));
  assert.throws(() => validateResponse({ ...envelope, ...tsNative, target: { pid: 4243, name: null } }, { command: 'send', to: '4242' }));
  assert.throws(() => validateResponse({ ...envelope, ...tsNative, target: { pid: 4242, name: 7 } }, { command: 'send', to: '4242' }));
  for (const key of ['status', 'submitted', 'consumptionConfirmed', 'handoff']) assert.equal(Object.hasOwn(native, key), false);
  assert.equal(JSON.stringify(native), before);
});

test('both actual Codex native validators preserve optional queue ID and enforce original home/target', () => {
  // Native UUIDs are not restricted to the correlation ID's UUIDv4 rule.
  const id = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa', home = '/fixture/codex-home';
  const resolution = { schemaVersion: 1, status: 'explicit', selected: home, reason: 'explicit_live_writer',
    candidates: [{ codexHome: home, savedThread: true, writerLock: 'held', activity: 'live_writer', reason: 'fixture' }] };
  const native = { ok: true, target: { agent: 'codex', id: id.toUpperCase() }, chars: 0, dryRun: false,
    status: 'queued', submitted: true, consumptionConfirmed: false, codexHome: home, codexHomeResolution: resolution };
  const record = { binding: { agent: 'codex', destination: ['local'], target: id, home } };
  const values = [native, { ...native, queueId: 'fixture-native-queue' }, { ...native, status: 'posted' },
    { ...native, consumptionConfirmed: true }, { ...native, codexHome: '/fixture/wrong-home' },
    { ...native, target: { agent: 'claude', id } }];
  const results = reference(values.map(value => ({ kind: 'native', value, record })));
  const envelope = { schemaVersion: 1, host: 'fixture', command: 'send' };
  const request = { command: 'send', to: `codex:${id}`, home };
  for (const [index, value] of values.entries()) {
    if (index < 2) {
      assert.equal(results[index]!.valid, true); assert.deepEqual(results[index]!.value, value);
      assert.doesNotThrow(() => validateResponse({ ...envelope, ...value }, request));
    } else {
      assert.deepEqual(results[index], { valid: false, reason: 'invalid_native_profile' });
      assert.throws(() => validateResponse({ ...envelope, ...value }, request));
    }
  }
  assert.equal(Object.hasOwn(results[0]!.value!, 'queueId'), false);
  assert.equal(results[1]!.value!.queueId, 'fixture-native-queue');
});
