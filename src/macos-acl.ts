// Shared bounded macOS ACL metadata. No shell, arbitrary executable or file contents.
import {spawnSync} from 'node:child_process';
import {isAbsolute} from 'node:path';
export const MACOS_ACL_LIMITS = Object.freeze({paths:4481,batchPaths:128,argumentBytes:32768,batchOutput:262144,totalOutput:8388608,batches:128,timeoutMs:5000});
// Node exposes POSIX mode bits, not macOS extended ACLs. Conservatively reject
// ANY extended ACL on automatic registries, including owner-only ACLs. The
// trusted system metadata helper receives only absolute paths and a minimal C
// locale environment; no shell, PATH lookup, agent binary or filename parsing.
// -b escapes embedded newlines and -n avoids account-name lookups. ACL entries
// must also be rejected when an xattr '@' masks the '+' permission suffix.
export function inspectMacosAcls(input: readonly string[]): 'clear' | 'acl' | 'unknown' {
  const paths = [...new Set(input)];
  if (!paths.length) return 'clear';
  if (process.platform !== 'darwin' || paths.length > MACOS_ACL_LIMITS.paths) return 'unknown';
  const batches: string[][] = []; let batch: string[] = [], bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path, 'utf8') + 1;
    if (!isAbsolute(path) || path.includes('\0') || size > MACOS_ACL_LIMITS.argumentBytes) return 'unknown';
    if (batch.length && (batch.length >= MACOS_ACL_LIMITS.batchPaths || bytes + size > MACOS_ACL_LIMITS.argumentBytes)) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(path); bytes += size;
  }
  if (batch.length) batches.push(batch);
  if (batches.length > MACOS_ACL_LIMITS.batches) return 'unknown';
  const cutoff = performance.now() + MACOS_ACL_LIMITS.timeoutMs; let output = 0;
  for (const entries of batches) {
    const remaining = Math.floor(cutoff - performance.now());
    if (remaining < 1) return 'unknown';
    let done: ReturnType<typeof spawnSync>;
    try {
      done = spawnSync('/bin/ls', ['-ldebn', '--', ...entries], { encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: remaining,
        maxBuffer: MACOS_ACL_LIMITS.batchOutput, killSignal: 'SIGKILL' });
    } catch { return 'unknown'; }
    if (done.error || done.status !== 0 || done.signal || typeof done.stdout !== 'string' ||
        typeof done.stderr !== 'string' || done.stderr.length || performance.now() >= cutoff) return 'unknown';
    const size = Buffer.byteLength(done.stdout, 'utf8'); output += size;
    if (size > MACOS_ACL_LIMITS.batchOutput || output > MACOS_ACL_LIMITS.totalOutput) return 'unknown';
    const lines = done.stdout.split('\n'); if (lines.at(-1) === '') lines.pop();
    let records = 0;
    for (const line of lines) {
      if (/^\s+\d+:/.test(line)) return 'acl';
      const mode = /^[-dlcbps][rwxstST-]{9}([+@]?)\s/.exec(line);
      if (!mode) return 'unknown';
      if (mode[1] === '+') return 'acl';
      records++;
    }
    if (records !== entries.length) return 'unknown';
  }
  return 'clear';
}
