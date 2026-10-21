import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// This repository-only tool deliberately has no runtime/agent dependency.
import { LIMITS, parseInput, readInput, readRegularFile, assess } from '../scripts/remote-qualification.mjs';

// The production seam defaults to node:fs; tests supply only the methods exercised.
const read = (path: string, options: any) => readRegularFile(path, options);
const stdin = (options: any) => readInput(options);
const script = resolve('scripts/remote-qualification.mjs');
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const observedAt = '2026-10-21T01:02:03.000Z';
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'tests-qualification-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, 'package.json');
  fs.writeFileSync(pkg, '{"name":"session-peer","version":"0.5.0"}');
  const input = { context: { installation: root, manager: 'operator', destination: 'declared-host', account: 'declared-user' }, packageJson: pkg, expectedVersion: '0.5.0' };
  const invoke = (text: string | Buffer, args: string[] = []) => {
    const child = spawnSync(process.execPath, [script, ...args], { input: text, encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error); assert.equal(child.signal, null);
    return { code: child.status, stdout: child.stdout, stderr: child.stderr };
  };
  return { root, pkg, input, invoke };
}

// Deterministic owned descriptors: never touch a platform's real special files.
function fakeFile(bytes: Buffer, options: { kind?: string; size?: number; fail?: string; changed?: string } = {}) {
  const calls = { opens: 0, closes: 0, reads: 0, maxBuffer: 0, maxRead: 0, flags: 0, consumed: 0, errors: [] as string[], buffers: new Set<Buffer>() };
  const record = (condition: boolean, detail: string) => { if (!condition) calls.errors.push(detail); };
  let statCount = 0;
  const stat = () => {
    statCount++;
    return { dev: 1, ino: options.changed === 'replace' && statCount > 2 ? 2 : 1,
      size: options.size ?? bytes.length, mtimeMs: options.changed === 'time' && statCount > 2 ? 2 : 1,
      ctimeMs: 1, isFile: () => !options.kind || options.kind === 'file',
      isSymbolicLink: () => options.kind === 'symlink' };
  };
  const io = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 0x100, O_NONBLOCK: 0x200 },
    lstatSync: () => { if (options.fail === 'lstat') throw new Error('PRIVATE-FAILURE'); return stat(); },
    openSync: (_path: string, flags: number) => { calls.flags = flags; calls.opens++; if (options.fail === 'open') throw new Error('PRIVATE-FAILURE'); return 91; },
    fstatSync: (fd: number) => { record(fd === 91, 'fstat descriptor'); if (options.fail === 'fstat') throw new Error('PRIVATE-FAILURE'); return stat(); },
    readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      record(fd === 91, 'read descriptor'); record(position === null, 'read position');
      record(offset >= 0 && length >= 0 && offset + length <= buffer.length, 'read bounds');
      calls.reads++; calls.maxBuffer = Math.max(calls.maxBuffer, buffer.length); calls.maxRead = Math.max(calls.maxRead, length); calls.buffers.add(buffer);
      if (options.fail === 'read') throw new Error('PRIVATE-FAILURE');
      const start = position ?? calls.consumed;
      const count = Math.min(length, Math.max(0, bytes.length - start));
      bytes.copy(buffer, offset, start, start + count); calls.consumed += count; return count;
    },
    closeSync: (fd: number) => { record(fd === 91, 'close descriptor'); calls.closes++; }
  };
  return { io, calls };
}

const check = (report: any, id: string) => {
  const found = report.checks.find((item: any) => item.id === id);
  assert.ok(found, `missing predicate ${id}`); return found;
};
const evaluate = (input: unknown, options: any = {}) => assess(input, { now: () => observedAt, ...options });

test('current package predicates and unexecuted checks have separate evidence scopes', t => {
  const f = fixture(t), before = fs.readFileSync(f.pkg);
  const report = evaluate(f.input);
  assert.equal(report.reportVersion, 1); assert.equal(report.scope, 'local_static_assessment');
  assert.equal(report.completedAt, observedAt);
  assert.ok(report.checks.every((item: any) => item.observedAt === observedAt)); assert.equal(check(report, 'selection').state, 'pass');
  const expected = process.platform === 'win32' ? 'unsupported' : 'pass';
  assert.equal(check(report, 'package.name').state, expected); assert.equal(check(report, 'package.version').state, expected);
  for (const id of ['runtime_execution', 'diagnostics', 'native_qualification', 'ownership', 'caller_use']) {
    assert.equal(check(report, id).state, 'not_checked');
  }
  for (const key of ['qualified', 'authorized', 'authorization', 'ready', 'status']) assert.equal(Object.hasOwn(report, key), false);
  assert.deepEqual(fs.readFileSync(f.pkg), before); assert.deepEqual(fs.readdirSync(f.root), ['package.json']);
});

