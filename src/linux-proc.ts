// Linux procfs evidence for exact native profiles. These readers inspect only
// a supplied PID (an owned app-server child or the single lsof-reported lock
// owner) and the kernel lock table; they never scan /proc/<pid> inventories.
// All parsing is closed: an unrecognized row that names the inspected inode, a
// changed start time, a foreign UID or an unexpected executable refuses.
// No Linux native profile is qualified; this is the machinery a future
// evidence-backed row selects, unit-tested with injected readers. The artifact
// digest helper below also serves any future pinned Darwin (Mach-O) row.
import { closeSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export type ProcStat = { dev: bigint; ino: bigint };
export type ProcReader = {
  readFile(path: string): string; readdir(path: string): string[];
  readlink(path: string): string; stat(path: string): ProcStat;
};
export const procfs: ProcReader = {
  readFile: path => readFileSync(path, 'utf8'),
  readdir: path => readdirSync(path),
  readlink: path => readlinkSync(path),
  stat: path => { const s = statSync(path, { bigint: true }); return { dev: s.dev, ino: s.ino }; },
};
export class ProcRefusal extends Error {}
const refuse = (): never => { throw new ProcRefusal('procfs_evidence_unverified'); };
const gone = (error: unknown) => ['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '');
const decimal = (value: string | undefined) => /^(?:0|[1-9]\d{0,18})$/.test(value ?? '') ? BigInt(value!) : refuse();
// /proc/<pid>/stat: comm may contain spaces and ')' so split after the LAST ')'.
// Fields after comm start at field 3 (state); starttime is field 22.
export function parseProcStat(text: string) {
  const end = text.lastIndexOf(')');
  if (end < 0 || text[end + 1] !== ' ') refuse();
  const fields = text.slice(end + 2).replace(/\n$/, '').split(' ');
  if (fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]!)) refuse();
  return { state: fields[0]!, ppid: Number(decimal(fields[1])), pgrp: Number(decimal(fields[2])), starttime: decimal(fields[19]).toString() };
}
// Real, effective, saved and filesystem UIDs must all be the caller's UID.
export function parseProcStatusUid(text: string): number {
  const rows = text.split('\n').filter(line => line.startsWith('Uid:'));
  const match = rows.length === 1 ? /^Uid:\t(\d+)\t(\d+)\t(\d+)\t(\d+)$/.exec(rows[0]!) : null;
  if (!match || new Set(match.slice(1)).size !== 1) refuse();
  return Number(decimal(match![1]));
}
// glibc gnu_dev_major/minor, matching libuv's makedev() for statx results.
export function devParts(dev: bigint) {
  return { major: ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn), minor: (dev & 0xffn) | ((dev >> 12n) & ~0xffn) };
}
export type ProcLock = { blocked: boolean; kind: string; access: string; pid: number; major: bigint; minor: bigint; ino: bigint };
// fs/locks.c lock_get_status: "<id>: [-> ]<KIND> <MODE> <ACCESS> <pid> <maj>:<min>:<ino> <start> <end|EOF>".
// Rows for other inodes may use unknown kinds and are ignored only when they
// cannot name the inspected inode.
export function procLockHolders(text: string, target: ProcStat): ProcLock[] {
  const { major, minor } = devParts(target.dev), rows: ProcLock[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const match = /^\d+: (?:\s*(->)\s+)?(\S+)\s+(\S+)\s+(\S+)\s+(-?\d+) ([0-9a-f]+):([0-9a-f]+):(\d+) \d+ (?:\d+|EOF)$/.exec(line);
    if (!match) { if (line.includes(':' + target.ino.toString() + ' ')) refuse(); continue; }
    const row = { blocked: match[1] === '->', kind: match[2]!, access: match[4]!, pid: Number(match[5]),
      major: BigInt('0x' + match[6]), minor: BigInt('0x' + match[7]), ino: decimal(match[8]) };
    if (row.ino === target.ino && row.major === major && row.minor === minor) rows.push(row);
  }
  return rows;
}
// Exactly one granted exclusive flock(2) holder, as Rust std File::try_lock
// takes on Unix; POSIX/OFD/shared/lease rows or another holder are ambiguous.
export function procFlockOwner(path: string, reader: ProcReader = procfs): number {
  const target = reader.stat(path), rows = procLockHolders(reader.readFile('/proc/locks'), target);
  const granted = rows.filter(row => !row.blocked);
  if (rows.some(row => row.kind !== 'FLOCK') || granted.length !== 1 || granted[0]!.access !== 'WRITE' ||
      !Number.isSafeInteger(granted[0]!.pid) || granted[0]!.pid <= 1) refuse();
  return granted[0]!.pid;
}
export type ProcOwner = { pid: number; ppid: number; pgrp: number; state: string; starttime: string; uid: number; exe?: ProcStat };
export function procOwner(pid: number, reader: ProcReader = procfs, executable = false): ProcOwner {
  if (!Number.isSafeInteger(pid) || pid <= 1) refuse();
  try {
    const stat = parseProcStat(reader.readFile(`/proc/${pid}/stat`)), uid = parseProcStatusUid(reader.readFile(`/proc/${pid}/status`));
    if (['Z', 'X', 'x'].includes(stat.state)) refuse();
    return { pid, ...stat, uid, ...(executable ? { exe: reader.stat(`/proc/${pid}/exe`) } : {}) };
  } catch (error) { if (error instanceof ProcRefusal) throw error; return refuse(); }
}
export const sameOwner = (left: ProcOwner, right: ProcOwner) => left.pid === right.pid && left.ppid === right.ppid &&
  left.pgrp === right.pgrp && left.starttime === right.starttime && left.uid === right.uid &&
  left.exe?.dev === right.exe?.dev && left.exe?.ino === right.exe?.ino;
