import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path/posix';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({ inputBytes: 64 * 1024, fileBytes: 1024 * 1024, chunkBytes: 64 * 1024, files: 16 });
const invalid = () => { throw new Error('invalid_assessment_input'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const label = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const keys = (value, allowed) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();
};

// JSON.parse owns the grammar. This iterative token walk only finds duplicate
// decoded object keys, including escaped spellings, without recursive parsing.
function uniqueKeys(text) {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      while (++i < text.length) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      const top = stack.at(-1);
      if (top?.kind === '{' && top.key) {
        const key = JSON.parse(text.slice(start, i + 1));
        if (top.seen.has(key)) invalid();
        top.seen.add(key);
        top.key = false;
      }
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? { kind: char, key: true, seen: new Set() } : { kind: char });
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.kind === '{') stack.at(-1).key = true;
  }
}

function parseJson(text) {
  const value = JSON.parse(text);
  uniqueKeys(text);
  return value;
}

/** Parse the complete bounded UTF-8 assessment specification; never reads files. */
export function parseInput(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > LIMITS.inputBytes) invalid();
  let value;
  try { value = parseJson(text); } catch { invalid(); }
  keys(value, ['context', 'packageJson', 'expectedVersion', 'files']);
  keys(value.context, ['installation', 'manager', 'destination', 'account']);
  if (!label(value.context.installation, 2048) || !label(value.context.manager, 128) ||
      !label(value.packageJson, 2048) || !label(value.expectedVersion, 128)) invalid();
  for (const key of ['destination', 'account']) {
    if (Object.hasOwn(value.context, key) && !label(value.context[key], 256)) invalid();
  }
  if (Object.hasOwn(value, 'files')) {
    if (!Array.isArray(value.files) || value.files.length > LIMITS.files) invalid();
    for (const file of value.files) {
      keys(file, ['path', 'baseline']);
      if (!label(file.path, 2048)) invalid();
      // Incomplete/malformed baseline evidence remains a per-file unknown.
      if (object(file.baseline)) keys(file.baseline, ['sha256', 'source', 'observedAt']);
    }
  }
  return value;
}

const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameObservation = (a, b) => sameIdentity(a, b) && a.size === b.size &&
  (a.mtimeNs ?? a.mtimeMs) === (b.mtimeNs ?? b.mtimeMs) && (a.ctimeNs ?? a.ctimeMs) === (b.ctimeNs ?? b.ctimeMs);

/** Bounded POSIX regular-file inspection. Parent symlinks are not excluded.
 * The fsImpl seam supports deterministic tests; it is never selected from env.
 */
export function readRegularFile(path, { fsImpl = fs, platform = process.platform } = {}) {
  const constants = fsImpl.constants ?? fs.constants;
  if (platform === 'win32' || !Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0 ||
      !Number.isInteger(constants.O_NONBLOCK) || constants.O_NONBLOCK === 0) {
    return { state: 'unsupported', reason: 'safe_posix_reader_unavailable' };
  }
  if (typeof path !== 'string' || !isAbsolute(path)) return { state: 'unsupported', reason: 'native_absolute_path_required' };
  let fd;
  let result;
  try {
    const before = fsImpl.lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) return { state: 'unsupported', reason: 'not_regular_file' };
    if (before.size > LIMITS.fileBytes) return { state: 'unknown', reason: 'file_byte_limit' };
    const noControllingTerminal = Number.isInteger(constants.O_NOCTTY) ? constants.O_NOCTTY : 0;
    fd = fsImpl.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | noControllingTerminal);
    const opened = fsImpl.fstatSync(fd, { bigint: true });
    if (!opened.isFile()) result = { state: 'unsupported', reason: 'not_regular_file' };
    else if (!sameObservation(before, opened)) result = { state: 'unknown', reason: 'file_changed' };
    else {
      const expectedSize = Number(opened.size);
      const buffer = Buffer.alloc(expectedSize + 1);
      let total = 0;
      while (total < buffer.length) {
        const count = fsImpl.readSync(fd, buffer, total, Math.min(LIMITS.chunkBytes, buffer.length - total), null);
        if (count === 0) break;
        total += count;
      }
      const after = fsImpl.fstatSync(fd, { bigint: true });
      const named = fsImpl.lstatSync(path, { bigint: true });
      if (total > LIMITS.fileBytes) result = { state: 'unknown', reason: 'file_byte_limit' };
      else if (total > expectedSize || !after.isFile() || !named.isFile() || named.isSymbolicLink() ||
          !sameObservation(opened, after) || !sameObservation(after, named) || BigInt(total) !== BigInt(after.size)) {
        result = { state: 'unknown', reason: 'file_changed' };
      } else result = { state: 'pass', bytes: buffer.subarray(0, total) };
    }
  } catch (error) {
    result = ['ELOOP', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EINVAL'].includes(error?.code)
      ? { state: 'unsupported', reason: 'safe_read_unsupported' }
      : { state: 'unknown', reason: 'file_read_unavailable' };
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); }
      catch { result = { state: 'unknown', reason: 'file_close_unverified' }; }
    }
  }
  return result;
}

const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
/** Read at most the stdin byte limit plus one overflow byte. fd 0 is not owned. */
export function readInput({ fsImpl = fs } = {}) {
  const buffer = Buffer.alloc(LIMITS.inputBytes + 1);
  let size = 0;
  while (size < buffer.length) {
    let count;
    try { count = fsImpl.readSync(0, buffer, size, Math.min(LIMITS.chunkBytes, buffer.length - size), null); }
    catch { throw Object.assign(new Error('input_unavailable'), { code: 'INPUT_UNAVAILABLE' }); }
    if (count === 0) return decode(buffer.subarray(0, size));
    size += count;
  }
  invalid();
}