test('metadata is exact, bounded, fatal UTF-8 and duplicate-key aware without exposing other fields', () => {
  const input = { context: { installation: '/chosen', manager: 'operator' }, packageJson: '/chosen/package.json', expectedVersion: '0.5.0' };
  const cases: [string | Buffer, string, string][] = [
    ['{"name":"other","version":"0.5.0"}', 'fail', 'pass'],
    ['{"name":"session-peer","version":"0.5.1"}', 'pass', 'fail'],
    ['{"name":"session-peer"}', 'pass', 'unknown'],
    ['{"name":"session-peer","version":5}', 'pass', 'unknown'],
    ['{"name":"session-peer","version":"0.5.0","version":"0.5.0"}', 'unknown', 'unknown'],
    ['{"name":"session-peer","version":"0.5.0","ver\\u0073ion":"0.5.0"}', 'unknown', 'unknown'],
    ['{"name":"session-peer","version":"0.5.0","private":{"token":"HIDDEN-METADATA"}}', 'pass', 'pass'],
    [Buffer.from([0x7b, 0xff, 0x7d]), 'unknown', 'unknown'],
    ['[]', 'unknown', 'unknown'], ['{broken', 'unknown', 'unknown']
  ];
  for (const [data, name, version] of cases) {
    const { io, calls } = fakeFile(typeof data === 'string' ? Buffer.from(data) : data);
    const report = evaluate(input, { fsImpl: io, platform: 'linux' });
    assert.equal(check(report, 'package.name').state, name);
    assert.equal(check(report, 'package.version').state, version);
    assert.equal(JSON.stringify(report).includes('HIDDEN-METADATA'), false); assert.deepEqual(calls.errors, []);
  }
});

test('invalid specifications fail before filesystem inspection and never echo input', t => {
  const f = fixture(t);
  const bad: unknown[] = [null, [], {}, { ...f.input, secret: 'DO-NOT-ECHO' },
    { ...f.input, context: { ...f.input.context, unknown: true } }, { ...f.input, expectedVersion: '' },
    { ...f.input, expectedVersion: 'a'.repeat(129) }, { ...f.input, files: Array(17).fill({ path: f.pkg }) },
    { ...f.input, files: [{ path: f.pkg, execute: true }] },
    { ...f.input, files: [{ path: f.pkg, baseline: { sha256: null, unknown: true } }] }];
  const noReads = new Proxy({}, { get() { assert.fail('invalid input touched filesystem'); } });
  for (const input of bad) assert.throws(() => evaluate(input, { fsImpl: noReads }), /invalid_assessment_input/);
  const valid = JSON.stringify(f.input);
  const exactInput = valid + ' '.repeat(LIMITS.inputBytes - Buffer.byteLength(valid));
  assert.deepEqual(parseInput(exactInput), f.input);
  assert.equal(f.invoke(exactInput).code, 0);
  assert.throws(() => parseInput(valid + ' '.repeat(LIMITS.inputBytes)), /invalid_assessment_input/);
  assert.throws(() => parseInput(valid.replace('"expectedVersion":', '"expectedVersion":"x","expectedVersion":')), /invalid_assessment_input/);
  assert.throws(() => parseInput(valid.replace('"expectedVersion":', '"expectedVersion":"x","expectedVer\\u0073ion":')), /invalid_assessment_input/);
  const result = f.invoke(JSON.stringify({ ...f.input, secret: 'DO-NOT-ECHO' }));
  assert.equal(result.code, 2); assert.deepEqual(JSON.parse(result.stdout), { error: 'invalid_assessment_input' });
  assert.equal(result.stderr, '');
});

