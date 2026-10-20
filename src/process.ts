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
  stdoutBytes?: Buffer; stopReason?: StopReason; cleanup?: TreeCleanup };
// On POSIX every child is started detached: a new session and process group
// with no controlling terminal. A timeout, an output overflow or a signal to
// this CLI reaps that group, which includes descendants such as a jump
// ProxyCommand, and nothing else; a descendant that calls setsid() itself has
// left the group and is out of scope (there is no PID scanning).
// On Windows the same stops terminate the child and then its owned descendants
// (reapWindowsTree below): attributed by parent PID and creation time through
// held handles, never by bare PID. The child gets total - treeReserve(total)
// of the caller's timeout and cleanup the rest, so the result still arrives
// within the original total. A stopped Windows run reports cleanup 'confirmed'
// only when the child and every attributed descendant were observed exited and
// nothing unverifiable was seen; otherwise 'unconfirmed', an unknown effect
// that permits no fallback or resend. POSIX results carry no cleanup field.
const groups = new Set<number>();
const trees = new Map<number, (cap: number) => Promise<unknown>>();
const reap = (pid: number | undefined) => { if (pid) try { process.kill(-pid, 'SIGKILL'); } catch { /* Already gone (ESRCH). */ } };
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
// A detached group no longer receives the terminal's Ctrl-C, so forward
// termination signals as a group kill, then re-raise with default handling.
// Windows first runs every active tree cleanup, each within its own total
// and WINDOWS_TREE_RESERVE_MS from now; Node re-raises there as TerminateProcess.
function forward(signal: NodeJS.Signals) {
  for (const name of signals) process.removeListener(name, forward);
  if (process.platform !== 'win32') {
    for (const pid of groups) reap(pid);
    groups.clear();
    process.kill(process.pid, signal); return;
  }
  const cap = performance.now() + WINDOWS_TREE_RESERVE_MS, pending = [...trees.values()].map(halt => halt(cap));
  trees.clear();
  void Promise.allSettled(pending).then(() => { try { process.kill(process.pid, signal); } catch { process.exit(1); } });
}
export function run(binary: string, args: string[], options: {
  env?: NodeJS.ProcessEnv; input?: string; timeout?: number; limit?: number; rawStdout?: boolean;
} = {}): Promise<Done> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, stderrBytes = 0, spawned = false, interrupted = false, finished = false, stopped = false;
    let stopReason: StopReason | undefined, cleanup: TreeCleanup | undefined, tree: Promise<unknown> | undefined, exitedAt: bigint | undefined;
    const chunks: Buffer[] = [], outputDecoder = new StringDecoder('utf8'), diagnosticDecoder = new StringDecoder('utf8');
    const windows = process.platform === 'win32', total = options.timeout ?? 3000, started = performance.now();
    const spawnedAt = filetime(Date.now());
    const child = spawn(binary, args, { shell: false, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: !windows });
    const release = () => {
      if (child.pid === undefined || !(windows ? trees.delete(child.pid) : groups.delete(child.pid)) || groups.size || trees.size) return;
      for (const name of signals) process.removeListener(name, forward);
    };
    const finish = (code: number | null) => {
      // A started Windows cleanup alone completes the run (bounded by total).
      if (finished || (tree && !cleanup)) return;
      finished = true; clearTimeout(timer); release();
      stdout += outputDecoder.end(); stderr += diagnosticDecoder.end();
      resolve({ code, stdout, stderr, spawned, interrupted,
        ...(options.rawStdout ? { stdoutBytes: Buffer.concat(chunks, bytes) } : {}), ...(stopReason ? { stopReason } : {}),
        ...(cleanup ? { cleanup } : {}) });
    };
    const sweep = (deadline: number) => {
      if (tree) return tree;
      try { child.kill('SIGKILL'); } catch { /* Exit decides. */ }
      const pid = child.pid;
      tree = (pid === undefined ? Promise.resolve<TreeCleanup>('unconfirmed') : reapWindowsTree({ pid, spawnedAt, exitedAt: () => exitedAt }, deadline))
        .then(outcome => { cleanup = outcome; finish(child.exitCode); });
      return tree;
    };
    const stop = (reason: StopReason) => {
      if (stopped || finished) return;
      stopped = interrupted = true; stopReason = reason;
      if (!windows) reap(child.pid); else sweep(started + total);
      // A descendant may still hold the pipes: stop reading so completion
      // depends on the exit (POSIX) or the bounded cleanup (Windows).
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      // Already exited (only a descendant was left): complete after the grace.
      if (!windows && (child.exitCode !== null || child.signalCode !== null)) setTimeout(() => finish(child.exitCode), 100);
    };
    const timer = setTimeout(() => stop('timeout'), total - (windows ? treeReserve(total) : 0));
    const register = () => {
      if (finished || stopped || child.pid === undefined || groups.has(child.pid) || trees.has(child.pid)) return;
      if (!groups.size && !trees.size) for (const name of signals) process.on(name, forward);
      if (!windows) { groups.add(child.pid); return; }
      trees.set(child.pid, cap => {
        if (!stopped) { stopped = interrupted = true; child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
        return sweep(Math.min(started + total, cap));
      });
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
    // Node closes the child's handle (freeing its PID) only after this event,
    // so its time bounds which children of that PID the child itself created.
    child.once('exit', code => { exitedAt = filetime(Date.now() + 1); if (stopped && !windows) setTimeout(() => finish(code), 100); });
    child.once('close', code => finish(code));
    child.stdin.end(options.input);
  });
}

