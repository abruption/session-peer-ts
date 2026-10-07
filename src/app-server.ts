// Bounded queue-only mechanics and metadata-only client foundation.
// No live owner/delivery observation route is qualified.
// Official Codex 0.160.1 schema generated with an isolated HOME/CODEX_HOME:
// https://learn.chatgpt.com/docs/app-server (schema is version-specific).
// queue/list returns QueuedSubmission.input; item/started returns full content;
// turn/completed returns Turn.items. These are not metadata-only observers.
// queue/add echoes only its OWN submitted input and can be validated as an
// effect receipt separately; it does not read other requests or thread history.
// A fresh app-server process is never evidence that it owns an existing writer.
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Readable, Writable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { run } from './process.js';

export const APP_SERVER_EVIDENCE = Object.freeze({
  version: '0.160.1', inspectedPlatform: 'darwin-arm64',
  officialSourceCommit: 'd27764b82f7118f674371e6d6e76271d9d606edb',
  scope: 'generated_schema_only',
  queueAddParamsSha256: '60f25b7d3e3357c215bef9d2fe7047200f545e030dca9e00527ac0620cd0c88f',
  queueAddResponseSha256: 'c11b9772788427b19c9f9decf0765e2b41cbdead1aa9c3d39f42fdd70b339314',
  itemStartedSha256: '7574788d2a352747f50d44be3ef649011cb8de8069da4c655faff14d0aee32c4',
  turnCompletedSha256: '016870158603b0f84bd9f8f65f927161c9fd5128e5ec632087616462dc44e085',
});
export const APP_SERVER_LIMITS = Object.freeze({
  frameBytes: 65536, receivedBytes: 1024 * 1024, sentBytes: 256 * 1024,
  frames: 512, notifications: 256, requests: 16, observations: 64, messageBytes: 32768,
  lifetimeMs: 60000, cleanupMs: 250,
});
export type AppServerScope = Readonly<{
  codexHome: string; threadId: string; generation: string; ownerIdentity: string;
}>;
export type AppServerContext = Readonly<{ version: string; platform: string; scope: AppServerScope }>;
export type AppServerCapability = {
  supported: false; schema: 'version_qualified' | 'version_unqualified'; route: 'route_unsupported';
  reason: 'metadata_only_owner_route_unvalidated' | 'version_unqualified'; attempted: false; queueSupported: boolean;
};
export function appServerCapability(context: AppServerContext): AppServerCapability {
  const qualified = context.version === APP_SERVER_EVIDENCE.version && context.platform === APP_SERVER_EVIDENCE.inspectedPlatform;
  return { supported: false, schema: qualified ? 'version_qualified' : 'version_unqualified', route: 'route_unsupported',
    reason: qualified ? 'metadata_only_owner_route_unvalidated' : 'version_unqualified', attempted: false, queueSupported: qualified };
}
// Hard production gate: do not spawn/connect a native endpoint even if a caller
// supplies an owner tuple. Queue-only mechanics use the separate nativeQueueOnce
// entry point; no metadata-only owner observation transport is claimed.
export async function connectAppServer(context: AppServerContext,
  _open: () => Promise<MetadataOnlyTransport>, _deadlineMs: number): Promise<AppServerCapability> {
  return appServerCapability(context);
}

export type AppServerFaultCode = 'invalid_scope' | 'invalid_input' | 'unsupported_transport' | 'deadline' |
  'owner_changed' | 'frame_invalid' | 'frame_limit' | 'traffic_limit' | 'notification_limit' | 'request_limit' |
  'connection_closed' | 'write_failed' | 'remote_refused' | 'already_attempted' | 'unsupported_version' | 'effect_guard_failed';
