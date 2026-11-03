// Pure local receipt protocol. No filesystem, transport, process or native input.
import { posix } from 'node:path';
import { Refusal } from './discovery.js';
import { canonicalId, closed, HANDOFF_LIMITS, parseStrictJson, safeId, safeInteger,
  validateHandoff, validateReceipt, type Handoff, type Receipt } from './handoff.js';

export const RECEIPT_LIMITS = Object.freeze({ frame: 16384, privateFrame: 4096, depth: 16, nodes: 1024,
  connections: 16, readMs: 2000, writeMs: 2000, exchangeMs: 5000, activeWaits: 128 });
export type ReceiptScope = 'original_generation' | 'delegated_context';
export type ReceiptPair = { agent: 'codex'; receiptSchemaVersion: 1; receiptScope: 'original_generation' } |
  { agent: 'claude'; receiptSchemaVersion: 2; receiptScope: 'delegated_context' };
export const RECEIPT_PAIRS: readonly ReceiptPair[] = Object.freeze([
  Object.freeze({ agent: 'codex', receiptSchemaVersion: 1, receiptScope: 'original_generation' }),
  Object.freeze({ agent: 'claude', receiptSchemaVersion: 2, receiptScope: 'delegated_context' })
]);
export type ReceiptBinding = {
  agent: 'codex'; destination: string; target: string; home: string; writerIdentity: string;
  generation: string; payloadDigest: string;
} | {
  agent: 'claude'; destination: string; target: string; registryDirectory: string; registryRecordPath: string;
  registryIdentity: string; socketPath: string; routeIdentity: string; generation: null; payloadDigest: string;
};
export type ProducerEvidence = { protocolVersion: 1; artifactSha256: string; challengeId: string;
  receiptSchemaVersion: 1 | 2; receiptScope: ReceiptScope };
export type ReceiptV2 = { schemaVersion: 2; kind: 'receipt'; receiptScope: 'delegated_context';
  ledgerEpoch: string; correlationId: string; receiptContextId: string; receiptId: string; capability: string };
