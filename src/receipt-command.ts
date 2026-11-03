// Explicit owner commands for the local receipt-only collector. This module
// never launches programs, submits native input or discovers another endpoint.
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Refusal } from './discovery.js';
import { HandoffBudget, canonicalId, parseWaitTimeout, safeId } from './handoff.js';
import { ReceiptState } from './receipt-state.js';
import { receiptExchange, startReceiptCollector, type Collector } from './receipt-collector.js';
import { RECEIPT_LIMITS, parseProducerProbeRequest, publicReceiptError, validateManagedHandoff, validateManagedReceipt,
  type ManagedHandoff, type ReceiptResponse } from './receipt-protocol.js';
import { VERSION } from './protocol.js';

export type ReceiptCommandResult = { value: Record<string, unknown>; exitCode: number; raw?: boolean; collector?: Collector };
const operations = ['init','serve','respond','status','wait','revoke','probe'] as const;
type Operation = typeof operations[number];
type Reader = (limit: number, privateInput?: boolean, timeoutMs?: number) => Promise<string>;
function fail(code: string, exit = 2): never { throw new Refusal(code, exit); }
function options(args: string[]): { operation: Operation; values: Map<string, string> } {
  if (args[0] !== 'receipt' || !operations.includes(args[1] as Operation)) fail('unsupported_receipt_command');
  const operation = args[1] as Operation, values = new Map<string,string>(); let json = false;
  const names = ['--state-dir','--collector','--ledger-epoch','--correlation-id','--wait-timeout','--receipt'];
  for (let i = 2; i < args.length; i++) {
    const token = args[i]!, equal = token.indexOf('='), key = equal < 0 ? token : token.slice(0,equal);
    if (key === '--json') { if (json || equal >= 0) fail('invalid_option'); json = true; continue; }
    if (!names.includes(key)) fail('unsupported_option');
    if (values.has(key)) fail('invalid_option');
    const value = equal < 0 ? args[++i] : token.slice(equal+1);
    if (value === undefined || (equal < 0 && value.startsWith('--'))) fail('invalid_option');
    values.set(key,value);
  }
  if (!json) fail('json_output_required');
  const allowed: Record<Operation, string[]> = {
    init: ['--state-dir','--collector'], serve: ['--state-dir','--collector'],
    respond: ['--collector','--receipt'], status: ['--collector','--ledger-epoch','--correlation-id'],
    wait: ['--collector','--ledger-epoch','--correlation-id','--wait-timeout'],
    revoke: ['--collector','--ledger-epoch','--correlation-id'], probe: []
  };
  if ([...values.keys()].some(key => !allowed[operation].includes(key))) fail('inapplicable_option');
  return { operation, values };
}
function absolute(value: string | undefined, code: string, maximum: number = 4096): string {
  if (!safeId(value,maximum) || !isAbsolute(value) || resolve(value) !== value) fail(code);
  return value;
}
function success(response: ReceiptResponse): Record<string, any> {
  if (!response.ok) throw new Refusal(response.error,1);
  return response.body;
}
function unknown(error: unknown, handoff?: ManagedHandoff, exit = 1): ReceiptCommandResult | undefined {
  if (!(error instanceof Refusal) || error.code !== 'receipt_transport_unknown') return undefined;
  return { value: { ok: false, status: 'unknown', error: 'receipt_transport_unknown', retryAllowed: false,
    ...(handoff ? { handoff } : {}) }, exitCode: exit };
}
function waitResult(handoff: ManagedHandoff): ReceiptCommandResult {
  const satisfied = handoff.wait.status === 'satisfied';
  return { value: { ok: satisfied, handoff }, exitCode: satisfied ? 0 : handoff.wait.status === 'stopped' && handoff.wait.reason === 'stopped_by_operator' ? 130 : 1 };
}
async function privateInput(readInput: Reader): Promise<string> {
  let raw: string;
  try { raw = await readInput(RECEIPT_LIMITS.privateFrame,true,RECEIPT_LIMITS.readMs); }
  catch { throw new Refusal('invalid_receipt_protocol',1); }
  if (typeof raw !== 'string') throw new Refusal('invalid_receipt_protocol',1);
  if (Buffer.byteLength(raw,'utf8') > RECEIPT_LIMITS.privateFrame) throw new Refusal('receipt_frame_too_large',1);
  return raw;
}
function platform(): void {
  if (process.platform === 'win32' || process.getuid?.() === undefined) throw new Refusal('receipt_storage_unsupported',1);
}
// Initialization may create only its explicitly selected leaf. Reject an alias
// before creating files that could not later pass the collector endpoint guard.
function statePath(value: string | undefined): string {
  const path = absolute(value,'invalid_receipt_state');
  try {
    let present = true;
    try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') present = false; else throw error; }
    const existing = present ? path : dirname(path);
    if (realpathSync(existing) !== existing) throw new Error();
  } catch { throw new Refusal('receipt_storage_untrusted',1); }
  return path;
}
async function wait(socket: string, epoch: string, id: string, seconds: number): Promise<ReceiptCommandResult> {
  const budget = new HandoffBudget(seconds); let interrupted = false, stopAttempted = false;
  let latest: ManagedHandoff | undefined, original: ManagedHandoff | undefined;
  let context: string | undefined, operationId: string | undefined;
  const selector = { ledgerEpoch: epoch, correlationId: id };
  const stop = () => { interrupted = true; };
  const accept = (value: unknown): ManagedHandoff => {
    const next = validateManagedHandoff(value);
    if (next.ledgerEpoch !== epoch || next.correlationId !== id || next.wait.for !== 'acknowledged' || !canonicalId(next.wait.operationId)) throw new Refusal('invalid_receipt_protocol',1);
    if (original && (next.schemaVersion !== original.schemaVersion || next.targetGeneration !== original.targetGeneration ||
        next.wait.operationId !== operationId || next.wait.deadlineAtUtcMs !== original.wait.deadlineAtUtcMs ||
        (original.schemaVersion === 2 && (next.schemaVersion !== 2 || next.receiptContext.id !== original.receiptContext.id)))) throw new Refusal('receipt_binding_conflict',1);
    if (!original) { original = structuredClone(next); operationId = next.wait.operationId; }
    return next;
  };
  const retained = (error: unknown): ReceiptCommandResult => ({ value: { ok: false, status: 'unknown',
    error: publicReceiptError(error), retryAllowed: false, ...(latest ? { handoff: latest } : {}) }, exitCode: latest?.wait.status === 'stopped' && latest.wait.reason === 'stopped_by_operator' ? 130 : 1 });
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
  try {
    const hello = await receiptExchange(socket,null,'hello',{},budget.remainingMs());
    const remainingMs = Math.floor(budget.remainingMs()), capabilities = success(hello); context = hello.collectorContextId;
    if (!('clockReferenceMs' in capabilities) || remainingMs < 1) throw new Refusal('deadline_before_effect',1);
    const opened = success(await receiptExchange(socket,context,'wait-open',
      { ...selector, goal: 'acknowledged', timeoutSeconds: seconds, clockReferenceMs: capabilities.clockReferenceMs, remainingMs },budget.remainingMs()));
    latest = accept(opened.handoff);
    while (latest.wait.status === 'pending') {
      if (budget.remainingMs() <= 0) return retained(new Refusal('receipt_transport_unknown',1));
      if (interrupted && !stopAttempted) {
        stopAttempted = true;
        latest = accept(success(await receiptExchange(socket,context,'wait-stop',
          { ...selector, operationId: operationId! },budget.remainingMs())).handoff);
        return waitResult(latest);
      }
      await delay(Math.min(100,Math.max(1,budget.remainingMs())));
      if (interrupted) continue;
      latest = accept(success(await receiptExchange(socket,context,'wait-status',
        { ...selector, operationId: operationId! },budget.remainingMs())).handoff);
    }
    return waitResult(latest);
  } catch (error) {
    // A terminal actor result may win the race against the explicit stop. Read
    // that same operation once; do not retry stop, renew a wait or adopt an owner.
    if (latest && stopAttempted && error instanceof Refusal && error.code === 'receipt_wait_terminal' &&
        context && operationId && budget.remainingMs() > 0) {
      try {
        const terminal = accept(success(await receiptExchange(socket,context,'wait-status',
          { ...selector, operationId },budget.remainingMs())).handoff);
        if (terminal.wait.status !== 'pending') { latest = terminal; return waitResult(terminal); }
      } catch (readError) { return retained(readError); }
    }
    if (latest) return retained(error);
    const result = unknown(error,undefined,1); if (result) return result;
    if (interrupted) return { value: { ok: false, error: publicReceiptError(error), retryAllowed: false }, exitCode: 1 };
    throw error;
  } finally { process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); }
}
export async function receiptCommand(args: string[], readInput: Reader): Promise<ReceiptCommandResult> {
  const { operation, values } = options(args);
  if (operation === 'probe') {
    const request = parseProducerProbeRequest(await privateInput(readInput));
    return { value: { ...request, implementation: 'typescript', runtimeVersion: VERSION }, exitCode: 0, raw: true };
  }
  platform();
  if (operation === 'init' || operation === 'serve') {
    const state = statePath(values.get('--state-dir'));
    const socket = absolute(values.get('--collector') ?? join(state,'s'),'receipt_endpoint_untrusted',100);
    if (dirname(socket) !== state) throw new Refusal('receipt_endpoint_untrusted',1);
    if (operation === 'init') return { value: { ...ReceiptState.initialize(state,socket), collector: socket }, exitCode: 0 };
    const collector = await startReceiptCollector(state,socket);
    return { value: { status: 'ready', collector: socket, collectorContextId: collector.contextId,
      ledgerEpoch: collector.ledgerEpoch }, exitCode: 0, collector };
  }
  const socket = absolute(values.get('--collector'),'receipt_endpoint_untrusted',100);
  if (operation === 'respond') {
    if (values.get('--receipt') !== '-') fail('private_receipt_stdin_required');
    const raw = await privateInput(readInput), receipt = validateManagedReceipt(raw);
    try {
      const hello = await receiptExchange(socket,null,'hello',{}), capabilities = success(hello);
      const scope = receipt.schemaVersion === 1 ? 'original_generation' : 'delegated_context';
      if (!capabilities.receiptSchemas.some((pair: any) => pair.receiptSchemaVersion === receipt.schemaVersion && pair.receiptScope === scope)) throw new Refusal('receipt_scope_unsupported',1);
      const result = success(await receiptExchange(socket,hello.collectorContextId,'receipt',{ receipt: raw }));
      return { value: result, exitCode: 0 };
    } catch (error) { const result = unknown(error); if (result) return result; throw error; }
  }
  const epoch = values.get('--ledger-epoch'), id = values.get('--correlation-id');
  if (!canonicalId(epoch)) fail('invalid_ledger_epoch');
  if (!canonicalId(id)) fail('invalid_correlation_id');
  if (operation === 'wait') return wait(socket,epoch,id,parseWaitTimeout(values.get('--wait-timeout') ?? '30'));
  try {
    const hello = await receiptExchange(socket,null,'hello',{}); success(hello);
    const result = success(await receiptExchange(socket,hello.collectorContextId,operation,{ ledgerEpoch: epoch, correlationId: id }));
    return { value: result, exitCode: 0 };
  } catch (error) { const result = unknown(error); if (result) return result; throw error; }
}
