// Opt-in integration only. Default CLI imports this without opening storage or
// starting an observer/collector. Production receipt bootstrap is unqualified.
import { homedir, hostname } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs';
import { HandoffLedger, payloadDigest, type HandoffBinding } from './handoff-ledger.js';
import { canonicalId, HANDOFF_LIMITS, HandoffBudget, parseWaitTimeout, type Handoff, type WaitFor } from './handoff.js';
import { fileURLToPath } from 'node:url';
import { nativeQueueCapability, nativeQueueOnce, AppServerFault, type AppServerScope } from './app-server.js';
import { metadataCapability, observeMetadata, type MetadataScope } from './metadata-observation.js';
import { checkMessage, queueId, send, type SendContext, type SendOptions } from './send.js';
import { Refusal } from './discovery.js';
import { HomeRefusal } from './writer.js';
import { executable, run, UnknownOutcome } from './process.js';

export type HandoffOptions = { correlationId?: string; requestAck?: boolean; observeDelivery?: boolean;
  waitFor?: Exclude<WaitFor, 'none'>; seconds?: number; ledgerPath?: string; payload?: string; budget?: HandoffBudget; resultOverhead?: number };
export type OperationResult = { value: Record<string, unknown>; exitCode: number };
export function ledgerPath(): string {
  const path = process.env.SESSION_PEER_HANDOFF_HOME ?? join(homedir(), '.local', 'state', 'session-peer-ts', 'handoff');
  if (!isAbsolute(path)) throw new Refusal('invalid_handoff_ledger', 2);
  return resolve(path);
}
export function privateMessage(path: string): string {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 4_100_000 ||
    (process.platform !== 'win32' && (before.uid !== process.getuid?.() || (before.mode & 0o777) !== 0o600))) throw new Refusal('private_message_file_untrusted', 2);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const actual = fstatSync(fd);
    if (!actual.isFile() || actual.ino !== before.ino || actual.dev !== before.dev || actual.size !== before.size) throw new Refusal('private_message_file_untrusted', 2);
    const buffer = Buffer.alloc(4_100_001); let length = 0;
    while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    const bytes = buffer.subarray(0, length); if (bytes.length > 4_100_000) throw new Refusal('input_too_large');
    const after = fstatSync(fd);
    if (after.size !== actual.size || after.mtimeMs !== actual.mtimeMs || length !== actual.size) throw new Refusal('private_message_file_changed', 1);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Refusal('invalid_utf8'); }
  } finally { closeSync(fd); }
}
function binding(context: SendContext, message: string, destination = hostname()): HandoffBinding {
  return { ...context, destination, payloadDigest: payloadDigest(message) };
}
export function correlationEnvelope(message: string, id: string): string {
  if (!canonicalId(id)) throw new Refusal('invalid_correlation_id', 2);
  // A dedicated inert metadata line, not an executable Reply-To extension.
  return message + '\n\n---\nHandoff: ' + JSON.stringify({ schemaVersion: 1, correlationId: id });
}
class BeforeEffectRefused extends Error {}
export async function prepareHandoff(options: SendOptions, path = ledgerPath()): Promise<OperationResult> {
  const ledger = new HandoffLedger(path); let handoff: Handoff | undefined;
  const value = await send({ ...options, dryRun: true, hooks: { resolved(context) {
    handoff = ledger.prepare(binding(context, options.message));
  } } });
  return { value: { ...value, handoff }, exitCode: 0 };
}
export async function handoffSend(options: SendOptions, handoffOptions: HandoffOptions): Promise<OperationResult> {
  const ledger = new HandoffLedger(handoffOptions.ledgerPath ?? ledgerPath());
  const budget = handoffOptions.budget ?? new HandoffBudget(handoffOptions.seconds ?? 30);
  let handoff: Handoff | undefined, snapshot: Record<string, unknown> | undefined;
  let scope: MetadataScope | undefined, queueScope: AppServerScope | undefined, deliverySupported = false, stopped = false, operationId: string | undefined;
  let original: HandoffBinding | undefined, fenced = false, knownNative: Record<string, unknown> | undefined;
  const ownWait = () => { if (handoff && operationId) handoff.wait = ledger.operationStatus(handoff.correlationId,operationId).wait; };
  const stop = () => { stopped = true; if (handoff?.wait.status === 'pending') { try { handoff = ledger.recordWait(handoff.correlationId, 'stopped', 'stopped_by_operator', operationId); ownWait(); } catch { /* No fabricated terminal evidence after persistence failure. */ } } };
  const authorize = () => { if (stopped) throw new Refusal('stopped_by_operator', 130); budget.beforeEffect(); handoff = ledger.commitEffect(handoff!.correlationId, original!, budget); fenced = true; };
  const verifyOwner = async (target: MetadataScope, signal?: AbortSignal) => {
    if (stopped || signal?.aborted || budget.observationRemainingMs() < 1) return false;
    const worker = fileURLToPath(new URL('./handoff-writer-probe.js', import.meta.url));
    const result = await run(process.execPath, [worker, target.home, target.threadId], { timeout: Math.min(800, budget.observationRemainingMs()), limit: 4096, env: { ...process.env, NODE_OPTIONS: undefined, NODE_PATH: undefined } });
    if (signal?.aborted || stopped || result.code !== 0 || result.interrupted) return false;
    try { const value = JSON.parse(result.stdout); return value.schemaVersion === 1 && value.ok === true && Object.keys(value).every(key => ['schemaVersion','ok','generation'].includes(key)) && /^[0-9a-f]{64}$/.test(value.generation) && value.generation === target.generation; } catch { return false; }
  };
  const finish = (value: Record<string, unknown>, exitCode: number): OperationResult => ({ value: { ...value, ...(handoff ? { handoff } : {}) }, exitCode });
  try {
    const value = await send({ ...options, hooks: {
      async resolved(context, native) {
        snapshot = native; original = binding(context, handoffOptions.payload ?? options.message);
        if (Buffer.byteLength(JSON.stringify(native)) + HANDOFF_LIMITS.publicFrame + (handoffOptions.resultOverhead ?? 1024) > HANDOFF_LIMITS.outerFrame) throw new Refusal('handoff_result_too_large',1);
        // Account for the fixed correlation envelope before allocating an intent.
        checkMessage(correlationEnvelope(options.message, '00000000-0000-4000-8000-000000000000'), context.agent === 'codex');
        const wantsDelivery = handoffOptions.observeDelivery || handoffOptions.waitFor === 'delivered';
        if (wantsDelivery && context.agent === 'codex' && context.home && context.generation && budget.observationRemainingMs() > 0) {
          scope = { home: context.home, threadId: context.target, generation: context.generation };
          queueScope = { codexHome: context.home, threadId: context.target, generation: context.generation, ownerIdentity: context.writerIdentity! };
          const version = await run(executable(options.codexBin ?? 'codex'), ['--version'], { timeout: Math.min(1000, budget.observationRemainingMs()), limit: 4096 });
          const nativeVersion = !version.interrupted && version.code === 0 ? version.stdout.trim().replace(/^codex-cli /, '') : '';
          if (nativeQueueCapability({version:nativeVersion,platform:`${process.platform}-${process.arch}`,scope:queueScope}).queueSupported) deliverySupported = (await metadataCapability(scope, nativeVersion, budget, verifyOwner)).supported;
        }
        handoff = ledger.prepare(original, { correlationId: handoffOptions.correlationId,
          requestAck: handoffOptions.requestAck || handoffOptions.waitFor === 'acknowledged',
          observeDelivery: handoffOptions.observeDelivery || handoffOptions.waitFor === 'delivered',
          waitFor: handoffOptions.waitFor ?? 'none', budget, dryRun: options.dryRun, observationSupported: deliverySupported });
        operationId = handoff.wait.operationId;
        if (handoffOptions.waitFor && handoff.wait.status === 'pending') process.on('SIGINT', stop);
        if (handoff.state === 'refused') throw new BeforeEffectRefused();
        return correlationEnvelope(options.message, handoff.correlationId);
      },
      beforeEffect: authorize,
      async submitCodex(context, message) {
        if (!deliverySupported) {
          // Best-effort unsupported is chosen before ANY app-server attempt.
          authorize();
          const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'CODEX_SQLITE_HOME'));
          const done = await run(executable(options.codexBin ?? 'codex'), ['queue','--thread',context.target,`--message=${message}`], {env:{...inherited,CODEX_HOME:context.home},timeout:Math.max(1,budget.observationRemainingMs())});
          if (!done.spawned) throw new Refusal('native_spawn_failed',1);
          if (done.interrupted || done.code !== 0) throw new UnknownOutcome();
          const receipt = queueId(done.stdout,context.target);
          return {queueId:receipt,clientUserMessageId:handoff!.correlationId};
        }
        try { return await nativeQueueOnce({binary:executable(options.codexBin ?? 'codex'),scope:queueScope!,message,clientUserMessageId:handoff!.correlationId,deadlineMs:budget.cutoff,verifyOwner: async () => verifyOwner(scope!),beforeEffect: async () => authorize()}); }
        catch(error) { if (error instanceof AppServerFault && error.attempted) throw new UnknownOutcome(); if(error instanceof AppServerFault) throw new Refusal(`app_server_${error.code}`,1); throw error; }
      },
      timeoutMs() { budget.beforeEffect(); return Math.max(1, Math.floor(budget.observationRemainingMs())); },
    } });
    knownNative = value;
    if (!options.dryRun) { handoff = ledger.recordSubmission(handoff!.correlationId, 'submitted'); ownWait(); }
    if (!options.dryRun && deliverySupported && scope && handoff) {
      do {
        if (stopped) break;
        const observed = await observeMetadata({...scope,clientUserMessageId:handoff.correlationId}, budget, verifyOwner);
        if (!observed.supported) {
          if (budget.observationRemainingMs() <= 0) break;
          handoff = ledger.recordObservationFailure(handoff.correlationId, original!, observed.reason === 'metadata_owner_changed' ? 'unsupported' : 'failed', operationId); ownWait();
          break;
        }
        if (observed.injectionObserved) { handoff = ledger.recordObservation(handoff.correlationId,{clientUserMessageId:observed.clientUserMessageId!,injectionObserved:true,...(observed.turn ? {turn:observed.turn} : {})},original!); ownWait(); break; }
        if (!handoffOptions.waitFor) break;
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(100,budget.observationRemainingMs())));
      } while(budget.observationRemainingMs() > 0);
      if (handoffOptions.waitFor && handoff.wait.status === 'pending') handoff = stopped ? ledger.recordWait(handoff.correlationId,'stopped','stopped_by_operator',operationId) : ledger.recordWait(handoff.correlationId,'timed_out_unknown',undefined,operationId);
      ownWait();
      if (handoffOptions.waitFor && handoff.wait.status !== 'satisfied') return finish({...value,ok:false,error:handoff.wait.reason ?? 'timed_out_unknown',retryAllowed:false},handoff.wait.status === 'stopped' && handoff.wait.reason === 'stopped_by_operator' ? 130 : 1);
    }
    return finish(value, 0);
  } catch (error) {
    if (!handoff || !snapshot) throw error;
    if (knownNative) {
      // An I/O failure after positive native acceptance cannot erase that fact.
      handoff = { ...handoff, state: handoff.ack.status === 'acknowledged' ? 'acknowledged' : handoff.observation.injectionObserved ? 'delivered' : 'submitted', submission: { status: 'submitted' }, nextActions: ['reconcile'] };
      if (handoffOptions.waitFor) {
        if (handoff.wait.status === 'pending') handoff.wait = { ...handoff.wait, status: 'failed', reason: 'evidence_failed' };
        const interrupted = handoff.wait.status === 'stopped' && handoff.wait.reason === 'stopped_by_operator';
        return finish({ ...knownNative, ok: false, error: interrupted ? 'stopped_by_operator' : 'handoff_persistence_failed', retryAllowed: false }, interrupted ? 130 : 1);
      }
      return finish({ ...knownNative, handoffWarning: 'persistence_failed', retryAllowed: false }, 0);
    }
    const uncertain = error instanceof UnknownOutcome;
    if (fenced) {
      try { handoff = ledger.recordSubmission(handoff.correlationId, uncertain ? 'unknown' : 'refused'); ownWait(); }
      catch { const state = ledger.status(handoff.correlationId); if ('handoff' in state) handoff = state.handoff; }
    }
    if (handoffOptions.waitFor && handoff.wait.status === 'pending') {
      try { handoff = ledger.recordWait(handoff.correlationId, budget.observationRemainingMs() <= 0 ? 'timed_out_unknown' : 'failed', budget.observationRemainingMs() <= 0 ? undefined : 'evidence_failed', operationId); ownWait(); }
      catch { handoff.wait = {...handoff.wait,status:'failed',reason:'evidence_failed'}; }
    }
    if (!fenced && original && handoff.state !== 'refused') {
      try { handoff = ledger.refusePrepared(handoff.correlationId, original); } catch { /* Keep the last verified facts; never retry. */ }
    }
    const code = error instanceof BeforeEffectRefused ? handoff.wait.reason ?? 'evidence_unsupported' : error instanceof Refusal ? error.code : uncertain ? 'outcome_unknown' : 'handoff_operation_failed';
    return finish({ ...snapshot, ok: false, error: code, status: uncertain ? 'unknown' : 'refused', submitted: uncertain ? null : false,
      consumptionConfirmed: false, retryAllowed: false, ...(error instanceof HomeRefusal ? {codexHomeResolution:error.codexHomeResolution} : {}) }, handoffOptions.waitFor && handoff.wait.status === 'stopped' && handoff.wait.reason === 'stopped_by_operator' ? 130 : error instanceof Refusal && error.exitCode !== 130 ? error.exitCode : 1);
  } finally { process.removeListener('SIGINT',stop); }
}

