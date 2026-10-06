// Exact candidate pins and synthetic examples only; no receipt, observer or native engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

type Pin = {
  status: string; proposalVersion: string; pythonRepository: string; pythonDesignPR: number;
  pythonDesignCommit: string; pythonRuntimeVersion: string; pythonRuntimeCommit: string;
  document: { path: string; upstreamPath: string; sha256: string };
  fixture: { path: string; upstreamPath: string; sha256: string };
  runtimeImplemented: boolean; jointFreezeApproved: boolean; openReviewGates: string[];
};
type Handoff = {
  schemaVersion: number; state: string; submission: { status: string };
  observation: { status: string; injectionObserved: boolean };
  ack: { status: string; late?: boolean }; wait: { status: string };
  retry: { allowed: boolean; reason: string }; nextActions: string[];
};
type Example = {
  name: string; mode: string; exit: number;
  result: { ok: boolean; status?: string; submitted?: boolean; consumptionConfirmed?: boolean; handoff: Handoff };
};
type Fixture = {
  schemaVersion: number; proposalVersion: string; status: string;
  provenance: { pythonRuntimeVersion: string; pythonRuntimeCommit: string; exampleKind: string };
  legacySnapshots: { name: string; result: Record<string, unknown>; mustRemainAbsent: string[]; noEffectProof?: boolean }[];
  accepted: Example[];
};
const file = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
const pin = JSON.parse(file('handoff-v1.pin.json').toString('utf8')) as Pin;
const fixture = JSON.parse(file('handoff-v1.json').toString('utf8')) as Fixture;
const example = (name: string) => {
  const value = fixture.accepted.find(x => x.name === name);
  assert.ok(value, `missing shared design example: ${name}`);
  return value;
};

test('handoff candidate document and fixture match one explicit upstream design commit', () => {
  assert.equal(pin.pythonRepository, 'abruption/session-peer');
  assert.equal(pin.pythonDesignPR, 261);
  assert.match(pin.pythonDesignCommit, /^[a-f0-9]{40}$/);
  assert.equal(pin.document.path, 'handoff-v1.md');
  assert.equal(pin.fixture.path, 'handoff-v1.json');
  for (const entry of [pin.document, pin.fixture]) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(file(entry.path)).digest('hex'), entry.sha256);
  }
  assert.equal(pin.pythonRuntimeVersion, '1.0.3');
  assert.equal(pin.pythonRuntimeCommit, '0d252550ab40c26d1ac4a19193df6ca2f84d830b');
  assert.equal(fixture.provenance.pythonRuntimeCommit, pin.pythonRuntimeCommit);
  assert.equal(fixture.provenance.pythonRuntimeVersion, pin.pythonRuntimeVersion);
});

test('mirrored proposal remains explicitly synthetic, unimplemented and unfrozen', () => {
  assert.equal(pin.status, 'candidate_not_frozen');
  assert.equal(pin.jointFreezeApproved, false);
  assert.equal(pin.runtimeImplemented, false);
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.proposalVersion, pin.proposalVersion);
  assert.equal(fixture.status, 'draft_unimplemented');
  assert.equal(fixture.provenance.exampleKind, 'synthetic_normalized_not_live');
  assert.ok(pin.openReviewGates.length > 0);
  const document = file(pin.document.path).toString('utf8');
  assert.match(document, /not a frozen protocol/);
  assert.match(document, /No native\/live evidence/);
});

test('shared golden examples preserve submission, legacy absence and terminal wait facts', () => {
  for (const snapshot of fixture.legacySnapshots) {
    for (const key of snapshot.mustRemainAbsent) assert.equal(Object.hasOwn(snapshot.result, key), false);
  }
  const unknown = fixture.legacySnapshots.find(x => x.name === 'legacy_unknown_false_not_no_effect');
  assert.ok(unknown); assert.equal(unknown.result.submitted, false); assert.equal(unknown.noEffectProof, false);
  const timeout = example('queued_explicit_ack_timeout');
  assert.equal(timeout.exit, 1); assert.equal(timeout.result.ok, false);
  assert.equal(timeout.result.status, 'queued'); assert.equal(timeout.result.submitted, true);
  assert.equal(timeout.result.consumptionConfirmed, false);
  const observer = example('queued_best_effort_observer_failed');
  assert.equal(observer.exit, 0); assert.equal(observer.result.ok, true); assert.equal(observer.result.submitted, true);
  const late = example('late_receipt_preserves_timeout_history');
  assert.equal(late.result.handoff.state, 'acknowledged'); assert.equal(late.result.handoff.ack.late, true);
  assert.equal(late.result.handoff.wait.status, 'timed_out_unknown');
  const dry = example('dry_run_preserves_codex_false');
  assert.equal(dry.result.handoff.submission.status, 'not_attempted');
  assert.equal(dry.result.handoff.observation.injectionObserved, false);
  for (const value of fixture.accepted) {
    assert.equal(value.result.handoff.retry.allowed, false);
    assert.equal(value.result.handoff.retry.reason, 'receiver_dedup_unavailable');
    assert.equal(value.result.handoff.nextActions.includes('resend_same_id'), false);
  }
});
