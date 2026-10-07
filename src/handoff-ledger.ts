// Private POSIX ledger. No native submission or transcript access occurs here.
// Fencing assumes intact retained history: unmarked clones/rollbacks cannot be
// detected by a local-only ledger. Windows ACL/bootstrap support is not claimed.
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { canonicalId, closed, fail, HANDOFF_LIMITS, HandoffBudget, parseStrictJson, safeId, safeInteger,
  systemClock, validateConfirmation, validateHandoff, validateReceipt, type Clock, type Handoff, type WaitFor, type WaitReason, type WaitStatus } from './handoff.js';

export type HandoffBinding = Readonly<{ agent: 'claude' | 'codex'; destination: string; target: string;
  home?: string; writerIdentity?: string; generation: string | null; payloadDigest: string }>;
export type PrepareOptions = { correlationId?: string; requestAck?: boolean; observeDelivery?: boolean; waitFor?: WaitFor;
  budget?: HandoffBudget; dryRun?: boolean; channels?: { delivery: boolean; receipt?: boolean };
  observationSupported?: boolean; clientUserMessageId?: string };
export type HandoffObservation = { clientUserMessageId: string; injectionObserved: boolean; turn?: Handoff['observation']['turn'] };
type StoredWait = { public: Handoff['wait']; clockId: string; cutoff: number };
type RecordIntent = { binding: HandoffBinding; preparedUtc: number; clockId: string; preparedMono: number;
  phase: 'prepared' | 'attempted' | 'finished' | 'refused'; handoff: Handoff; waits: StoredWait[];
  reserve: number; capabilityHash?: string; capabilityClockId?: string; receiptId?: string; revoked?: boolean; expired?: boolean;
  deliverySupported?: boolean; clientUserMessageId?: string };
type Ledger = { version: 1; epoch: string; quarantined: boolean; records: Record<string, RecordIntent> };
export type HandoffQueryError = { schemaVersion: 1; correlationId: string; status: 'unknown';
  context: 'ledger_missing' | 'ledger_corrupt' | 'id_unknown'; retry: { allowed: false; reason: 'history_unavailable' } };