test('baseline comparisons never inherit success and keep unrelated healthy measurements', t => {
  const f = fixture(t), healthy = join(f.root, 'healthy'), missing = join(f.root, 'missing');
  fs.writeFileSync(healthy, 'current file');
  const baseline = { sha256: digest('current file'), source: 'dated operator record', observedAt: '2026-10-01T00:00:00Z' };
  const files = [
    { path: healthy, baseline }, { path: healthy, baseline: { ...baseline, sha256: '0'.repeat(64) } },
    { path: healthy }, { path: healthy, baseline: null },
    { path: healthy, baseline: { sha256: null } }, { path: healthy, baseline: { sha256: baseline.sha256 } },
    { path: missing, baseline }, { path: healthy, baseline: { ...baseline, sha256: baseline.sha256.toUpperCase() } }
  ];
  const report = evaluate({ ...f.input, files });
  if (process.platform === 'win32') {
    assert.equal(check(report, 'files.0.digest').state, 'unsupported');
    assert.equal(check(report, 'files.0.comparison').state, 'unsupported'); return;
  }
  assert.deepEqual(files.map((_, i) => check(report, `files.${i}.comparison`).state), ['pass', 'fail', 'not_checked', 'unknown', 'unknown', 'unknown', 'unknown', 'pass']);
  assert.equal(check(report, 'files.2.digest').observed, baseline.sha256);
  assert.equal(check(report, 'files.6.digest').state, 'unknown');
  assert.equal(check(report, 'files.7.digest').state, 'pass');
  assert.deepEqual(check(report, 'files.0.comparison').baseline, { source: baseline.source, observedAt: baseline.observedAt, evidenceKind: 'operator_attestation' });
  assert.equal(check(report, 'ownership').state, 'not_checked'); assert.equal(check(report, 'caller_use').state, 'not_checked');
});

test('reader refuses special files and unsupported methods before opening or reading', () => {
  for (const kind of ['symlink', 'fifo', 'directory', 'device']) {
    const { io, calls } = fakeFile(Buffer.from('private'), { kind });
    assert.equal(read('/owned/file', { fsImpl: io, platform: 'linux' }).state, 'unsupported');
    assert.equal(calls.opens, 0); assert.equal(calls.reads, 0); assert.deepEqual(calls.errors, []);
  }
  for (const path of ['relative', 'C:\\owned\\file', '\\\\server\\share', '']) {
    const { io, calls } = fakeFile(Buffer.from('private'));
    assert.equal(read(path, { fsImpl: io, platform: 'linux' }).state, 'unsupported'); assert.equal(calls.opens, 0); assert.deepEqual(calls.errors, []);
  }
  const { io, calls } = fakeFile(Buffer.from('private'));
  assert.equal(read('/owned/file', { fsImpl: io, platform: 'win32' }).state, 'unsupported');
  assert.equal(read('/owned/file', { fsImpl: { ...io, constants: {} }, platform: 'linux' }).state, 'unsupported');
  assert.equal(calls.opens, 0);
});

test('reader enforces byte budgets with bounded allocations and closes its descriptor', () => {
  for (const extra of [0, 1]) {
    // The extra byte simulates growth after lstat; no huge allocation from claimed size.
    const { io, calls } = fakeFile(Buffer.alloc(LIMITS.fileBytes + extra, 65), { size: LIMITS.fileBytes });
    const result = read('/owned/file', { fsImpl: io, platform: 'linux' });
    assert.equal(result.state, extra ? 'unknown' : 'pass');
    if (extra) assert.equal(result.reason, 'file_byte_limit');
    if (!extra) { assert.ok(result.bytes); assert.equal(result.bytes.length, LIMITS.fileBytes); }
    assert.equal(calls.consumed, LIMITS.fileBytes + extra); assert.equal(calls.reads, 17);
    assert.ok(calls.maxBuffer <= LIMITS.fileBytes + 1); assert.ok(calls.maxRead <= LIMITS.chunkBytes);
    assert.equal(calls.buffers.size, 1); assert.deepEqual(calls.errors, []); assert.equal(calls.closes, 1);
    assert.equal(calls.flags, io.constants.O_RDONLY | io.constants.O_NOFOLLOW | io.constants.O_NONBLOCK);
  }
  const { io, calls } = fakeFile(Buffer.alloc(0), { size: LIMITS.fileBytes + 1 });
  const oversized = read('/owned/file', { fsImpl: io, platform: 'linux' });
  assert.equal(oversized.state, 'unknown'); assert.equal(oversized.reason, 'file_byte_limit');
  assert.equal(calls.opens, 0); assert.equal(calls.reads, 0); assert.deepEqual(calls.errors, []);
});

