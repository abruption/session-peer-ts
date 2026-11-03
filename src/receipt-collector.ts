// Explicit local receipt-only IPC. No native agent, shell, network or transcript calls.
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, realpathSync, type BigIntStats } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { Refusal } from './discovery.js';
import { inspectMacosAcls } from './macos-acl.js';
import { ReceiptState } from './receipt-state.js';
import { RECEIPT_LIMITS, RECEIPT_PAIRS, parseReceiptRequest, parseReceiptResponse,
  publicReceiptError, validateReceiptRequest, validateReceiptResponse,
  type ReceiptOperation, type ReceiptRequest, type ReceiptRequestBody, type ReceiptResponse } from './receipt-protocol.js';

const fail = (code: string): never => { throw new Refusal(code, 1); };
function privateParent(path: string): void {
  if (process.platform === 'win32' || process.getuid?.() === undefined) fail('receipt_storage_unsupported');
  if (!isAbsolute(path) || resolve(path) !== path || Buffer.byteLength(path) > 100 || path.includes('\0')) fail('receipt_endpoint_untrusted');
  const parent = dirname(path), stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o700 ||
      realpathSync(parent) !== parent) fail('receipt_endpoint_untrusted');
}
function identity(stat: BigIntStats): string {
  return [stat.dev,stat.ino,stat.uid,stat.mode,stat.ctimeNs,stat.birthtimeNs].join(':');
}
export function receiptEndpoint(path: string): string {
  try {
    privateParent(path);
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isSocket() || stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o777n) !== 0o600n) fail('receipt_endpoint_untrusted');
    if (process.platform === 'darwin' && (inspectMacosAcls([dirname(path), path]) !== 'clear' ||
        identity(lstatSync(path, { bigint: true })) !== identity(stat))) fail('receipt_endpoint_untrusted');
    return identity(stat);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    if (['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return fail('receipt_collector_unavailable');
    return fail('receipt_endpoint_untrusted');
  }
}
const frame = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
export type Collector = { contextId: string; ledgerEpoch: string; socketPath: string;
  close: () => Promise<{ cleanup: 'confirmed' | 'unconfirmed' }> };
