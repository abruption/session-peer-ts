import childProcess, { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import timers from 'node:timers/promises';
import { Refusal } from './discovery.js';

export class UnknownOutcome extends Error {}
// Node refuses to spawn .cmd/.bat without a shell (CVE-2024-27980), and a shell
// would interpret the message argv, so Windows batch shims are unsupported.
export const batchShim = (path: string) => process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(path);
export function executable(name: string): string {
  const windows = process.platform === 'win32';
  const names = windows && !/\.(?:exe|cmd|bat)$/i.test(name) ? [name + '.exe', name + '.cmd', name] : [name];
  const paths = isAbsolute(name) ? [name] : name.includes('/') || name.includes('\\') ? [] :
    (process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(p => names.map(n => join(p, n)));
  for (const path of paths) {
    let found = false;
    try { accessSync(path, constants.X_OK); found = statSync(path).isFile(); } catch {}
    if (!found) continue;
    // Keep PATH precedence: a first-match shim is refused, not bypassed.
    if (batchShim(path)) throw new Refusal('executable_unsupported', 1);
    try { return realpathSync(path); } catch {}
  }
  throw new Refusal('executable_unavailable', 1);
}
export type StopReason = 'timeout' | 'output_limit' | 'process_error';
export type Done = { code: number | null; stdout: string; stderr: string; spawned: boolean; interrupted: boolean;
  stdoutBytes?: Buffer; stopReason?: StopReason };
// On POSIX every child is started detached: a new session and process group
// with no controlling terminal. A timeout, an output overflow or a signal to
// this CLI reaps that group, which includes descendants such as a jump
// ProxyCommand, and nothing else; a descendant that calls setsid() itself has
// left the group and is out of scope (there is no PID scanning). Windows has no
// equivalent here: only the child is killed and descendants may linger; the
// tree backend below is a candidate that is deliberately not used (#131).
const groups = new Set<number>();
const posix = process.platform !== 'win32';
const reap = (pid: number | undefined) => { if (pid) try { process.kill(-pid, 'SIGKILL'); } catch { /* Already gone (ESRCH). */ } };
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
// A detached group no longer receives the terminal's Ctrl-C, so forward
// termination signals as a group kill, then re-raise with default handling.
function forward(signal: NodeJS.Signals) {
  for (const pid of groups) reap(pid);
  groups.clear();
  for (const name of signals) process.removeListener(name, forward);
  process.kill(process.pid, signal);
}
export function run(binary: string, args: string[], options: {
  env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeout?: number; limit?: number; rawStdout?: boolean;
} = {}): Promise<Done> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, stderrBytes = 0, spawned = false, interrupted = false, finished = false, stopped = false;
    let stopReason: StopReason | undefined;
    const chunks: Buffer[] = [], outputDecoder = new StringDecoder('utf8'), diagnosticDecoder = new StringDecoder('utf8');
    const child = spawn(binary, args, { shell: false, env: options.env ?? process.env, cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: posix });
    const release = () => {
      if (child.pid === undefined || !groups.delete(child.pid) || groups.size) return;
      for (const name of signals) process.removeListener(name, forward);
    };
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true; clearTimeout(timer); release();
      stdout += outputDecoder.end(); stderr += diagnosticDecoder.end();
      resolve({ code, stdout, stderr, spawned, interrupted,
        ...(options.rawStdout ? { stdoutBytes: Buffer.concat(chunks, bytes) } : {}), ...(stopReason ? { stopReason } : {}) });
    };
    const stop = (reason: StopReason) => {
      if (stopped || finished) return;
      stopped = interrupted = true; stopReason = reason;
      if (posix) reap(child.pid); else child.kill('SIGKILL');
      // A descendant outside our reach (Windows) may still hold the pipes:
      // stop reading so completion depends on the exit, not on their close.
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      // Already exited (only a descendant was left): complete after the grace.
      if (child.exitCode !== null || child.signalCode !== null) setTimeout(() => finish(child.exitCode), 100);
    };
    const timer = setTimeout(() => stop('timeout'), options.timeout ?? 3000);
    const register = () => {
      if (finished || stopped || !posix || child.pid === undefined || groups.has(child.pid)) return;
      if (!groups.size) for (const name of signals) process.on(name, forward);
      groups.add(child.pid);
    };
    // Register as soon as the PID exists, so a signal arriving before the
    // 'spawn' event still reaps the group; 'spawn' remains the fallback.
    register();
    child.once('spawn', () => { spawned = true; register(); });
    child.stdin.on('error', () => { /* Close/exit determines outcome, never resend. */ });
    child.stdout.on('data', (part: Buffer) => {
      if (bytes + part.length > (options.limit ?? 1024 * 1024)) { stop('output_limit'); return; }
      bytes += part.length;
      if (options.rawStdout) chunks.push(part); else stdout += outputDecoder.write(part);
    });
    // Drain but never report native stderr (it may contain message text/credentials).
    // Retain stderr only for allowlisted error classification. Never include it in CLI output.
    child.stderr.on('data', (part: Buffer) => {
      // Protocol mode has an independent 4096-byte diagnostic budget. Excess
      // diagnostics are drained without retaining them or invalidating stdout.
      if (stderrBytes < 4096) {
        const kept = part.subarray(0, 4096 - stderrBytes); stderrBytes += kept.length;
        stderr += diagnosticDecoder.write(kept);
      }
      if (!options.rawStdout) {
        if (bytes + part.length > (options.limit ?? 1024 * 1024)) stop('output_limit');
        else bytes += part.length;
      }
    });
    child.once('error', () => { interrupted = true; stopReason = 'process_error'; });
    // After a kill, the exit plus a short fixed grace bounds completion even if
    // a pipe never closes; otherwise 'close' (all output read) completes it.
    // A descendant that keeps the pipes open after the child exits runs into
    // the same deadline and is reaped with the group.
    child.once('exit', code => { if (stopped) setTimeout(() => finish(code), 100); });
    child.once('close', code => finish(code));
    child.stdin.end(options.input);
  });
}