export type HandoffStatus = { handoff: Handoff } | { reason: 'handoff_history_unavailable'; handoffQuery: HandoffQueryError };
const reserveBytes = 65536;
export const payloadDigest = (payload: string | Uint8Array): string => createHash('sha256').update(payload).digest('hex');
function checkBinding(value: HandoffBinding): HandoffBinding {
  const row = closed(value, ['agent', 'destination', 'target', 'generation', 'payloadDigest'], ['home', 'writerIdentity']);
  if (!['claude', 'codex'].includes(row.agent as string) || !safeId(row.destination, 512) || !safeId(row.target, 256) ||
      (row.generation !== null && !safeId(row.generation, 256)) || typeof row.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadDigest) ||
      (row.home !== undefined && (!safeId(row.home, 4096) || !isAbsolute(row.home))) ||
      (row.writerIdentity !== undefined && !safeId(row.writerIdentity, 256))) fail('invalid_handoff_binding', 2);
  return structuredClone(value);
}
function sameBinding(a: HandoffBinding, b: HandoffBinding): boolean {
  return ['agent', 'destination', 'target', 'home', 'writerIdentity', 'generation', 'payloadDigest'].every(key => a[key as keyof HandoffBinding] === b[key as keyof HandoffBinding]);
}
function privateStat(path: string, directory: boolean) {
  const uid = process.getuid?.(); if (uid === undefined || process.platform === 'win32') fail('handoff_storage_unsupported');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || stat.uid !== uid ||
      (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) || (!directory && stat.nlink !== 1)) fail('handoff_storage_untrusted');
  return stat;
}
export class HandoffLedger {
  readonly path: string;
  private readonly clock: Clock;
  private readonly clockId = randomUUID();
  constructor(path: string, options: { clock?: Clock } = {}) {
    if (!isAbsolute(path)) fail('invalid_handoff_ledger', 2);
    this.path = resolve(path); this.clock = options.clock ?? systemClock;
  }
  private filename(): string { return join(this.path, 'ledger.json'); }
  private lock<T>(operation: () => T, create = false): T {
    try { privateStat(this.path, true); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('handoff_history_unavailable'); throw error; }
    const path = join(this.path, 'ledger.lock');
    if (create) {
      try { const created = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); fsyncSync(created); closeSync(created); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const before = privateStat(path, false);
    const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) fail('handoff_storage_untrusted');
      const locks = createRequire(import.meta.url)('fs-ext-extra-prebuilt') as { flockSync: (fd: number, mode: string) => void };
      try { locks.flockSync(fd, 'exnb'); } catch { fail('handoff_ledger_busy'); }
      try { return operation(); } finally { locks.flockSync(fd, 'un'); }
    } finally { closeSync(fd); }
  }
  private read(): Ledger {
    privateStat(this.path, true);
    const path = this.filename(), stat = privateStat(path, false);
    if (stat.size > HANDOFF_LIMITS.journal) fail('handoff_ledger_corrupt');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const opened = fstatSync(fd); if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > HANDOFF_LIMITS.journal) fail('handoff_storage_untrusted');
      const buffer = Buffer.alloc(Math.min(opened.size + 1, HANDOFF_LIMITS.journal + 1));
      let length = 0;
      while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, length); if (!count) break; length += count; }
      if (length > opened.size || length > HANDOFF_LIMITS.journal) fail('handoff_ledger_corrupt');
      bytes = buffer.subarray(0, length);
    } finally { closeSync(fd); }
    try {
      const wrapper = closed(parseStrictJson(bytes, { scope: 'outer', maxBytes: HANDOFF_LIMITS.journal }), ['digest', 'data']);
      if (typeof wrapper.digest !== 'string' || wrapper.digest !== payloadDigest(JSON.stringify(wrapper.data))) fail();
      const data = closed(wrapper.data, ['version', 'epoch', 'quarantined', 'records']);
      if (data.version !== 1 || !canonicalId(data.epoch) || typeof data.quarantined !== 'boolean' || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) fail();
      const records = data.records as Record<string, RecordIntent>;
      if (Object.keys(records).length > HANDOFF_LIMITS.intents) fail();
      for (const [id, item] of Object.entries(records)) {
        closed(item, ['binding', 'preparedUtc', 'clockId', 'preparedMono', 'phase', 'handoff', 'waits', 'reserve'], ['capabilityHash', 'capabilityClockId', 'receiptId', 'revoked', 'expired', 'deliverySupported', 'clientUserMessageId']);
        checkBinding(item.binding);
        if (!canonicalId(id) || !canonicalId(item.clockId) || !safeInteger(item.preparedUtc) || typeof item.preparedMono !== 'number' || item.preparedMono < 0 ||
            !['prepared', 'attempted', 'finished', 'refused'].includes(item.phase) || !Array.isArray(item.waits) || item.waits.length > HANDOFF_LIMITS.waits ||
            !safeInteger(item.reserve) || item.reserve > reserveBytes || (item.capabilityHash !== undefined && !/^[a-f0-9]{64}$/.test(item.capabilityHash)) ||
            (item.capabilityClockId !== undefined && !canonicalId(item.capabilityClockId)) ||
            (item.receiptId !== undefined && !canonicalId(item.receiptId)) ||
            (item.deliverySupported !== undefined && typeof item.deliverySupported !== 'boolean') ||
            (item.clientUserMessageId !== undefined && !safeId(item.clientUserMessageId)) ||
            (item.deliverySupported && (!safeId(item.clientUserMessageId) || item.binding.generation === null))) fail();
        const h = validateHandoff(item.handoff);
        if (h.correlationId !== id || h.ledgerEpoch !== data.epoch || h.targetGeneration !== item.binding.generation) fail();
        for (const wait of item.waits) {
          closed(wait, ['public', 'clockId', 'cutoff']);
          if (!canonicalId(wait.clockId) || typeof wait.cutoff !== 'number' || !Number.isFinite(wait.cutoff)) fail();
          validateHandoff({ ...h, wait: wait.public });
        }
      }
      return data as Ledger;
    } catch { fail('handoff_ledger_corrupt'); }
  }
  private write(data: Ledger): void {
    for (const item of Object.values(data.records)) validateHandoff(item.handoff);
    const text = JSON.stringify({ digest: payloadDigest(JSON.stringify(data)), data });
    const reserves = Object.values(data.records).reduce((sum, item) => sum + Math.max(0, item.reserve - Buffer.byteLength(JSON.stringify(item))), 0);
    if (Buffer.byteLength(text) + reserves > HANDOFF_LIMITS.journal) fail('handoff_ledger_full');
    const temporary = join(this.path, `.ledger-${randomUUID()}.tmp`);
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    finally { closeSync(fd); }
    try {
      renameSync(temporary, this.filename());
      const directory = openSync(this.path, constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  }
  init(): { ledgerEpoch: string; storage: 'private_posix'; cloneRollbackProtection: 'intact_retained_history_only' } {
    if (process.platform === 'win32' || process.getuid?.() === undefined) fail('handoff_storage_unsupported');
    try { mkdirSync(this.path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return this.lock(() => {
      try { lstatSync(this.filename()); fail('handoff_ledger_exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const epoch = randomUUID(); this.write({ version: 1, epoch, quarantined: false, records: {} });
      return { ledgerEpoch: epoch, storage: 'private_posix', cloneRollbackProtection: 'intact_retained_history_only' };
    }, true);
  }
  private usable(data: Ledger, id: string): RecordIntent {
    if (!canonicalId(id)) fail('invalid_correlation_id', 2);
    const item = data.records[id]; if (!item) fail('handoff_id_unknown');
    if (data.quarantined) fail('handoff_ledger_quarantined');
    if (item.expired || this.clock.utc() - item.preparedUtc >= HANDOFF_LIMITS.detailMs) fail('handoff_history_unavailable');
    return item;
  }
  private snapshot(item: RecordIntent, quarantine = false): Handoff {
    const h = structuredClone(item.handoff);
    if (quarantine || item.expired || this.clock.utc() - item.preparedUtc >= HANDOFF_LIMITS.detailMs) {
      h.state = 'unknown'; h.submission = { status: 'unknown' }; h.observation = { status: 'not_requested', injectionObserved: false };
      h.ack = { status: 'unsupported' }; h.wait = { for: 'none', status: 'not_requested' }; h.nextActions = ['reconcile'];
    } else if (item.phase === 'attempted') { h.state = 'unknown'; h.submission = { status: 'unknown' }; h.nextActions = ['reconcile']; }
    if ((item.capabilityClockId !== this.clockId || item.revoked || this.clock.monotonic() - item.preparedMono >= HANDOFF_LIMITS.capabilityMs) && h.ack.status === 'pending') {
      h.ack = { status: 'unsupported' }; h.nextActions = ['reconcile'];
    }
    if (item.clockId !== this.clockId && h.observation.status === 'pending') {
      h.observation = { status: 'unsupported', injectionObserved: false }; h.nextActions = ['reconcile'];
    }
    return validateHandoff(h);
  }
  status(id: string): HandoffStatus {
    if (!canonicalId(id)) fail('invalid_correlation_id', 2);
    let context: HandoffQueryError['context'] = 'ledger_corrupt';
    try {
      const data = this.read(), item = data.records[id];
      if (item) return { handoff: this.snapshot(item, data.quarantined) };
      context = 'id_unknown';
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') context = 'ledger_missing'; }
    return { reason: 'handoff_history_unavailable', handoffQuery: { schemaVersion: 1, correlationId: id, status: 'unknown', context, retry: { allowed: false, reason: 'history_unavailable' } } };
  }
  prepare(binding: HandoffBinding, options: PrepareOptions = {}): Handoff {
    binding = checkBinding(binding);
    if (options.dryRun && (options.requestAck || options.observeDelivery || (options.waitFor && options.waitFor !== 'none'))) fail('incompatible_handoff_dry_run', 2);
    if (options.correlationId && !canonicalId(options.correlationId)) fail('invalid_correlation_id', 2);
    return this.lock(() => {
      const data = this.read(); if (data.quarantined) fail('handoff_ledger_quarantined');
      let id = options.correlationId;
      if (id) {
        const item = this.usable(data, id);
        if (!sameBinding(item.binding, binding)) fail('handoff_binding_conflict');
        if (item.phase !== 'prepared') fail('handoff_already_attempted');
        if (!options.dryRun) { this.configure(item, options); this.write(data); }
        return this.snapshot(item);
      }
      if (options.dryRun) fail('prepared_correlation_required', 2);
      if (Object.keys(data.records).length >= HANDOFF_LIMITS.intents) fail('handoff_ledger_full');
      id = randomUUID(); const goal = options.waitFor ?? 'none';
      if (!['none', 'delivered', 'acknowledged'].includes(goal)) fail('invalid_wait_for', 2);
      // Runtime channels remain unsupported until a compatible private bootstrap
      // and producer are proven by the integration, not merely by generation.
      const h: Handoff = { schemaVersion: 1, correlationId: id, ledgerEpoch: data.epoch, state: 'validated', submission: { status: 'not_attempted' },
        observation: { status: options.observeDelivery ? 'unsupported' : 'not_requested', injectionObserved: false },
        ack: { status: options.requestAck ? 'unsupported' : 'not_requested' }, wait: { for: 'none', status: 'not_requested' },
        targetGeneration: binding.generation, decisionOwner: 'sender_operator', retry: { allowed: false, reason: 'receiver_dedup_unavailable' }, nextActions: [] };
      const item: RecordIntent = { binding, preparedUtc: Math.floor(this.clock.utc()), clockId: this.clockId, preparedMono: this.clock.monotonic(), phase: 'prepared', handoff: h, waits: [], reserve: reserveBytes };
      data.records[id] = item;
      this.configure(item, options);
      this.write(data); return this.snapshot(item);
    });
  }
  private configure(item: RecordIntent, options: PrepareOptions): void {
    const h = item.handoff, goal = options.waitFor ?? 'none';
    if (!['none', 'delivered', 'acknowledged'].includes(goal)) fail('invalid_wait_for', 2);
    if (options.clientUserMessageId !== undefined && !safeId(options.clientUserMessageId)) fail('invalid_client_user_message_id', 2);
    const clientId = options.clientUserMessageId ?? h.correlationId;
    if (item.clientUserMessageId !== undefined && item.clientUserMessageId !== clientId) fail('handoff_binding_conflict');
    if (options.requestAck) h.ack.status = 'unsupported';
    const delivery = (options.observationSupported === true || options.channels?.delivery === true) && item.binding.generation !== null;
    if (options.observeDelivery || goal === 'delivered') {
      item.deliverySupported = delivery; item.clientUserMessageId = clientId;
      h.observation.status = delivery ? 'pending' : 'unsupported';
    }
    if (goal !== 'none') {
      const budget = options.budget ?? new HandoffBudget(30, this.clock); this.addWait(item, goal, budget);
      if (goal === 'delivered' && delivery) h.wait.status = 'pending';
      else { h.wait.status = 'unsupported'; h.wait.reason = 'evidence_unsupported'; }
      try { budget.beforeEffect(); } catch (error) {
        h.wait.status = 'failed'; h.wait.reason = (error as { code: WaitReason }).code;
      }
      if (goal === 'acknowledged') h.ack.status = 'unsupported';
      if (h.wait.status !== 'pending') { h.state = 'refused'; h.submission.status = 'refused'; item.phase = 'refused'; }
      item.waits.at(-1)!.public = structuredClone(h.wait);
    }
  }
  // Durable intent is synced before returning authorization to the caller.
  // A crash after this point, even before native effect, can never authorize retry.
  commitEffect(id: string, binding: HandoffBinding, budget?: HandoffBudget): Handoff {
    binding = checkBinding(binding);
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, id);
      if (!sameBinding(item.binding, binding)) fail('handoff_binding_conflict');
      if (item.phase !== 'prepared') fail('handoff_already_attempted');
      try { budget?.beforeEffect(); } catch (error) {
        this.refuse(item, (error as { code: WaitReason }).code); this.write(data); throw error;
      }
      item.phase = 'attempted'; item.clockId = this.clockId;
      item.handoff.state = 'unknown'; item.handoff.submission.status = 'unknown'; item.handoff.nextActions = ['reconcile'];
      this.write(data); return this.snapshot(item);
    });
  }
  private refuse(item: RecordIntent, reason?: WaitReason): void {
    item.phase = 'refused'; item.handoff.state = 'refused'; item.handoff.submission.status = 'refused'; item.handoff.nextActions = [];
    if (item.handoff.observation.status === 'pending') item.handoff.observation = { status: 'failed', injectionObserved: false };
    if (item.handoff.ack.status === 'pending') { item.handoff.ack = { status: 'unsupported' }; item.revoked = true; }
    const wait = item.waits.at(-1);
    if (wait?.public.status === 'pending') {
      item.handoff.wait.status = 'failed'; item.handoff.wait.reason = reason ?? 'evidence_failed'; wait.public = structuredClone(item.handoff.wait);
    }
  }
  refusePrepared(id: string, binding: HandoffBinding, reason?: WaitReason): Handoff {
    binding = checkBinding(binding);
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, id);
      if (!sameBinding(item.binding, binding)) fail('handoff_binding_conflict');
      if (item.phase !== 'prepared') fail('handoff_already_attempted');
      this.refuse(item, reason); this.write(data); return this.snapshot(item);
    });
  }
  recordSubmission(id: string, status: 'submitted' | 'unknown' | 'refused'): Handoff {
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, id);
      if (item.phase !== 'attempted' || item.clockId !== this.clockId) fail('handoff_outcome_not_authorized');
      item.phase = 'finished'; item.handoff.submission.status = status;
      item.handoff.state = status; item.handoff.nextActions = ['reconcile'];
      if (status === 'refused') this.refuse(item, 'evidence_failed');
      this.write(data); return this.snapshot(item);
    });
  }
  recordObservation(id: string, observation: HandoffObservation, originalBinding: HandoffBinding): Handoff {
    originalBinding = checkBinding(originalBinding);
    closed(observation, ['clientUserMessageId', 'injectionObserved'], ['turn']);
    if (!safeId(observation.clientUserMessageId) || typeof observation.injectionObserved !== 'boolean' ||
        (!observation.injectionObserved && observation.turn !== undefined)) fail('invalid_handoff_observation');
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, id), h = item.handoff;
      if (!sameBinding(item.binding, originalBinding)) fail('handoff_binding_conflict');
      if (!item.deliverySupported || item.binding.generation === null || item.clientUserMessageId !== observation.clientUserMessageId ||
          item.phase !== 'finished' || h.submission.status !== 'submitted') fail('handoff_observation_unverified');
      if (!observation.injectionObserved) return this.snapshot(item);
      if (observation.turn !== undefined) {
        closed(observation.turn, ['id', 'status']);
        if (!safeId(observation.turn.id) || !['running', 'completed', 'failed', 'interrupted', 'unknown'].includes(observation.turn.status)) fail('invalid_handoff_observation');
        const prior = h.observation.turn;
        if (prior && (prior.id !== observation.turn.id || (['completed', 'failed', 'interrupted'].includes(prior.status) && prior.status !== observation.turn.status))) fail('handoff_turn_conflict');
      }
      h.observation = { status: 'observed', injectionObserved: true, clientUserMessageId: observation.clientUserMessageId,
        ...(observation.turn ? { turn: structuredClone(observation.turn) } : h.observation.turn ? { turn: h.observation.turn } : {}) };
      if (h.ack.status !== 'acknowledged') h.state = 'delivered';
      const latest = item.waits.at(-1);
      if (latest?.public.status === 'pending' && latest.public.for === 'delivered') {
        if (latest.clockId !== this.clockId) { latest.public.status = 'failed'; latest.public.reason = 'history_unavailable'; }
        else latest.public.status = this.clock.monotonic() < latest.cutoff ? 'satisfied' : 'timed_out_unknown';
        h.wait = structuredClone(latest.public);
      }
      h.nextActions = ['reconcile']; this.write(data); return this.snapshot(item);
    });
  }
  private addWait(item: RecordIntent, goal: Exclude<WaitFor, 'none'>, budget: HandoffBudget): void {
    if (item.waits.length >= HANDOFF_LIMITS.waits) fail('handoff_wait_quota');
    item.handoff.wait = { for: goal, status: 'pending', operationId: randomUUID(), deadlineAtUtcMs: budget.deadlineAtUtcMs };
    item.waits.push({ public: structuredClone(item.handoff.wait), clockId: this.clockId, cutoff: budget.cutoff });
  }
  beginWait(id: string, goal: Exclude<WaitFor, 'none'>, budget = new HandoffBudget(30, this.clock)): Handoff {
    if (!['delivered', 'acknowledged'].includes(goal)) fail('invalid_wait_for', 2);
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, id); this.addWait(item, goal, budget);
      const h = item.handoff;
      h.nextActions = ['reconcile'];
      if ((goal === 'acknowledged' && h.ack.status === 'acknowledged') || (goal === 'delivered' && h.observation.injectionObserved)) h.wait.status = 'satisfied';
      else if (budget.seconds <= 5) { h.wait.status = 'failed'; h.wait.reason = 'insufficient_budget'; }
      else if (goal === 'delivered' && item.deliverySupported && item.binding.generation !== null && item.clockId === this.clockId && h.submission.status === 'submitted') {
        h.nextActions = ['keep_waiting', 'reconcile', 'stop_waiting'];
      }
      else if (goal === 'acknowledged' && item.capabilityHash && !item.revoked && item.capabilityClockId === this.clockId &&
          this.clock.monotonic() - item.preparedMono < HANDOFF_LIMITS.capabilityMs && item.binding.generation !== null && h.submission.status === 'submitted') {
        h.ack.status = 'pending'; h.nextActions = ['keep_waiting', 'reconcile', 'stop_waiting'];
      } else { h.wait.status = 'unsupported'; h.wait.reason = 'evidence_unsupported'; }
      item.waits.at(-1)!.public = structuredClone(h.wait);
      this.write(data); return this.snapshot(item);
    });
  }
  recordWait(id: string, status: Exclude<WaitStatus, 'pending' | 'not_requested'>, reason?: WaitReason): Handoff {
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, id), wait = item.waits.at(-1);
      if (!wait || wait.public.status !== 'pending') fail('handoff_wait_terminal');
      if (status === 'timed_out_unknown' && (wait.clockId !== this.clockId || this.clock.monotonic() < wait.cutoff)) fail('receipt_order_unprovable');
      item.handoff.wait.status = status; if (reason) item.handoff.wait.reason = reason;
      if (status === 'timed_out_unknown') item.handoff.state = 'timed_out_unknown';
      item.handoff.nextActions = ['reconcile'];
      wait.public = structuredClone(item.handoff.wait); validateHandoff(item.handoff);
      this.write(data); return this.snapshot(item);
    });
  }
  private commitAck(item: RecordIntent, assurance: 'operator_confirmed' | 'token_possession'): void {
    const h = item.handoff, origin = item.waits[0];
    let late = false;
    if (origin) {
      if (origin.public.status === 'timed_out_unknown') late = true;
      else if (origin.clockId === this.clockId) late = this.clock.monotonic() >= origin.cutoff;
      else fail('receipt_order_unprovable');
    }
    h.state = 'acknowledged'; h.ack = { status: 'acknowledged', assurance, receivedAtUtcMs: Math.floor(this.clock.utc()), late };
    const latest = item.waits.at(-1);
    if (latest?.public.status === 'pending' && latest.public.for === 'acknowledged') {
      if (latest.clockId !== this.clockId) fail('receipt_order_unprovable');
      latest.public.status = this.clock.monotonic() < latest.cutoff ? 'satisfied' : 'timed_out_unknown'; h.wait = structuredClone(latest.public);
    }
    h.nextActions = ['reconcile'];
  }
  confirm(raw: string | Uint8Array): Handoff {
    const proof = validateConfirmation(raw);
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, proof.correlationId);
      if (data.epoch !== proof.ledgerEpoch || item.binding.generation !== proof.targetGeneration || item.handoff.submission.status !== 'submitted') fail('confirmation_binding_invalid');
      if (item.handoff.ack.status !== 'acknowledged') this.commitAck(item, 'operator_confirmed');
      this.write(data); return this.snapshot(item);
    });
  }
  // Caller must already validate a compatible private receipt-only producer.
  // This returns authority for authorized private effect input only; never argv,
  // environment, public output or persistence. The raw value is not recoverable.
  mintCapability(id: string, bootstrap: { privateConsumerValidated: true; compatibleProducerValidated: true }): string {
    if (bootstrap.privateConsumerValidated !== true || bootstrap.compatibleProducerValidated !== true) fail('receipt_bootstrap_unsupported');
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, id);
      if (item.phase !== 'prepared' || item.binding.generation === null || item.capabilityHash || item.clockId !== this.clockId ||
          this.clock.monotonic() - item.preparedMono >= HANDOFF_LIMITS.capabilityMs) fail('receipt_authority_unavailable');
      const capability = randomBytes(32).toString('base64url'); item.capabilityHash = payloadDigest(capability);
      item.capabilityClockId = this.clockId;
      item.handoff.ack.status = 'pending'; item.clockId = this.clockId; this.write(data); return capability;
    });
  }
  acceptReceipt(raw: string | Uint8Array): Handoff {
    const proof = validateReceipt(raw);
    return this.lock(() => {
      const data = this.read(), item = this.usable(data, proof.correlationId);
      const expected = Buffer.from(item.capabilityHash ?? '0'.repeat(64), 'hex'), actual = Buffer.from(payloadDigest(proof.capability), 'hex');
      const authenticated = timingSafeEqual(expected, actual);
      if (!authenticated || !item.capabilityHash || item.revoked || data.epoch !== proof.ledgerEpoch ||
          item.binding.generation !== proof.targetGeneration || item.handoff.submission.status !== 'submitted') fail('receipt_authentication_failed');
      if (item.receiptId) { if (item.receiptId !== proof.receiptId) fail('receipt_already_committed'); return this.snapshot(item); }
      if (item.handoff.ack.status === 'acknowledged') fail('receipt_already_committed');
      if (item.capabilityClockId !== this.clockId || this.clock.monotonic() - item.preparedMono >= HANDOFF_LIMITS.capabilityMs) fail('receipt_authority_expired');
      this.commitAck(item, 'token_possession'); item.receiptId = proof.receiptId;
      this.write(data); return this.snapshot(item);
    });
  }
  revoke(id: string): void { this.lock(() => { const data = this.read(), item = this.usable(data, id); item.revoked = true; this.write(data); }); }
  quarantine(): void { this.lock(() => { const data = this.read(); data.quarantined = true; this.write(data); }); }
  prune(): void {
    this.lock(() => {
      const data = this.read();
      for (const item of Object.values(data.records)) if (this.clock.utc() - item.preparedUtc >= HANDOFF_LIMITS.detailMs) {
        item.expired = true; item.phase = 'finished'; item.handoff = this.snapshot(item); item.waits = []; item.reserve = 0;
        delete item.capabilityHash; delete item.capabilityClockId; delete item.receiptId;
      }
      this.write(data);
    });
  }
}