export class AppServerFault extends Error {
  readonly fallbackEligible: boolean;
  constructor(readonly code: AppServerFaultCode, readonly attempted: boolean) {
    super(code); this.fallbackEligible = !attempted && ['unsupported_transport', 'unsupported_version'].includes(code);
  }
}
// This contract is NOT an official Codex notification or queue response shape.
// It is used only by hermetic fixtures until an actual metadata-only owner
// endpoint is independently qualified. The producer must omit bodies BEFORE
// transmission; the consumer does not implement a body-returning API/filter.
export type MetadataOnlyTransport = {
  qualification: 'hermetic_fixture_only';
  input: Readable; output: Writable;
  close: () => Promise<void>;
};
type NativeQueueTransport = Omit<MetadataOnlyTransport, 'qualification'> & { qualification: 'native_queue_only_stdio' };
type ClientTransport = MetadataOnlyTransport | NativeQueueTransport;
export type NativeQueuePort = Pick<AppServerPort, 'queueOnce' | 'close'>;
export type NativeQueueOptions = {
  binary: string; scope: AppServerScope; message: string; clientUserMessageId: string; deadlineMs: number;
  verifyOwner: (scope: AppServerScope) => Promise<boolean>; beforeEffect: () => Promise<void>; env?: NodeJS.ProcessEnv;
};
export function nativeQueueCapability(context: AppServerContext): {
  queueSupported: boolean; observationSupported: false;
  qualification: 'mechanics_from_isolated_fixture' | 'unsupported'; reason: 'queue_only' | 'version_unqualified';
} {
  const qualified = appServerCapability(context).queueSupported;
  return { queueSupported: qualified, observationSupported: false,
    qualification: qualified ? 'mechanics_from_isolated_fixture' : 'unsupported', reason: qualified ? 'queue_only' : 'version_unqualified' };
}
// All 83 methods from the experimental 0.160.1 ServerNotification schema are
// suppressed before queue/add. A notification reaching us is a qualification
// failure, not an invitation to inspect/filter its body or perform another RPC.
export const NATIVE_QUEUE_NOTIFICATION_OPTOUTS = Object.freeze([
  'account/gatewayOAuth/changed', 'account/login/completed', 'account/rateLimits/updated', 'account/updated', 'app/list/updated',
  'autoApprovalReview/strictReviewRequired', 'command/exec/outputDelta', 'configWarning', 'deprecationNotice', 'error',
  'externalAgentConfig/import/completed', 'externalAgentConfig/import/progress', 'fs/changed', 'fuzzyFileSearch/sessionCompleted',
  'fuzzyFileSearch/sessionUpdated', 'guardianWarning', 'hook/completed', 'hook/started', 'item/agentMessage/delta',
  'item/autoApprovalReview/completed', 'item/autoApprovalReview/started', 'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction', 'item/completed', 'item/fileChange/outputDelta', 'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress', 'item/plan/delta', 'item/reasoning/summaryPartAdded', 'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta', 'item/started', 'mcpServer/event/stream/notification', 'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated', 'model/rerouted', 'model/safetyBuffering/updated', 'model/verification',
  'modelProvider/authRecoveryCompleted', 'modelProvider/authRecoveryStarted', 'process/exited', 'process/outputDelta',
  'project/changed', 'remoteControl/status/changed', 'serverRequest/resolved', 'skills/changed', 'thread/archived',
  'thread/attachment/updated', 'thread/closed', 'thread/compacted', 'thread/deleted', 'thread/environment/connected',
  'thread/environment/disconnected', 'thread/goal/cleared', 'thread/goal/updated', 'thread/name/updated', 'thread/project/updated',
  'thread/queue/changed', 'thread/realtime/closed', 'thread/realtime/error', 'thread/realtime/item/completed',
  'thread/realtime/item/started', 'thread/realtime/item/transcript/delta', 'thread/realtime/itemAdded',
  'thread/realtime/outputAudio/delta', 'thread/realtime/sdp', 'thread/realtime/started', 'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done', 'thread/reverted', 'thread/settings/updated', 'thread/started', 'thread/status/changed',
  'thread/tokenUsage/updated', 'thread/unarchived', 'turn/completed', 'turn/diff/updated', 'turn/moderationMetadata',
  'turn/plan/updated', 'turn/started', 'warning', 'windows/worldWritableWarning', 'windowsSandbox/setupCompleted',
]);
export type MetadataEvent =
  { kind: 'injected'; scope: AppServerScope; clientUserMessageId: string; itemId: string; turnId: string } |
  { kind: 'turn'; scope: AppServerScope; clientUserMessageId: string; turnId: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' };
export type MetadataObservation = {
  injectionObserved: boolean; clientUserMessageId?: string;
  turn?: { id: string; status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' };
};
export interface AppServerPort {
  queueOnce(input: { clientUserMessageId: string; message: string }): Promise<{ queueId: string; clientUserMessageId: string }>;
  observe(clientUserMessageId: string): Promise<MetadataObservation>;
  close(): Promise<void>;
}
type ObjectValue = Record<string, unknown>;
function disposeTransport(transport: ClientTransport): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, APP_SERVER_LIMITS.cleanupMs);
    Promise.resolve().then(() => transport.close()).catch(() => {}).finally(() => { clearTimeout(timer); resolve(); });
  });
}
function object(value: unknown, keys: string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('invalid');
  return value as ObjectValue;
}
function safeId(value: unknown, maximum = 128): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= maximum &&
    !/[\x00-\x1f\x7f-\x9f]/u.test(value) && [...value].every(char => {
      const cp = char.codePointAt(0)!; return cp < 0xd800 || cp > 0xdfff;
    });
}
function scopeValue(value: unknown): AppServerScope {
  const v = object(value, ['codexHome', 'threadId', 'generation', 'ownerIdentity']);
  if (!safeId(v.codexHome, 4096) || !isAbsolute(v.codexHome) || !safeId(v.threadId) ||
      !safeId(v.generation, 256) || !safeId(v.ownerIdentity, 512)) throw new Error('invalid');
  return Object.freeze({ codexHome: v.codexHome, threadId: v.threadId, generation: v.generation, ownerIdentity: v.ownerIdentity });
}
function matches(left: AppServerScope, right: AppServerScope): boolean {
  return left.codexHome === right.codexHome && left.threadId === right.threadId &&
    left.generation === right.generation && left.ownerIdentity === right.ownerIdentity;
}
export function parseMetadataEvent(value: unknown, original: AppServerScope): MetadataEvent {
  try {
    const kind = (value as ObjectValue | null)?.kind;
    const v = object(value, kind === 'injected' ? ['kind', 'scope', 'clientUserMessageId', 'itemId', 'turnId'] :
      ['kind', 'scope', 'clientUserMessageId', 'turnId', 'status']);
    const scope = scopeValue(v.scope);
    if (!matches(scope, original)) throw new AppServerFault('owner_changed', false);
    if (!safeId(v.clientUserMessageId) || !safeId(v.turnId)) throw new Error('invalid');
    if (kind === 'injected' && safeId(v.itemId)) return { kind, scope, clientUserMessageId: v.clientUserMessageId, itemId: v.itemId, turnId: v.turnId };
    if (kind === 'turn' && typeof v.status === 'string' && ['running', 'completed', 'failed', 'interrupted', 'unknown'].includes(v.status)) {
      return { kind, scope, clientUserMessageId: v.clientUserMessageId, turnId: v.turnId, status: v.status as 'running' };
    }
    throw new Error('invalid');
  } catch (error) {
    if (error instanceof AppServerFault) throw error;
    throw new AppServerFault('frame_invalid', false);
  }
}
// Token-aware scanner rejects duplicate keys, non-integer numbers, deep input
// and trailing frames before JSON.parse loses that information. Native message
// text is outbound only; this parser accepts metadata fixture frames only.
function parseFrame(bytes: Buffer): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let offset = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(text[offset] ?? '\0')) offset++; };
  function string(): string {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') offset++;
      else if (char === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    throw new Error('invalid');
  }
  function value(depth: number): void {
    if (depth > 8) throw new Error('invalid');
    whitespace(); const char = text[offset];
    if (char === '"') { string(); return; }
    if (char === '{') {
      offset++; whitespace(); const keys = new Set<string>();
      if (text[offset] === '}') { offset++; return; }
      while (true) {
        whitespace(); if (text[offset] !== '"') throw new Error('invalid');
        const key = string(); if (keys.has(key)) throw new Error('invalid'); keys.add(key);
        whitespace(); if (text[offset++] !== ':') throw new Error('invalid');
        value(depth + 1); whitespace(); const end = text[offset++];
        if (end === '}') return;
        if (end !== ',') throw new Error('invalid');
      }
    }
    if (char === '[') {
      offset++; whitespace(); if (text[offset] === ']') { offset++; return; }
      while (true) {
        value(depth + 1); whitespace(); const end = text[offset++];
        if (end === ']') return;
        if (end !== ',') throw new Error('invalid');
      }
    }
    for (const token of ['true', 'false', 'null']) if (text.startsWith(token, offset)) { offset += token.length; return; }
    const token = /^-?(?:0|[1-9][0-9]*)/.exec(text.slice(offset))?.[0];
    if (!token || !Number.isSafeInteger(Number(token))) throw new Error('invalid');
    offset += token.length;
  }
  value(0); whitespace(); if (offset !== text.length) throw new Error('invalid');
  return JSON.parse(text);
}

