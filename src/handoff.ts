// Pure opt-in protocol helpers. Importing this module performs no filesystem IO.
import { Refusal } from './discovery.js';

export const HANDOFF_LIMITS = Object.freeze({ privateFrame: 4096, publicFrame: 8192, outerFrame: 1048576,
  fanout: 32, aggregateFrame: 34603008, intents: 10000, journal: 33554432, waits: 64,
  detailMs: 30 * 86400000, capabilityMs: 86400000, cleanupMs: 5000 });
export type WaitFor = 'none' | 'delivered' | 'acknowledged';
export type WaitStatus = 'not_requested' | 'pending' | 'satisfied' | 'timed_out_unknown' | 'stopped' | 'unsupported' | 'failed';
export type WaitReason = 'insufficient_budget' | 'deadline_before_effect' | 'evidence_unsupported' | 'evidence_failed' | 'history_unavailable' | 'stopped_by_operator' | 'invalid_handoff';
export type Handoff = {
  schemaVersion: 1; correlationId: string; ledgerEpoch: string;
  state: 'validated' | 'refused' | 'submitted' | 'delivered' | 'acknowledged' | 'unknown' | 'timed_out_unknown';
  submission: { status: 'not_attempted' | 'submitted' | 'refused' | 'unknown' };
  observation: { status: 'not_requested' | 'pending' | 'observed' | 'unsupported' | 'failed'; injectionObserved: boolean;
    clientUserMessageId?: string; turn?: { id: string; status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' } };
  ack: { status: 'not_requested' | 'pending' | 'acknowledged' | 'unsupported'; assurance?: 'token_possession' | 'operator_confirmed'; receivedAtUtcMs?: number; late?: boolean };
  wait: { for: WaitFor; status: WaitStatus; operationId?: string; deadlineAtUtcMs?: number; reason?: WaitReason };
  targetGeneration: string | null; decisionOwner: 'sender_operator';
  retry: { allowed: false; reason: 'receiver_dedup_unavailable' };
  nextActions: ('keep_waiting' | 'reconcile' | 'stop_waiting')[];
};
export type PublicHandoff = Handoff;
export type Clock = { monotonic: () => number; utc: () => number };
export const systemClock: Clock = { monotonic: () => performance.now(), utc: () => Date.now() };
export function fail(code = 'invalid_handoff', exitCode = 1): never { throw new Refusal(code, exitCode); }
export function canonicalId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function safeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
export function safeId(value: unknown, bytes = 128): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= bytes &&
    !/[\x00-\x1f\x7f-\x9f]/.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
export function parseWaitTimeout(value: string): number {
  if (!/^(?:[1-9]|[1-5][0-9]|60)$/.test(value)) fail('invalid_wait_timeout', 2);
  return Number(value);
}
export class HandoffBudget {
  readonly startedAt: number; readonly cutoff: number; readonly deadline: number; readonly deadlineAtUtcMs: number;
  constructor(readonly seconds = 30, readonly clock: Clock = systemClock) {
    parseWaitTimeout(String(seconds));
    this.startedAt = clock.monotonic(); this.deadline = this.startedAt + seconds * 1000;
    this.cutoff = this.deadline - HANDOFF_LIMITS.cleanupMs;
    this.deadlineAtUtcMs = Math.max(0, Math.floor(clock.utc() + Math.max(0, seconds * 1000 - HANDOFF_LIMITS.cleanupMs)));
  }
  remainingMs(): number { return Math.max(0, this.deadline - this.clock.monotonic()); }
  observationRemainingMs(): number { return Math.max(0, this.cutoff - this.clock.monotonic()); }
  beforeEffect(): void {
    if (this.seconds <= 5) fail('insufficient_budget');
    if (this.clock.monotonic() >= this.cutoff) fail('deadline_before_effect');
  }
}

// Recursive token parser keeps integer lexemes before JavaScript can round them.
// Outer mode restricts new-schema subtrees only; native numeric siblings retain
// their existing grammar. Duplicate keys/nonfinite numbers always fail closed.
export function parseStrictJson(raw: string | Uint8Array, options: { scope?: 'private' | 'handoff' | 'query' | 'outer'; maxBytes?: number } = {}): unknown {
  if (typeof raw === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(raw)) fail('invalid_handoff_json');
  const scope = options.scope ?? 'private', bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  const maximum = options.maxBytes ?? (scope === 'outer' ? HANDOFF_LIMITS.outerFrame : scope === 'handoff' ? HANDOFF_LIMITS.publicFrame : HANDOFF_LIMITS.privateFrame);
  if (bytes.byteLength > maximum) fail('handoff_frame_too_large');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('invalid_handoff_json'); }
  let position = 0;
  const space = () => { while (/[\x20\t\r\n]/.test(text[position] ?? 'x')) position++; };
  const string = (): string => {
    const start = position++;
    while (position < text.length) {
      const c = text[position++];
      if (c === '"') { try { return JSON.parse(text.slice(start, position)) as string; } catch { fail('invalid_handoff_json'); } }
      if (c === '\\') position++;
    }
    fail('invalid_handoff_json');
  };
  const value = (strict: boolean, depth: number): unknown => {
    if (depth > 64) fail('invalid_handoff_json');
    space(); const c = text[position];
    if (c === '"') return string();
    if (c === '{') {
      position++; space(); const result: Record<string, unknown> = Object.create(null), keys = new Set<string>();
      if (text[position] === '}') { position++; return result; }
      while (true) {
        space(); if (text[position] !== '"') fail('invalid_handoff_json'); const key = string();
        if (keys.has(key)) fail('invalid_handoff_json'); keys.add(key);
        space(); if (text[position++] !== ':') fail('invalid_handoff_json');
        result[key] = value(strict || (scope === 'outer' && depth === 0 && ['handoff', 'handoffQuery'].includes(key)), depth + 1);
        space(); const separator = text[position++]; if (separator === '}') break; if (separator !== ',') fail('invalid_handoff_json');
      }
      return result;
    }
    if (c === '[') {
      position++; space(); const result: unknown[] = []; if (text[position] === ']') { position++; return result; }
      while (true) { result.push(value(strict, depth + 1)); space(); const separator = text[position++]; if (separator === ']') break; if (separator !== ',') fail('invalid_handoff_json'); }
      return result;
    }
    for (const [literal, item] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, position)) { position += literal.length; return item; }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(position))?.[0];
    if (!token) fail('invalid_handoff_json'); position += token.length; const number = Number(token);
    if (!Number.isFinite(number) || (strict && (!/^(?:0|[1-9][0-9]*)$/.test(token) || !safeInteger(number)))) fail('invalid_handoff_json');
    return number;
  };
  const result = value(scope !== 'outer', 0); space(); if (position !== text.length) fail('invalid_handoff_json'); return result;
}
export function closed(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) fail();
  return row;
}
const member = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value);
export function validateHandoff(value: unknown): Handoff {
  const row = closed(value, ['schemaVersion', 'correlationId', 'ledgerEpoch', 'state', 'submission', 'observation', 'ack', 'wait', 'targetGeneration', 'decisionOwner', 'retry', 'nextActions']);
  const sub = closed(row.submission, ['status']), obs = closed(row.observation, ['status', 'injectionObserved'], ['clientUserMessageId', 'turn']);
  const ack = closed(row.ack, ['status'], ['assurance', 'receivedAtUtcMs', 'late']);
  const wait = closed(row.wait, ['for', 'status'], ['operationId', 'deadlineAtUtcMs', 'reason']);
  const retry = closed(row.retry, ['allowed', 'reason']);
  if (row.schemaVersion !== 1 || !canonicalId(row.correlationId) || !canonicalId(row.ledgerEpoch) ||
      !member(row.state, ['validated', 'refused', 'submitted', 'delivered', 'acknowledged', 'unknown', 'timed_out_unknown']) ||
      !member(sub.status, ['not_attempted', 'submitted', 'refused', 'unknown']) ||
      !member(obs.status, ['not_requested', 'pending', 'observed', 'unsupported', 'failed']) || typeof obs.injectionObserved !== 'boolean' ||
      !member(ack.status, ['not_requested', 'pending', 'acknowledged', 'unsupported']) ||
      !member(wait.for, ['none', 'delivered', 'acknowledged']) || !member(wait.status, ['not_requested', 'pending', 'satisfied', 'timed_out_unknown', 'stopped', 'unsupported', 'failed']) ||
      (row.targetGeneration !== null && !safeId(row.targetGeneration, 256)) || row.decisionOwner !== 'sender_operator' ||
      retry.allowed !== false || retry.reason !== 'receiver_dedup_unavailable' || !Array.isArray(row.nextActions) ||
      row.nextActions.some(item => !member(item, ['keep_waiting', 'reconcile', 'stop_waiting'])) || new Set(row.nextActions).size !== row.nextActions.length) fail();
  if (Object.hasOwn(obs, 'clientUserMessageId') && !safeId(obs.clientUserMessageId)) fail();
  if (obs.injectionObserved !== (obs.status === 'observed') ||
      (obs.injectionObserved && (!safeId(obs.clientUserMessageId) || row.targetGeneration === null || sub.status !== 'submitted')) ||
      (!obs.injectionObserved && Object.hasOwn(obs, 'clientUserMessageId'))) fail();
  if (Object.hasOwn(obs, 'turn')) {
    const turn = closed(obs.turn, ['id', 'status']);
    if (!obs.injectionObserved || !safeId(turn.id) || !member(turn.status, ['running', 'completed', 'failed', 'interrupted', 'unknown'])) fail();
  }
  if (ack.status === 'acknowledged') {
    if (!member(ack.assurance, ['token_possession', 'operator_confirmed']) || !safeInteger(ack.receivedAtUtcMs) || typeof ack.late !== 'boolean' || row.state !== 'acknowledged' || sub.status !== 'submitted' || row.targetGeneration === null) fail();
  } else if (['assurance', 'receivedAtUtcMs', 'late'].some(key => Object.hasOwn(ack, key))) fail();
  if (row.targetGeneration === null && (ack.status === 'pending' || ack.status === 'acknowledged' || wait.status === 'pending' || wait.status === 'satisfied')) fail();
  const states: Record<string, string> = { validated: 'not_attempted', refused: 'refused', submitted: 'submitted', delivered: 'submitted', acknowledged: 'submitted', unknown: 'unknown' };
  if ((row.state !== 'timed_out_unknown' && sub.status !== states[row.state as string]) ||
      (row.state === 'timed_out_unknown' && !['submitted', 'unknown'].includes(sub.status as string)) ||
      (row.state === 'delivered' && !obs.injectionObserved) || (row.state === 'acknowledged' && ack.status !== 'acknowledged')) fail();
  if (wait.for === 'none') {
    if (wait.status !== 'not_requested' || Object.keys(wait).length !== 2) fail();
  } else if (wait.status === 'not_requested' || !canonicalId(wait.operationId) || !safeInteger(wait.deadlineAtUtcMs)) fail();
  if (Object.hasOwn(wait, 'reason') && !member(wait.reason, ['insufficient_budget', 'deadline_before_effect', 'evidence_unsupported', 'evidence_failed', 'history_unavailable', 'stopped_by_operator', 'invalid_handoff'])) fail();
  if (wait.status === 'stopped' && wait.reason !== 'stopped_by_operator') fail();
  if (wait.status === 'satisfied' && (wait.for === 'delivered' ? !obs.injectionObserved : ack.status !== 'acknowledged')) fail();
  if (row.nextActions.includes('keep_waiting') && (row.targetGeneration === null || wait.status === 'unsupported' || ack.status === 'unsupported' || !['submitted', 'unknown'].includes(sub.status as string))) fail();
  if (row.nextActions.includes('stop_waiting') && wait.status !== 'pending') fail();
  if (Buffer.byteLength(JSON.stringify(row), 'utf8') > HANDOFF_LIMITS.publicFrame) fail('handoff_frame_too_large');
  return structuredClone(row) as Handoff;
}
export type Receipt = { schemaVersion: 1; kind: 'receipt'; ledgerEpoch: string; correlationId: string; targetGeneration: string; receiptId: string; capability: string };
export type Confirmation = { schemaVersion: 1; ledgerEpoch: string; correlationId: string; targetGeneration: string; confirmed: true };
export function validateHandoffQuery(value: unknown): { schemaVersion: 1; correlationId: string; status: 'unknown'; context: 'ledger_missing' | 'ledger_corrupt' | 'id_unknown'; retry: { allowed: false; reason: 'history_unavailable' } } {
  const row = closed(value, ['schemaVersion', 'correlationId', 'status', 'context', 'retry']);
  const retry = closed(row.retry, ['allowed', 'reason']);
  if (row.schemaVersion !== 1 || !canonicalId(row.correlationId) || row.status !== 'unknown' ||
      !member(row.context, ['ledger_missing', 'ledger_corrupt', 'id_unknown']) || retry.allowed !== false || retry.reason !== 'history_unavailable') fail();
  return structuredClone(row) as ReturnType<typeof validateHandoffQuery>;
}
export function validateReceipt(raw: string | Uint8Array): Receipt {
  const row = closed(parseStrictJson(raw), ['schemaVersion', 'kind', 'ledgerEpoch', 'correlationId', 'targetGeneration', 'receiptId', 'capability']);
  if (row.schemaVersion !== 1 || row.kind !== 'receipt' || !canonicalId(row.ledgerEpoch) || !canonicalId(row.correlationId) || !canonicalId(row.receiptId) || !safeId(row.targetGeneration, 256) ||
      typeof row.capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(row.capability) || Buffer.from(row.capability, 'base64url').length !== 32 || Buffer.from(row.capability, 'base64url').toString('base64url') !== row.capability) fail('invalid_receipt');
  return row as Receipt;
}
export function validateConfirmation(raw: string | Uint8Array): Confirmation {
  const row = closed(parseStrictJson(raw), ['schemaVersion', 'ledgerEpoch', 'correlationId', 'targetGeneration', 'confirmed']);
  if (row.schemaVersion !== 1 || !canonicalId(row.ledgerEpoch) || !canonicalId(row.correlationId) || !safeId(row.targetGeneration, 256) || row.confirmed !== true) fail('invalid_confirmation');
  return row as Confirmation;
}