// Candidate Windows process-tree cleanup backend (#131). NOT selected by run()
// or any production path: its classifier is not an ownership proof on
// Windows 10. Every candidate is opened by a helper that keeps the handle (a
// held PID cannot be reused) and is terminated only through that handle, but
// attribution compares GetProcessTimes creation/exit times, which are UTC
// wall-clock instants, not monotonic generations: after a clock rollback a
// process created under an earlier holder of a parent's PID can look like a
// child of the current holder. Win32_Process ParentProcessId has the same
// reuse caveat. A sound boundary needs a Job object the child is created in
// (suspended, assigned, resumed), which Node's spawn cannot do. Kept, with its
// tests, as the design record for that follow-up; it must not be enabled.

export type TreeCleanup = 'confirmed' | 'unconfirmed';
export type TreeReply = { rows: Map<number, number>;
  held: Map<number, { start: bigint; exit: bigint | null }>; errors: Map<number, 'gone' | 'denied'> };
export type TreeHelper = { pid?: number; request(hold: number[], kill: number[]): Promise<TreeReply>; close(): void };
// exited: Node has observed the root's exit (its handle, and so its PID, may
// then be released). kill: terminate through Node's own handle; idempotent.
export type TreeRoot = { pid: number; exited: () => boolean; kill: () => void };

// Request: "<hold csv|-> <kill csv|->". Reply: "ok <rows> <held> <errors>"
// with rows pid:ppid, held pid:start:exit (exit empty while running) and errors
// pid:gone|denied. Get-CimInstance returns no command lines or arguments here.
const helperScript = String.raw`
$ErrorActionPreference = 'Stop'
$held = @{}
function Ids([string]$text) {
  if ($text -eq '-') { return @() }
  if ($text -notmatch '^[0-9]{1,10}(,[0-9]{1,10}){0,4095}$') { throw 'invalid_request' }
  return @($text.Split(',') | ForEach-Object { [int]$_ })
}
function Field($list) { if ($list.Count) { return ($list -join ',') }; return '-' }
function Ticks([DateTime]$time) { return $time.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $parts = $line.Split(' ')
    if ($parts.Count -ne 2) { throw 'invalid_request' }
    $errors = @()
    foreach ($id in (Ids $parts[0])) {
      if ($held.ContainsKey($id)) { continue }
      try {
        $item = [Diagnostics.Process]::GetProcessById($id)
        # Handle opens and caches one handle; StartTime, HasExited and Kill
        # below all use it, so the identity checked is the identity killed.
        $null = $item.Handle
        $held[$id] = $item
      } catch [ComponentModel.Win32Exception] {
        $kind = 'gone'; if ($_.Exception.NativeErrorCode -eq 5) { $kind = 'denied' }
        $errors += "$($id):$kind"
      } catch { $errors += "$($id):gone" }
    }
    # Snapshot right after the holds and before any kill, so every candidate
    # held here that is still running is listed with its own parent.
    $rows = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "$($_.ProcessId):$($_.ParentProcessId)" })
    $kills = @(Ids $parts[1])
    foreach ($id in $kills) { if ($held.ContainsKey($id)) { try { $held[$id].Kill() } catch {} } }
    foreach ($id in $kills) { if ($held.ContainsKey($id)) { try { [void]$held[$id].WaitForExit(250) } catch {} } }
    $states = @()
    foreach ($id in @($held.Keys)) {
      $item = $held[$id]
      $exit = ''; if ($item.HasExited) { $exit = Ticks $item.ExitTime }
      $states += "$($id):$(Ticks $item.StartTime):$exit"
    }
    [Console]::Out.WriteLine("ok $(Field $rows) $(Field $states) $(Field $errors)")
  } catch { [Console]::Out.WriteLine('error') }
  [Console]::Out.Flush()
}
`;
const csv = (values: number[]) => values.length ? values.join(',') : '-';
const ticks = (text: string) => { if (!/^[1-9][0-9]{0,18}$/.test(text)) throw new Error('tree_reply'); return BigInt(text); };
export function parseTreeReply(line: string): TreeReply {
  const parts = line.split(' ');
  if (parts.length !== 4 || parts[0] !== 'ok') throw new Error('tree_reply');
  const list = (text: string) => text === '-' ? [] : text.split(',');
  const id = (text: string) => { if (!/^[0-9]{1,10}$/.test(text)) throw new Error('tree_reply'); return Number(text); };
  const reply: TreeReply = { rows: new Map(), held: new Map(), errors: new Map() };
  for (const row of list(parts[1]!)) { const [pid, ppid, extra] = row.split(':'); if (extra !== undefined) throw new Error('tree_reply'); reply.rows.set(id(pid!), id(ppid ?? '')); }
  for (const row of list(parts[2]!)) {
    const [pid, start, exit, extra] = row.split(':');
    if (extra !== undefined || exit === undefined) throw new Error('tree_reply');
    reply.held.set(id(pid!), { start: ticks(start!), exit: exit === '' ? null : ticks(exit) });
  }
  for (const row of list(parts[3]!)) {
    const [pid, error, extra] = row.split(':');
    if (extra !== undefined || (error !== 'gone' && error !== 'denied')) throw new Error('tree_reply');
    reply.errors.set(id(pid!), error);
  }
  return reply;
}

