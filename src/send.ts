import { casefold } from './casefold.js';
import { createConnection } from 'node:net';
import { claude, Refusal } from './discovery.js';
import { executable, run, UnknownOutcome } from './process.js';
import { HomeRefusal, resolveWriter, revalidateWriter, uuid, type HomeResolution } from './writer.js';
import { postWindowsPipe } from './windows.js';

export type SendOptions = { to: string; home?: string; codexBin?: string; message: string; dryRun?: boolean; allowInactive?: boolean };
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
export async function postSocket(path: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempted = false, finished = false;
    const socket = createConnection(path);
    const timer = setTimeout(() => finish(new Error('timeout')), 10000);
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
        const drain = setTimeout(() => finish(), 2000);
        socket.once('close', () => { clearTimeout(drain); finish(); });
        socket.once('data', () => { clearTimeout(drain); finish(); });
      });
    });
  });
}
export async function send(options: SendOptions): Promise<Record<string, unknown>> {
  checkMessage(options.message, options.to.startsWith('codex:'));
  const base = { ok: true, submitted: !options.dryRun, consumptionConfirmed: false,
    dryRun: Boolean(options.dryRun), chars: [...options.message].length };
  if (options.to.startsWith('codex:')) {
    const id = options.to.slice(6).toLowerCase();
    if (!uuid(id)) throw new Refusal('codex_uuid_required');
    const binary = executable(options.codexBin ?? 'codex');
    const selection = await resolveWriter(options.home, id, options.allowInactive);
    const { home } = selection;
    const result = { ...base, target: { agent: 'codex', id }, codexHome: home,
      status: options.dryRun ? 'validated' : 'queued', codexHomeResolution: selection.resolution };
    if (options.dryRun) return result;
    await revalidateWriter(selection, options.home, id, options.allowInactive);
    const done = await run(binary, ['queue', '--thread', id, '--message', options.message],
      { env: { ...process.env, CODEX_HOME: home }, timeout: 30000 });
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
  const result = { ...base, target: { agent: 'claude', pid: row.pid, name: row.name }, status: options.dryRun ? 'validated' : 'posted' };
  if (options.dryRun) return result;
  const rechecked = select();
  if (row.pid !== rechecked.pid || row.socket !== rechecked.socket) throw new Refusal('target_changed', 1);
  if (process.platform === 'win32') await postWindowsPipe(String(row.socket), Number(row.pid), options.message);
  else await postSocket(String(row.socket), options.message);
  return result;
}