export class BoundedAppServerClient implements AppServerPort {
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: AppServerFault) => void }>();
  private readonly observers = new Set<{ resolve: (value: MetadataObservation) => void; reject: (error: AppServerFault) => void }>();
  private readonly operations = new Set<{ reject: (error: AppServerFault) => void }>();
  private buffer = Buffer.alloc(0); private received = 0; private sent = 0; private frames = 0; private notifications = 0; private requests = 0;
  private reserved = false; private attempted = false; private clientId?: string;
  private observations = 0;
  private observed: MetadataObservation = { injectionObserved: false };
  private injectedItemId?: string;
  private fault?: AppServerFault; private closing?: Promise<void>; private readonly timer: ReturnType<typeof setTimeout>;
  private constructor(readonly scope: AppServerScope, private readonly transport: ClientTransport,
    private readonly deadlineMs: number, private readonly verifyOwner: (scope: AppServerScope) => Promise<boolean>,
    private readonly nativeQueue = false, private readonly beforeEffect: () => Promise<void> = async () => {}) {
    this.timer = setTimeout(() => this.fail('deadline'), Math.max(1, deadlineMs - performance.now()));
    transport.input.on('data', this.receive);
    transport.input.once('end', this.ended); transport.input.once('error', this.errored);
    transport.output.on('error', this.writeErrored);
  }
  static async connectMetadataFixture(scope: AppServerScope, transport: MetadataOnlyTransport, deadlineMs: number,
    verifyOwner: (scope: AppServerScope) => Promise<boolean>): Promise<BoundedAppServerClient> {
    return this.connectWire(scope, transport, deadlineMs, verifyOwner, false);
  }
  // Hermetic test hook for the exact native RPC profile. It does not qualify a
  // binary, platform or writer. Production callers use nativeQueueOnce instead.
  static async connectNativeQueueFixture(scope: AppServerScope, transport: MetadataOnlyTransport, deadlineMs: number,
    verifyOwner: (scope: AppServerScope) => Promise<boolean>, beforeEffect: () => Promise<void>): Promise<NativeQueuePort> {
    return this.connectWire(scope, transport, deadlineMs, verifyOwner, true, beforeEffect);
  }
  static async connectNativeQueueWire(scope: AppServerScope, transport: NativeQueueTransport, deadlineMs: number,
    verifyOwner: (scope: AppServerScope) => Promise<boolean>, beforeEffect: () => Promise<void>): Promise<NativeQueuePort> {
    return this.connectWire(scope, transport, deadlineMs, verifyOwner, true, beforeEffect);
  }
  private static async connectWire(scope: AppServerScope, transport: ClientTransport, deadlineMs: number,
    verifyOwner: (scope: AppServerScope) => Promise<boolean>, nativeQueue: boolean,
    beforeEffect: () => Promise<void> = async () => {}): Promise<BoundedAppServerClient> {
    let original: AppServerScope;
    try { original = scopeValue(scope); } catch { await disposeTransport(transport); throw new AppServerFault('invalid_scope', false); }
    if (transport.qualification !== 'hermetic_fixture_only' && !(nativeQueue && transport.qualification === 'native_queue_only_stdio')) {
      await disposeTransport(transport); throw new AppServerFault('unsupported_transport', false);
    }
    const remaining = deadlineMs - performance.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > APP_SERVER_LIMITS.lifetimeMs) {
      await disposeTransport(transport); throw new AppServerFault('deadline', false);
    }
    const client = new BoundedAppServerClient(original, transport, deadlineMs, verifyOwner, nativeQueue, beforeEffect);
    try {
      await client.owner();
      if (nativeQueue) {
        const hello = object(await client.request('initialize', {
          clientInfo: { name: 'session-peer-native-queue', version: '1' },
          capabilities: { experimentalApi: true, optOutNotificationMethods: [...NATIVE_QUEUE_NOTIFICATION_OPTOUTS] },
        }), ['codexHome', 'platformFamily', 'platformOs', 'userAgent']);
        if (hello.codexHome !== original.codexHome || hello.platformFamily !== 'unix' || hello.platformOs !== 'macos' ||
            !safeId(hello.userAgent, 4096)) throw new AppServerFault('owner_changed', false);
        client.notification('initialized');
      } else {
        const hello = object(await client.request('session-peer/metadata/initialize', { scope: original }), ['scope', 'metadataOnly']);
        if (hello.metadataOnly !== true || !matches(scopeValue(hello.scope), original)) throw new AppServerFault('owner_changed', false);
      }
      return client;
    } catch (error) { client.fail(error instanceof AppServerFault ? error.code : 'frame_invalid'); await client.close(); throw client.fault; }
  }
  private check(): void {
    if (this.fault) throw this.fault;
    if (performance.now() >= this.deadlineMs) { this.fail('deadline'); throw this.fault; }
  }
  private async owner(): Promise<void> {
    this.check();
    // The external verifier is the authority; echoed protocol tuples cannot
    // qualify an endpoint or prove the live writer's ownership by themselves.
    const result = await this.bounded(this.verifyOwner(this.scope));
    this.check(); if (!result) { this.fail('owner_changed'); throw this.fault; }
  }
  private bounded<T>(promise: Promise<T>, failureCode: AppServerFaultCode = 'owner_changed'): Promise<T> {
    return new Promise((resolve, reject) => {
      const wait = { reject };
      this.operations.add(wait);
      promise.then(value => { this.operations.delete(wait); resolve(value); }, () => {
        this.operations.delete(wait); this.fail(failureCode); reject(this.fault);
      });
    });
  }
  private readonly ended = () => { this.fail(this.buffer.length ? 'frame_invalid' : 'connection_closed'); };
  private readonly errored = () => { this.fail('connection_closed'); };
  private readonly writeErrored = () => { this.fail('write_failed'); };
  private readonly receive = (chunk: Buffer | string): void => {
    if (this.fault) return;
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this.received += bytes.length;
    if (this.received > APP_SERVER_LIMITS.receivedBytes) { this.fail('traffic_limit'); return; }
    let start = 0;
    while (start < bytes.length && !this.fault) {
      const end = bytes.indexOf(10, start), stop = end < 0 ? bytes.length : end + 1;
      if (this.buffer.length + stop - start > APP_SERVER_LIMITS.frameBytes) { this.fail('frame_limit'); return; }
      this.buffer = Buffer.concat([this.buffer, bytes.subarray(start, stop)]); start = stop;
      if (end >= 0) {
        const frame = this.buffer; this.buffer = Buffer.alloc(0);
        try {
          if (++this.frames > APP_SERVER_LIMITS.frames) { this.fail('traffic_limit'); return; }
          this.frame(parseFrame(frame));
        } catch (error) { this.fail(error instanceof AppServerFault ? error.code : 'frame_invalid'); }
      }
    }
  };
  private frame(value: unknown): void {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'method')) {
      if (this.nativeQueue) throw new AppServerFault('unsupported_transport', this.attempted);
      const event = object(value, ['method', 'params']);
      if (event.method !== 'session-peer/metadata/event') throw new Error('invalid');
      if (++this.notifications > APP_SERVER_LIMITS.notifications) { this.fail('notification_limit'); return; }
      const metadata = parseMetadataEvent(event.params, this.scope);
      if (metadata.clientUserMessageId !== this.clientId) return;
      if (metadata.kind === 'injected') {
        if (this.observed.injectionObserved) {
          if (this.injectedItemId !== metadata.itemId || this.observed.turn?.id !== metadata.turnId) throw new Error('invalid');
          return;
        }
        this.injectedItemId = metadata.itemId;
        this.observed = { injectionObserved: true, clientUserMessageId: this.clientId, turn: { id: metadata.turnId, status: 'unknown' } };
      } else if (this.observed.injectionObserved && this.observed.turn?.id === metadata.turnId) {
        this.observed = { ...this.observed, turn: { id: metadata.turnId, status: metadata.status } };
      } else return; // Turn completion or a queue disappearance never proves injection.
      for (const observer of this.observers) observer.resolve(this.snapshot());
      this.observers.clear(); return;
    }
    const response = object(value, Object.hasOwn(value as object, 'error') ? ['id', 'error'] : ['id', 'result']);
    if (typeof response.id !== 'number' || !Number.isSafeInteger(response.id) || response.id < 1) throw new Error('invalid');
    const pending = this.pending.get(response.id); if (!pending) throw new Error('invalid');
    if (Object.hasOwn(response, 'error')) {
      if (!this.nativeQueue) {
        const error = object(response.error, ['code']);
        if (!['unsupported', 'refused', 'failed'].includes(String(error.code))) throw new Error('invalid');
      } // Native RPC error text/data may be sensitive and is never exposed.
      this.pending.delete(response.id); pending.reject(new AppServerFault('remote_refused', this.attempted));
    } else { this.pending.delete(response.id); pending.resolve(response.result); }
  }
  private notification(method: string): void {
    this.check(); const bytes = Buffer.from(JSON.stringify({ method }) + '\n'); this.sent += bytes.length;
    if (this.sent > APP_SERVER_LIMITS.sentBytes) { this.fail('frame_limit'); throw this.fault; }
    try { this.transport.output.write(bytes, error => { if (error) this.fail('write_failed'); }); }
    catch { this.fail('write_failed'); throw this.fault; }
  }
  private async request(method: string, params: ObjectValue, effect = false): Promise<unknown> {
    this.check();
    if (++this.requests > APP_SERVER_LIMITS.requests) { this.fail('request_limit'); return Promise.reject(this.fault); }
    const id = this.requests, bytes = Buffer.from(JSON.stringify({ id, method, params }) + '\n');
    this.sent += bytes.length;
    if (bytes.length > APP_SERVER_LIMITS.frameBytes || this.sent > APP_SERVER_LIMITS.sentBytes) { this.fail('frame_limit'); return Promise.reject(this.fault); }
    if (effect) {
      try { await this.bounded(this.beforeEffect(), 'effect_guard_failed'); } catch { this.fail('effect_guard_failed'); throw this.fault; }
      this.check();
    }
    return new Promise((resolve, reject) => {
      if (effect) this.attempted = true; // Before write, after local frame/budget validation.
      this.pending.set(id, { resolve, reject });
      try { this.transport.output.write(bytes, error => { if (error) this.fail('write_failed'); }); }
      catch { this.fail('write_failed'); }
    });
  }
  async queueOnce(input: { clientUserMessageId: string; message: string }): Promise<{ queueId: string; clientUserMessageId: string }> {
    this.check();
    if (!safeId(input.clientUserMessageId) || typeof input.message !== 'string' || !input.message ||
      Buffer.byteLength(input.message) > APP_SERVER_LIMITS.messageBytes || input.message.includes('\0') ||
      [...input.message].some(char => { const cp = char.codePointAt(0)!; return cp >= 0xd800 && cp <= 0xdfff; })) throw new AppServerFault('invalid_input', this.attempted);
    if (this.reserved) throw new AppServerFault('already_attempted', true);
    this.reserved = true;
    try {
      await this.owner(); this.check();
      this.clientId = input.clientUserMessageId;
      if (this.nativeQueue) {
        const result = object(await this.request('thread/queue/add', {
          threadId: this.scope.threadId, clientUserMessageId: input.clientUserMessageId,
          input: [{ type: 'text', text: input.message, text_elements: [] }],
        }, true), ['queuedSubmission']);
        const queued = object(result.queuedSubmission, ['id', 'input', 'clientUserMessageId']);
        if (!safeId(queued.id) || queued.clientUserMessageId !== input.clientUserMessageId || !Array.isArray(queued.input) || queued.input.length !== 1) throw new Error('invalid');
        const ownInput = object(queued.input[0], Object.hasOwn(queued.input[0], 'text_elements') ? ['type', 'text', 'text_elements'] : ['type', 'text']);
        if (ownInput.type !== 'text' || ownInput.text !== input.message || (Object.hasOwn(ownInput, 'text_elements') &&
            (!Array.isArray(ownInput.text_elements) || ownInput.text_elements.length))) throw new Error('invalid');
        return { queueId: queued.id, clientUserMessageId: input.clientUserMessageId };
      }
      const result = object(await this.request('session-peer/metadata/queue', {
        scope: this.scope, clientUserMessageId: input.clientUserMessageId, input: [{ type: 'text', text: input.message }],
      }, true), ['scope', 'queueId', 'clientUserMessageId']);
      if (!matches(scopeValue(result.scope), this.scope) || result.clientUserMessageId !== this.clientId || !safeId(result.queueId)) throw new Error('invalid');
      return { queueId: result.queueId, clientUserMessageId: this.clientId };
    } catch (error) { this.fail(error instanceof AppServerFault ? error.code : 'frame_invalid'); await this.close(); throw this.fault; }
  }
  private snapshot(): MetadataObservation { return { ...this.observed, ...(this.observed.turn ? { turn: { ...this.observed.turn } } : {}) }; }
  async observe(clientUserMessageId: string): Promise<MetadataObservation> {
    this.check();
    if (this.nativeQueue) throw new AppServerFault('unsupported_transport', this.attempted);
    if (!safeId(clientUserMessageId) || clientUserMessageId !== this.clientId || !this.attempted) throw new AppServerFault('invalid_input', this.attempted);
    if (++this.observations > APP_SERVER_LIMITS.observations) { this.fail('request_limit'); throw this.fault; }
    if (this.observed.injectionObserved) return this.snapshot();
    return new Promise((resolve, reject) => { this.observers.add({ resolve, reject }); });
  }
  private fail(code: AppServerFaultCode): void {
    if (this.fault) return;
    this.fault = new AppServerFault(code, this.attempted); clearTimeout(this.timer);
    for (const wait of this.pending.values()) wait.reject(this.fault); this.pending.clear();
    for (const observer of this.observers) observer.reject(this.fault); this.observers.clear();
    for (const operation of this.operations) operation.reject(this.fault); this.operations.clear();
    void this.close();
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    clearTimeout(this.timer);
    if (!this.fault) { this.fault = new AppServerFault('connection_closed', this.attempted);
      for (const wait of this.pending.values()) wait.reject(this.fault); this.pending.clear();
      for (const observer of this.observers) observer.reject(this.fault); this.observers.clear();
      for (const operation of this.operations) operation.reject(this.fault); this.operations.clear(); }
    this.transport.input.removeListener('data', this.receive);
    this.transport.input.removeListener('end', this.ended); this.transport.input.removeListener('error', this.errored);
    // Keep a safe error listener during disposal so pipe shutdown cannot become
    // an uncaught exception. Never retain native stderr or message text.
    this.transport.input.on('error', () => {});
    this.transport.output.removeListener('error', this.writeErrored); this.transport.output.on('error', () => {});
    this.closing = disposeTransport(this.transport);
    return this.closing;
  }
}

