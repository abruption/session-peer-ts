// Owner-private managed receipt storage. This module never launches a process,
// opens an agent inbox, interprets a supplied target path or repairs old history.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, writeSync, type BigIntStats } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { canonicalId, closed, fail, HANDOFF_LIMITS, parseStrictJson, safeId } from './handoff.js';
import { inspectMacosAcls } from './macos-acl.js';

export const receiptDigest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
type Marker = { version: 2; ledgerEpoch: string; endpointSelector: string };
const flags = constants.O_NOFOLLOW | constants.O_NONBLOCK;
const identity = (s: BigIntStats) => [s.dev, s.ino, s.uid, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(':');
const directoryIdentity = (s: BigIntStats) => [s.dev, s.ino, s.uid, s.mode].join(':');
// ACL changes update ctime. Cache only an inspected unchanged descriptor/path
// snapshot, and bound this process-local metadata cache independently of history.
const aclEvidence = new Map<string, string>();
function privateStat(path: string, directory: boolean): BigIntStats {
  const uid = process.getuid?.();
  if (uid === undefined || process.platform === 'win32') fail('receipt_storage_unsupported');
  const s = lstatSync(path, { bigint: true });
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) || s.uid !== BigInt(uid) ||
      (s.mode & 0o777n) !== (directory ? 0o700n : 0o600n) || (!directory && s.nlink !== 1n)) fail('receipt_storage_untrusted');
  if (process.platform === 'darwin' && aclEvidence.get(path) !== identity(s)) {
    if (inspectMacosAcls([path]) !== 'clear' || identity(lstatSync(path, { bigint: true })) !== identity(s)) fail('receipt_storage_untrusted');
    if (aclEvidence.size >= 256) aclEvidence.clear();
    aclEvidence.set(path, identity(s));
  }
  return s;
}
function writeAll(fd: number, data: Uint8Array): void {
  let offset = 0;
  while (offset < data.byteLength) {
    const count = writeSync(fd, data, offset, data.byteLength - offset);
    if (count <= 0) fail('receipt_history_unavailable');
    offset += count;
  }
  fsyncSync(fd);
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | flags);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function readPrivate(path: string, limit: number): { bytes: Buffer; evidence: string } {
  const before = privateStat(path, false);
  if (before.size > BigInt(limit)) fail('receipt_history_corrupt');
  const fd = openSync(path, constants.O_RDONLY | flags);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (identity(opened) !== identity(before)) fail('receipt_storage_untrusted');
    const buffer = Buffer.alloc(Math.min(Number(opened.size) + 1, limit + 1));
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length !== Number(opened.size) || identity(fstatSync(fd, { bigint: true })) !== identity(opened) ||
        identity(privateStat(path, false)) !== identity(opened)) fail('receipt_storage_untrusted');
    return { bytes: buffer.subarray(0, length), evidence: identity(opened) };
  } finally { closeSync(fd); }
}
function createPrivate(path: string, value: Uint8Array): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | flags, 0o600);
  try { writeAll(fd, value); } finally { closeSync(fd); }
}
const locks = () => createRequire(import.meta.url)('fs-ext-extra-prebuilt') as { flockSync(fd: number, mode: string): void };