export type OpenedFile = { name: string; dev: bigint; ino: bigint; deleted: boolean };
// Only regular absolute paths are retained; sockets, pipes and anon inodes are
// not storage. A descriptor closed during the walk is not opened state.
export function procOpenedFiles(pid: number, reader: ProcReader = procfs, limit = 4096): OpenedFile[] {
  let entries: string[];
  try { entries = reader.readdir(`/proc/${pid}/fd`); } catch { return refuse(); }
  if (entries.length > limit || entries.some(entry => !/^(?:0|[1-9]\d{0,9})$/.test(entry))) refuse();
  const files: OpenedFile[] = [];
  for (const fd of entries) {
    let name: string, stat: ProcStat;
    try {
      name = reader.readlink(`/proc/${pid}/fd/${fd}`);
      if (!name.startsWith('/')) continue;
      stat = reader.stat(`/proc/${pid}/fd/${fd}`);
    } catch (error) { if (gone(error)) continue; return refuse(); }
    const deleted = name.endsWith(' (deleted)');
    files.push({ name: deleted ? name.slice(0, -' (deleted)'.length) : name, dev: stat.dev, ino: stat.ino, deleted });
  }
  return files;
}
// Owned app-server binding: this process's direct child, its own detached
// group leader, same UID in all four slots, executing exactly the selected
// executable inode, unchanged (PID reuse/exec) across the descriptor walk.
export function procOwnedFiles(pid: number, parentPid: number, uid: number, executable: ProcStat, reader: ProcReader = procfs): OpenedFile[] {
  const before = procOwner(pid, reader, true);
  if (before.ppid !== parentPid || before.pgrp !== pid || before.uid !== uid ||
      before.exe!.dev !== executable.dev || before.exe!.ino !== executable.ino) refuse();
  const files = procOpenedFiles(pid, reader);
  if (!sameOwner(before, procOwner(pid, reader, true))) refuse();
  return files;
}
// Host-native 64-bit little-endian executable header: ELF on Linux, thin
// Mach-O on Darwin. The complete byte digest is the artifact identity.
const machines: Record<string, [number, number]> = { arm64: [183, 0x0100000c], x64: [62, 0x01000007] };
export function nativeExecutable(header: Buffer, platform: string, arch: string): boolean {
  const machine = machines[arch]; if (!machine || header.length < 20) return false;
  if (platform === 'linux') return header.readUInt32BE(0) === 0x7f454c46 && header[4] === 2 && header[5] === 1 &&
    [2, 3].includes(header.readUInt16LE(16)) && header.readUInt16LE(18) === machine[0];
  return platform === 'darwin' && header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === machine[1] &&
    header.readUInt32LE(12) === 2;
}
export async function artifactDigest(path: string, platform: string, arch: string, deadlineMs: number, now: () => number,
  maxBytes = 512 * 1024 * 1024): Promise<string> {
  const fd = openSync(path, 'r'); let header: Buffer;
  try { header = Buffer.alloc(20); if (readSync(fd, header, 0, 20, 0) !== 20 || !nativeExecutable(header, platform, arch)) refuse(); }
  finally { closeSync(fd); }
  const handle = await open(path, 'r'), hash = createHash('sha256'); let total = 0;
  try {
    for await (const chunk of handle.createReadStream({ highWaterMark: 1024 * 1024 }) as AsyncIterable<Buffer>) {
      total += chunk.length; if (total > maxBytes || now() >= deadlineMs) refuse(); hash.update(chunk);
    }
  } finally { await handle.close().catch(() => {}); }
  return hash.digest('hex');
}
