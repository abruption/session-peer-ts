// Single-owner receipt actor. It only records the original caller's evidence;
// it never sends native input, reads transcripts or treats a token as identity.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalId, closed, fail, HANDOFF_LIMITS, safeInteger, systemClock, type Clock, type Handoff } from './handoff.js';
import { ReceiptStore, receiptDigest } from './receipt-store.js';
import { validateBinding, validateProducerEvidence, validateReceiptPair, validateManagedHandoff, validateManagedReceipt,
  type ReceiptBinding, type ProducerEvidence, type ManagedHandoff, type ReceiptScope } from './receipt-protocol.js';

type Handle = { ledgerEpoch: string; correlationId: string; receiptContextId: string | null };
type Selector = Pick<Handle, 'ledgerEpoch' | 'correlationId'>;
type Wait = { public: Handoff['wait']; clockId: string; cutoff: number };
type Candidate = { receiptId: string; receiptSchemaVersion: 1 | 2; receiptScope: ReceiptScope; receiptContextId: string | null;
  arrivalClockContextId: string; arrivalMonotonic: number; arrivalUtcMs: number };
type RecordIntent = { binding: ReceiptBinding; producerEvidence: ProducerEvidence; receiptSchemaVersion: 1 | 2;
  receiptScope: ReceiptScope; receiptContextId: string | null; originClockId: string; preparedMono: number; preparedUtc: number;
  phase: 'prepared' | 'fenced' | 'finished'; handoff: ManagedHandoff; waits: Wait[]; reserve: number;
  revoked: boolean; expired: boolean; capabilityHash?: string; receiptId?: string; pendingReceipt?: Candidate };
type Ledger = { version: 2; epoch: string; keyId: string; quarantined: boolean; records: Record<string, RecordIntent> };
export type ReceiptPreparation = { binding: ReceiptBinding; receiptSchemaVersion: 1 | 2; receiptScope: ReceiptScope; producerEvidence: ProducerEvidence };
export type PreparedReceipt = Handle & { handoff: ManagedHandoff };
export type MintedReceipt = Handle & { capability: string; receiptSchemaVersion: 1 | 2; receiptScope: ReceiptScope; targetGeneration: string | null };
export type ReceiptAcceptance = { status: 'awaiting_submission' | 'acknowledged'; receiptId: string; handoff: ManagedHandoff };
const reserveBytes = 65536;
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function normalizeBinding(value: unknown): ReceiptBinding {
  const row = validateBinding(value);
  // Stable keys make comparison independent of sender JSON insertion order.
  return Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) as ReceiptBinding;
}
function assertSelector(value: Selector): void {
  closed(value, ['ledgerEpoch', 'correlationId']);
  if (!canonicalId(value.ledgerEpoch) || !canonicalId(value.correlationId)) fail('receipt_id_unknown');
}