async function beforeDeadline<T>(deadlineMs: number, operation: () => Promise<T>, code: AppServerFaultCode): Promise<T> {
  const remaining = deadlineMs - performance.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > APP_SERVER_LIMITS.lifetimeMs) throw new AppServerFault('deadline', false);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppServerFault('deadline', false)), remaining);
    Promise.resolve().then(operation).then(value => { clearTimeout(timer); resolve(value); }, () => {
      clearTimeout(timer); reject(new AppServerFault(code, false));
    });
  });
}
// Queue mechanics were verified only for the exact installed version/platform
// in a network-denied synthetic home. This is not a live delivery/ACK claim.
// Root integration owns generation, canonical home, storage and writer guards.
// This function never invokes thread start/resume/read/list or a model turn.
export async function nativeQueueOnce(options: NativeQueueOptions): Promise<{ queueId: string; clientUserMessageId: string }> {
  const platform = `${process.platform}-${process.arch}`;
  if (platform !== APP_SERVER_EVIDENCE.inspectedPlatform) throw new AppServerFault('unsupported_transport', false);
  let original: AppServerScope;
  try { original = scopeValue(options.scope); } catch { throw new AppServerFault('invalid_scope', false); }
  if (!isAbsolute(options.binary) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(original.threadId)) throw new AppServerFault('invalid_input', false);
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), CODEX_HOME: original.codexHome };
  delete env.CODEX_SQLITE_HOME;
  if (!await beforeDeadline(options.deadlineMs, () => options.verifyOwner(original), 'owner_changed')) throw new AppServerFault('owner_changed', false);
  const version = await run(options.binary, ['--version'], {
    env, timeout: Math.max(1, options.deadlineMs - performance.now()), limit: 4096,
  });
  if (performance.now() >= options.deadlineMs) throw new AppServerFault('deadline', false);
  if (version.interrupted || version.code !== 0 || version.stdout.trim() !== `codex-cli ${APP_SERVER_EVIDENCE.version}`) {
    throw new AppServerFault('unsupported_version', false);
  }
  const transport: NativeQueueTransport = { qualification: 'native_queue_only_stdio',
    ...spawnOwnedStdio(options.binary, ['app-server', '--stdio', '-c', 'analytics.enabled=false'], env, original.codexHome) };
  let client: NativeQueuePort | undefined;
  try {
    client = await BoundedAppServerClient.connectNativeQueueWire(original, transport, options.deadlineMs, options.verifyOwner, options.beforeEffect);
    return await client.queueOnce({ clientUserMessageId: options.clientUserMessageId, message: options.message });
  } finally { if (client) await client.close(); else await disposeTransport(transport); }
}