// Owned Windows process-tree cleanup for run(). Windows has no detached
// process group here, and libuv lets descendants silently break away from its
// kill-on-close job, so a timed-out child's descendants are found by walking
// parent PIDs. A bare PID is never trusted: every candidate is first opened by
// a helper that keeps the handle (a held PID cannot be reused), attributed by
// creation time against an owned parent, and terminated only through that same
// handle. No taskkill, no PID-only kill, no shell, no caller text in argv.

export type TreeCleanup = 'confirmed' | 'unconfirmed';
export type TreeReply = { snapshot: bigint; rows: Map<number, number>;
  held: Map<number, { start: bigint; exit: bigint | null }>; errors: Map<number, 'gone' | 'denied'> };
export type TreeHelper = { pid?: number; request(hold: number[], kill: number[]): Promise<TreeReply>; close(): void };
export type TreeRoot = { pid: number; spawnedAt: bigint; exitedAt: () => bigint | undefined };
// Cleanup is carved out of the caller's total budget, never added to it.
export const WINDOWS_TREE_RESERVE_MS = 6000;
export const treeReserve = (total: number) => Math.min(WINDOWS_TREE_RESERVE_MS, Math.max(0, Math.floor(total / 2)));
// FILETIME (100 ns since 1601) of a wall-clock millisecond, the unit of
// process creation/exit times. Callers pass a floor (spawn) or ceiling (exit).
export const filetime = (ms: number) => BigInt(Math.floor(ms)) * 10000n + 116444736000000000n;