export class ReceiptState {
  readonly collectorContextId = randomUUID();
  private readonly clock: Clock;
  private store?: ReceiptStore;
  private data?: Ledger;
  private busy = false;
  private stopped = false;
  private lastMono?: number;
  constructor(readonly path: string, options: { clock?: Clock } = {}) { this.clock = options.clock ?? systemClock; }
  static initialize(path: string, endpointSelector: string) {
    return ReceiptStore.initialize(path, endpointSelector);
  }
  get endpointSelector(): string { if (!this.store) fail('receipt_collector_closed'); return this.store.marker.endpointSelector; }
  get ledgerEpoch(): string { if (!this.data) fail('receipt_collector_closed'); return this.data.epoch; }
  assertOpen(): void {
    if (!this.store || !this.data || this.stopped) fail('receipt_collector_closed');
    this.now(); this.store.assertUnchanged();
  }
  open(): this {
    if (this.store || this.stopped) fail('receipt_collector_closed');
    try {
      this.store = new ReceiptStore(this.path);
      const raw = this.store.read() as Ledger;
      if (!raw.records || typeof raw.records !== 'object' || Array.isArray(raw.records)) fail('receipt_history_corrupt');
      for (const [id, item] of Object.entries(raw.records)) {
        if (!canonicalId(id) || !item || typeof item !== 'object' || !item.binding) fail('receipt_history_corrupt');
        item.binding.payloadDigest = this.store.openDigest(item.binding.payloadDigest, raw.epoch, id);
      }
      this.validate(raw); this.data = raw;
      // Restart never adopts a prior owner's live authority or monotonic waits.
      this.transact(data => {
        let changed = false;
        for (const item of Object.values(data.records)) changed = this.classify(item) || changed;
        return { value: undefined, write: changed };
      });
      return this;
    } catch (error) {
      this.store?.close(); this.store = undefined; this.data = undefined; this.stopped = true;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('receipt_history_unavailable');
      throw error;
    }
  }
  close(): void { this.stopped = true; this.store?.close(); this.store = undefined; this.data = undefined; }
  private now(): number {
    const now = this.clock.monotonic();
    if (!finite(now) || (this.lastMono !== undefined && now < this.lastMono)) {
      // Observed clock loss permanently closes this owner. Catching up later
      // cannot revive a capability or a deadline from the lost clock context.
      this.stopped = true; fail('receipt_authority_expired');
    }
    this.lastMono = now; return now;
  }
  clockReference(): number {
    this.assertOpen();
    return Math.floor(this.now());
  }
  private utc(): number { const now = Math.floor(this.clock.utc()); if (!safeInteger(now)) fail('receipt_authority_unavailable'); return now; }
  private transact<T>(operation: (data: Ledger) => { value: T; write?: boolean }): T {
    if (this.busy) fail('receipt_collector_busy');
    if (!this.store || !this.data || this.stopped) fail('receipt_collector_closed');
    this.busy = true;
    try {
      this.store.assertUnchanged();
      const copy = structuredClone(this.data), result = operation(copy);
      if (result.write !== false) {
        this.validate(copy);
        const stored = structuredClone(copy);
        for (const [id, item] of Object.entries(stored.records)) item.binding.payloadDigest = this.store.sealDigest(item.binding.payloadDigest, stored.epoch, id);
        const text = JSON.stringify({ digest: receiptDigest(JSON.stringify(stored)), data: stored });
        const reserved = Object.values(stored.records).reduce((n, item) => n + Math.max(0, item.reserve - Buffer.byteLength(JSON.stringify(item))), 0);
        if (Buffer.byteLength(text) + reserved > HANDOFF_LIMITS.journal) fail('receipt_ledger_full');
        try { this.store.write(stored); } catch (error) { this.stopped = true; throw error; }
        this.data = copy;
      }
      return result.value;
    } finally { this.busy = false; }
  }
  private validate(data: Ledger): void {
    try {
      closed(data, ['version', 'epoch', 'keyId', 'quarantined', 'records']);
      if (data.version !== 2 || !canonicalId(data.epoch) || !hex(data.keyId) || typeof data.quarantined !== 'boolean' ||
          !data.records || typeof data.records !== 'object' || Array.isArray(data.records) || Object.keys(data.records).length > HANDOFF_LIMITS.intents) throw 0;
      for (const [id, item] of Object.entries(data.records)) {
        closed(item, ['binding', 'producerEvidence', 'receiptSchemaVersion', 'receiptScope', 'receiptContextId', 'originClockId',
          'preparedMono', 'preparedUtc', 'phase', 'handoff', 'waits', 'reserve', 'revoked', 'expired'], ['capabilityHash', 'receiptId', 'pendingReceipt']);
        if (!canonicalId(id) || !canonicalId(item.originClockId) || !finite(item.preparedMono) || !safeInteger(item.preparedUtc) ||
            !['prepared', 'fenced', 'finished'].includes(item.phase) || typeof item.revoked !== 'boolean' || typeof item.expired !== 'boolean' ||
            !safeInteger(item.reserve) || item.reserve > reserveBytes || !Array.isArray(item.waits) || item.waits.length > HANDOFF_LIMITS.waits) throw 0;
        item.binding = normalizeBinding(item.binding); validateProducerEvidence(item.producerEvidence);
        validateReceiptPair(item.binding.agent, item.receiptSchemaVersion, item.receiptScope);
        if (item.producerEvidence.receiptSchemaVersion !== item.receiptSchemaVersion || item.producerEvidence.receiptScope !== item.receiptScope ||
            (item.binding.agent === 'codex' ? item.receiptContextId !== null : !canonicalId(item.receiptContextId))) throw 0;
        const h = validateManagedHandoff(item.handoff);
        if (h.correlationId !== id || h.ledgerEpoch !== data.epoch || h.targetGeneration !== item.binding.generation ||
            h.schemaVersion !== item.receiptSchemaVersion || (h.schemaVersion === 2 && h.receiptContext.id !== item.receiptContextId)) throw 0;
        if (item.capabilityHash !== undefined && !hex(item.capabilityHash)) throw 0;
        if (item.receiptId !== undefined && (!canonicalId(item.receiptId) || h.ack.status !== 'acknowledged')) throw 0;
        if (h.ack.status === 'acknowledged' && (!item.receiptId || !item.capabilityHash || h.submission.status !== 'submitted')) throw 0;
        if (item.phase === 'prepared' && h.submission.status !== 'not_attempted') throw 0;
        if (item.phase === 'fenced' && h.submission.status !== 'unknown') throw 0;
        if (item.phase === 'finished' && !['submitted', 'refused', 'unknown'].includes(h.submission.status)) throw 0;
        for (const wait of item.waits) {
          closed(wait, ['public', 'clockId', 'cutoff']);
          if (!canonicalId(wait.clockId) || !finite(wait.cutoff)) throw 0;
          validateManagedHandoff({ ...h, wait: wait.public, nextActions: ['reconcile'] });
        }
        if (item.pendingReceipt !== undefined) {
          const p = item.pendingReceipt;
          closed(p, ['receiptId', 'receiptSchemaVersion', 'receiptScope', 'receiptContextId', 'arrivalClockContextId', 'arrivalMonotonic', 'arrivalUtcMs']);
          if (!canonicalId(p.receiptId) || p.receiptSchemaVersion !== item.receiptSchemaVersion || p.receiptScope !== item.receiptScope ||
              p.receiptContextId !== item.receiptContextId || !canonicalId(p.arrivalClockContextId) || !finite(p.arrivalMonotonic) || !safeInteger(p.arrivalUtcMs) ||
              !item.capabilityHash || item.phase === 'prepared' || (item.receiptId !== undefined && item.receiptId !== p.receiptId)) throw 0;
        }
      }
    } catch { fail('receipt_history_corrupt'); }
  }
  private item(data: Ledger, selector: Selector): RecordIntent {
    assertSelector(selector);
    if (data.epoch !== selector.ledgerEpoch) fail('receipt_epoch_mismatch');
    if (data.quarantined) fail('receipt_history_quarantined');
    const item = data.records[selector.correlationId]; if (!item) fail('receipt_id_unknown');
    if (item.expired || this.utc() - item.preparedUtc >= HANDOFF_LIMITS.detailMs) fail('receipt_history_unavailable');
    return item;
  }
  private handle(data: Ledger, value: Handle): RecordIntent {
    const item = this.item(data, { ledgerEpoch: value.ledgerEpoch, correlationId: value.correlationId });
    if (value.receiptContextId !== item.receiptContextId) fail('receipt_context_mismatch');
    return item;
  }
  private authority(item: RecordIntent): boolean {
    const elapsed = this.now() - item.preparedMono;
    return !!item.capabilityHash && !item.revoked && !item.expired && item.originClockId === this.collectorContextId &&
      elapsed >= 0 && elapsed < HANDOFF_LIMITS.capabilityMs;
  }
  private classify(item: RecordIntent): boolean {
    const before = JSON.stringify(item), h = item.handoff, now = this.now();
    const live = this.authority(item);
    if (h.ack.status === 'pending' && !live) h.ack = { status: 'unsupported' };
    for (const wait of item.waits) {
      if (wait.public.status !== 'pending') continue;
      if (!live || wait.clockId !== this.collectorContextId) {
        wait.public.status = 'unsupported'; wait.public.reason = 'evidence_unsupported';
      } else if (now >= wait.cutoff) {
        if (item.phase === 'prepared') {
          wait.public.status = 'failed'; wait.public.reason = 'deadline_before_effect';
          item.phase = 'finished'; item.revoked = true; h.state = 'refused'; h.submission = { status: 'refused' }; h.ack = { status: 'unsupported' };
        } else {
          wait.public.status = 'timed_out_unknown';
          if (h.ack.status !== 'acknowledged') h.state = 'timed_out_unknown';
        }
      }
    }
    if (item.waits.length) h.wait = structuredClone(item.waits.at(-1)!.public);
    if (h.ack.status !== 'acknowledged' && h.wait.status === 'timed_out_unknown' && ['submitted', 'unknown'].includes(h.submission.status)) h.state = 'timed_out_unknown';
    h.nextActions = ['reconcile'];
    if (h.wait.status === 'pending') {
      h.nextActions.push('stop_waiting');
      if (h.ack.status === 'pending' && ['submitted', 'unknown'].includes(h.submission.status)) h.nextActions.unshift('keep_waiting');
    }
    return before !== JSON.stringify(item);
  }
  private snapshot(item: RecordIntent, wait?: Wait): ManagedHandoff {
    const h = structuredClone(item.handoff);
    if (wait) {
      h.wait = structuredClone(wait.public); h.nextActions = ['reconcile'];
      if (wait.public.status === 'pending') {
        h.nextActions.push('stop_waiting');
        if (h.ack.status === 'pending' && ['submitted', 'unknown'].includes(h.submission.status)) h.nextActions.unshift('keep_waiting');
      }
    }
    return validateManagedHandoff(h);
  }
  prepare(input: ReceiptPreparation): PreparedReceipt {
    closed(input, ['binding', 'receiptSchemaVersion', 'receiptScope', 'producerEvidence']);
    const binding = normalizeBinding(input.binding), producer = validateProducerEvidence(input.producerEvidence);
    validateReceiptPair(binding.agent, input.receiptSchemaVersion, input.receiptScope);
    if (producer.receiptSchemaVersion !== input.receiptSchemaVersion || producer.receiptScope !== input.receiptScope) fail('receipt_producer_mismatch');
    return this.transact(data => {
      if (data.quarantined) fail('receipt_history_quarantined');
      if (Object.keys(data.records).length >= HANDOFF_LIMITS.intents) fail('receipt_ledger_full');
      const id = randomUUID(), context = binding.agent === 'claude' ? randomUUID() : null;
      const shared = { correlationId: id, ledgerEpoch: data.epoch, state: 'validated' as const, submission: { status: 'not_attempted' as const },
        observation: { status: 'not_requested' as const, injectionObserved: false }, ack: { status: 'unsupported' as const },
        wait: { for: 'none' as const, status: 'not_requested' as const }, targetGeneration: binding.generation, decisionOwner: 'sender_operator' as const,
        retry: { allowed: false as const, reason: 'receiver_dedup_unavailable' as const }, nextActions: [] };
      const handoff = validateManagedHandoff(binding.agent === 'codex' ? { schemaVersion: 1, ...shared } :
        { schemaVersion: 2, ...shared, receiptContext: { kind: 'delegated_context', id: context } });
      data.records[id] = { binding, producerEvidence: producer, receiptSchemaVersion: input.receiptSchemaVersion, receiptScope: input.receiptScope,
        receiptContextId: context, originClockId: this.collectorContextId, preparedMono: this.now(), preparedUtc: this.utc(), phase: 'prepared',
        handoff, waits: [], reserve: reserveBytes, revoked: false, expired: false };
      return { value: { ledgerEpoch: data.epoch, correlationId: id, receiptContextId: context, handoff: this.snapshot(data.records[id]!) } };
    });
  }
  mint(input: Handle & { producerProtocolVersion: number }): MintedReceipt {
    closed(input, ['ledgerEpoch', 'correlationId', 'receiptContextId', 'producerProtocolVersion']);
    return this.transact(data => {
      const item = this.handle(data, input);
      const elapsed = this.now() - item.preparedMono;
      if (item.phase !== 'prepared' || item.capabilityHash || item.originClockId !== this.collectorContextId || item.revoked ||
          elapsed < 0 || elapsed >= HANDOFF_LIMITS.capabilityMs) fail('receipt_authority_unavailable');
      if (input.producerProtocolVersion !== item.producerEvidence.protocolVersion) fail('receipt_producer_mismatch');
      const capability = randomBytes(32).toString('base64url'); item.capabilityHash = receiptDigest(capability); item.handoff.ack = { status: 'pending' };
      return { value: { ledgerEpoch: data.epoch, correlationId: input.correlationId, receiptContextId: item.receiptContextId,
        receiptSchemaVersion: item.receiptSchemaVersion, receiptScope: item.receiptScope, targetGeneration: item.binding.generation, capability } };
    });
  }
  fence(input: Handle & { binding: ReceiptBinding }): ManagedHandoff {
    closed(input, ['ledgerEpoch', 'correlationId', 'receiptContextId', 'binding']);
    const binding = normalizeBinding(input.binding);
    return this.transact(data => {
      const item = this.handle(data, input); this.classify(item);
      if (!same(binding, item.binding)) fail('receipt_binding_conflict');
      if (item.phase !== 'prepared') fail('receipt_already_attempted');
      if (!this.authority(item)) fail('receipt_authority_unavailable');
      item.phase = 'fenced'; item.handoff.state = 'unknown'; item.handoff.submission = { status: 'unknown' }; this.classify(item);
      return { value: this.snapshot(item) };
    });
  }
  submission(input: Handle & { status: 'submitted' | 'refused' | 'unknown' }): ManagedHandoff {
    closed(input, ['ledgerEpoch', 'correlationId', 'receiptContextId', 'status']);
    if (!['submitted', 'refused', 'unknown'].includes(input.status)) fail('receipt_outcome_not_authorized');
    return this.transact(data => {
      const item = this.handle(data, input);
      if (item.phase !== 'fenced' || item.originClockId !== this.collectorContextId) fail('receipt_outcome_not_authorized');
      this.classify(item); item.phase = 'finished'; item.handoff.submission = { status: input.status }; item.handoff.state = input.status;
      if (input.status !== 'submitted') {
        item.handoff.ack = { status: 'unsupported' };
        for (const wait of item.waits) if (wait.public.status === 'pending') {
          wait.public.status = input.status === 'refused' ? 'failed' : 'unsupported'; wait.public.reason = input.status === 'refused' ? 'evidence_failed' : 'evidence_unsupported';
        }
      } else if (item.pendingReceipt && this.authority(item)) this.commitAck(item, item.pendingReceipt.receiptId);
      this.classify(item); return { value: this.snapshot(item) };
    });
  }
  status(input: Selector): ManagedHandoff {
    assertSelector(input);
    return this.transact(data => { const item = this.item(data, input), changed = this.classify(item); return { value: this.snapshot(item), write: changed }; });
  }
  waitOpen(input: Selector & { goal: 'acknowledged'; timeoutSeconds: number; clockReferenceMs?: number; remainingMs?: number }): ManagedHandoff {
    closed(input, ['ledgerEpoch', 'correlationId', 'goal', 'timeoutSeconds'], ['clockReferenceMs', 'remainingMs']);
    if (input.goal !== 'acknowledged' || !Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 60) fail('receipt_wait_unknown');
    return this.transact(data => {
      const item = this.item(data, { ledgerEpoch: input.ledgerEpoch, correlationId: input.correlationId }); this.classify(item);
      if (item.waits.length >= HANDOFF_LIMITS.waits) fail('receipt_wait_quota');
      const now = this.now();
      const active = Object.values(data.records).reduce((n, r) => n + r.waits.filter(w => w.public.status === 'pending' && w.clockId === this.collectorContextId && now < w.cutoff).length, 0);
      const paired = input.clockReferenceMs !== undefined || input.remainingMs !== undefined;
      if (paired && (!safeInteger(input.clockReferenceMs) || input.clockReferenceMs > now ||
          !safeInteger(input.remainingMs) || input.remainingMs < 1 || input.remainingMs > input.timeoutSeconds * 1000)) fail('receipt_wait_unknown');
      const span = paired ? input.remainingMs! : input.timeoutSeconds * 1000;
      const cutoff = Math.max(0, (paired ? input.clockReferenceMs! : now) + span - HANDOFF_LIMITS.cleanupMs);
      const wait: Wait = { public: { for: 'acknowledged', status: 'pending', operationId: randomUUID(),
        deadlineAtUtcMs: Math.max(0, Math.floor(this.utc() + Math.max(0, cutoff - now))) }, clockId: this.collectorContextId, cutoff };
      if (item.handoff.ack.status === 'acknowledged') wait.public.status = 'satisfied';
      else if (input.timeoutSeconds * 1000 <= HANDOFF_LIMITS.cleanupMs) { wait.public.status = 'failed'; wait.public.reason = 'insufficient_budget'; }
      else if (!this.authority(item) || (item.phase === 'finished' && item.handoff.submission.status !== 'submitted')) {
        wait.public.status = 'unsupported'; wait.public.reason = 'evidence_unsupported';
      }
      else if (now >= cutoff) {
        wait.public.status = item.phase === 'prepared' ? 'failed' : 'timed_out_unknown';
        if (item.phase === 'prepared') wait.public.reason = 'deadline_before_effect';
      }
      if (wait.public.status === 'pending' && active >= 128) fail('receipt_wait_quota');
      item.waits.push(wait);
      if (item.phase === 'prepared' && wait.public.status !== 'pending') {
        item.phase = 'finished'; item.revoked = true; item.handoff.state = 'refused'; item.handoff.submission = { status: 'refused' }; item.handoff.ack = { status: 'unsupported' };
      }
      this.classify(item); return { value: this.snapshot(item) };
    });
  }
  private selectWait(item: RecordIntent, id: string): Wait {
    if (!canonicalId(id)) fail('receipt_wait_unknown');
    const wait = item.waits.find(w => w.public.operationId === id); if (!wait) fail('receipt_wait_unknown'); return wait;
  }
  waitStatus(input: Selector & { operationId: string }): ManagedHandoff {
    closed(input, ['ledgerEpoch', 'correlationId', 'operationId']);
    return this.transact(data => {
      const item = this.item(data, { ledgerEpoch: input.ledgerEpoch, correlationId: input.correlationId });
      const wait = this.selectWait(item, input.operationId), changed = this.classify(item);
      return { value: this.snapshot(item, wait), write: changed };
    });
  }
  waitStop(input: Selector & { operationId: string }): ManagedHandoff {
    closed(input, ['ledgerEpoch', 'correlationId', 'operationId']);
    return this.transact(data => {
      const item = this.item(data, { ledgerEpoch: input.ledgerEpoch, correlationId: input.correlationId }); this.classify(item);
      const wait = this.selectWait(item, input.operationId);
      if (wait.public.status !== 'pending') fail('receipt_wait_terminal');
      wait.public.status = 'stopped'; wait.public.reason = 'stopped_by_operator'; this.classify(item);
      return { value: this.snapshot(item, wait) };
    });
  }
  revoke(input: Selector): ManagedHandoff {
    assertSelector(input);
    return this.transact(data => {
      const item = this.item(data, input); item.revoked = true;
      if (item.phase === 'prepared') {
        item.phase = 'finished'; item.handoff.state = 'refused'; item.handoff.submission = { status: 'refused' };
        for (const wait of item.waits) if (wait.public.status === 'pending') { wait.public.status = 'failed'; wait.public.reason = 'evidence_failed'; }
      }
      this.classify(item); return { value: this.snapshot(item) };
    });
  }
  private commitAck(item: RecordIntent, receiptId: string): void {
    const now = this.now(), origin = item.waits[0];
    if (item.handoff.submission.status !== 'submitted' || !this.authority(item)) fail('receipt_authority_expired');
    this.classify(item);
    const late = !!origin && (origin.public.status === 'timed_out_unknown' || now >= origin.cutoff);
    item.handoff.state = 'acknowledged'; item.handoff.ack = { status: 'acknowledged', assurance: 'token_possession', receivedAtUtcMs: this.utc(), late };
    item.receiptId = receiptId;
    for (const wait of item.waits) if (wait.public.status === 'pending') wait.public.status = now < wait.cutoff ? 'satisfied' : 'timed_out_unknown';
    this.classify(item);
  }
  receipt(raw: string): ReceiptAcceptance {
    const proof = validateManagedReceipt(raw);
    return this.transact<ReceiptAcceptance>(data => {
      // Always compare a fixed-size hash, including unknown IDs; errors never
      // reflect the secret-bearing receipt or raw transport/parser details.
      const item = data.records[proof.correlationId];
      const actual = Buffer.from(receiptDigest(proof.capability), 'hex'), expected = Buffer.from(item?.capabilityHash ?? '0'.repeat(64), 'hex');
      const authenticated = timingSafeEqual(actual, expected);
      if (!authenticated || !item || !item.capabilityHash || item.revoked || item.expired || data.quarantined || data.epoch !== proof.ledgerEpoch ||
          this.utc() - item.preparedUtc >= HANDOFF_LIMITS.detailMs || item.receiptSchemaVersion !== proof.schemaVersion ||
          (proof.schemaVersion === 1 ? item.binding.generation !== proof.targetGeneration : item.receiptContextId !== proof.receiptContextId)) fail('receipt_authentication_failed');
      if (item.receiptId) {
        if (item.receiptId !== proof.receiptId) fail('receipt_already_committed');
        return { value: { status: 'acknowledged', receiptId: proof.receiptId, handoff: this.snapshot(item) }, write: false };
      }
      if (!this.authority(item)) fail('receipt_authority_expired');
      if (item.phase === 'prepared') fail('receipt_authority_unavailable');
      if (item.pendingReceipt && item.pendingReceipt.receiptId !== proof.receiptId) fail('receipt_candidate_conflict');
      if (item.handoff.submission.status === 'submitted') {
        this.commitAck(item, proof.receiptId);
        return { value: { status: 'acknowledged', receiptId: proof.receiptId, handoff: this.snapshot(item) } };
      }
      if (item.phase !== 'fenced') fail('receipt_authority_unavailable');
      if (item.pendingReceipt) return { value: { status: 'awaiting_submission', receiptId: proof.receiptId, handoff: this.snapshot(item) }, write: false };
      item.pendingReceipt = { receiptId: proof.receiptId, receiptSchemaVersion: item.receiptSchemaVersion, receiptScope: item.receiptScope,
        receiptContextId: item.receiptContextId, arrivalClockContextId: this.collectorContextId, arrivalMonotonic: this.now(), arrivalUtcMs: this.utc() };
      this.classify(item);
      return { value: { status: 'awaiting_submission', receiptId: proof.receiptId, handoff: this.snapshot(item) } };
    });
  }
}
