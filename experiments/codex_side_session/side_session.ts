/** Dedicated single-producer experiment only: turn/start may steer after an idle check. */
import { lstatSync, realpathSync } from 'node:fs';
import { connect as connectUnix } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

type ObjectValue = Record<string, unknown>;
export interface Caller { call(method: string, params: ObjectValue): Promise<ObjectValue> }
export class Refused extends Error {}
export class Unknown extends Error {}
export class RpcRejected extends Refused {
  code: unknown;
  constructor(method: string, code: unknown) { super('rpc_rejected:' + method); this.code = code; }
}
export const MAX_FRAME = 1024 * 1024;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);

export function ownedSocket(path: string): string {
  if (process.platform === 'win32' || !process.getuid) throw new Refused('unix_only');
  if (!isAbsolute(path) || path.includes(':') || path.includes('\0')) throw new Refused('absolute_socket_required');
  const uid = process.getuid();
  for (const dir of [dirname(path), dirname(realpathSync(path))]) {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) throw new Refused('private_socket_directory_required');
  }
  const link = lstatSync(path), actual = realpathSync(path), socket = lstatSync(actual);
  if (link.uid !== uid || socket.uid !== uid || !socket.isSocket()) throw new Refused('socket_not_owned');
  return actual;
}

/** One outstanding request, bounded frames/notifications, no reconnect or server-request answers. */
export class Rpc implements Caller {
  ws: WebSocket;
  timeout: number;
  sequence = 0;
  notifications = 0;
  failed: Error | undefined;
  pending: { id: number; resolve: (value: ObjectValue) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  private constructor(ws: WebSocket, timeout: number) {
    this.ws = ws; this.timeout = timeout;
    ws.on('message', (data, binary) => {
      try {
        const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        if (binary || bytes.byteLength > MAX_FRAME) throw new Refused('invalid_frame');
        const message: unknown = JSON.parse(bytes.toString());
        if (!object(message)) throw new Refused('invalid_rpc_response');
        if ('id' in message) {
          if (message.id !== this.pending?.id || 'method' in message) throw new Refused('server_interaction_required');
          const p = this.pending!; clearTimeout(p.timer); this.pending = undefined;
          if ('error' in message) {
            if (!object(message.error)) { p.reject(new Refused('invalid_rpc_response')); return; }
            p.reject(new RpcRejected('response', message.error.code));
          } else if (object(message.result)) p.resolve(message.result);
          else p.reject(new Refused('invalid_rpc_response'));
        } else {
          if (typeof message.method !== 'string' || ++this.notifications > 100) throw new Refused('notification_limit');
          // Discard notifications immediately: no transcript retention or generic ACK detection.
        }
      } catch { this.fail(new Refused('connection_or_protocol_failed')); }
    });
    ws.on('error', () => this.fail(new Refused('transport_closed')));
    ws.on('close', () => this.fail(new Refused('transport_closed')));
  }
  private fail(error: Error) {
    this.failed ??= error;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.ws.terminate();
  }
  static async connect(path: string, timeout = 10000): Promise<Rpc> {
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30000) throw new Refused('invalid_timeout');
    const actual = ownedSocket(path);
    // Fixed HTTP authority plus an explicit Unix connector. Never use TCP or
    // URL-encode the socket pathname (which may contain spaces).
    const ws = new WebSocket('ws://localhost/', {
      createConnection: () => connectUnix({ path: actual }),
      handshakeTimeout: timeout, maxPayload: MAX_FRAME, perMessageDeflate: false, followRedirects: false,
    });
    const rpc = new Rpc(ws, timeout);
    try {
      await new Promise<void>((done, reject) => { ws.once('open', done); ws.once('error', () => reject(new Refused('connection_or_protocol_failed'))); });
      const info = await rpc.call('initialize', { clientInfo: { name: 'session_peer_ts_side_experiment', title: 'TS side experiment', version: '0.0.0' }, capabilities: { experimentalApi: true } });
      if (typeof info.userAgent !== 'string' || !/^(codex-tui|session_peer_ts_side_experiment)\/0\.159\.2 /.test(info.userAgent)) throw new Refused('unsupported_server_version');
      ws.send(JSON.stringify({ method: 'initialized' }));
      return rpc;
    } catch (error) { rpc.close(); throw error; }
  }
  async call(method: string, params: ObjectValue): Promise<ObjectValue> {
    if (this.failed) throw this.failed;
    if (this.pending) throw new Refused('concurrent_call_unsupported');
    const id = ++this.sequence, frame = JSON.stringify({ id, method, params });
    if (Buffer.byteLength(frame) > MAX_FRAME) throw new Refused('frame_too_large');
    this.notifications = 0;
    try {
      return await new Promise<ObjectValue>((done, reject) => {
        this.pending = { id, resolve: done, reject, timer: setTimeout(() => this.fail(new Refused('rpc_timeout')), this.timeout) };
        this.ws.send(frame, error => { if (error) this.fail(new Refused('transport_closed')); });
      });
    } catch (error) {
      if (error instanceof RpcRejected) throw new RpcRejected(method, error.code);
      throw error;
    }
  }
  close() { this.fail(new Refused('transport_closed')); }
}