test('replacement, observable changes and I/O failures produce unknown and close owned fds', () => {
  for (const options of [{ changed: 'replace' }, { changed: 'time' }, { fail: 'fstat' }, { fail: 'read' }, { fail: 'open' }, { fail: 'lstat' }]) {
    const { io, calls } = fakeFile(Buffer.from('abc'), options);
    const result = read('/owned/file', { fsImpl: io, platform: 'linux' });
    assert.equal(result.state, 'unknown'); assert.equal(result.reason, options.changed ? 'file_changed' : 'file_read_unavailable'); assert.equal(calls.closes, options.fail === 'open' || options.fail === 'lstat' ? 0 : 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE-FAILURE'), false); assert.deepEqual(calls.errors, []);
  }
  const { io, calls } = fakeFile(Buffer.from('abc'));
  io.closeSync = () => { calls.closes++; throw new Error('PRIVATE-CLOSE'); };
  const closeResult = read('/owned/file', { fsImpl: io, platform: 'linux' });
  assert.equal(closeResult.state, 'unknown'); assert.equal(closeResult.reason, 'file_close_unverified'); assert.equal(calls.closes, 1); assert.deepEqual(calls.errors, []);
});

test('CLI handles bounds, options and import without consuming stdin or executing selected content', t => {
  const f = fixture(t), marker = join(f.root, 'must-not-exist'), selected = join(f.root, 'selected.js');
  fs.writeFileSync(selected, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`);
  const before = fs.readdirSync(f.root), bytes = fs.readFileSync(selected);
  const result = f.invoke(JSON.stringify({ ...f.input, expectedVersion: 'mismatch', files: [{ path: selected }] }));
  assert.equal(result.code, 0); assert.equal(check(JSON.parse(result.stdout), 'package.version').state, process.platform === 'win32' ? 'unsupported' : 'fail');
  assert.equal(fs.existsSync(marker), false); assert.deepEqual(fs.readFileSync(selected), bytes); assert.deepEqual(fs.readdirSync(f.root), before);
  for (const [text, args] of [[Buffer.from([0xff]), []], [' '.repeat(LIMITS.inputBytes + 1), []], ['', ['--host', 'NEVER-CONNECT']], ['', ['--unknown']]] as [string | Buffer, string[]][]) {
    const failure = f.invoke(text, args); assert.equal(failure.code, 2); assert.deepEqual(JSON.parse(failure.stdout), { error: 'invalid_assessment_input' }); assert.equal(failure.stderr, '');
  }
  const help = f.invoke('', ['--help']); assert.equal(help.code, 0); assert.equal(help.stderr, ''); assert.match(help.stdout, /static/i);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)}); console.log('imported')`], { input: 'INVALID-STDIN', encoding: 'utf8', timeout: 10000 });
  assert.ifError(imported.error); assert.equal(imported.status, 0); assert.equal(imported.stdout.trim(), 'imported'); assert.equal(imported.stderr, '');
});


test('stdin bounds actual reads and one-buffer storage even with one-byte short reads', () => {
  for (const short of [false, true]) for (const overflow of [false, true]) {
    const bytes = Buffer.alloc(LIMITS.inputBytes + (overflow ? 100000 : 0), 32);
    let consumed = 0, reads = 0;
    const buffers = new Set<Buffer>(), errors: string[] = [];
    const io = {
      readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null) {
        if (fd !== 0 || position !== null || length > LIMITS.chunkBytes || offset + length > buffer.length) errors.push('invalid read');
        reads++; buffers.add(buffer);
        const count = Math.min(short ? 1 : length, bytes.length - consumed);
        bytes.copy(buffer, offset, consumed, consumed + count); consumed += count; return count;
      },
      closeSync() { errors.push('closed unowned stdin'); }
    };
    if (overflow) assert.throws(() => stdin({ fsImpl: io }), /invalid_assessment_input/);
    else assert.equal(stdin({ fsImpl: io }), bytes.toString('utf8'));
    assert.equal(consumed, LIMITS.inputBytes + (overflow ? 1 : 0));
    assert.equal(reads, short ? LIMITS.inputBytes + 1 : 2);
    assert.equal(buffers.size, 1); assert.ok([...buffers].reduce((sum, b) => sum + b.length, 0) <= LIMITS.inputBytes + 1);
    assert.deepEqual(errors, []);
  }
  let consumed = false, closed = false;
  assert.throws(() => stdin({ fsImpl: {
    readSync(_fd: number, buffer: Buffer) { if (consumed) return 0; consumed = true; buffer[0] = 255; return 1; },
    closeSync() { closed = true; }
  } }), error => error instanceof TypeError && (error as NodeJS.ErrnoException).code === 'ERR_ENCODING_INVALID_ENCODED_DATA');
  assert.equal(closed, false);
  assert.throws(() => stdin({ fsImpl: { readSync() { throw new Error('PRIVATE-STDIN-ERROR'); }, closeSync() { closed = true; } } }),
    error => error instanceof Error && error.message === 'input_unavailable' && (error as NodeJS.ErrnoException).code === 'INPUT_UNAVAILABLE');
  assert.equal(closed, false);
});