// One helper per cleanup, started only after a stop (so after any Ctrl-C that
// caused it); it exits on stdin EOF. Not detached: PowerShell started with
// DETACHED_PROCESS reads EOF from its piped stdin and exits at once (measured
// on Windows 10 x64 / PowerShell 5.1). A further Ctrl-C during cleanup can end
// the helper; that cleanup then reports unconfirmed.
export function windowsTreeHelper(): TreeHelper {
  const helper = childProcess.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(helperScript, 'utf16le').toString('base64')], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '', waiting: { resolve: (reply: TreeReply) => void; reject: (error: Error) => void } | undefined, failed = false;
  const fail = () => { failed = true; waiting?.reject(new Error('tree_helper')); waiting = undefined; };
  helper.once('error', fail); helper.once('exit', fail);
  helper.stdin.on('error', fail);
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', (part: string) => {
    buffer += part;
    if (buffer.length > 4 * 1024 * 1024) { fail(); helper.kill(); return; }
    const end = buffer.indexOf('\n'); if (end < 0) return;
    const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
    const pending = waiting; waiting = undefined;
    try { pending?.resolve(parseTreeReply(line)); } catch { pending?.reject(new Error('tree_reply')); }
  });
  return {
    pid: helper.pid,
    request(hold, kill) {
      return new Promise((resolve, reject) => {
        if (failed || waiting) { reject(new Error('tree_helper')); return; }
        waiting = { resolve, reject }; helper.stdin.write(`${csv(hold)} ${csv(kill)}\n`);
      });
    },
    close() { try { helper.stdin.destroy(); helper.stdout.destroy(); helper.kill(); } catch { /* Already gone. */ } },
  };
}

