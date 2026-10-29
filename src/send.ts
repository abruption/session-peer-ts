import { createHash } from 'node:crypto';
import { casefold } from './casefold.js';
import { createConnection } from 'node:net';
import { closeSync, constants, fstatSync, lstatSync, openSync, type BigIntStats } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claude, Refusal } from './discovery.js';
import { classifyCodexStorage, codexConsumerCwd, codexConsumerSnapshotSync, codexWriterCwd, codexWriterStorage, storageDiagnostic, type StorageCheck } from './codex-storage.js';
import { executable, run, UnknownOutcome } from './process.js';
import { HomeRefusal, resolveWriter, revalidateWriter, uuid, type HomeResolution } from './writer.js';
import { postWindowsPipe } from './windows.js';

export type SendContext = { agent: 'claude' | 'codex'; target: string; home?: string; generation: string | null; writerIdentity?: string };
export type CodexStorageGuard = { readonly binary: string; readonly cwd: string;
  revalidate: (ownedAppServer?: boolean) => Promise<void>; finalCheck: (ownedAppServer?: boolean) => void };
export type SendHooks = {
  // Opted-in callers resolve additional handoff context and fencing. Codex
  // sends share the storage guard without creating an implicit handoff ledger.
  resolved: (context: SendContext, snapshot: Record<string, unknown>) => Promise<string | void> | string | void;
  beforeEffect?: () => Promise<void> | void;
  timeoutMs?: () => number;
  submitCodex?: (context: SendContext, message: string, storage: CodexStorageGuard) => Promise<{ queueId?: string; clientUserMessageId: string }>;
};
export type SendOptions = { to: string; home?: string; codexBin?: string; message: string; dryRun?: boolean; allowInactive?: boolean; hooks?: SendHooks };
export class CodexUnknownOutcome extends UnknownOutcome {
  constructor(readonly codexHomeResolution: HomeResolution) { super(); }
}
export function queueId(stdout: string, id: string): string | undefined {
  if (!uuid(id)) return undefined;
  const matches = [...stdout.matchAll(new RegExp(`^Queued message ([A-Za-z0-9][A-Za-z0-9._:-]{0,127}) for thread ${id}\\.\\r?$`, 'gm'))];
  return matches.length === 1 ? matches[0]![1] : undefined;
}
export function checkMessage(text: string, codex = false): void {
  if (!text.trim() || text.includes('\0') || [...text].length > 1_000_000 ||
      (codex && Buffer.byteLength(text, 'utf8') > 32768)) throw new Refusal('invalid_message', 2);
}
export async function postSocket(path: string, text: string, timeout?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempted = false, finished = false;
    const startedAt = performance.now();
    const socket = createConnection(path);
    const timer = setTimeout(() => finish(new Error('timeout')), timeout ?? 10000);
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); socket.destroy();
      if (error) reject(attempted ? new UnknownOutcome() : new Refusal('inbox_unreachable', 1));
      else resolve();
    };
    socket.on('error', error => finish(error));
    socket.once('connect', () => {
      attempted = true;
      socket.end(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n', () => {
        // Write completion is submission only, never consumption. Match Python's drain window.
        clearTimeout(timer);
        const drain = setTimeout(() => finish(), timeout === undefined ? 2000 : Math.min(2000, Math.max(0, timeout - (performance.now() - startedAt))));
        socket.once('close', () => { clearTimeout(drain); finish(); });
        socket.once('data', () => { clearTimeout(drain); finish(); });
      });
    });
  });
}
// A private continuity fingerprint, not proof of a native incarnation. Do not
// read or persist registry contents (which can include authentication material).
function claudeBindingIdentity(row: Record<string, unknown>): string {
  const stable = (s: BigIntStats) => [s.dev,s.ino,s.uid,s.size,s.mtimeNs,s.ctimeNs,s.birthtimeNs].map(String);
  const same = (a: BigIntStats,b: BigIntStats) => JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const directory=process.env.CLAUDE_CONFIG_DIR || process.env.ANTHROPIC_CONFIG_DIR || join(homedir(),'.claude');
  const path=join(directory,'sessions',String(row.pid)+'.json');
  try {
    const before=lstatSync(path,{bigint:true});
    if(!before.isFile() || before.size>1024n*1024n)throw new Error();
    const fd=openSync(path,constants.O_RDONLY | (process.platform==='win32'?0:constants.O_NOFOLLOW | constants.O_NONBLOCK));
    let metadata:string[];
    try {
      const opened=fstatSync(fd,{bigint:true});
      if(!opened.isFile() || !same(before,opened) || !same(opened,lstatSync(path,{bigint:true})))throw new Error();
      metadata=stable(opened);
    } finally {closeSync(fd);}
    let socket:string[]|null=null;
    if(process.platform!=='win32'){
      const file=lstatSync(String(row.socket),{bigint:true});
      if(!file.isSocket())throw new Error();
      socket=stable(file);
    }
    return createHash('sha256').update(JSON.stringify({pid:row.pid,name:row.name,socketPath:row.socket,metadata,socket})).digest('hex');
  } catch {throw new Refusal('target_changed',1);}
}
export async function send(options: SendOptions): Promise<Record<string, unknown>> {
  checkMessage(options.message, options.to.startsWith('codex:'));
  const base = { ok: true, submitted: !options.dryRun, consumptionConfirmed: false,
    dryRun: Boolean(options.dryRun), chars: [...options.message].length };
  if (options.to.startsWith('codex:')) {
    const id = options.to.slice(6).toLowerCase();
    if (!uuid(id)) throw new Refusal('codex_uuid_required');
    const binary = executable(options.codexBin ?? 'codex');
    const executableEvidence = () => {
      try { const info = lstatSync(binary, { bigint: true }); if (!info.isFile()) throw new Error();
        return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':'); }
      catch { throw new Refusal('codex_storage_loader_unverifiable', 1); }
    };
    const binaryEvidence = executableEvidence();
    const selection = await resolveWriter(options.home, id, options.allowInactive);
    const { home } = selection;
    if (!['darwin', 'linux'].includes(process.platform)) {
      const platformStorage = classifyCodexStorage({ home });
      throw new HomeRefusal(platformStorage.code, selection.resolution);
    }
    const refuseStorage = (check: StorageCheck) => {
      if (check.status !== 'classified') throw new HomeRefusal(check.code, selection.resolution);
      return check;
    };
    let consumerCwd: string;
    try { consumerCwd = await codexConsumerCwd(home, id); }
    catch { throw new HomeRefusal('codex_consumer_context_unverifiable', selection.resolution); }
    let writerPid: number | undefined, writerCwd: string | undefined, selectedDatabase: string;
    try {
      const proof = JSON.parse(selection.evidence) as { fingerprints: { home: string; writer: string; database: string }[] };
      const selected = proof.fingerprints.find(item => item.home === home)!;
      selectedDatabase = selected.database;
      if (codexConsumerSnapshotSync(home, id).database !== selectedDatabase) throw new Error();
      writerPid = JSON.parse(selected.writer).pid;
      if (writerPid !== undefined) { writerCwd = codexWriterCwd(writerPid); codexWriterStorage(writerPid, home); }
    } catch { throw new HomeRefusal('codex_consumer_context_unverifiable', selection.resolution); }
    const consumerCwds = [consumerCwd, ...(writerCwd ? [writerCwd] : [])];
    const queueCwd = process.cwd();
    // Hooks may choose an owned app-server; that path binds its opened SQLite
    // descriptors independently. Its fallback must revalidate the ordinary plan.
    const ownedAppServer = Boolean(options.hooks?.submitCodex);
    const storage = refuseStorage(classifyCodexStorage({ home, queueCwd, consumerCwds, ownedAppServer }));
    const result = { ...base, target: { agent: 'codex', id }, codexHome: home,
      status: options.dryRun ? 'validated' : 'queued', codexHomeResolution: selection.resolution,
      storage: storageDiagnostic(storage) };
    let context: SendContext | undefined;
    if (options.hooks) {
      // Bind the identity already captured by selection, not a second sample
      // which could belong to a different incarnation between A -> B -> A.
      const proof = JSON.parse(selection.evidence) as { fingerprints: { home: string; database: string; writer: string }[] };
      const selected = proof.fingerprints.find(item => item.home === home);
      const identity = selected?.writer;
      const live = selection.resolution.candidates.find(item => item.codexHome === home)?.activity === 'live_writer';
      if (!identity) throw new HomeRefusal('active_writer_unverified', selection.resolution);
      const generation = live ? createHash('sha256').update(identity).digest('hex') : null;
      context = { agent: 'codex', target: id, home, generation,
        // Inactive evidence still binds a prepared intent across invocations. This
        // private fingerprint is not a native incarnation or public generation.
        writerIdentity: generation ?? createHash('sha256').update(JSON.stringify(selected)).digest('hex') };
      const body = await options.hooks.resolved(context, result);
      if (body !== undefined) { checkMessage(body, true); options = { ...options, message: body }; result.chars = [...body].length; }
    }
    if (options.dryRun) return result;
    // Diagnostic probe only on an effectful send. Doctor and dry-run never
    // execute an agent binary. Exact tags qualify loader semantics, not delivery.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['CODEX_SQLITE_HOME', 'CODEX_HOME'].includes(key.toUpperCase())));
    const env = { ...inherited, CODEX_HOME: home, PWD: storage.queueCwd! };
    const version = await run(binary, ['--version'], { env, cwd: storage.queueCwd, timeout: Math.min(3000, options.hooks?.timeoutMs?.() ?? 3000), limit: 4096 });
    const nativeVersion = !version.interrupted && version.code === 0 && /^codex-cli \d+\.\d+\.\d+\s*$/.test(version.stdout) ? version.stdout.trim().slice(10) : '';
    const qualified = refuseStorage(classifyCodexStorage({ home, queueCwd, consumerCwds, ownedAppServer, version: nativeVersion }));
    if (qualified.fingerprint !== storage.fingerprint) throw new HomeRefusal('codex_storage_changed_before_queue', selection.resolution);
    result.storage = storageDiagnostic(qualified);
    const guard: CodexStorageGuard = Object.freeze({ binary, cwd: qualified.queueCwd!, async revalidate(owned = ownedAppServer) {
      await revalidateWriter(selection, options.home, id, options.allowInactive);
      try { await codexConsumerCwd(home, id); }
      catch { throw new HomeRefusal('codex_consumer_context_unverifiable', selection.resolution); }
      guard.finalCheck(owned);
    }, finalCheck(owned = ownedAppServer) {
      const checkConsumer = () => {
        try {
          const current = codexConsumerSnapshotSync(home, id);
          if (current.database !== selectedDatabase || current.cwd !== consumerCwd) throw new Error();
        } catch { throw new HomeRefusal('codex_storage_changed_before_queue', selection.resolution); }
      };
      checkConsumer();
      if (writerPid !== undefined) {
        try { if (codexWriterCwd(writerPid) !== writerCwd) throw new Error(); codexWriterStorage(writerPid, home); }
        catch { throw new HomeRefusal('codex_consumer_context_unverifiable', selection.resolution); }
      }
      const current = refuseStorage(classifyCodexStorage({ home, queueCwd, consumerCwds, ownedAppServer, version: nativeVersion }));
      if (current.fingerprint !== qualified.fingerprint) throw new HomeRefusal('codex_storage_changed_before_queue', selection.resolution);
      if (owned !== ownedAppServer) refuseStorage(classifyCodexStorage({ home, queueCwd, consumerCwds, ownedAppServer: owned, version: nativeVersion }));
      checkConsumer();
      if (executableEvidence() !== binaryEvidence) throw new HomeRefusal('codex_storage_loader_changed', selection.resolution);
    } });
    await guard.revalidate();
    // `--message=` keeps a body starting with `-` from being parsed as an option.
    // An inherited CODEX_SQLITE_HOME would queue outside the validated home.
    // Windows environment names are case-insensitive.
    if (options.hooks?.submitCodex) {
      const receipt = await options.hooks.submitCodex(context!, options.message, guard);
      return { ...result, ...(receipt.queueId === undefined ? {} : {queueId:receipt.queueId}) };
    }
    await options.hooks?.beforeEffect?.();
    await guard.revalidate();
    // Read the remaining operation budget after the final synchronous I/O.
    const timeout = options.hooks?.timeoutMs?.() ?? 30000;
    const done = await run(binary, ['queue', '--thread', id, `--message=${options.message}`, '-c', `sqlite_home=${JSON.stringify(home)}`],
      { env, cwd: guard.cwd, timeout });
    if (!done.spawned) throw new HomeRefusal('native_spawn_failed', selection.resolution);
    if (done.interrupted || done.code !== 0) throw new CodexUnknownOutcome(selection.resolution);
    const queuedId = queueId(done.stdout, id);
    return { ...result, ...(queuedId === undefined ? {} : { queueId: queuedId }) };
  }
  if (options.to.includes(':') && !options.to.startsWith('claude:')) throw new Refusal('unsupported_agent');
  if (options.home || options.codexBin || options.allowInactive) throw new Refusal('inapplicable_option');
  const target = options.to.replace(/^claude:/, '');
  if (!target) throw new Refusal('no_reachable_target');
  const select = () => {
    const rows = claude(false).sessions as Record<string, unknown>[];
    const matches = rows.filter(r => /^\d+$/.test(target) ? r.pid === Number(target) :
      typeof r.name === 'string' && casefold(r.name) === casefold(target));
    if (matches.length !== 1) throw new Refusal(matches.length ? 'ambiguous_target' : 'no_reachable_target', 2);
    return matches[0]!;
  };
  const row = select();
  const identity = options.hooks ? claudeBindingIdentity(row) : undefined;
  const result = { ...base, target: { agent: 'claude', pid: row.pid, name: row.name }, status: options.dryRun ? 'validated' : 'posted' };
  if (options.hooks) {
    // Existing POSIX Claude discovery proves PID/socket reachability, not a
    // restart-safe native incarnation. Do not manufacture a generation.
    const body = await options.hooks.resolved({ agent: 'claude', target: String(row.pid), generation: null, writerIdentity: identity }, result);
    if (body !== undefined) { checkMessage(body); options = { ...options, message: body }; result.chars = [...body].length; }
  }
  if (options.dryRun) return result;
  const rechecked = select();
  if (row.pid !== rechecked.pid || row.socket !== rechecked.socket ||
      (identity !== undefined && claudeBindingIdentity(rechecked) !== identity)) throw new Refusal('target_changed', 1);
  await options.hooks?.beforeEffect?.();
  if (process.platform === 'win32') await postWindowsPipe(String(row.socket), Number(row.pid), options.message);
  else await postSocket(String(row.socket), options.message, options.hooks?.timeoutMs?.());
  return result;
}
