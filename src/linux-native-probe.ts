// Owned one-shot worker for synchronous native-profile I/O: the complete
// executable digest and the Linux owned-child procfs/canonical-path binding.
// The caller runs it with process.run() under the ORIGINAL remaining budget;
// at that deadline it requests termination of the worker's process group and
// the caller refuses the effect. Actual reaping of a process blocked in
// uninterruptible kernel I/O may occur later, when the kernel returns; the
// caller's effect decision never waits on it beyond its own deadline check. Output is closed JSON returned only to the
// caller (opened paths stay in memory, never in CLI output or logs).
import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { nativeExecutable, procOwnedFiles } from './linux-proc.js';

type Output = { ok: true; sha256?: string; files?: { name: string; dev: string; ino: string; deleted: boolean }[] } | { ok: false };
const integer = (value: string | undefined) => /^[1-9]\d{0,9}$/.test(value ?? '') ? Number(value) : NaN;
function digest(path: string, platform: string, arch: string, maxBytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(20);
    if (readSync(fd, header, 0, 20, 0) !== 20 || !nativeExecutable(header, platform, arch)) throw new Error('format');
    const hash = createHash('sha256'), chunk = Buffer.alloc(1024 * 1024); let total = 0;
    for (let read; (read = readSync(fd, chunk, 0, chunk.length, null)) > 0;) {
      total += read; if (total > maxBytes) throw new Error('size'); hash.update(chunk.subarray(0, read));
    }
    return hash.digest('hex');
  } finally { closeSync(fd); }
}
function main(args: string[]): Output {
  try {
    if (args[0] === 'digest' && args.length === 5 && isAbsolute(args[1]!)) {
      return { ok: true, sha256: digest(args[1]!, args[2]!, args[3]!, integer(args[4])) };
    }
    if (args[0] === 'bind' && args.length === 5 && isAbsolute(args[4]!)) {
      const [pid, parent, uid] = [integer(args[1]), integer(args[2]), Number(args[3])];
      if (!Number.isSafeInteger(uid) || uid < 0 || uid !== process.getuid?.()) throw new Error('uid');
      const exe = statSync(realpathSync(args[4]!), { bigint: true });
      const files = procOwnedFiles(pid, parent, uid, { dev: exe.dev, ino: exe.ino });
      return { ok: true, files: files.map(file => ({ name: file.name, dev: file.dev.toString(), ino: file.ino.toString(), deleted: file.deleted })) };
    }
  } catch { /* Closed refusal below; no path or native diagnostic is returned. */ }
  return { ok: false };
}
process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n');
