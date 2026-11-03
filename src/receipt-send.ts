// Explicit local receipt delegation. No import-time IO, collector startup or replay.
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeQueueCapability, nativeQueueOnce, AppServerFault, type AppServerScope } from './app-server.js';
import { Refusal, type ClaudeReceiptProvenance } from './discovery.js';
import { HandoffBudget } from './handoff.js';
import { inspectMacosAcls } from './macos-acl.js';
import { currentPlatform, selectNativeProfile } from './native-profiles.js';
import { run, UnknownOutcome } from './process.js';
import { receiptEndpoint, receiptExchange } from './receipt-collector.js';
import { validateReceiptProducer } from './receipt-producer.js';
import { RECEIPT_PAIRS, validateReceiptBinding, validateManagedHandoff, type ManagedHandoff, type ReceiptBinding,
  type ReceiptHandle, type ReceiptOperation, type ReceiptPair, type ReceiptRequestBody, type ReceiptResponse } from './receipt-protocol.js';
import { checkMessage, send, type SendContext, type SendOptions } from './send.js';

export type ReceiptSendConfig = { collector: string; requestAck?: boolean; waitFor?: 'acknowledged'; seconds?: number; payload?: string; budget?: HandoffBudget };
// Explicit in-process fixtures only; these are never configured by CLI or environment.
export type ReceiptSendDependencies = { send?: typeof send; exchange?: typeof receiptExchange; producer?: typeof validateReceiptProducer;
  endpoint?: typeof receiptEndpoint; nativeQueue?: typeof nativeQueueOnce; run?: typeof run };
