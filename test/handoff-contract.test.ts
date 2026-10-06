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
  queryErrors: { name: string; exit: number; result: Record<string, unknown> & {
    ok: boolean; reason: string; handoffQuery: { status: string; context: string; retry: { allowed: boolean; reason: string } };
  } }[];
  requestAwareWireCases: { name: string; optIn: boolean; explicitWait: boolean; exit: number; expected: {
    wireAccepted: boolean; nativeEvidencePreserved: boolean; handoffValidated: boolean; ackPromoted: boolean; resubmit: boolean;
  } }[];
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

// Expected-contract assertions only; these do not execute a query or wire handler.
test('amended missing-context examples never invent a ledger epoch or native snapshot', () => {
  assert.equal(fixture.queryErrors.length, 3);
  for (const value of fixture.queryErrors) {
    assert.equal(value.exit, 1); assert.equal(value.result.ok, false);
    assert.equal(value.result.reason, 'handoff_history_unavailable');
    assert.equal(value.result.handoffQuery.status, 'unknown');
    assert.ok(['ledger_missing', 'ledger_corrupt', 'id_unknown'].includes(value.result.handoffQuery.context));
    assert.equal(value.result.handoffQuery.retry.allowed, false);
    assert.equal(value.result.handoffQuery.retry.reason, 'history_unavailable');
    for (const key of ['handoff', 'ledgerEpoch', 'status', 'submitted', 'consumptionConfirmed']) {
      assert.equal(Object.hasOwn(value.result, key), false);
    }
    assert.equal(Object.hasOwn(value.result.handoffQuery, 'ledgerEpoch'), false);
  }
});

test('amended declared wire cases require original opt-in and native-target evidence', () => {
  assert.equal(fixture.requestAwareWireCases.length, 39);
  for (const value of fixture.requestAwareWireCases) {
    assert.equal(value.expected.resubmit, false);
    if (!value.optIn) {
      // A valid legacy success remains acceptable; unrequested metadata never
      // enables a failed-wait tuple or authenticated handoff/ACK evidence.
      if (value.exit !== 0) assert.equal(value.expected.wireAccepted, false);
      assert.equal(value.expected.handoffValidated, false);
      assert.equal(value.expected.ackPromoted, false);
    }
    if (value.name.includes('wrong_native_target')) {
      assert.equal(value.expected.nativeEvidencePreserved, false);
      assert.equal(value.expected.wireAccepted, false);
      assert.equal(value.expected.ackPromoted, false);
    }
  }
});

// These are pinned example invariants, not executions of the proposed operations.
test('final candidate distinguishes native profiles, unsupported waits and interruption results', () => {
  const pythonClaude = example('python_claude_explicit_ack_timeout');
  assert.equal(pythonClaude.exit, 1); assert.equal(pythonClaude.result.ok, false);
  for (const key of ['status', 'submitted', 'consumptionConfirmed']) {
    assert.equal(Object.hasOwn(pythonClaude.result, key), false);
  }
  assert.equal(pythonClaude.result.handoff.submission.status, 'submitted');
  const typescriptClaude = example('typescript_claude_explicit_ack_timeout');
  assert.equal(typescriptClaude.result.status, 'posted'); assert.equal(typescriptClaude.result.submitted, true);
  assert.equal(typescriptClaude.result.consumptionConfirmed, false);
  const unsupported = example('queued_post_submission_unsupported');
  assert.equal(unsupported.exit, 1); assert.equal(unsupported.result.ok, false);
  assert.equal(unsupported.result.status, 'queued'); assert.equal(unsupported.result.submitted, true);
  assert.equal(unsupported.result.handoff.wait.status, 'unsupported');
  const interrupted = example('queued_interrupted_pending_wait');
  assert.equal(interrupted.exit, 130); assert.equal(interrupted.result.ok, false);
  assert.equal(interrupted.result.status, 'queued'); assert.equal(interrupted.result.submitted, true);
  assert.equal(interrupted.result.handoff.wait.status, 'stopped');
  const query = example('stopped_status_query');
  assert.equal(query.exit, 0); assert.equal(query.result.ok, true);
  assert.equal(query.result.handoff.wait.status, 'stopped');
  for (const name of ['codex_posted_is_invalid', 'codex_consumption_overwrite', 'wrong_codex_home',
    'interrupted_wrong_exit_one', 'interrupted_wrong_exit_zero', 'interrupted_wrong_wait_reason']) {
    const value = fixture.requestAwareWireCases.find(x => x.name === name);
    assert.ok(value, `missing final design vector: ${name}`);
    assert.equal(value.expected.wireAccepted, false); assert.equal(value.expected.resubmit, false);
  }
});