// New commands are local owner operations; forwarding them through native send
// or interpreting a receipt as a model prompt is never allowed.
export async function handoffCommand(args: string[], readInput: (limit: number) => Promise<string>): Promise<OperationResult> {
  const ack = args[0] === 'ack', operation = ack ? 'ack' : args[1];
  if (!operation || !['init', 'prepare', 'status', 'wait', 'confirm', 'ack'].includes(operation)) throw new Refusal('unsupported_handoff_command');
  const values = new Map<string, string>(); const flags = new Set<string>();
  const names = ['--correlation-id', '--wait-for', '--wait-timeout', '--receipt', '--to', '--message-file', '--codex-home', '--codex-bin', '--output-format'];
  for (let i = ack ? 1 : 2; i < args.length; i++) {
    const token = args[i]!, equal = token.indexOf('='), name = equal < 0 ? token : token.slice(0, equal);
    if (['--json', '--no-update-notice', '--allow-inactive-codex-home'].includes(name)) {
      if (equal >= 0 || flags.has(name)) throw new Refusal('invalid_option'); flags.add(name); continue;
    }
    if (!names.includes(name) || values.has(name)) throw new Refusal('unsupported_option');
    const value = equal < 0 ? args[++i] : token.slice(equal + 1);
    if (value === undefined || (equal < 0 && value.startsWith('--'))) throw new Refusal('invalid_option'); values.set(name, value);
  }
  if (!flags.has('--json') && values.get('--output-format') !== 'json') throw new Refusal('json_output_required');
  if (values.has('--output-format') && values.get('--output-format') !== 'json') throw new Refusal('unsupported_output_format');
  const permitted: Record<string, string[]> = { init: [], prepare: ['--to', '--message-file', '--codex-home', '--codex-bin'],
    status: ['--correlation-id'], wait: ['--correlation-id', '--wait-for', '--wait-timeout'], confirm: ['--receipt'], ack: ['--receipt'] };
  if ([...values.keys()].some(k => k !== '--output-format' && !permitted[operation]!.includes(k)) ||
      (flags.has('--allow-inactive-codex-home') && operation !== 'prepare')) throw new Refusal('inapplicable_option');
  const path = ledgerPath(), ledger = new HandoffLedger(path);
  if (operation === 'init') {
    if (process.platform === 'win32') throw new Refusal('handoff_platform_unsupported', 1);
    const parent = dirname(path);
    // Initialization is explicit; never follow a symlinked state prefix.
    let current = parse(parent).root;
    for (const component of parent.slice(current.length).split('/').filter(Boolean)) {
      current = join(current, component);
      try { const stat = lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Refusal('handoff_storage_untrusted', 1); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; mkdirSync(current, { mode: 0o700 }); }
    }
    if (realpathSync(parent) !== parent) throw new Refusal('handoff_storage_untrusted', 1);
    return { value: ledger.init(), exitCode: 0 };
  }
  if (operation === 'prepare') {
    if (!values.get('--to') || !values.get('--message-file')) throw new Refusal('invalid_send_options');
    const value = await prepareHandoff({ to: values.get('--to')!, message: privateMessage(values.get('--message-file')!),
      home: values.get('--codex-home'), codexBin: values.get('--codex-bin'), allowInactive: flags.has('--allow-inactive-codex-home') }, path);
    return { value: { handoff: value.value.handoff }, exitCode: 0 };
  }
  if (operation === 'confirm' || operation === 'ack') {
    if (values.get('--receipt') !== '-') throw new Refusal('private_receipt_stdin_required', 2);
    const raw = await readInput(4096);
    return { value: { handoff: operation === 'confirm' ? ledger.confirm(raw) : ledger.acceptReceipt(raw) }, exitCode: 0 };
  }
  const id = values.get('--correlation-id'); if (!canonicalId(id)) throw new Refusal('invalid_correlation_id', 2);
  const result = ledger.status(id);
  if ('handoffQuery' in result) return { value: { ok: false, ...result }, exitCode: 1 };
  if (operation === 'status') return { value: result, exitCode: 0 };
  const goal = values.get('--wait-for'); if (!['delivered', 'acknowledged'].includes(goal ?? '')) throw new Refusal('invalid_wait_for', 2);
  const budget = new HandoffBudget(parseWaitTimeout(values.get('--wait-timeout') ?? '30'));
  const handoff = ledger.beginWait(id, goal as 'delivered' | 'acknowledged', budget);
  // No qualified observer/receipt bootstrap exists yet. This path never polls
  // transcripts, opens a native client or repeats a prior submission.
  return { value: { handoff, ok: handoff.wait.status === 'satisfied' }, exitCode: handoff.wait.status === 'satisfied' ? 0 : 1 };
}