test('file one-byte short reads retain one bounded buffer and preserve measured bytes', () => {
  const bytes = Buffer.alloc(4096, 65), { io, calls } = fakeFile(bytes);
  const original = io.readSync;
  io.readSync = (fd, buffer, offset, length, position) => {
    if (length > LIMITS.chunkBytes) calls.errors.push('requested read exceeds chunk limit');
    return original(fd, buffer, offset, Math.min(1, length), position);
  };
  const result = read('/owned/file', { fsImpl: io, platform: 'linux' });
  assert.equal(result.state, 'pass'); assert.deepEqual(result.bytes, bytes); assert.ok(result.bytes);
  assert.ok(result.bytes.buffer.byteLength <= bytes.length + 1);
  assert.equal(calls.reads, bytes.length + 1); assert.equal(calls.buffers.size, 1);
  assert.ok([...calls.buffers].reduce((sum, b) => sum + b.length, 0) <= bytes.length + 1);
  assert.ok(calls.maxRead <= LIMITS.chunkBytes); assert.deepEqual(calls.errors, []); assert.equal(calls.closes, 1);
});

test('large inode identity requests bigint stats and detects values that alias as Number', () => {
  for (const replacement of [false, true]) {
    const { io, calls } = fakeFile(Buffer.from('abc'));
    let observations = 0;
    const requested: (boolean | undefined)[] = [];
    const stat = (_: unknown, options?: { bigint?: boolean }) => {
      requested.push(options?.bigint); observations++;
      const inode = replacement && observations > 2 ? 9007199254740993n : 9007199254740992n;
      if (options?.bigint) return { dev: 1n, ino: inode, size: 3n, mtimeNs: 1n, ctimeNs: 1n, isFile: () => true, isSymbolicLink: () => false };
      // The fallback deliberately aliases the two inode values, as Number Stats can.
      return { dev: 1, ino: Number(inode), size: 3, mtimeMs: 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false };
    };
    const result = read('/owned/file', { fsImpl: { ...io, lstatSync: stat, fstatSync(fd: number, options: any) { if (fd !== 91) calls.errors.push('bigint fstat descriptor'); return stat(fd, options); } }, platform: 'linux' });
    assert.equal(result.state, replacement ? 'unknown' : 'pass');
    if (replacement) assert.equal(result.reason, 'file_changed');
    assert.ok(requested.length >= 4); assert.ok(requested.every(value => value === true));
    assert.deepEqual(calls.errors, []); assert.equal(calls.closes, 1);
  }
});

test('CLI works through a symlink entry with default and preserved main resolution', t => {
  const f = fixture(t), link = join(f.root, 'qualification.mjs');
  try { fs.symlinkSync(script, link, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('symlink creation permission denied'); return; }
    throw error;
  }
  for (const flags of [[], ['--preserve-symlinks-main']]) {
    const child = spawnSync(process.execPath, [...flags, link], { input: JSON.stringify(f.input), encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error); assert.equal(child.status, 0); assert.equal(child.stderr, '');
    assert.equal(JSON.parse(child.stdout).scope, 'local_static_assessment');
  }
});

test('CLI reports stdin I/O failure with a fixed sanitized token', () => {
  const code = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    process.argv = [process.execPath, ${JSON.stringify(script)}];
    const original = fs.readSync; fs.readSync = (fd, ...args) => { if (fd === 0) throw new Error('PRIVATE-STDIN-ERROR'); return original(fd, ...args); }; syncBuiltinESMExports();
    await import(${JSON.stringify(pathToFileURL(script).href)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(child.error); assert.equal(child.status, 2);
  assert.deepEqual(JSON.parse(child.stdout), { error: 'input_unavailable' }); assert.equal(child.stderr, '');
});

test('CLI keeps bounded raw specifications with expansive or deeply nested malformed baselines as per-file unknown', t => {
  const f = fixture(t);
  const prefix = JSON.stringify({ ...f.input, files: [{ path: f.pkg, baseline: 'BASELINE' }] });
  const expansive = prefix.replace('"BASELINE"', '[' + Array(11000).fill('1e21').join(',') + ']');
  assert.ok(Buffer.byteLength(expansive) < LIMITS.inputBytes);
  assert.ok(Buffer.byteLength(JSON.stringify(JSON.parse(expansive))) > LIMITS.inputBytes);
  const deep = prefix.replace('"BASELINE"', '['.repeat(12000) + '0' + ']'.repeat(12000));
  assert.ok(Buffer.byteLength(deep) < LIMITS.inputBytes);
  for (const raw of [expansive, deep]) {
    const result = f.invoke(raw); assert.equal(result.code, 0); assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(check(report, 'files.0.comparison').state, 'unknown');
    assert.equal(check(report, 'files.0.comparison').reason, 'baseline_evidence_incomplete');
    assert.equal(check(report, 'files.0.digest').state, process.platform === 'win32' ? 'unsupported' : 'pass');
  }
});