const baselineValid = baseline => object(baseline) && typeof baseline.sha256 === 'string' &&
  /^[a-fA-F0-9]{64}$/.test(baseline.sha256) && label(baseline.source, 512) && label(baseline.observedAt, 128);

/** Record independent predicates. States are evidence, never an operational gate. */
export function assess(input, { fsImpl = fs, platform = process.platform, now = () => new Date().toISOString() } = {}) {
  // Validate all entries before any filesystem inspection, also for imported use.
  const value = parseInput(JSON.stringify(input));
  const checks = [];
  const add = (id, predicate, state, evidenceKind, source, details = {}) =>
    checks.push({ id, predicate, state, evidenceKind, source, observedAt: now(), ...details });
  add('selection', 'Operator explicitly declares an installation and manager', 'pass',
    'operator_attestation', 'input.context', { reason: 'declaration_only_not_ownership_proof' });
  const inspected = readRegularFile(value.packageJson, { fsImpl, platform });
  let metadata;
  if (inspected.state === 'pass') {
    try {
      metadata = parseJson(decode(inspected.bytes));
      if (!object(metadata)) metadata = undefined;
    } catch { metadata = undefined; }
  }
  for (const [field, expected] of [['name', 'session-peer'], ['version', value.expectedVersion]]) {
    const observed = metadata?.[field];
    const readable = label(observed, 128);
    add(`package.${field}`, `Selected package JSON ${field} equals the expected text`,
      inspected.state !== 'pass' ? inspected.state : !readable ? 'unknown' : observed === expected ? 'pass' : 'fail',
      'static_metadata', value.packageJson, { expected, ...(readable ? { observed } : {}),
        reason: inspected.state !== 'pass' ? inspected.reason : !readable ? 'metadata_field_unverified' : 'selected_file_field_only' });
  }
  for (const [index, file] of (value.files ?? []).entries()) {
    const read = readRegularFile(file.path, { fsImpl, platform });
    const sha256 = read.state === 'pass' ? createHash('sha256').update(read.bytes).digest('hex') : undefined;
    add(`files.${index}.digest`, 'Selected regular file has a current bounded SHA-256 measurement',
      read.state, 'static_metadata', file.path, sha256 ? { observed: sha256, reason: 'measured_bytes_only' } : { reason: read.reason });
    if (!Object.hasOwn(file, 'baseline')) {
      add(`files.${index}.comparison`, 'Current digest equals the operator-labelled baseline digest',
        'not_checked', 'static_metadata', file.path, { reason: 'baseline_not_provided' });
    } else if (!baselineValid(file.baseline)) {
      add(`files.${index}.comparison`, 'Current digest equals the operator-labelled baseline digest',
        'unknown', 'static_metadata', file.path, { reason: 'baseline_evidence_incomplete' });
    } else {
      const expected = file.baseline.sha256.toLowerCase();
      add(`files.${index}.comparison`, 'Current digest equals the operator-labelled baseline digest',
        sha256 ? (sha256 === expected ? 'pass' : 'fail') : read.state, 'static_metadata', file.path,
        { expected, ...(sha256 ? { observed: sha256 } : {}),
          baseline: { source: file.baseline.source, observedAt: file.baseline.observedAt, evidenceKind: 'operator_attestation' },
          reason: sha256 ? 'digest_equality_only_not_authentication_use_or_ownership' : read.reason });
    }
  }
  for (const [id, predicate] of [
    ['runtime_execution', 'Selected runtime and CLI were actually executed'],
    ['diagnostics', 'Separately authorized diagnostics were executed'],
    ['native_qualification', 'The destination cell has current native qualification'],
    ['ownership', 'Storage ownership is established'],
    ['caller_use', 'Current callers use the selected installation']
  ]) add(id, predicate, 'not_checked', 'none', 'none', { reason: 'outside_local_static_assessment' });
  return { reportVersion: 1, scope: 'local_static_assessment', assessmentOnly: true,
    context: { evidenceKind: 'operator_attestation', provided: value.context }, completedAt: now(), checks,
    limits: { byteBoundsOnly: true, atomicSnapshot: false, contentAuthentication: false, parentSymlinksExcluded: false } };
}

const HELP = `Usage: node scripts/remote-qualification.mjs < assessment.json
       node scripts/remote-qualification.mjs --help
Local POSIX static inspection; no tool execution or network connections.
No intentional file/state writes except stdout.
Required: context {installation, manager}, packageJson (absolute path), expectedVersion.
Optional: context.destination/account; files [{path, baseline?: {sha256, source, observedAt}}].
Limits: 64 KiB UTF-8 input; 16 files; 1 MiB per selected regular file.
Relative/foreign paths yield unsupported checks. Label lengths use UTF-16 units.
Read limits bound bytes, not I/O time; they are not deadlines.
Baseline source/time are operator labels, not authenticated history.
Exit 0: report processed regardless of check states. Exit 2: invalid/unavailable input.
No report grants qualification, readiness, ownership or permission to act.
`;

function main() {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') {
      process.stdout.write(HELP);
      return;
    }
    if (process.argv.length !== 2) invalid();
    const input = parseInput(readInput());
    process.stdout.write(JSON.stringify(assess(input)) + '\n');
  } catch (error) {
    process.stdout.write(error?.code === 'INPUT_UNAVAILABLE' ? '{"error":"input_unavailable"}\n' : '{"error":"invalid_assessment_input"}\n');
    process.exitCode = 2;
  }
}

function isEntryPoint() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isEntryPoint()) main();
