// Private owner verifier entry point. The caller MUST spawn this in an owned
// POSIX process group and enforce the original remaining deadline (at most 1s).
// lsof/ps inherit that group; using process.run() here would detach them into
// separate groups and defeat the supervisor's cleanup.
// Keep the sample/identity algorithm aligned with writer.ts inspectWriter.
// Its byte-for-byte identity SHA is covered by a real-lock synthetic fixture.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type Owner = { pid: number; uid?: number; command?: string; start?: string };
type Output = { schemaVersion: 1; ok: true; generation: string } |
  { schemaVersion: 1; ok: false; error: 'writer_probe_invalid' | 'writer_probe_unsupported' | 'writer_probe_unverified' };
const safe = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length > 0 &&
  Buffer.byteLength(value) <= bytes && !/[\x00-\x1f\x7f-\x9f]/.test(value) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function fingerprint(path: string): string {
  const s = lstatSync(path, { bigint: true });
  return [s.dev, s.ino, s.size, s.mtimeNs].join(':');
}
function owned(path: string, directory: boolean): boolean {
  const s = lstatSync(path);
  return !s.isSymbolicLink() && (directory ? s.isDirectory() : s.isFile() && s.nlink === 1) &&
    s.uid === process.getuid?.() && !(s.mode & 0o022);
}
function command(binary: string, args: string[], env = process.env): Promise<{ valid: boolean; stdout: string }> {
  return new Promise(resolve => {
    let child;
    try { child = spawn(binary, args, { shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, NODE_OPTIONS: undefined, NODE_PATH: undefined } }); }
    catch { resolve({ valid: false, stdout: '' }); return; }
    let bytes = 0, output = '', overflow = false, failed = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part: string) => {
      bytes += Buffer.byteLength(part);
      if (bytes > 4096) { overflow = true; output = ''; } else if (!overflow) output += part;
    });
    // Drain metadata tool errors without retaining paths, command text or bodies.
    child.stderr.on('data', (part: Buffer) => { bytes += part.length; if (bytes > 8192) { overflow = true; output = ''; } });
    child.once('error', () => { failed = true; });
    // Do not return while a command still runs. A hung/overflowing command and
    // all its inherited-group descendants are killed by the owning supervisor.
    child.once('close', code => resolve({ valid: code === 0 && !failed && !overflow, stdout: overflow ? '' : output }));
  });
}
async function main(args: string[]): Promise<Output> {
  const refusal = (error: 'writer_probe_invalid' | 'writer_probe_unsupported' | 'writer_probe_unverified'): Output => ({ schemaVersion: 1, ok: false, error });
  if (!['darwin', 'linux'].includes(process.platform) || process.getuid?.() === undefined) return refusal('writer_probe_unsupported');
  const [home, rawId] = args;
  if (args.length !== 2 || !safe(home, 2048) || !safe(rawId, 128) || !isAbsolute(home) || resolve(home) !== home ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(rawId)) return refusal('writer_probe_invalid');
  try {
    const id = rawId.toLowerCase(), directory = join(home, 'thread-writer-locks'), path = join(directory, id + '.lock');
    if (realpathSync(home) !== home || !owned(home, true) || !owned(directory, true) || !owned(path, false)) return refusal('writer_probe_unverified');
    // Dynamic import keeps dependency failures inside the sanitized boundary.
    const { probeLock } = await import('./writer.js');
    async function sample() {
      const state = await probeLock(path);
      if (state !== 'held') return { state, fingerprint: state === 'free' ? fingerprint(path) : '', owners: [] as Owner[], valid: true };
      const stamp = fingerprint(path);
      const listed = await command('lsof', ['-nP', '-F0pcu', '--', path]);
      const owners: Owner[] = []; let current: Owner | undefined;
      // Preserve assignment order: inspectWriter's original JSON serialization
      // is the generation source, not a newly canonicalized owner object.
      for (const token of listed.stdout.split(/[\0\n]/)) {
        const value = token.slice(1).trim();
        if (token[0] === 'p') { current = { pid: Number(value) }; owners.push(current); }
        if (current && token[0] === 'u') { const uid = /^\d+$/.test(value) ? Number(value) : NaN; current.uid = Number.isSafeInteger(uid) ? uid : undefined; }
        if (current && token[0] === 'c') current.command = value;
      }
      // Ambiguous owners need no further tools and cannot produce a generation.
      if (owners.length !== 1) return { state, fingerprint: stamp, owners, valid: false };
      for (const owner of owners) {
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 1) continue;
        const started = await command('ps', ['-p', String(owner.pid), '-o', 'lstart='], { ...process.env, LC_ALL: 'C' });
        if (started.valid) owner.start = started.stdout.trim();
      }
      return { state, fingerprint: stamp, owners, valid: listed.valid };
    }
    const before = await sample();
    if (before.state !== 'held') return refusal('writer_probe_unverified');
    await delay(250);
    const after = await sample(), owner = after.owners[0], uid = process.getuid?.();
    if (!before.valid || !after.valid || before.state !== after.state || before.fingerprint !== after.fingerprint ||
        before.owners.length !== 1 || after.owners.length !== 1 || JSON.stringify(before.owners) !== JSON.stringify(after.owners) ||
        !owner?.start || !safe(owner.start, 256) || uid === undefined || owner.uid !== uid ||
        !/^codex(?:\.exe|-|$)/i.test(owner.command ?? '') || !owned(path, false)) return refusal('writer_probe_unverified');
    const identity = JSON.stringify({ fingerprint: after.fingerprint, ...owner });
    return { schemaVersion: 1, ok: true, generation: createHash('sha256').update(identity).digest('hex') };
  } catch { return refusal('writer_probe_unverified'); }
}
void main(process.argv.slice(2)).then(result => { process.stdout.write(JSON.stringify(result) + '\n'); },
  () => { process.stdout.write('{"schemaVersion":1,"ok":false,"error":"writer_probe_unverified"}\n'); });