// A lifetime kernel lock, with every later read/write tied to its original inode.
// A missing/replaced key, marker, lock or state is not an invitation to recreate it.
export class ReceiptStore {
  readonly path: string;
  readonly marker: Marker;
  private fd: number | undefined;
  private readonly lockEvidence: string;
  private readonly directoryEvidence: string;
  private readonly markerEvidence: string;
  private readonly keyEvidence: string;
  private readonly key: Buffer;
  private stateEvidence = '';
  private poisoned = false;
  constructor(path: string) {
    if (!isAbsolute(path)) fail('receipt_storage_untrusted');
    this.path = resolve(path);
    this.directoryEvidence = directoryIdentity(privateStat(this.path, true));
    const lockPath = join(this.path, 'collector.lock'), before = privateStat(lockPath, false);
    const fd = openSync(lockPath, constants.O_RDWR | flags);
    try {
      if (identity(fstatSync(fd, { bigint: true })) !== identity(before)) fail('receipt_storage_untrusted');
      try { locks().flockSync(fd, 'exnb'); } catch { fail('receipt_collector_busy'); }
      this.fd = fd; this.lockEvidence = identity(before);
      const marker = readPrivate(join(this.path, 'managed.json'), 16384);
      const m = closed(parseStrictJson(marker.bytes, { maxBytes: 16384 }), ['version', 'ledgerEpoch', 'endpointSelector']);
      if (m.version !== 2 || !canonicalId(m.ledgerEpoch) || !safeId(m.endpointSelector, 4096) || !isAbsolute(m.endpointSelector)) fail('receipt_history_corrupt');
      this.marker = Object.freeze(m) as Marker; this.markerEvidence = marker.evidence;
      const key = readPrivate(join(this.path, 'ledger.key'), 32);
      if (key.bytes.length !== 32) fail('receipt_history_corrupt');
      this.key = Buffer.from(key.bytes); this.keyEvidence = key.evidence;
      this.assertOwner();
    } catch (error) {
      if (this.fd !== undefined) { try { locks().flockSync(fd, 'un'); } finally { this.fd = undefined; closeSync(fd); } }
      else closeSync(fd);
      throw error;
    }
  }
  static initialize(path: string, endpointSelector: string): { ledgerEpoch: string; storage: 'private_posix'; managedVersion: 2 } {
    if (!isAbsolute(path) || !safeId(endpointSelector, 4096) || !isAbsolute(endpointSelector)) fail('receipt_storage_untrusted');
    if (process.platform === 'win32' || process.getuid?.() === undefined) fail('receipt_storage_unsupported');
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    privateStat(path, true);
    // Even an old unmanaged ledger is left untouched. Partial initialization is
    // retained as unavailable evidence, never automatically repaired or removed.
    const entries = opendirSync(path);
    try { if (entries.readSync() !== null) fail('receipt_state_exists'); } finally { entries.closeSync(); }
    const lockPath = join(path, 'collector.lock');
    let fd: number;
    try { fd = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | flags, 0o600); }
    catch { fail('receipt_state_exists'); }
    try {
      locks().flockSync(fd, 'exnb'); fsyncSync(fd);
      const key = randomBytes(32), epoch = randomUUID();
      createPrivate(join(path, 'ledger.key'), key);
      const data = { version: 2, epoch, keyId: receiptDigest(key), quarantined: false, records: {} };
      createPrivate(join(path, 'ledger.json'), Buffer.from(JSON.stringify({ digest: receiptDigest(JSON.stringify(data)), data })));
      createPrivate(join(path, 'managed.json'), Buffer.from(JSON.stringify({ version: 2, ledgerEpoch: epoch, endpointSelector })));
      syncDirectory(path);
      return { ledgerEpoch: epoch, storage: 'private_posix', managedVersion: 2 };
    } finally { try { locks().flockSync(fd, 'un'); } finally { closeSync(fd); } }
  }
  assertOwner(): void {
    if (this.fd === undefined || this.poisoned) fail('receipt_collector_closed');
    if (directoryIdentity(privateStat(this.path, true)) !== this.directoryEvidence ||
        identity(privateStat(join(this.path, 'collector.lock'), false)) !== this.lockEvidence ||
        identity(fstatSync(this.fd, { bigint: true })) !== this.lockEvidence ||
        identity(privateStat(join(this.path, 'managed.json'), false)) !== this.markerEvidence ||
        identity(privateStat(join(this.path, 'ledger.key'), false)) !== this.keyEvidence) fail('receipt_storage_untrusted');
  }
  read(): unknown {
    this.assertOwner();
    const content = readPrivate(join(this.path, 'ledger.json'), HANDOFF_LIMITS.journal);
    try {
      const wrapper = closed(parseStrictJson(content.bytes, { scope: 'outer', maxBytes: HANDOFF_LIMITS.journal }), ['digest', 'data']);
      if (typeof wrapper.digest !== 'string' || wrapper.digest !== receiptDigest(JSON.stringify(wrapper.data))) fail('receipt_history_corrupt');
      const data = closed(wrapper.data, ['version', 'epoch', 'keyId', 'quarantined', 'records']);
      if (data.version !== 2 || data.epoch !== this.marker.ledgerEpoch || data.keyId !== receiptDigest(this.key)) fail('receipt_history_corrupt');
      this.stateEvidence = content.evidence;
      return data;
    } catch { fail('receipt_history_corrupt'); }
  }
  assertUnchanged(): void {
    this.assertOwner();
    if (!this.stateEvidence || identity(privateStat(join(this.path, 'ledger.json'), false)) !== this.stateEvidence) fail('receipt_history_changed');
  }
  sealDigest(value: string, epoch: string, id: string): string {
    if (!/^[a-f0-9]{64}$/.test(value)) fail('receipt_history_corrupt');
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(['receipt-binding-v2', epoch, id])));
    const bytes = Buffer.concat([cipher.update(Buffer.from(value, 'hex')), cipher.final()]);
    return `sealed-v2:${nonce.toString('hex')}:${bytes.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
  }
  openDigest(value: unknown, epoch: string, id: string): string {
    try {
      if (typeof value !== 'string' || !/^sealed-v2:[a-f0-9]{24}:[a-f0-9]{64}:[a-f0-9]{32}$/.test(value)) fail('receipt_history_corrupt');
      const [, nonce, bytes, tag] = (value as string).split(':');
      const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce!, 'hex'));
      cipher.setAAD(Buffer.from(JSON.stringify(['receipt-binding-v2', epoch, id]))); cipher.setAuthTag(Buffer.from(tag!, 'hex'));
      return Buffer.concat([cipher.update(Buffer.from(bytes!, 'hex')), cipher.final()]).toString('hex');
    } catch { fail('receipt_history_corrupt'); }
  }
  write(data: unknown): void {
    this.assertUnchanged();
    const text = Buffer.from(JSON.stringify({ digest: receiptDigest(JSON.stringify(data)), data }));
    if (text.byteLength > HANDOFF_LIMITS.journal) fail('receipt_ledger_full');
    const temporary = join(this.path, `.receipt-ledger-${randomUUID()}.tmp`);
    try {
      createPrivate(temporary, text);
      this.assertUnchanged();
      renameSync(temporary, join(this.path, 'ledger.json'));
      syncDirectory(this.path);
      this.stateEvidence = identity(privateStat(join(this.path, 'ledger.json'), false));
      this.assertOwner();
    } catch (error) {
      // A sync failure can follow rename; do not claim rollback or allow another
      // command to extend authority from uncertain durable state in this owner.
      this.poisoned = true; throw error;
    }
  }
  close(): void {
    const fd = this.fd; this.fd = undefined; this.key.fill(0);
    if (fd !== undefined) { try { locks().flockSync(fd, 'un'); } finally { closeSync(fd); } }
  }
}