const ownedGroups = new Set<number>();
const terminationSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
function reapOwned(pid: number): void { try { process.kill(-pid, 'SIGKILL'); } catch { /* Already gone. */ } }
function processExit(): void { for (const pid of ownedGroups) reapOwned(pid); }
function terminateOwned(signal: NodeJS.Signals): void {
  processExit(); ownedGroups.clear();
  for (const name of terminationSignals) process.removeListener(name, terminateOwned);
  process.removeListener('exit', processExit); process.kill(process.pid, signal);
}
function registerOwned(pid: number | undefined): void {
  if (!pid || ownedGroups.has(pid)) return;
  if (!ownedGroups.size) {
    for (const name of terminationSignals) process.on(name, terminateOwned);
    process.on('exit', processExit);
  }
  ownedGroups.add(pid);
}
function releaseOwned(pid: number | undefined): void {
  if (!pid || !ownedGroups.delete(pid) || ownedGroups.size) return;
  for (const name of terminationSignals) process.removeListener(name, terminateOwned);
  process.removeListener('exit', processExit);
}
// POSIX groups reap owned descendants. Only darwin-arm64 has native queue
// mechanics qualification; Windows resource cleanup remains unqualified.
function spawnOwnedStdio(binary: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Omit<MetadataOnlyTransport, 'qualification'> {
  if (process.platform === 'win32') throw new AppServerFault('unsupported_transport', false);
  const child = spawn(binary, args, { env, cwd, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  registerOwned(child.pid); child.once('spawn', () => registerOwned(child.pid));
  child.stdout.on('error', () => {}); child.stdin.on('error', () => {});
  let stderrBytes = 0, closed = false;
  const kill = () => { if (child.pid) reapOwned(child.pid); };
  // Also bound a fixture transport whose caller fails before attaching a client.
  const lifetime = setTimeout(() => { kill(); releaseOwned(child.pid); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }, APP_SERVER_LIMITS.lifetimeMs);
  lifetime.unref();
  child.stderr.on('data', (bytes: Buffer) => {
    stderrBytes += bytes.length;
    if (stderrBytes > APP_SERVER_LIMITS.receivedBytes) { kill(); child.stdout.destroy(new Error('traffic_limit')); }
  });
  child.on('error', () => { child.stdout.destroy(new Error('connection_closed')); });
  return { input: child.stdout, output: child.stdin,
    close: () => new Promise(resolve => {
      if (closed) { resolve(); return; } closed = true; clearTimeout(lifetime); kill(); releaseOwned(child.pid);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) { resolve(); return; }
      const timer = setTimeout(resolve, APP_SERVER_LIMITS.cleanupMs);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    }),
  };
}
// Test-only metadata protocol transport; never inferred from a Codex process.
export function spawnOwnedMetadataFixture(binary: string, args: string[], env: NodeJS.ProcessEnv): MetadataOnlyTransport {
  return { qualification: 'hermetic_fixture_only', ...spawnOwnedStdio(binary, args, env) };
}
