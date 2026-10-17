import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HandoffLedger, payloadDigest, type HandoffBinding } from '../dist/handoff-ledger.js';
import { HandoffBudget, type Clock } from '../dist/handoff.js';

const posix = { skip: process.platform === 'win32' };
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-ledger-privacy-')));
  chmodSync(root, 0o700); t.after(() => rmSync(root, { recursive: true, force: true }));
  const clock: Clock = { monotonic: () => 100, utc: () => 100000 };
  const path = join(root, 'ledger'), ledger = new HandoffLedger(path, { clock });
  const body = 'private low entropy fixture message';
  const binding: HandoffBinding = { agent: 'codex', destination: 'fixture', target: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    home: '/fixture/home', generation: 'fixture-generation', writerIdentity: 'fixture-writer', payloadDigest: payloadDigest(body) };
  ledger.init(); return { root, path, ledger, clock, body, binding, journal: join(path, 'ledger.json'), key: join(path, 'ledger.key') };
}

test('journal never persists raw payload, payload digest, receipt capability or encryption key', posix, t => {
  const f = fixture(t), h = f.ledger.prepare(f.binding);
  const capability = f.ledger.mintCapability(h.correlationId, { privateConsumerValidated: true, compatibleProducerValidated: true });
  const text = readFileSync(f.journal, 'utf8');
  assert.equal(text.includes(f.body), false);
  assert.equal(text.includes(f.binding.payloadDigest), false);
  assert.equal(text.includes(capability), false);
  const key = readFileSync(f.key);
  assert.equal(key.length, 32); assert.equal(statSync(f.key).mode & 0o777, 0o600);
  assert.equal(text.includes(key.toString('hex')), false); assert.equal(text.includes(key.toString('base64')), false);
  assert.deepEqual(readdirSync(f.path).sort(), ['ledger.json', 'ledger.key', 'ledger.lock']);
  assert.equal(JSON.stringify(h).includes(f.binding.payloadDigest), false);
});

test('encrypted binding survives restart, refuses conflicting body, and keeps receipt and wait evidence', posix, t => {
  const f = fixture(t), h = f.ledger.prepare(f.binding);
  const restarted = new HandoffLedger(f.path, { clock: f.clock });
  assert.equal(restarted.prepare(f.binding, { correlationId: h.correlationId }).correlationId, h.correlationId);
  const before = readFileSync(f.journal);
  assert.throws(() => restarted.commitEffect(h.correlationId, { ...f.binding, payloadDigest: payloadDigest('conflict') }), /handoff_binding_conflict/);
  assert.deepEqual(readFileSync(f.journal), before);
  restarted.commitEffect(h.correlationId, f.binding); restarted.recordSubmission(h.correlationId, 'submitted');
  const confirmed = restarted.confirm(JSON.stringify({ schemaVersion: 1, ledgerEpoch: h.ledgerEpoch, correlationId: h.correlationId,
    targetGeneration: h.targetGeneration, confirmed: true }));
  assert.equal(confirmed.ack.assurance, 'operator_confirmed');
  const wait = restarted.beginWait(h.correlationId, 'acknowledged', new HandoffBudget(30, f.clock));
  assert.equal(wait.wait.status, 'satisfied');
  const status = new HandoffLedger(f.path, { clock: f.clock }).status(h.correlationId);
  assert.ok('handoff' in status); assert.equal(status.handoff.ack.status, 'acknowledged');
  assert.equal(status.handoff.wait.operationId, wait.wait.operationId);
  assert.equal(readFileSync(f.journal, 'utf8').includes(f.binding.payloadDigest), false);
});

