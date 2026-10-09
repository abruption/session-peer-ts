// Ordinary SSH response protocol. Internal helpers, not a package-root API.
import { casefold } from './casefold.js';
import { uuid } from './writer.js';
import type { Done } from './process.js';

export const RESPONSE_BYTES = 1024 * 1024;
export const RESPONSE_DEPTH = 64;
export const RESPONSE_NODES = 65536;
function invalid(): never { throw new Error('remote_response_unverified'); }

// A finite-depth scanner validates the whole frame and decoded object keys
// before JSON.parse can overwrite duplicates. Each key/value consumes a node;
// both allocations and recursion are bounded independently of field semantics.
export function parseResponse(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength > RESPONSE_BYTES) return invalid();
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return invalid(); }
  let at = 0, nodes = 0;
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++; };
  const count = () => { if (++nodes > RESPONSE_NODES) invalid(); };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const char = text[at++]!;
      if (char === '\\') { at++; continue; }
      if (char === '"') {
        try { return JSON.parse(text.slice(start, at)) as string; } catch { return invalid(); }
      }
    }
    return invalid();
  };
  const value = (depth: number): void => {
    count(); space();
    const char = text[at];
    if (char === '{' || char === '[') {
      if (depth >= RESPONSE_DEPTH) invalid();
      const object = char === '{', close = object ? '}' : ']';
      const keys = new Set<string>(); at++; space();
      if (text[at] === close) { at++; return; }
      while (true) {
        if (object) {
          space(); if (text[at] !== '"') invalid(); count();
          const key = string(); if (keys.has(key)) invalid(); keys.add(key);
          space(); if (text[at++] !== ':') invalid();
        }
        value(depth + 1); space();
        if (text[at] === close) { at++; return; }
        if (text[at++] !== ',') invalid();
      }
    }
    if (char === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, at)) { at += literal.length; return; }
    }
    number.lastIndex = at;
    const matched = number.exec(text); if (!matched) invalid(); at = number.lastIndex;
  };
  space(); if (text[at] !== '{') return invalid();
  value(0); space(); if (at !== text.length) return invalid();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return invalid(); }
}

export type ResponseRequest = { command: string; to?: string; dryRun?: boolean; returnTo?: string; home?: string; allowInactive?: boolean };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// Bind supported native facts to the original command, dry-run and exact
// target. Home aliases are resolved on the destination; this does not resolve
// remote paths on the caller or authenticate a remote process/incarnation.
export function validateResponse(value: Record<string, unknown>, request: ResponseRequest): void {
  if (value.schemaVersion !== 1 || value.command !== request.command || typeof value.ok !== 'boolean' ||
      typeof value.host !== 'string' || !value.host || ('error' in value && (value.ok || typeof value.error !== 'string'))) invalid();
  if (request.command === 'list' && value.ok && !Array.isArray(value.sessions)) invalid();
  if (request.command === 'doctor' && value.ok && (value.diagnosticCompleted !== true || typeof value.ready !== 'boolean' ||
      value.implementation !== 'typescript' || !record(value.agents))) invalid();
  if (request.command === 'doctor' && value.ok && request.returnTo && (!record(value.returnRoute) ||
      !['verified', 'failed'].includes(value.returnRoute.status as string) || !['local', 'ssh'].includes(value.returnRoute.transport as string))) invalid();
  if (request.command !== 'send') return;
  if (!value.ok && typeof value.error !== 'string') invalid();
  const codex = request.to?.startsWith('codex:') === true;
  const expected = request.dryRun ? 'validated' : codex ? 'queued' : 'posted';
  if (value.consumptionConfirmed !== false ||
      (value.ok && (value.submitted !== !request.dryRun || value.status !== expected)) ||
      (!value.ok && !((value.submitted === false && value.status === 'refused') || (value.submitted === null && value.status === 'unknown'))) ||
      ('dryRun' in value && value.dryRun !== !!request.dryRun) || ('retryAllowed' in value && value.retryAllowed !== false)) invalid();
  if (!value.ok) { if (value.submitted === false && 'queueId' in value) invalid(); return; }
  const target = value.target;
  if (!record(target) || (target.agent !== undefined && target.agent !== (codex ? 'codex' : 'claude'))) invalid();
  if (codex) {
    if (typeof target.id !== 'string' || !uuid(target.id) || target.id.toLowerCase() !== request.to!.slice(6).toLowerCase()) invalid();
    if ('queueId' in value && (request.dryRun || typeof value.queueId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.queueId))) invalid();
    if ('codexHome' in value && (typeof value.codexHome !== 'string' || !/^(?:\/|[A-Za-z]:[\\/]|[\\/]{2})/.test(value.codexHome))) invalid();
    if (request.home !== undefined && typeof value.codexHome !== 'string') invalid();
    // A receiver can canonicalize a remote alias. It echoes the explicit home
    // it actually parsed, rather than asking the caller to resolve remote paths.
    if ('requestedCodexHome' in value && (request.home === undefined || value.requestedCodexHome !== request.home)) invalid();
    if (request.home !== undefined && value.codexHome !== request.home && value.requestedCodexHome !== request.home) invalid();
    if ('codexHomeResolution' in value && (!record(value.codexHomeResolution) || value.codexHomeResolution.schemaVersion !== 1 ||
        value.codexHomeResolution.status !== (request.home === undefined ? 'selected' : 'explicit') ||
        value.codexHomeResolution.selected !== value.codexHome ||
        (value.codexHomeResolution.reason === 'explicit_inactive_opt_in' && !request.allowInactive))) invalid();
  } else {
    if (!Number.isSafeInteger(target.pid) || (target.pid as number) <= 0 || !(typeof target.name === 'string' || target.name === null) || 'queueId' in value) invalid();
    const requested = request.to!.replace(/^claude:/, '');
    if (/^\d+$/.test(requested) ? target.pid !== Number(requested) :
      typeof target.name !== 'string' || casefold(target.name) !== casefold(requested)) invalid();
  }
}

// Transport failure is not a second submission. A fully validated response
// keeps native ok/status/submitted unchanged; local exit 1 reports transport
// failure. Overflow never establishes a complete frame, even with a prefix.
export function responseOutcome(done: Done, request: ResponseRequest): { value: Record<string, unknown>; exitCode: number } {
  if (!done.spawned || done.stopReason === 'output_limit' || !done.stdoutBytes) return invalid();
  const value = parseResponse(done.stdoutBytes); validateResponse(value, request);
  // Reserved client-owned diagnosis; retain unrelated additive native fields.
  delete value.sshTransport; delete value.requestedCodexHome;
  const ordinary = !done.interrupted && [0, 1, 2].includes(done.code ?? -1);
  if (ordinary) {
    if (value.ok !== (done.code === 0)) return invalid();
    return { value, exitCode: done.code! };
  }
  return { value: { ...value, ...(request.command === 'send' ? { retryAllowed: false } : {}),
    sshTransport: { status: done.stopReason === 'timeout' ? 'timed_out' : 'failed',
      reason: done.stopReason === 'timeout' ? 'ssh_timeout' : done.stopReason === 'process_error' ? 'ssh_process_error' : 'ssh_exit_nonzero',
      exitCode: done.code } }, exitCode: 1 };
}
