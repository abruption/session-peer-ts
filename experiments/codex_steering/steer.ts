/** Local, opt-in research adapter. Never imported by the installed CLI. */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import WebSocket, { type RawData } from 'ws';

export type ObjectValue = Record<string, unknown>;
export interface Caller { readonly info: ObjectValue; call(method: string, params: ObjectValue): Promise<ObjectValue> }
export class Refused extends Error {}
export class Unknown extends Error {}
export class RpcRejected extends Refused {
  readonly code: number;
  constructor(method: string, code: number) { super(`rpc_rejected:${method}`); this.code = code; }
}
export const MAX_FRAME = 1_048_576;
const METHODS = new Set(['initialize', 'thread/loaded/list', 'thread/read', 'experimentalFeature/list', 'turn/steer']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): string | null => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
function canonicalHome(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Refused('server_home_mismatch');
  try { const result = fs.realpathSync(value); if (!fs.statSync(result).isDirectory()) throw new Error(); return result; }
  catch { throw new Refused('server_home_mismatch'); }
}
function socketIdentity(socketPath: string): fs.Stats {
  if (process.platform === 'win32') throw new Refused('unsupported_platform');
  if (!path.isAbsolute(socketPath)) throw new Refused('absolute_socket_required');
  const uid = process.getuid?.();
  if (uid === undefined) throw new Refused('owned_socket_required');
  try {
    // Inspect components without following a link. The immediate directory and
    // endpoint are private; system ancestor directories need not be private.
    let component = path.parse(socketPath).root;
    for (const part of socketPath.slice(component.length).split(path.sep).filter(Boolean)) {
      component = path.join(component, part);
      if (fs.lstatSync(component).isSymbolicLink()) throw new Refused('symlink_socket_path');
    }
    const parent = fs.lstatSync(path.dirname(socketPath));
    const endpoint = fs.lstatSync(socketPath);
    if (!parent.isDirectory() || parent.uid !== uid || (parent.mode & 0o077) !== 0) throw new Refused('private_directory_required');
    if (!endpoint.isSocket() || endpoint.uid !== uid) throw new Refused('owned_socket_required');
    if ((endpoint.mode & 0o077) !== 0) throw new Refused('private_socket_required');
    return endpoint;
  } catch (error) { if (error instanceof Refused) throw error; throw new Refused('socket_unavailable'); }
}
interface Pending { id: number; method: string; resolve(value: ObjectValue): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
export class Rpc implements Caller {
  private ws: WebSocket;
  private deadline: number;
  private pending: Pending | undefined;
  private sequence = 0;
  private notifications = 0;
  private traffic = 0;
  private closed = false;
  private initialized = false;
  private initializeInfo: ObjectValue = {};
  get info(): ObjectValue { return this.initializeInfo; }
  private constructor(ws: WebSocket, deadline: number) {
    this.ws = ws; this.deadline = deadline;
    ws.on('message', (data: RawData, binary: boolean) => this.message(data, binary));
    ws.on('error', () => this.fail(new Refused('transport_closed')));
    ws.on('close', () => this.fail(new Refused('transport_closed')));
  }
  static async connect(socketPath: string, timeoutMs = 10_000): Promise<Rpc> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Refused('invalid_timeout');
    const deadline = performance.now() + timeoutMs;
    const before = socketIdentity(socketPath);
    const ws = new WebSocket('ws://localhost/', {
      createConnection: () => net.createConnection({ path: socketPath }),
      maxPayload: MAX_FRAME, perMessageDeflate: false,
      handshakeTimeout: Math.max(1, Math.ceil(deadline - performance.now())),
    });
    const rpc = new Rpc(ws, deadline);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Refused('operation_timeout')), Math.max(1, Math.ceil(deadline - performance.now())));
        const opened = () => finish();
        const failed = () => finish(new Refused('connection_failed'));
        const finish = (error?: Error) => { clearTimeout(timer); ws.off('open', opened); ws.off('error', failed); ws.off('close', failed); error ? reject(error) : resolve(); };
        ws.once('open', opened); ws.once('error', failed); ws.once('close', failed);
      });
      const after = socketIdentity(socketPath);
      if (before.dev !== after.dev || before.ino !== after.ino) throw new Refused('socket_changed');
      rpc.initializeInfo = await rpc.call('initialize', {
        clientInfo: { name: 'session_peer_steer_experiment', version: '0.0.0' },
        capabilities: { experimentalApi: true },
      });
      if (typeof rpc.info.userAgent !== 'string' || !/^(?:codex-tui|codex_cli_rs|codex-cli|session_peer_steer_experiment)\/0\.159\.2(?:\s|$)/.test(rpc.info.userAgent)) throw new Refused('unsupported_server_version');
      canonicalHome(rpc.info.codexHome);
      rpc.initialized = true;
      rpc.write({ method: 'initialized' });
      return rpc;
    } catch (error) { rpc.close(); throw error; }
  }
  close(): void {
    this.fail(new Refused('transport_closed'));
    this.ws.terminate();
  }
  private fail(error: Error): void {
    this.closed = true;
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
  }
  private write(value: ObjectValue): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) throw new Refused('transport_closed');
    if (performance.now() >= this.deadline) throw new Refused('operation_timeout');
    const frame = Buffer.from(JSON.stringify(value), 'utf8');
    if (frame.length > MAX_FRAME) throw new Refused('frame_too_large');
    this.traffic += frame.length;
    if (this.traffic > 4 * MAX_FRAME) throw new Refused('traffic_limit');
    this.ws.send(frame, { binary: false }, error => { if (error) this.fail(new Refused('transport_closed')); });
  }
  private message(data: RawData, binary: boolean): void {
    if (this.closed) return;
    try {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
      this.traffic += bytes.length;
      if (binary || bytes.length > MAX_FRAME || this.traffic > 4 * MAX_FRAME) throw new Refused('invalid_frame');
      let value: unknown;
      try { value = JSON.parse(decoder.decode(bytes)); } catch { throw new Refused('invalid_rpc_response'); }
      if (!object(value)) throw new Refused('invalid_rpc_response');
      if ('method' in value) {
        if ('id' in value) throw new Refused('server_interaction_required');
        if (typeof value.method !== 'string' || 'result' in value || 'error' in value) throw new Refused('invalid_rpc_response');
        if (++this.notifications > 100) throw new Refused('event_limit');
        return; // Never answer server requests or retain body-bearing events.
      }
      if (!this.pending || value.id !== this.pending.id) throw new Refused('invalid_rpc_response');
      if (('result' in value) === ('error' in value)) throw new Refused('invalid_rpc_response');
      const pending = this.pending;
      if ('error' in value) {
        if (!object(value.error) || !Number.isSafeInteger(value.error.code)) throw new Refused('invalid_rpc_response');
        this.pending = undefined; clearTimeout(pending.timer);
        pending.reject(new RpcRejected(pending.method, value.error.code as number));
      } else {
        if (!object(value.result)) throw new Refused('invalid_rpc_response');
        this.pending = undefined; clearTimeout(pending.timer); pending.resolve(value.result);
      }
    } catch (error) { this.fail(error instanceof Refused ? error : new Refused('invalid_rpc_response')); this.ws.terminate(); }
  }
  async call(method: string, params: ObjectValue): Promise<ObjectValue> {
    if (!METHODS.has(method) || (method === 'initialize' && (this.initialized || this.sequence > 0))) throw new Refused('method_not_allowed');
    if (this.pending) throw new Refused('concurrent_rpc');
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) throw new Refused('transport_closed');
    if (++this.sequence > 80) throw new Refused('rpc_limit');
    const remaining = this.deadline - performance.now();
    if (remaining <= 0) throw new Refused('operation_timeout');
    return await new Promise<ObjectValue>((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Refused('operation_timeout')); this.ws.terminate(); }, Math.ceil(remaining));
      this.pending = { id: this.sequence, method, resolve, reject, timer };
      try { this.write({ id: this.sequence, method, params }); }
      catch (error) { this.fail(error instanceof Error ? error : new Refused('transport_closed')); }
    });
  }
}
async function pages(rpc: Caller, method: string, params: ObjectValue): Promise<unknown[]> {
  const all: unknown[] = []; const seen = new Set<string>(); let cursor: string | undefined;
  for (let count = 0; count < 32; count++) {
    const result = await rpc.call(method, { ...params, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    if (!Array.isArray(result.data) || result.data.length > 100) throw new Refused('invalid_inventory');
    all.push(...result.data);
    if (result.nextCursor === null || result.nextCursor === undefined) return all;
    if (typeof result.nextCursor !== 'string' || !result.nextCursor || Buffer.byteLength(result.nextCursor) > 1024 || seen.has(result.nextCursor)) throw new Refused('invalid_cursor');
    cursor = result.nextCursor; seen.add(cursor);
  }
  throw new Refused('inventory_limit');
}
const busy = new WeakSet<Caller>();
const attempted = new WeakSet<Caller>();
export async function steer(rpc: Caller, target: string, expectedTurn: string, text: string,
  options: { expectedHome: string; optIn?: boolean; requireInstant?: boolean; dryRun?: boolean }): Promise<ObjectValue> {
  if (!options.optIn) throw new Refused('steering_opt_in_required');
  if (busy.has(rpc)) throw new Refused('concurrent_steering');
  if (attempted.has(rpc)) throw new Refused('submission_already_attempted');
  busy.add(rpc);
  try {
    const id = uuid(target.startsWith('codex:') ? target.slice(6) : target);
    if (!id) throw new Refused('full_thread_uuid_required');
    if (typeof expectedTurn !== 'string' || !expectedTurn.trim() || Buffer.byteLength(expectedTurn) > 128 || /[\x00-\x1f\x7f]/.test(expectedTurn)) throw new Refused('expected_turn_required');
    if (typeof text !== 'string' || !text || text.includes('\0') || Buffer.byteLength(text) > 65_536 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new Refused('invalid_message');
    if (canonicalHome(rpc.info.codexHome) !== canonicalHome(options.expectedHome)) throw new Refused('server_home_mismatch');
    const loaded = await pages(rpc, 'thread/loaded/list', {});
    if (!loaded.every(item => uuid(item) !== null)) throw new Refused('invalid_inventory');
    if (loaded.filter(item => uuid(item) === id).length !== 1) throw new Refused('target_not_loaded');
    const reply = await rpc.call('thread/read', { threadId: id, includeTurns: false });
    const thread = reply.thread;
    if (!object(thread) || uuid(thread.id) !== id) throw new Refused('thread_mismatch');
    const status = thread.status;
    if (!object(status) || status.type !== 'active') throw new Refused('target_not_active');
    if (!Array.isArray(status.activeFlags) || status.activeFlags.length !== 0) throw new Refused('active_interaction_pending');
    if (thread.canAcceptDirectInput !== true) throw new Refused('direct_input_unverified');
    const features = await pages(rpc, 'experimentalFeature/list', { threadId: id });
    if (!features.every(item => object(item) && typeof item.name === 'string')) throw new Refused('invalid_inventory');
    const matching = features.filter(item => object(item) && item.name === 'instant_interrupt') as ObjectValue[];
    const flag = matching.length === 1 && typeof matching[0]!.enabled === 'boolean' ? matching[0]!.enabled : null;
    if (options.requireInstant && flag !== true) throw new Refused('instant_interrupt_not_enabled_or_verified');
    const result: ObjectValue = { schemaVersion: 1, ok: true, experimental: true, mode: 'steer', submitted: false,
      consumptionConfirmed: false, retryAllowed: false, dryRun: !!options.dryRun,
      instantInterruptEnabledSnapshot: flag, status: options.dryRun ? 'validated' : 'accepted' };
    if (options.dryRun) return { ...result, expectedTurnValidated: false };
    attempted.add(rpc); // Fence before the first potentially effectful call, even if it fails.
    let accepted: ObjectValue;
    try {
      accepted = await rpc.call('turn/steer', { threadId: id, expectedTurnId: expectedTurn,
        input: [{ type: 'text', text }], clientUserMessageId: randomUUID() });
    } catch (error) {
      if (error instanceof RpcRejected && (error.code === -32600 || error.code === -32601)) throw error;
      throw new Unknown('submission_outcome_unknown');
    }
    if (!object(accepted) || accepted.turnId !== expectedTurn) throw new Unknown('returned_turn_mismatch');
    return { ...result, submitted: true, turnId: expectedTurn };
  } finally { busy.delete(rpc); }
}

async function stdinMessage(): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65_536) throw new Refused('invalid_message');
    chunks.push(bytes);
  }
  try { return decoder.decode(Buffer.concat(chunks)); } catch { throw new Refused('invalid_message'); }
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let rpc: Rpc | undefined;
  try {
    const flags = new Set(['--experimental-steering', '--require-instant', '--dry-run']);
    const values = new Set(['--socket', '--expected-home', '--to', '--expected-turn-id', '--message', '--timeout']);
    const parsed = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
      const key = argv[i]!;
      if (parsed.has(key)) throw new Refused('invalid_arguments');
      if (flags.has(key)) parsed.set(key, true);
      else if (values.has(key) && i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) parsed.set(key, argv[++i]!);
      else throw new Refused('invalid_arguments');
    }
    if (!parsed.has('--experimental-steering')) throw new Refused('steering_opt_in_required');
    const get = (key: string): string => { const value = parsed.get(key); if (typeof value !== 'string' || !value) throw new Refused('invalid_arguments'); return value; };
    const timeout = parsed.has('--timeout') ? get('--timeout') : '10';
    if (!/^(?:[1-9]|[12][0-9]|30)$/.test(timeout)) throw new Refused('invalid_timeout');
    const socket = get('--socket'), home = get('--expected-home'), target = get('--to'), turn = get('--expected-turn-id'), message = get('--message');
    const text = message === '-' ? await stdinMessage() : message;
    rpc = await Rpc.connect(socket, Number(timeout) * 1000);
    const result = await steer(rpc, target, turn, text, { expectedHome: home, optIn: true, requireInstant: parsed.has('--require-instant'), dryRun: parsed.has('--dry-run') });
    console.log(JSON.stringify(result)); return 0;
  } catch (error) {
    const unknown = error instanceof Unknown;
    const reason = error instanceof Refused || unknown ? error.message : 'connection_failed';
    console.log(JSON.stringify({ schemaVersion: 1, ok: false, experimental: true, mode: 'steer', status: unknown ? 'unknown' : 'refused', submitted: unknown ? null : false, consumptionConfirmed: false, retryAllowed: false, reason }));
    return 1;
  } finally { rpc?.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