for (const damage of ['missing', 'short', 'rotated', 'permissions', 'symlink'] as const) {
  test(`a ${damage} key fails closed without journal changes or key regeneration`, posix, t => {
    const f = fixture(t), h = f.ledger.prepare(f.binding), before = readFileSync(f.journal);
    if (damage === 'missing') unlinkSync(f.key);
    if (damage === 'short') writeFileSync(f.key, 'bad', { mode: 0o600 });
    if (damage === 'rotated') writeFileSync(f.key, randomBytes(32));
    if (damage === 'permissions') chmodSync(f.key, 0o644);
    if (damage === 'symlink') { const other = join(f.root, 'other'); writeFileSync(other, randomBytes(32), { mode: 0o600 }); unlinkSync(f.key); symlinkSync(other, f.key); }
    const keyBefore = damage === 'missing' ? undefined : readFileSync(f.key);
    const restarted = new HandoffLedger(f.path, { clock: f.clock });
    assert.throws(() => restarted.commitEffect(h.correlationId, f.binding));
    assert.ok('handoffQuery' in restarted.status(h.correlationId));
    assert.throws(() => restarted.init(), /handoff_ledger_exists/);
    assert.deepEqual(readFileSync(f.journal), before);
    if (damage === 'missing') assert.equal(existsSync(f.key), false);
    else assert.deepEqual(readFileSync(f.key), keyBefore);
  });
}

test('rotated key is rejected even for an empty ledger; orphan key is never reused by init', posix, t => {
  const f = fixture(t), before = readFileSync(f.journal); writeFileSync(f.key, randomBytes(32));
  assert.throws(() => new HandoffLedger(f.path).prepare(f.binding));
  assert.deepEqual(readFileSync(f.journal), before);
  unlinkSync(f.journal); const keyBefore = readFileSync(f.key);
  assert.throws(() => new HandoffLedger(f.path).init());
  assert.equal(existsSync(f.journal), false); assert.deepEqual(readFileSync(f.key), keyBefore);
});

test('ciphertext is authenticated against the original epoch and intent ID', posix, t => {
  const f = fixture(t), a = f.ledger.prepare(f.binding), b = f.ledger.prepare({ ...f.binding, target: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  const original = readFileSync(f.journal, 'utf8'), wrapper = JSON.parse(original);
  wrapper.data.records[b.correlationId].binding.payloadDigest = wrapper.data.records[a.correlationId].binding.payloadDigest;
  wrapper.digest = payloadDigest(JSON.stringify(wrapper.data)); writeFileSync(f.journal, JSON.stringify(wrapper));
  assert.throws(() => new HandoffLedger(f.path).commitEffect(b.correlationId, f.binding), /handoff_ledger_corrupt/);
  const changedEpoch = JSON.parse(original); changedEpoch.data.epoch = randomUUID();
  for (const item of Object.values(changedEpoch.data.records) as { handoff: { ledgerEpoch: string } }[]) item.handoff.ledgerEpoch = changedEpoch.data.epoch;
  changedEpoch.digest = payloadDigest(JSON.stringify(changedEpoch.data)); writeFileSync(f.journal, JSON.stringify(changedEpoch));
  assert.throws(() => new HandoffLedger(f.path).prepare(f.binding, { correlationId: a.correlationId }), /handoff_ledger_corrupt/);
});

test('plaintext historical journal is refused without silently migrating or replacing the key', posix, t => {
  const f = fixture(t), h = f.ledger.prepare(f.binding), wrapper = JSON.parse(readFileSync(f.journal, 'utf8'));
  wrapper.data.records[h.correlationId].binding.payloadDigest = f.binding.payloadDigest;
  wrapper.digest = payloadDigest(JSON.stringify(wrapper.data)); writeFileSync(f.journal, JSON.stringify(wrapper));
  const journalBefore = readFileSync(f.journal), keyBefore = readFileSync(f.key);
  assert.throws(() => new HandoffLedger(f.path).prepare(f.binding, { correlationId: h.correlationId }), /handoff_ledger_corrupt/);
  assert.deepEqual(readFileSync(f.journal), journalBefore); assert.deepEqual(readFileSync(f.key), keyBefore);
});