// A provisional classifier, not an ownership proof. It compares creation/exit
// times read through held handles; those are UTC wall-clock instants, so the
// ordering is known to be unsound under a clock rollback, which is why no
// production path selects this backend. The root is identified first: Node
// holds its handle until Node observes its exit, so a hold that completes
// before that holds the root itself (the root is terminated only after this
// and after its listed children are held, or after ROOT_HOLD_GRACE_MS if the
// helper is slow). A descendant C is accepted when its parent P was accepted
// and P.start <= C.start <= P.exit by those UTC times, P being held and so
// stable. Only accepted candidates are killed; anything else is held but not
// killed. When the root's identity, a candidate's identity or a candidate's
// parent cannot be established (root exited first, vanished, denied, unlisted),
// nothing under it is killed and the result is unconfirmed.
// A descendant whose own parent exited and was released before cleanup began
// is not linked to the root at all; it is neither killed nor detectable here.
// close() asks the helper to exit; it does not await its termination.
export const ROOT_HOLD_GRACE_MS = 2000;
export async function reapWindowsTree(root: TreeRoot, deadline: () => number, options: {
  helper?: () => TreeHelper; now?: () => number; self?: number; signal?: AbortSignal } = {}): Promise<TreeCleanup> {
  const now = options.now ?? (() => performance.now()), self = options.self ?? process.pid;
  let helper: TreeHelper;
  const grace = setTimeout(() => root.kill(), Math.max(0, Math.min(ROOT_HOLD_GRACE_MS, deadline() - now())));
  try { helper = (options.helper ?? windowsTreeHelper)(); } catch { clearTimeout(grace); root.kill(); return 'unconfirmed'; }
  const owned = new Map<number, { start: bigint; exit: bigint | null }>(), foreign = new Set<number>(), unknown = new Set<number>();
  const listed = new Map<number, number>();
  // An already observed exit means the root PID may be reused: no evidence.
  let hold: number[] = root.exited() ? [] : [root.pid], kill: number[] = [];
  let doubtful = !hold.length, rootPending = hold.length > 0;
  const parentOwns = (ppid: number, start: bigint) => {
    const parent = owned.get(ppid);
    return !!parent && start >= parent.start && (parent.exit === null || start <= parent.exit);
  };
  const aborted = new Promise<undefined>(resolve => {
    if (options.signal?.aborted) resolve(undefined); else options.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
  });
  try {
    for (;;) {
      const remaining = deadline() - now();
      if (remaining <= 0 || options.signal?.aborted) return 'unconfirmed';
      // A reply can confirm only if its snapshot followed every kill and the
      // root's observed exit (the helper snapshots before a request's kills).
      const settledBefore = !kill.length && root.exited();
      const abort = new AbortController();
      const reply = await Promise.race([helper.request(hold, kill), aborted,
        timers.setTimeout(remaining, undefined, { signal: abort.signal }).catch(() => undefined)]).finally(() => abort.abort());
      if (!reply) return 'unconfirmed';
      for (const [pid, state] of reply.held) { const node = owned.get(pid); if (node) node.exit = state.exit; }
      for (const pid of hold) {
        const state = reply.held.get(pid);
        if (rootPending && pid === root.pid) {
          // Still unobserved by Node now, so it was the root when opened.
          rootPending = false;
          // An identified root is terminated through the held handle once the
          // visible tree is held (Node's own kill would let a Node child's job
          // end them first, unheld); the grace timer stays as the backstop.
          // An unidentified root is killed now (through Node's handle).
          if (state && !root.exited()) owned.set(pid, { ...state }); else { doubtful = true; unknown.add(pid); clearTimeout(grace); root.kill(); }
          continue;
        }
        if (!state) { doubtful = true; unknown.add(pid); continue; }
        // Only this snapshot, taken after the hold, describes the held process.
        // An earlier row may belong to a previous holder of the PID, and no
        // wall-clock stamp can show otherwise: an unlisted (already exited)
        // candidate stays unclassified, and nothing under it is killed.
        const ppid = reply.rows.get(pid);
        if (ppid === undefined) { doubtful = true; unknown.add(pid); }
        else if (ppid !== pid && parentOwns(ppid, state.start)) owned.set(pid, { ...state });
        else {
          // A changed parent means the listed process was replaced before the
          // hold; whatever it started is no longer visible: doubtful.
          if (ppid !== listed.get(pid)) doubtful = true;
          foreign.add(pid);
        }
      }
      hold = []; kill = [];
      for (const [pid, node] of owned) if (node.exit === null) kill.push(pid);
      // An unidentified root already made the result doubtful; its PID is in unknown.
      for (const [pid, ppid] of reply.rows) {
        if (unknown.has(ppid)) doubtful = true;
        if (pid <= 4 || pid === ppid || pid === self || pid === helper.pid || owned.has(pid) || foreign.has(pid) || unknown.has(pid)) continue;
        if (owned.has(ppid)) { hold.push(pid); listed.set(pid, ppid); }
      }
      // Hold the whole visible tree before killing anything: a dying Node
      // parent's job ends its children, and an unheld one would then vanish
      // unattributed. A tree that keeps growing is bounded by the deadline
      // (the root by ROOT_HOLD_GRACE_MS).
      if (hold.length) kill = [];
      if (!hold.length && !kill.length) {
        if (root.exited() && settledBefore) return doubtful ? 'unconfirmed' : 'confirmed';
        if (root.exited()) continue;
        // The root was asked to terminate; give Node a moment to observe it.
        await Promise.race([timers.setTimeout(Math.max(0, Math.min(25, deadline() - now()))), aborted]);
      }
    }
  } catch { return 'unconfirmed'; }
  finally { clearTimeout(grace); root.kill(); helper.close(); }
}