// Retain an unreferenced listener if its pathname was replaced. Node's normal
// server.close() unlinks that pathname, including a replacement regular file.
// Closing an untrusted pathname is therefore refused; process exit closes the
// orphaned FD. This is an explicitly unconfirmed cleanup, never deletion authority.
const orphanedListeners = new Set<Server>();
export async function startReceiptCollector(stateDir: string, socketPath: string): Promise<Collector> {
  privateParent(socketPath);
  if (dirname(socketPath) !== resolve(stateDir)) fail('receipt_endpoint_untrusted');
  const state = new ReceiptState(stateDir); state.open();
  try {
    if (state.endpointSelector !== socketPath) fail('receipt_endpoint_untrusted');
    try { lstatSync(socketPath); fail('receipt_endpoint_exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  } catch (error) { state.close(); throw error; }
  let stopped = false, busy = false, original = '';
  const connections = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, socket => {
    if (stopped || connections.size >= RECEIPT_LIMITS.connections) { socket.destroy(); return; }
    connections.add(socket);
    const started = performance.now(); let bytes = Buffer.alloc(0), handled = false;
    const timeout = setTimeout(() => socket.destroy(), RECEIPT_LIMITS.readMs);
    socket.on('error', () => {});
    socket.once('close', () => { clearTimeout(timeout); connections.delete(socket); });
    socket.on('data', chunk => {
      if (handled) { socket.destroy(); return; }
      if (performance.now() - started >= RECEIPT_LIMITS.exchangeMs || bytes.length + chunk.length > RECEIPT_LIMITS.frame) { socket.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
    });
    // EOF is part of the one-frame request: do not mutate state merely because
    // an early chunk ends in LF and then accept delayed trailing pollution.
    socket.once('end', () => {
      if (handled || socket.destroyed) return;
      handled = true; clearTimeout(timeout);
      if (performance.now() - started >= RECEIPT_LIMITS.readMs) { socket.destroy(); return; }
      let request: ReceiptRequest;
      try { request = parseReceiptRequest(bytes); } catch { socket.destroy(); return; }
      let response: ReceiptResponse;
      try {
        if (stopped || receiptEndpoint(socketPath) !== original) fail('receipt_endpoint_changed');
        if (request.collectorContextId !== null && request.collectorContextId !== state.collectorContextId) fail('receipt_context_mismatch');
        if (busy) fail('receipt_collector_busy');
        busy = true;
        const body = dispatch(state, request);
        response = validateReceiptResponse({ ipcVersion: 2, requestId: request.requestId,
          collectorContextId: state.collectorContextId, ok: true, body }, request);
      } catch (error) {
        response = { ipcVersion: 2, requestId: request.requestId, collectorContextId: state.collectorContextId,
          ok: false, error: publicReceiptError(error) };
      } finally { busy = false; }
      const remaining = Math.floor(RECEIPT_LIMITS.exchangeMs - (performance.now() - started));
      if (remaining <= 0) { socket.destroy(); return; }
      const encoded = frame(response);
      if (encoded.length > RECEIPT_LIMITS.frame) { socket.destroy(); return; }
      const output = setTimeout(() => socket.destroy(), Math.min(RECEIPT_LIMITS.writeMs, remaining));
      socket.once('close', () => clearTimeout(output));
      socket.end(encoded);
    });
  });
  try {
    await new Promise<void>((ok, reject) => {
      server.once('error', reject); server.listen(socketPath, () => { server.removeListener('error', reject); ok(); });
    });
    chmodSync(socketPath, 0o600); original = receiptEndpoint(socketPath);
  } catch (error) {
    state.close();
    if (server.listening) { server.unref(); orphanedListeners.add(server); }
    throw error instanceof Refusal ? error : new Refusal('receipt_endpoint_untrusted', 1);
  }
  server.on('error', () => {});
  let closing: Promise<{ cleanup: 'confirmed' | 'unconfirmed' }> | undefined;
  return { contextId: state.collectorContextId, ledgerEpoch: state.ledgerEpoch, socketPath,
    close() {
      if (closing) return closing;
      closing = (async () => {
        stopped = true; for (const socket of connections) socket.destroy();
        let safe = false;
        try { safe = receiptEndpoint(socketPath) === original; } catch { /* Never unlink an untrusted replacement. */ }
        let cleanup: 'confirmed' | 'unconfirmed' = 'unconfirmed';
        if (safe) {
          await new Promise<void>(ok => server.close(() => ok()));
          try { lstatSync(socketPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') cleanup = 'confirmed'; }
        } else { server.unref(); orphanedListeners.add(server); }
        try { state.close(); } catch { cleanup = 'unconfirmed'; }
        return { cleanup };
      })();
      return closing;
    }
  };
}
function dispatch(state: ReceiptState, request: ReceiptRequest): unknown {
  state.assertOpen();
  switch (request.op) {
    case 'hello': return { clockReferenceMs: state.clockReference(), receiptSchemas: RECEIPT_PAIRS, managedStoreVersion: 2,
      endpointOwner: { uid: process.getuid!(), pid: process.pid } };
    case 'prepare': return state.prepare(request.body);
    case 'mint': return { capability: state.mint(request.body).capability };
    case 'fence': return { handoff: state.fence(request.body) };
    case 'submission': return { handoff: state.submission(request.body) };
    case 'status': return { handoff: state.status(request.body) };
    case 'wait-open': return { handoff: state.waitOpen(request.body) };
    case 'wait-status': return { handoff: state.waitStatus(request.body) };
    case 'wait-stop': return { handoff: state.waitStop(request.body) };
    case 'revoke': return { handoff: state.revoke(request.body) };
    case 'receipt': {
      const received = state.receipt(request.body.receipt);
      return { ...received, ledgerEpoch: received.handoff.ledgerEpoch, correlationId: received.handoff.correlationId };
    }
  }
}
export async function receiptExchange<K extends ReceiptOperation>(socketPath: string, context: string | null,
  op: K, body: ReceiptRequestBody[K], timeoutMs: number = RECEIPT_LIMITS.exchangeMs): Promise<ReceiptResponse> {
  const started = performance.now();
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) fail('deadline_before_effect');
  const duration = Math.min(Math.floor(timeoutMs), RECEIPT_LIMITS.exchangeMs);
  const request = validateReceiptRequest({ ipcVersion: 2, requestId: randomUUID(), collectorContextId: context, op, body });
  const before = receiptEndpoint(socketPath), encoded = frame(request);
  if (performance.now() - started >= duration) fail('deadline_before_effect');
  return new Promise((ok, reject) => {
    let attempted = false, finished = false, input = Buffer.alloc(0);
    const connection = createConnection(socketPath);
    const finish = (error?: unknown, response?: ReceiptResponse) => {
      if (finished) return;
      finished = true; clearTimeout(timer); connection.destroy();
      if (error) reject(error); else ok(response!);
    };
    const timer = setTimeout(() => finish(new Refusal(attempted ? 'receipt_transport_unknown' : 'receipt_transport_timeout', 1)),
      Math.max(1, Math.min(RECEIPT_LIMITS.readMs, duration - (performance.now() - started))));
    connection.once('connect', () => {
      try {
        if (receiptEndpoint(socketPath) !== before) fail('receipt_endpoint_changed');
        if (performance.now() - started >= duration) fail('deadline_before_effect');
        attempted = true; connection.end(encoded);
      } catch (error) { finish(error instanceof Refusal ? error : new Refusal('receipt_endpoint_untrusted', 1)); }
    });
    connection.on('data', chunk => {
      if (input.length + chunk.length > RECEIPT_LIMITS.frame) { finish(new Refusal('receipt_transport_unknown', 1)); return; }
      input = Buffer.concat([input, chunk]);
    });
    connection.once('end', () => {
      try { finish(undefined, parseReceiptResponse(input, request)); }
      catch { finish(new Refusal('receipt_transport_unknown', 1)); }
    });
    connection.once('error', () => finish(new Refusal(attempted ? 'receipt_transport_unknown' : 'receipt_collector_unavailable', 1)));
    connection.once('close', () => { if (!finished) finish(new Refusal(attempted ? 'receipt_transport_unknown' : 'receipt_collector_unavailable', 1)); });
  });
}