export async function loadedIds(rpc: Caller): Promise<string[]> {
  const ids: string[] = [], cursors = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < 32; page++) {
    const result = await rpc.call('thread/loaded/list', { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    if (!Array.isArray(result.data) || result.data.length > 100 || result.data.some(x => typeof x !== 'string')) throw new Refused('invalid_loaded_list');
    ids.push(...result.data);
    if (result.nextCursor === null) return ids;
    if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor)) throw new Refused('invalid_cursor');
    cursor = result.nextCursor; cursors.add(cursor);
  }
  throw new Refused('inventory_limit');
}

export async function targetInfo(rpc: Caller, target: string): Promise<string> {
  const id = target.replace(/^codex:/, '').toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Refused('full_thread_uuid_required');
  if (!(await loadedIds(rpc)).includes(id)) throw new Refused('target_not_loaded');
  const thread = (await rpc.call('thread/read', { threadId: id, includeTurns: false })).thread;
  if (!object(thread) || thread.id !== id) throw new Refused('target_mismatch');
  if (thread.ephemeral !== true) throw new Refused('ephemeral_target_required');
  if (!object(thread.status) || thread.status.type !== 'idle') throw new Refused('target_not_idle');
  if (thread.canAcceptDirectInput !== true) throw new Refused('direct_input_unverified');
  return id;
}

export async function send(rpc: Caller, target: string, text: string, options: { exclusive?: boolean; dryRun?: boolean } = {}): Promise<ObjectValue> {
  if (!options.exclusive) throw new Refused('exclusive_test_session_required');
  if (!text.trim() || text.includes('\0') || Buffer.byteLength(text) > 65536) throw new Refused('invalid_message');
  const threadId = await targetInfo(rpc, target);
  const result = { schemaVersion: 1, ok: true, experimental: true, transport: 'codex-live-app-server', submitted: false, consumptionConfirmed: false, dryRun: Boolean(options.dryRun) };
  if (options.dryRun) return { ...result, status: 'validated' };
  // NOT atomic idle-only input. Dedicated single producer is a prerequisite, not a lock.
  try {
    const started = await rpc.call('turn/start', { threadId, input: [{ type: 'text', text }], clientUserMessageId: randomUUID() });
    if (!object(started.turn) || typeof started.turn.id !== 'string' || !started.turn.id) throw new Unknown('submission_response_invalid');
    return { ...result, status: 'accepted', submitted: true, turnId: started.turn.id };
  } catch (error) {
    if (error instanceof RpcRejected && (error.code === -32600 || error.code === -32601)) throw error;
    throw new Unknown('submission_outcome_unknown');
  }
}

export async function main(args: string[]): Promise<number> {
  let rpc: Rpc | undefined;
  try {
    // Exact, fail-closed experiment parser; does not alter the installed CLI.
    const flags = new Set(['--experimental-side-session', '--exclusive-test-session', '--dry-run']);
    const values = new Set(['--socket', '--to', '--message', '--timeout']);
    const opts = new Map<string, string>(); let command: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (flags.has(arg)) { if (opts.has(arg)) throw new Refused('invalid_option'); opts.set(arg, 'true'); }
      else if (values.has(arg)) { const v = args[++i]; if (opts.has(arg) || !v || v.startsWith('--')) throw new Refused('invalid_option'); opts.set(arg, v); }
      else if ((arg === 'list' || arg === 'send') && !command) command = arg;
      else throw new Refused('invalid_option');
    }
    if (!opts.has('--experimental-side-session') || !opts.get('--socket') || !command) throw new Refused('experimental_opt_in_required');
    if (command === 'list' && ['--to', '--message', '--exclusive-test-session', '--dry-run'].some(k => opts.has(k))) throw new Refused('invalid_option');
    if (command === 'send' && (!opts.get('--to') || !opts.get('--message') || !opts.has('--exclusive-test-session'))) throw new Refused('exclusive_test_session_required');
    let text = opts.get('--message') ?? '';
    if (text === '-') {
      const parts: Buffer[] = []; let size = 0;
      for await (const part of process.stdin) {
        size += part.length;
        if (size > 65536) { process.stdin.destroy(); throw new Refused('invalid_message'); }
        parts.push(part);
      }
      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
    }
    rpc = await Rpc.connect(opts.get('--socket')!, Number(opts.get('--timeout') ?? 10) * 1000);
    let result: ObjectValue;
    if (command === 'send') result = await send(rpc, opts.get('--to')!, text, { exclusive: true, dryRun: opts.has('--dry-run') });
    else {
      const sessions: ObjectValue[] = [];
      for (const id of await loadedIds(rpc)) {
        const t = (await rpc.call('thread/read', { threadId: id, includeTurns: false })).thread;
        if (!object(t) || t.id !== id) throw new Refused('target_mismatch');
        if (t.ephemeral === true) sessions.push({ id, ephemeral: true, kind: 'ephemeral_unclassified', status: object(t.status) ? t.status.type : 'unknown', canAcceptDirectInput: t.canAcceptDirectInput === true });
      }
      result = { schemaVersion: 1, ok: true, experimental: true, sessions };
    }
    console.log(JSON.stringify(result)); return 0;
  } catch (error) {
    const unknown = error instanceof Unknown;
    console.log(JSON.stringify({ ok: false, status: unknown ? 'unknown' : 'refused', submitted: unknown ? null : false, consumptionConfirmed: false, reason: error instanceof Refused || unknown ? (error as Error).message : 'connection_or_protocol_failed', retryAllowed: false }));
    return 1;
  } finally { rpc?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