export type ManagedReceipt = Receipt | ReceiptV2;
export type HandoffV2 = Omit<Handoff, 'schemaVersion' | 'targetGeneration'> & {
  schemaVersion: 2; targetGeneration: null; receiptContext: { kind: 'delegated_context'; id: string };
};
export type ManagedHandoff = Handoff | HandoffV2;
export type ReceiptHandle = { ledgerEpoch: string; correlationId: string; receiptContextId: string | null };
export type ReceiptRequestBody = {
  hello: Record<string, never>;
  prepare: { binding: ReceiptBinding; receiptSchemaVersion: 1 | 2; receiptScope: ReceiptScope; producerEvidence: ProducerEvidence };
  mint: ReceiptHandle & { producerProtocolVersion: 1 };
  fence: ReceiptHandle & { binding: ReceiptBinding };
  submission: ReceiptHandle & { status: 'submitted' | 'refused' | 'unknown' };
  status: { ledgerEpoch: string; correlationId: string };
  'wait-open': { ledgerEpoch: string; correlationId: string; goal: 'acknowledged'; timeoutSeconds: number; clockReferenceMs: number; remainingMs: number };
  'wait-status': { ledgerEpoch: string; correlationId: string; operationId: string };
  'wait-stop': { ledgerEpoch: string; correlationId: string; operationId: string };
  revoke: { ledgerEpoch: string; correlationId: string };
  receipt: { receipt: string };
};
export type ReceiptOperation = keyof ReceiptRequestBody;
export type ReceiptRequest = { [K in ReceiptOperation]: {
  ipcVersion: 2; requestId: string; collectorContextId: K extends 'hello' ? null : string; op: K; body: ReceiptRequestBody[K]
} }[ReceiptOperation];
export type ReceiptResponseBody = {
  hello: { clockReferenceMs: number; receiptSchemas: ReceiptPair[]; managedStoreVersion: 2; endpointOwner: { uid: number; pid: number } };
  prepare: ReceiptHandle & { handoff: ManagedHandoff };
  mint: { capability: string };
  fence: { handoff: ManagedHandoff }; submission: { handoff: ManagedHandoff }; status: { handoff: ManagedHandoff };
  'wait-open': { handoff: ManagedHandoff }; 'wait-status': { handoff: ManagedHandoff }; 'wait-stop': { handoff: ManagedHandoff };
  revoke: { handoff: ManagedHandoff };
  receipt: { status: 'awaiting_submission' | 'acknowledged'; ledgerEpoch: string; correlationId: string;
    receiptId: string; handoff: ManagedHandoff };
};
export type ReceiptResponse = {
  ipcVersion: 2; requestId: string; collectorContextId: string;
} & ({ ok: true; body: ReceiptResponseBody[ReceiptOperation] } | { ok: false; error: ReceiptErrorCode });
export const RECEIPT_ERROR_CODES = Object.freeze([
  'invalid_receipt_protocol', 'invalid_handoff_json', 'handoff_frame_too_large', 'invalid_receipt', 'invalid_handoff', 'receipt_ipc_version_unsupported', 'receipt_schema_unsupported', 'receipt_scope_unsupported',
  'receipt_storage_unsupported', 'receipt_storage_untrusted', 'receipt_history_unavailable', 'receipt_history_changed',
  'receipt_history_corrupt', 'receipt_state_exists', 'receipt_collector_busy', 'receipt_collector_closed',
  'receipt_collector_error', 'receipt_collector_unavailable', 'receipt_ledger_full', 'receipt_id_unknown',
  'receipt_epoch_mismatch', 'receipt_binding_conflict', 'receipt_scope_mismatch', 'receipt_authority_unavailable',
  'receipt_authority_expired', 'receipt_authentication_failed', 'receipt_already_committed', 'receipt_candidate_conflict',
  'receipt_already_attempted', 'receipt_outcome_not_authorized', 'receipt_wait_quota', 'receipt_wait_unknown',
  'receipt_wait_terminal', 'receipt_context_mismatch', 'receipt_producer_mismatch', 'receipt_history_quarantined',
  'receipt_bootstrap_unsupported', 'receipt_managed_context_required', 'receipt_endpoint_untrusted',
  'receipt_endpoint_changed', 'receipt_endpoint_exists', 'receipt_endpoint_busy', 'receipt_transport_unknown',
  'receipt_frame_too_large', 'receipt_transport_timeout', 'insufficient_budget', 'deadline_before_effect'
] as const);
export type ReceiptErrorCode = typeof RECEIPT_ERROR_CODES[number];
export function isReceiptErrorCode(value: unknown): value is ReceiptErrorCode {
  return typeof value === 'string' && (RECEIPT_ERROR_CODES as readonly string[]).includes(value);
}
export function publicReceiptError(error: unknown): ReceiptErrorCode {
  return error instanceof Refusal && isReceiptErrorCode(error.code) ? error.code : 'receipt_collector_error';
}
function invalid(code = 'invalid_receipt_protocol'): never { throw new Refusal(code, 1); }
const digest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const nativeUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const member = (v: unknown, choices: readonly string[]): v is string => typeof v === 'string' && choices.includes(v);
const capability = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v) &&
  Buffer.from(v, 'base64url').length === 32 && Buffer.from(v, 'base64url').toString('base64url') === v;
