import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
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
export type Done = { code: number | null; stdout: string; stderr: string; spawned: boolean; interrupted: boolean };
// On POSIX every child is started detached: a new session and process group
// with no controlling terminal. A timeout, an output overflow or a signal to
// this CLI reaps that group, which includes descendants such as a jump
// ProxyCommand, and nothing else; a descendant that calls setsid() itself has
// left the group and is out of scope (there is no PID scanning). Windows has no
// equivalent here: only the child is killed and descendants may linger.
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
  env?: NodeJS.ProcessEnv; input?: string; timeout?: number; limit?: number;
} = {}): Promise<Done> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, spawned = false, interrupted = false, finished = false, stopped = false;
    const child = spawn(binary, args, { shell: false, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: posix });
    const release = () => {
      if (child.pid === undefined || !groups.delete(child.pid) || groups.size) return;
      for (const name of signals) process.removeListener(name, forward);
    };
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true; clearTimeout(timer); release();
      resolve({ code, stdout, stderr, spawned, interrupted });
    };
    const stop = () => {
      if (stopped || finished) return;
      stopped = interrupted = true;
      if (posix) reap(child.pid); else child.kill('SIGKILL');
      // A descendant outside our reach (Windows) may still hold the pipes:
      // stop reading so completion depends on the exit, not on their close.
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      // Already exited (only a descendant was left): complete after the grace.
      if (child.exitCode !== null || child.signalCode !== null) setTimeout(() => finish(child.exitCode), 100);
    };
    const timer = setTimeout(stop, options.timeout ?? 3000);
    const register = () => {
      if (!posix || child.pid === undefined || groups.has(child.pid)) return;
      if (!groups.size) for (const name of signals) process.on(name, forward);
      groups.add(child.pid);
    };
    // Register as soon as the PID exists, so a signal arriving before the
    // 'spawn' event still reaps the group; 'spawn' remains the fallback.
    register();
    child.once('spawn', () => { spawned = true; register(); });
    child.stdin.on('error', () => { /* Close/exit determines outcome, never resend. */ });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part: string) => {
      bytes += Buffer.byteLength(part);
      if (bytes > (options.limit ?? 1024 * 1024)) stop();
      else stdout += part;
    });
    // Drain but never report native stderr (it may contain message text/credentials).
    // Retain stderr only for allowlisted error classification. Never include it in CLI output.
    child.stderr.on('data', (part: Buffer) => {
      bytes += part.length;
      if (stderr.length < 4096) stderr += part.toString('utf8').slice(0, 4096 - stderr.length);
      if (bytes > (options.limit ?? 1024 * 1024)) stop();
    });
    child.once('error', () => { interrupted = true; });
    // After a kill, the exit plus a short fixed grace bounds completion even if
    // a pipe never closes; otherwise 'close' (all output read) completes it.
    // A descendant that keeps the pipes open after the child exits runs into
    // the same deadline and is reaped with the group.
    child.once('exit', code => { if (stopped) setTimeout(() => finish(code), 100); });
    child.once('close', code => finish(code));
    child.stdin.end(options.input);
  });
}