class Unsupported extends Refusal { constructor() { super('receipt_bootstrap_unsupported',1); } }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const identity = (s: Stats) => [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs,s.birthtimeMs].join(':');
function claudeAdmission(proof: ClaudeReceiptProvenance): () => void {
  const paths = [proof.registryDirectory,proof.registryRecordPath];
  const inspect = () => {
    const directory = lstatSync(paths[0]!), record = lstatSync(paths[1]!);
    if (directory.isSymbolicLink() || !directory.isDirectory() || record.isSymbolicLink() || !record.isFile() ||
        directory.uid !== process.getuid?.() || record.uid !== process.getuid?.() ||
        ((directory.mode | record.mode) & 0o022) !== 0 || realpathSync(paths[0]!) !== paths[0] ||
        realpathSync(paths[1]!) !== paths[1] || dirname(paths[1]!) !== paths[0] || digest(identity(record)) !== proof.registryIdentity) throw new Refusal('receipt_registry_untrusted',1);
    return [identity(directory),identity(record)].join('/');
  };
  try {
    const pinned = inspect();
    const revalidate = () => {
      if (inspect() !== pinned || (process.platform === 'darwin' && inspectMacosAcls(paths) !== 'clear') || inspect() !== pinned) throw new Refusal('receipt_registry_untrusted',1);
    };
    revalidate(); return revalidate;
  } catch { throw new Refusal('receipt_registry_untrusted',1); }
}
export async function managedReceiptSend(options: SendOptions, config: ReceiptSendConfig, deps: ReceiptSendDependencies = {}): Promise<{ value: Record<string,unknown>; exitCode: number }> {
  if ((config.requestAck !== undefined && typeof config.requestAck !== 'boolean') ||
      (config.waitFor !== undefined && config.waitFor !== 'acknowledged')) throw new Refusal('receipt_opt_in_required',2);
  if (!options.dryRun && config.requestAck !== true && config.waitFor !== 'acknowledged') throw new Refusal('receipt_opt_in_required',2);
  const sourceSend = deps.send ?? send;
  if (options.dryRun) return {value:{...await sourceSend({...options,hooks:undefined}),receiptBootstrap:{status:'not_checked'}},exitCode:0};
  const budget = config.budget ?? new HandoffBudget(config.seconds ?? 30), exchange = deps.exchange ?? receiptExchange;
  const endpoint = deps.endpoint ?? receiptEndpoint, probe = deps.run ?? run;
  const required = config.waitFor === 'acknowledged';
  let contextId: string | null = null, endpointIdentity: string | undefined, original: ReceiptBinding | undefined;
  let handoff: ManagedHandoff | undefined, handle: ReceiptHandle | undefined, operationId: string | undefined, operationDeadline: number | undefined;
  let snapshot: Record<string,unknown> | undefined, knownNative: Record<string,unknown> | undefined;
  let firstContext: SendContext | undefined;
  let waitBudget: { clockReferenceMs: number; remainingMs: number } | undefined;
  let prepared = false, fenced = false, stopped = false, stopSent = false;
  let producer: Awaited<ReturnType<typeof validateReceiptProducer>> | undefined, revalidateTarget = () => {};
  let queueScope: AppServerScope | undefined, ownerArgs: string[] = [];
  const timeout = () => { const remaining = Math.floor(budget.remainingMs()); if (remaining < 1) throw new Refusal('deadline_before_effect',1); return remaining; };
  const rpc = async <K extends ReceiptOperation>(op: K, body: ReceiptRequestBody[K]) => {
    if (endpointIdentity !== undefined && endpoint(config.collector) !== endpointIdentity) throw new Refusal('receipt_endpoint_changed',1);
    const response: ReceiptResponse = await exchange(config.collector,contextId,op,body,timeout());
    if (contextId !== null && response.collectorContextId !== contextId) throw new Refusal('receipt_context_mismatch',1);
    if (!response.ok) throw new Refusal(response.error,1);
    if ('handoff' in response.body) {
      const h = validateManagedHandoff(response.body.handoff);
      if (handle && (h.ledgerEpoch !== handle.ledgerEpoch || h.correlationId !== handle.correlationId ||
          h.schemaVersion !== (handle.receiptContextId === null ? 1 : 2) ||
          (h.schemaVersion === 2 && h.receiptContext.id !== handle.receiptContextId) || h.targetGeneration !== original?.generation)) throw new Refusal('receipt_context_mismatch',1);
      if (operationId && (op === 'wait-status' || op === 'wait-stop') &&
          (h.wait.operationId !== operationId || h.wait.deadlineAtUtcMs !== operationDeadline)) throw new Refusal('receipt_wait_unknown',1);
    }
    return response;
  };
  const update = (response: ReceiptResponse) => {
    if (!response.ok || !('handoff' in response.body)) throw new Refusal('invalid_receipt_protocol',1);
    const incoming = validateManagedHandoff(response.body.handoff);
    if (operationId && incoming.wait.operationId === operationId && incoming.wait.deadlineAtUtcMs !== operationDeadline)
      throw new Refusal('receipt_wait_unknown',1);
    // A general actor response may expose a concurrent owner's latest wait.
    // Only an explicit original-operation query can replace our wait evidence.
    handoff = !required ? {...incoming,wait:{for:'none',status:'not_requested'},nextActions:['reconcile']} :
      operationId && incoming.wait.operationId !== operationId && handoff ?
        {...incoming,wait:handoff.wait,nextActions:['reconcile']} : incoming;
  };
  const selector = () => ({ledgerEpoch:handle!.ledgerEpoch,correlationId:handle!.correlationId});
  const ownWait = async () => { if (operationId) update(await rpc('wait-status',{...selector(),operationId})); };
  const stopWait = async () => {
    stopSent = true;
    try { update(await rpc('wait-stop',{...selector(),operationId:operationId!})); }
    catch (error) {
      if (budget.remainingMs() <= 0) throw error;
      await ownWait(); // One read of the original operation; a terminal result wins.
      if (handoff?.wait.status === 'pending') throw error;
    }
  };
  const authorize = async () => {
    if (fenced) throw new Refusal('receipt_already_attempted',1);
    if (stopped) throw new Refusal('stopped_by_operator',130);
    budget.beforeEffect(); producer!.revalidate(); revalidateTarget();
    if (endpoint(config.collector) !== endpointIdentity) throw new Refusal('receipt_endpoint_changed',1);
    budget.beforeEffect(); update(await rpc('fence',{...handle!,binding:original!})); fenced = true;
    producer!.revalidate(); revalidateTarget(); budget.beforeEffect();
  };
  const verifyOwner = async (scope: AppServerScope) => {
    if (stopped || budget.observationRemainingMs() < 1) return false;
    const result = await probe(process.execPath,[fileURLToPath(new URL('./handoff-writer-probe.js',import.meta.url)),scope.codexHome,scope.threadId,...ownerArgs],
      {timeout:Math.min(800,budget.observationRemainingMs()),limit:4096,env:{...process.env,NODE_OPTIONS:undefined,NODE_PATH:undefined}});
    if (stopped || result.interrupted || result.code !== 0) return false;
    try { const row = JSON.parse(result.stdout); return row.schemaVersion === 1 && row.ok === true && row.generation === scope.generation && Object.keys(row).every(k => ['schemaVersion','ok','generation'].includes(k)); } catch { return false; }
  };
  const stop = () => { stopped = true; };
  const finish = (value: Record<string,unknown>, exitCode: number) => ({value:{...value,receiptBootstrap:{status:prepared ? 'supported' : 'unsupported'},...(handoff ? {handoff} : {})},exitCode});
  if (required) process.on('SIGINT',stop);
  try {
    const value = await sourceSend({...options,hooks:{privateReceiptContext:true,
      async resolved(context: SendContext,native,provenance) {
        firstContext = {...context}; snapshot = {...native}; budget.beforeEffect();
        const pair: ReceiptPair = RECEIPT_PAIRS.find(p => p.agent === context.agent)!;
        if (!['linux','darwin'].includes(process.platform)) throw new Unsupported();
        if (context.agent === 'claude') {
          if (!provenance || context.generation !== null) throw new Unsupported();
          if (provenance.routeIdentity !== context.writerIdentity) throw new Refusal('receipt_registry_untrusted',1);
          revalidateTarget = claudeAdmission(provenance);
          original = validateReceiptBinding({agent:'claude',destination:hostname(),target:context.target,...provenance,generation:null,payloadDigest:digest(config.payload ?? options.message)});
        } else {
          if (!context.home || !context.writerIdentity || !context.generation || !context.binary) throw new Unsupported();
          original = validateReceiptBinding({agent:'codex',destination:hostname(),target:context.target,home:context.home,writerIdentity:context.writerIdentity,generation:context.generation,payloadDigest:digest(config.payload ?? options.message)});
          queueScope = {codexHome:context.home,threadId:context.target,generation:context.generation,ownerIdentity:context.writerIdentity};
          const result = await probe(context.binary,['--version'],{timeout:Math.min(1000,timeout()),limit:4096});
          const version = !result.interrupted && result.code === 0 && /^codex-cli \d+\.\d+\.\d+\s*$/.test(result.stdout) ? result.stdout.trim().slice(10) : '';
          const profile = selectNativeProfile({platform:currentPlatform(),version});
          if (!profile || !nativeQueueCapability({version,platform:currentPlatform(),scope:queueScope}).queueSupported) throw new Unsupported();
          ownerArgs = profile.ownerInspection === 'lsof_ps_procfs_locks' ? ['--procfs-owner'] : [];
          if (!await verifyOwner(queueScope)) throw new Unsupported();
        }
        endpointIdentity = endpoint(config.collector);
        const hello = await rpc('hello',{}); const remainingMs = Math.floor(budget.remainingMs()); contextId = hello.collectorContextId;
        if (!hello.ok || !('receiptSchemas' in hello.body)) throw new Refusal('invalid_receipt_protocol',1);
        if (remainingMs < 1) throw new Refusal('deadline_before_effect',1);
        waitBudget = {clockReferenceMs:hello.body.clockReferenceMs,remainingMs};
        if (hello.body.endpointOwner.uid !== process.getuid?.()) throw new Refusal('receipt_endpoint_untrusted',1);
        if (!hello.body.receiptSchemas.some(p => p.agent === pair.agent && p.receiptSchemaVersion === pair.receiptSchemaVersion && p.receiptScope === pair.receiptScope)) throw new Unsupported();
        producer = await (deps.producer ?? validateReceiptProducer)(pair,{timeoutMs:timeout()});
        revalidateTarget(); budget.beforeEffect();
        // Account for the whole inert recipient envelope before allocating authority.
        const placeholder = {schemaVersion:pair.receiptSchemaVersion,kind:'receipt',ledgerEpoch:randomUUID(),correlationId:randomUUID(),
          ...(pair.agent === 'codex' ? {targetGeneration:context.generation} : {receiptScope:'delegated_context',receiptContextId:randomUUID()}),receiptId:randomUUID(),capability:'x'.repeat(43)};
        checkMessage(options.message+'\nCorrelation-Id: '+placeholder.correlationId+'\nReceipt-Only: '+JSON.stringify({collector:config.collector,receipt:placeholder}),context.agent === 'codex');
        // Once prepare is attempted, no ordinary fallback is allowed even on an ambiguous response.
        prepared = true;
        const response = await rpc('prepare',{binding:original,receiptSchemaVersion:pair.receiptSchemaVersion,receiptScope:pair.receiptScope,producerEvidence:producer.evidence});
        if (!response.ok || !('ledgerEpoch' in response.body) || !('receiptContextId' in response.body) || !('handoff' in response.body)) throw new Refusal('invalid_receipt_protocol',1);
        handle = {ledgerEpoch:response.body.ledgerEpoch,correlationId:response.body.correlationId,receiptContextId:response.body.receiptContextId};
        const h = validateManagedHandoff(response.body.handoff);
        if (h.schemaVersion !== pair.receiptSchemaVersion || h.targetGeneration !== context.generation || h.ledgerEpoch !== handle.ledgerEpoch || h.correlationId !== handle.correlationId ||
            (pair.agent === 'codex' ? handle.receiptContextId !== null : h.schemaVersion !== 2 || h.receiptContext.id !== handle.receiptContextId)) throw new Refusal('receipt_context_mismatch',1);
        handoff = h;
        const minted = await rpc('mint',{...handle,producerProtocolVersion:1});
        if (!minted.ok || !('capability' in minted.body)) throw new Refusal('invalid_receipt_protocol',1);
        if (required) {
          update(await rpc('wait-open',{...selector(),goal:'acknowledged',timeoutSeconds:budget.seconds,...waitBudget!}));
          operationId = handoff!.wait.operationId;
          operationDeadline = handoff!.wait.deadlineAtUtcMs;
          if (!operationId || handoff!.wait.status !== 'pending') throw new Refusal(handoff!.wait.reason ?? 'receipt_bootstrap_unsupported',1);
        }
        const frame = {...placeholder,ledgerEpoch:handle.ledgerEpoch,correlationId:handle.correlationId,
          ...(pair.agent === 'claude' ? {receiptContextId:handle.receiptContextId} : {}),capability:minted.body.capability};
        return options.message+'\nCorrelation-Id: '+handle.correlationId+'\nReceipt-Only: '+JSON.stringify({collector:config.collector,receipt:frame});
      },beforeEffect:authorize,codexRoute:()=> 'owned_app_server',
      async submitCodex(_context,message,storage) {
        if (!queueScope || !handle) throw new Unsupported();
        try { return await (deps.nativeQueue ?? nativeQueueOnce)({binary:storage.binary,scope:queueScope,message,clientUserMessageId:handle.correlationId,
          deadlineMs:budget.cutoff,verifyOwner,beforeEffect:authorize,verifyStorage:()=>storage.revalidate(true),verifyStorageSync:()=>storage.finalCheck(true)}); }
        catch(error) { if (error instanceof AppServerFault) { if (error.attempted) throw new UnknownOutcome(); throw new Refusal('receipt_bootstrap_unsupported',1); } throw error; }
      },timeoutMs:()=> {budget.beforeEffect(); return Math.max(1,Math.floor(budget.observationRemainingMs()));}
    }});
    knownNative = {...value};
    update(await rpc('submission',{...handle!,status:'submitted'}));
    await ownWait();
    while (required && handoff!.wait.status === 'pending' && !stopped && budget.observationRemainingMs() > 0) {
      await delay(Math.min(100,budget.observationRemainingMs())); if (stopped) break; await ownWait();
    }
    if (required && handoff!.wait.status === 'pending') {
      if (stopped && !stopSent) { await stopWait(); }
      else if (!stopped) { await delay(Math.min(25,budget.remainingMs())); if (stopped && !stopSent) await stopWait(); else await ownWait(); }
    }
    if (required && handoff!.wait.status !== 'satisfied') {
      const interrupted = handoff!.wait.status === 'stopped' && handoff!.wait.reason === 'stopped_by_operator';
      return finish({...value,ok:false,error:handoff!.wait.reason ?? 'timed_out_unknown',retryAllowed:false},interrupted ? 130 : 1);
    }
    return finish(value,0);
  } catch(error) {
    if (!prepared && !required && firstContext && error instanceof Refusal && ['receipt_bootstrap_unsupported','receipt_collector_unavailable'].includes(error.code)) {
      try {
        const value = await sourceSend({...options,hooks:{
          resolved(context) {
            const fields = ['agent','target','home','generation','writerIdentity','binary'] as const;
            if (fields.some(field => context[field] !== firstContext![field])) throw new Refusal('target_changed',1);
            budget.beforeEffect();
          },
          beforeEffect() { budget.beforeEffect(); },
          timeoutMs() { budget.beforeEffect(); return Math.max(1,Math.floor(budget.observationRemainingMs())); }
        }});
        return {value:{...value,receiptBootstrap:{status:'unsupported'},retryAllowed:false},exitCode:0};
      } catch (fallbackError) { error = fallbackError; }
    }
    if (!snapshot) throw error;
    let warning = false;
    const uncertain = error instanceof UnknownOutcome || (fenced && !(error instanceof Refusal));
    let stopError: unknown;
    // Preserve an explicit stop before revoke/submission terminalizes this wait.
    if (stopped && operationId && handoff?.wait.status === 'pending' && !stopSent) {
      try { await stopWait(); } catch (failure) { stopError = failure; warning = true; }
    }
    if (knownNative) {
      // A receipt/IPC failure cannot erase independently positive native acceptance.
      if (handoff) handoff = {...handoff,state:handoff.ack.status === 'acknowledged' ? 'acknowledged' : 'submitted',submission:{status:'submitted'},nextActions:['reconcile']};
      if (required && stopSent && handoff && handoff.wait.status !== 'pending') {
        if (handoff.wait.status === 'satisfied') return finish(knownNative,0);
        const confirmedStop = handoff.wait.status === 'stopped' && handoff.wait.reason === 'stopped_by_operator';
        return finish({...knownNative,ok:false,error:handoff.wait.reason ?? 'timed_out_unknown',retryAllowed:false},confirmedStop ? 130 : 1);
      }
      return finish({...knownNative,...(required ? {ok:false,error:stopSent ? 'stop_unconfirmed' : 'receipt_persistence_failed'} : {}),handoffWarning:'persistence_failed',retryAllowed:false},required ? 1 : 0);
    }
    if (handle) {
      try {
        if (fenced) update(await rpc('submission',{...handle,status:uncertain ? 'unknown' : 'refused'}));
        else update(await rpc('revoke',selector()));
        await ownWait();
      } catch { warning = true; }
    }
    if (error instanceof Refusal && error.code === 'stopped_by_operator' &&
        !(handoff?.wait.status === 'stopped' && handoff.wait.reason === 'stopped_by_operator'))
      error = stopError instanceof Refusal ? stopError : new Refusal('stop_unconfirmed',1);
    return finish({...snapshot,ok:false,status:uncertain ? 'unknown' : 'refused',submitted:uncertain ? null : false,consumptionConfirmed:false,
      error:error instanceof Refusal ? error.code : uncertain ? 'outcome_unknown' : 'receipt_operation_failed',retryAllowed:false,...(warning ? {handoffWarning:'persistence_failed'} : {})},handoff?.wait.status === 'stopped' && handoff.wait.reason === 'stopped_by_operator' ? 130 : error instanceof Refusal && error.exitCode !== 130 ? error.exitCode : 1);
  } finally { if (required) process.removeListener('SIGINT',stop); }
}