const path = (v: unknown): v is string => safeId(v, 4096) && posix.isAbsolute(v) && v.startsWith('/') && posix.normalize(v) === v;
function keys(value: unknown, required: string[]): Record<string, unknown> {
  try { return closed(value, required); } catch { invalid(); }
}
function bounded(value: unknown, max: number = RECEIPT_LIMITS.frame): void {
  let nodes = 0;
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (++nodes > RECEIPT_LIMITS.nodes || depth > RECEIPT_LIMITS.depth) invalid();
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (Buffer.byteLength(item, 'utf8') > max || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)) invalid();
      return;
    }
    if (typeof item === 'number') { if (!safeInteger(item)) invalid(); return; }
    if (!item || typeof item !== 'object' || seen.has(item)) invalid();
    seen.add(item);
    if (Array.isArray(item)) for (const child of item) visit(child, depth + 1);
    else for (const [key, child] of Object.entries(item)) {
      if (++nodes > RECEIPT_LIMITS.nodes || !safeId(key, max)) invalid(); visit(child, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  try { if (Buffer.byteLength(JSON.stringify(value), 'utf8') + 1 > max) invalid('receipt_frame_too_large'); }
  catch (error) { if (error instanceof Refusal) throw error; invalid(); }
}
export function validateReceiptPair(agent: unknown, version: unknown, scope: unknown): ReceiptPair {
  const pair = RECEIPT_PAIRS.find(item => item.agent === agent && item.receiptSchemaVersion === version && item.receiptScope === scope);
  if (!pair) invalid('receipt_scope_unsupported');
  return { ...pair };
}
export function validateBinding(value: unknown): ReceiptBinding {
  const agent = value && typeof value === 'object' ? (value as Record<string, unknown>).agent : undefined;
  const row = keys(value, agent === 'codex' ? ['agent','destination','target','home','writerIdentity','generation','payloadDigest'] :
    ['agent','destination','target','registryDirectory','registryRecordPath','registryIdentity','socketPath','routeIdentity','generation','payloadDigest']);
  if (!safeId(row.destination, 512) || !digest(row.payloadDigest)) invalid();
  if (agent === 'codex') {
    if (!nativeUuid(row.target) || !path(row.home) || !safeId(row.generation, 256) || !safeId(row.writerIdentity, 256)) invalid();
  } else if (agent === 'claude') {
    if (typeof row.target !== 'string' || row.target.length > 10 || !/^[1-9][0-9]*$/.test(row.target) || Number(row.target) <= 1 || Number(row.target) > 2147483647 ||
        !path(row.registryDirectory) || !path(row.registryRecordPath) || !digest(row.registryIdentity) ||
        !safeId(row.socketPath, 4096) || !digest(row.routeIdentity) || row.generation !== null) invalid();
  } else invalid();
  return structuredClone(row) as ReceiptBinding;
}
export const validateReceiptBinding = validateBinding;
export function validateProducerEvidence(value: unknown): ProducerEvidence {
  const row = keys(value, ['protocolVersion','artifactSha256','challengeId','receiptSchemaVersion','receiptScope']);
  if (row.protocolVersion !== 1 || !digest(row.artifactSha256) || !canonicalId(row.challengeId)) invalid('receipt_producer_mismatch');
  validateReceiptPair(row.receiptSchemaVersion === 1 ? 'codex' : 'claude', row.receiptSchemaVersion, row.receiptScope);
  return structuredClone(row) as ProducerEvidence;
}
export function validateReceiptV2(raw: string | Uint8Array): ReceiptV2 {
  const row = keys(parseStrictJson(raw), ['schemaVersion','kind','receiptScope','ledgerEpoch','correlationId','receiptContextId','receiptId','capability']);
  if (row.schemaVersion !== 2 || row.kind !== 'receipt' || row.receiptScope !== 'delegated_context' ||
      !canonicalId(row.ledgerEpoch) || !canonicalId(row.correlationId) || !canonicalId(row.receiptContextId) ||
      !canonicalId(row.receiptId) || !capability(row.capability)) invalid();
  return structuredClone(row) as ReceiptV2;
}
export function validateManagedReceipt(raw: string | Uint8Array): ManagedReceipt {
  const value = parseStrictJson(raw) as Record<string, unknown>;
  if (value && value.schemaVersion === 1) return validateReceipt(raw);
  if (value && value.schemaVersion === 2) return validateReceiptV2(raw);
  invalid('receipt_schema_unsupported');
}
export function validateHandoffV2(value: unknown): HandoffV2 {
  const row = keys(value, ['schemaVersion','correlationId','ledgerEpoch','state','submission','observation','ack','wait',
    'targetGeneration','receiptContext','decisionOwner','retry','nextActions']);
  const context = keys(row.receiptContext, ['kind','id']);
  if (row.schemaVersion !== 2 || row.targetGeneration !== null || context.kind !== 'delegated_context' || !canonicalId(context.id)) invalid();
  const obs = keys(row.observation, ['status','injectionObserved']);
  if (!member(obs.status, ['not_requested','unsupported']) || obs.injectionObserved !== false || row.state === 'delivered') invalid();
  const ack = row.ack as Record<string, unknown>, wait = row.wait as Record<string, unknown>;
  if (!ack || !wait || (ack.status === 'acknowledged' && ack.assurance !== 'token_possession') ||
      (wait.for === 'delivered' && !member(wait.status, ['unsupported','failed'])) ||
      (Array.isArray(row.nextActions) && row.nextActions.includes('keep_waiting') && (wait.for !== 'acknowledged' || wait.status !== 'pending'))) invalid();
  // Reuse all unchanged v1 predicates without teaching its strict validator a
  // permissive extension. The synthetic generation is local validation-only;
  // it is never returned, persisted, sent or used as identity evidence.
  const legacy = { ...row, schemaVersion: 1, targetGeneration: 'validation-only-not-native-generation' };
  delete (legacy as Record<string, unknown>).receiptContext;
  validateHandoff(legacy);
  try { if (Buffer.byteLength(JSON.stringify(row), 'utf8') > HANDOFF_LIMITS.publicFrame) invalid('receipt_frame_too_large'); }
  catch (error) { if (error instanceof Refusal) throw error; invalid(); }
  return structuredClone(row) as HandoffV2;
}
export function validateManagedHandoff(value: unknown): ManagedHandoff {
  if (value && typeof value === 'object' && (value as Record<string, unknown>).schemaVersion === 2) return validateHandoffV2(value);
  return validateHandoff(value);
}
export function parseManagedHandoff(raw: string | Uint8Array): ManagedHandoff {
  return validateManagedHandoff(parseStrictJson(raw, { scope: 'handoff' }));
}
function handle(value: Record<string, unknown>): void {
  if (!canonicalId(value.ledgerEpoch) || !canonicalId(value.correlationId) ||
      (value.receiptContextId !== null && !canonicalId(value.receiptContextId))) invalid();
}
const operations: readonly ReceiptOperation[] = ['hello','prepare','mint','fence','submission','status','wait-open','wait-status','wait-stop','revoke','receipt'];
export function validateReceiptRequest(value: unknown): ReceiptRequest {
  const row = keys(value, ['ipcVersion','requestId','collectorContextId','op','body']);
  if (row.ipcVersion !== 2) invalid('receipt_ipc_version_unsupported');
  if (!canonicalId(row.requestId) || !operations.includes(row.op as ReceiptOperation) ||
      (row.op === 'hello' ? row.collectorContextId !== null : !canonicalId(row.collectorContextId))) invalid();
  let body: Record<string, unknown>;
  switch (row.op) {
    case 'hello': keys(row.body, []); break;
    case 'prepare': {
      body = keys(row.body, ['binding','receiptSchemaVersion','receiptScope','producerEvidence']);
      const binding = validateBinding(body.binding), producer = validateProducerEvidence(body.producerEvidence);
      validateReceiptPair(binding.agent, body.receiptSchemaVersion, body.receiptScope);
      if (producer.receiptSchemaVersion !== body.receiptSchemaVersion || producer.receiptScope !== body.receiptScope) invalid('receipt_producer_mismatch');
      break;
    }
    case 'mint': body = keys(row.body, ['ledgerEpoch','correlationId','receiptContextId','producerProtocolVersion']); handle(body); if (body.producerProtocolVersion !== 1) invalid('receipt_producer_mismatch'); break;
    case 'fence': body = keys(row.body, ['ledgerEpoch','correlationId','receiptContextId','binding']); handle(body); {
      const binding = validateBinding(body.binding); if ((binding.agent === 'codex') !== (body.receiptContextId === null)) invalid();
    } break;
    case 'submission': body = keys(row.body, ['ledgerEpoch','correlationId','receiptContextId','status']); handle(body); if (!member(body.status, ['submitted','refused','unknown'])) invalid(); break;
    case 'status': case 'revoke': body = keys(row.body, ['ledgerEpoch','correlationId']); if (!canonicalId(body.ledgerEpoch) || !canonicalId(body.correlationId)) invalid(); break;
    case 'wait-open': body = keys(row.body, ['ledgerEpoch','correlationId','goal','timeoutSeconds','clockReferenceMs','remainingMs']); if (!canonicalId(body.ledgerEpoch) || !canonicalId(body.correlationId) || body.goal !== 'acknowledged' || !safeInteger(body.timeoutSeconds) || body.timeoutSeconds < 1 || body.timeoutSeconds > 60 || !safeInteger(body.clockReferenceMs) || !safeInteger(body.remainingMs) || body.remainingMs < 1 || body.remainingMs > body.timeoutSeconds * 1000) invalid(); break;
    case 'wait-status': case 'wait-stop': body = keys(row.body, ['ledgerEpoch','correlationId','operationId']); if (!canonicalId(body.ledgerEpoch) || !canonicalId(body.correlationId) || !canonicalId(body.operationId)) invalid(); break;
    case 'receipt': body = keys(row.body, ['receipt']); if (typeof body.receipt !== 'string') invalid(); validateManagedReceipt(body.receipt); break;
    default: invalid();
  }
  bounded(row); return structuredClone(row) as ReceiptRequest;
}
function parseFrame(raw: string | Uint8Array, maximum: number = RECEIPT_LIMITS.frame): unknown {
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  if (bytes.byteLength > maximum) invalid('receipt_frame_too_large');
  if (!bytes.byteLength || bytes[bytes.byteLength - 1] !== 10 || bytes.subarray(0, -1).includes(10) || bytes.includes(13)) invalid();
  return parseStrictJson(typeof raw === 'string' ? raw : bytes, { maxBytes: maximum });
}
export function parseReceiptRequest(raw: string | Uint8Array): ReceiptRequest { return validateReceiptRequest(parseFrame(raw)); }
function matchingHandoff(value: unknown, request: ReceiptRequest): ManagedHandoff {
  const result = validateManagedHandoff(value), body = request.body as Record<string, unknown>;
  if ('ledgerEpoch' in body && (result.ledgerEpoch !== body.ledgerEpoch || result.correlationId !== body.correlationId)) invalid();
  // Handles carry an immutable scope discriminator: null is Codex v1; an
  // original context UUID is Claude v2. IDs alone cannot authorize a cross-scope
  // response, even when both variants are independently well-formed.
  if (Object.hasOwn(body, 'receiptContextId')) {
    if (body.receiptContextId === null) { if (result.schemaVersion !== 1) invalid(); }
    else if (result.schemaVersion !== 2 || result.receiptContext.id !== body.receiptContextId) invalid();
  }
  if (request.op === 'fence' && result.targetGeneration !== request.body.binding.generation) invalid();
  if ((request.op === 'wait-status' || request.op === 'wait-stop') && result.wait.operationId !== body.operationId) invalid();
  return result;
}
export function validateReceiptResponse(value: unknown, request: ReceiptRequest): ReceiptResponse {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  keys(row, row.ok === true ? ['ipcVersion','requestId','collectorContextId','ok','body'] : ['ipcVersion','requestId','collectorContextId','ok','error']);
  if (row.ipcVersion !== 2 || row.requestId !== request.requestId || !canonicalId(row.collectorContextId)) invalid();
  if (request.collectorContextId !== null && row.collectorContextId !== request.collectorContextId) invalid('receipt_context_mismatch');
  if (row.ok === false) { if (!isReceiptErrorCode(row.error)) invalid(); bounded(row); return structuredClone(row) as ReceiptResponse; }
  if (row.ok !== true) invalid();
  let body: Record<string, unknown>;
  switch (request.op) {
    case 'hello': {
      body = keys(row.body, ['receiptSchemas','managedStoreVersion','endpointOwner','clockReferenceMs']);
      const owner = keys(body.endpointOwner, ['uid','pid']);
      if (!safeInteger(body.clockReferenceMs) || body.managedStoreVersion !== 2 || !safeInteger(owner.uid) || !safeInteger(owner.pid) || owner.pid <= 1 || owner.pid > 2147483647 ||
          !Array.isArray(body.receiptSchemas) || body.receiptSchemas.length < 1 || body.receiptSchemas.length > 2) invalid();
      const scopes = new Set<string>();
      for (const item of body.receiptSchemas) {
        const pair = keys(item, ['agent','receiptSchemaVersion','receiptScope']); validateReceiptPair(pair.agent,pair.receiptSchemaVersion,pair.receiptScope);
        if (scopes.has(String(pair.receiptScope))) invalid(); scopes.add(String(pair.receiptScope));
      } break;
    }
    case 'prepare': {
      body = keys(row.body, ['ledgerEpoch','correlationId','receiptContextId','handoff']); handle(body);
      const handoff = validateManagedHandoff(body.handoff), binding = request.body.binding;
      if (handoff.ledgerEpoch !== body.ledgerEpoch || handoff.correlationId !== body.correlationId || handoff.targetGeneration !== binding.generation ||
          (binding.agent === 'codex' ? body.receiptContextId !== null || handoff.schemaVersion !== 1 :
            handoff.schemaVersion !== 2 || handoff.receiptContext.id !== body.receiptContextId)) invalid();
      break;
    }
    case 'mint': body = keys(row.body, ['capability']); if (!capability(body.capability)) invalid(); break;
    case 'receipt': {
      body = keys(row.body, ['status','ledgerEpoch','correlationId','receiptId','handoff']);
      const receipt = validateManagedReceipt(request.body.receipt), handoff = validateManagedHandoff(body.handoff);
      if (!member(body.status, ['awaiting_submission','acknowledged']) || body.ledgerEpoch !== receipt.ledgerEpoch ||
          body.correlationId !== receipt.correlationId || body.receiptId !== receipt.receiptId || handoff.ledgerEpoch !== receipt.ledgerEpoch ||
          handoff.correlationId !== receipt.correlationId || (body.status === 'acknowledged') !== (handoff.ack.status === 'acknowledged') ||
          (receipt.schemaVersion === 1 ? handoff.schemaVersion !== 1 || handoff.targetGeneration !== receipt.targetGeneration :
            handoff.schemaVersion !== 2 || handoff.receiptContext.id !== receipt.receiptContextId)) invalid();
      break;
    }
    default: body = keys(row.body, ['handoff']); matchingHandoff(body.handoff, request); break;
  }
  bounded(row); return structuredClone(row) as ReceiptResponse;
}
export function parseReceiptResponse(raw: string | Uint8Array, request: ReceiptRequest): ReceiptResponse {
  return validateReceiptResponse(parseFrame(raw), request);
}
export type ProducerProbeRequest = { producerProtocolVersion: 1; challengeId: string; receiptSchemaVersion: 1 | 2; receiptScope: ReceiptScope };
export type ProducerProbeResponse = ProducerProbeRequest & { implementation: 'typescript'; runtimeVersion: string };
export function validateProducerProbeRequest(value: unknown): ProducerProbeRequest {
  const row = keys(value, ['producerProtocolVersion','challengeId','receiptSchemaVersion','receiptScope']);
  if (row.producerProtocolVersion !== 1 || !canonicalId(row.challengeId)) invalid('receipt_producer_mismatch');
  validateReceiptPair(row.receiptSchemaVersion === 1 ? 'codex' : 'claude', row.receiptSchemaVersion,row.receiptScope);
  bounded(row, RECEIPT_LIMITS.privateFrame); return structuredClone(row) as ProducerProbeRequest;
}
export function validateProducerProbeResponse(value: unknown, request: ProducerProbeRequest): ProducerProbeResponse {
  const row = keys(value, ['producerProtocolVersion','challengeId','receiptSchemaVersion','receiptScope','implementation','runtimeVersion']);
  if (row.producerProtocolVersion !== request.producerProtocolVersion || row.challengeId !== request.challengeId ||
      row.receiptSchemaVersion !== request.receiptSchemaVersion || row.receiptScope !== request.receiptScope || row.implementation !== 'typescript' ||
      typeof row.runtimeVersion !== 'string' || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(row.runtimeVersion) || row.runtimeVersion.length > 64) invalid('receipt_producer_mismatch');
  bounded(row, RECEIPT_LIMITS.privateFrame); return structuredClone(row) as ProducerProbeResponse;
}
export function parseProducerProbeRequest(raw: string | Uint8Array): ProducerProbeRequest {
  return validateProducerProbeRequest(parseFrame(raw, RECEIPT_LIMITS.privateFrame));
}
export function parseProducerProbeResponse(raw: string | Uint8Array, request: ProducerProbeRequest): ProducerProbeResponse {
  return validateProducerProbeResponse(parseFrame(raw, RECEIPT_LIMITS.privateFrame), request);
}