// Request: "<hold csv|-> <kill csv|->". Reply: "ok <snapshot> <rows> <held> <errors>"
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
    $kills = @(Ids $parts[1])
    foreach ($id in $kills) { if ($held.ContainsKey($id)) { try { $held[$id].Kill() } catch {} } }
    foreach ($id in $kills) { if ($held.ContainsKey($id)) { try { [void]$held[$id].WaitForExit(250) } catch {} } }
    $snapshot = Ticks ([DateTime]::UtcNow)
    $rows = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "$($_.ProcessId):$($_.ParentProcessId)" })
    $states = @()
    foreach ($id in @($held.Keys)) {
      $item = $held[$id]
      $exit = ''; if ($item.HasExited) { $exit = Ticks $item.ExitTime }
      $states += "$($id):$(Ticks $item.StartTime):$exit"
    }
    [Console]::Out.WriteLine("ok $snapshot $(Field $rows) $(Field $states) $(Field $errors)")
  } catch { [Console]::Out.WriteLine('error') }
  [Console]::Out.Flush()
}
`;
const csv = (values: number[]) => values.length ? values.join(',') : '-';
const ticks = (text: string) => { if (!/^[1-9][0-9]{0,18}$/.test(text)) throw new Error('tree_reply'); return BigInt(text); };
export function parseTreeReply(line: string): TreeReply {
  const parts = line.split(' ');
  if (parts.length !== 5 || parts[0] !== 'ok') throw new Error('tree_reply');
  const list = (text: string) => text === '-' ? [] : text.split(',');
  const id = (text: string) => { if (!/^[0-9]{1,10}$/.test(text)) throw new Error('tree_reply'); return Number(text); };
  const reply: TreeReply = { snapshot: ticks(parts[1]!), rows: new Map(), held: new Map(), errors: new Map() };
  for (const row of list(parts[2]!)) { const [pid, ppid, extra] = row.split(':'); if (extra !== undefined) throw new Error('tree_reply'); reply.rows.set(id(pid!), id(ppid ?? '')); }
  for (const row of list(parts[3]!)) {
    const [pid, start, exit, extra] = row.split(':');
    if (extra !== undefined || exit === undefined) throw new Error('tree_reply');
    reply.held.set(id(pid!), { start: ticks(start!), exit: exit === '' ? null : ticks(exit) });
  }
  for (const row of list(parts[4]!)) {
    const [pid, error, extra] = row.split(':');
    if (extra !== undefined || (error !== 'gone' && error !== 'denied')) throw new Error('tree_reply');
    reply.errors.set(id(pid!), error);
  }
  return reply;
}

// One helper per cleanup, started only after a stop. Detached so a console
// Ctrl-C aimed at this CLI cannot end the cleanup; it exits on stdin EOF.
export function windowsTreeHelper(): TreeHelper {
  const helper = childProcess.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(helperScript, 'utf16le').toString('base64')], { shell: false, detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
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

// Attribution, all against held (stable) identities: C is owned iff its parent P
// is owned and P.start <= C.start <= P.exit. The root is held by Node until Node
// observes its exit, so before that every child of its PID created after the
// spawn is its child; afterwards only those created no later than that exit.
// Anything else is held but never killed. A candidate that vanished or could
// not be opened leaves its subtree unattributable: the result is unconfirmed.
// A descendant whose own parent exited and was released before cleanup began
// is not linked to the root at all; it is neither killed nor detectable here.
export async function reapWindowsTree(root: TreeRoot, deadline: number, options: {
  helper?: () => TreeHelper; now?: () => number; self?: number } = {}): Promise<TreeCleanup> {
  const now = options.now ?? (() => performance.now()), self = options.self ?? process.pid;
  let helper: TreeHelper;
  try { helper = (options.helper ?? windowsTreeHelper)(); } catch { return 'unconfirmed'; }
  const owned = new Map<number, { start: bigint; exit: bigint | null }>(), foreign = new Set<number>(), unknown = new Set<number>();
  let hold: number[] = [], kill: number[] = [], previous: TreeReply | undefined, doubtful = false;
  const parentOwns = (ppid: number, start: bigint) => {
    const exit = root.exitedAt();
    if (ppid === root.pid && start >= root.spawnedAt && (exit === undefined || start <= exit)) return true;
    const parent = owned.get(ppid);
    return !!parent && start >= parent.start && (parent.exit === null || start <= parent.exit);
  };
  try {
    for (;;) {
      const remaining = deadline - now();
      if (remaining <= 0) return 'unconfirmed';
      const abort = new AbortController();
      const reply = await Promise.race([helper.request(hold, kill),
        timers.setTimeout(remaining, undefined, { signal: abort.signal }).catch(() => undefined)]).finally(() => abort.abort());
      if (!reply) return 'unconfirmed';
      for (const [pid, state] of reply.held) { const node = owned.get(pid); if (node) node.exit = state.exit; }
      for (const pid of hold) {
        const state = reply.held.get(pid);
        if (!state) { if (reply.errors.get(pid) === 'denied') doubtful = true; unknown.add(pid); continue; }
        // This snapshot follows the hold. An exited (unlisted) process may use
        // the earlier row only if it already owned the PID when that was taken.
        const ppid = reply.rows.get(pid) ?? (previous && state.start <= previous.snapshot ? previous.rows.get(pid) : undefined);
        if (ppid === undefined) unknown.add(pid);
        else if (ppid !== pid && parentOwns(ppid, state.start)) owned.set(pid, { ...state });
        else foreign.add(pid);
      }
      previous = reply; hold = []; kill = [];
      for (const [pid, node] of owned) if (node.exit === null) kill.push(pid);
      const exited = root.exitedAt() !== undefined;
      for (const [pid, ppid] of reply.rows) {
        if (unknown.has(ppid)) doubtful = true;
        if (pid <= 4 || pid === ppid || pid === self || pid === helper.pid || owned.has(pid) || foreign.has(pid) || unknown.has(pid)) continue;
        if (pid === root.pid && !exited) continue;
        if (ppid === root.pid || owned.has(ppid)) hold.push(pid);
      }
      if (!hold.length && !kill.length) {
        if (exited) return doubtful ? 'unconfirmed' : 'confirmed';
        // Node has asked for the root's termination; give its exit a moment.
        await timers.setTimeout(Math.max(0, Math.min(25, deadline - now())));
      }
    }
  } catch { return 'unconfirmed'; }
  finally { helper.close(); }
}
