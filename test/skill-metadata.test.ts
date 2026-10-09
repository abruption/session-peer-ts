import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { closeSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import childProcess, { execFileSync } from 'node:child_process';
import { inspectSkill, SKILL_METADATA_LIMIT, validateSkillMetadata } from '../dist/skill-metadata.js';
const fields = { version: '0.1.0', 'runtime-implementation': 'typescript', 'runtime-min-version': '0.1.0',
  'runtime-full-version': '0.1.0', 'runtime-capability-policy': 'probe-help' };
function fixtureText(values: Record<string, string> = fields, name = 'session-peer-ts') {
  return `---\nname: ${name}\ndescription: local only\nmetadata:\n${Object.entries(values).map(([key, value]) => `  ${key}: "${value}"`).join('\n')}\n---\nDo not execute this body or fetch https://fixture.invalid\n`;
}
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-skill-metadata-'))), file = join(root, 'SKILL.md');
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(file, fixtureText());
  return { root, file };
}
const compatible = { status: 'compatible', code: 'skill_contract_compatible', verification: 'metadata_only' };
const incompatible = { status: 'incompatible', code: 'skill_contract_mismatch', verification: 'metadata_only' };
const missing = { status: 'unknown', code: 'skill_metadata_missing' };
const unreadable = { status: 'unknown', code: 'skill_metadata_unreadable' };
function withoutPath(value: ReturnType<typeof inspectSkill>) { const { path: _path, ...rest } = value; return rest; }

test('finite runtime/profile matrix preserves public legacy and contains successor source proposal', () => {
  const legacy = fixtureText(), successor = fixtureText({ ...fields, version: '0.2.0', 'runtime-full-version': '0.3.2' });
  assert.deepEqual(validateSkillMetadata(legacy), compatible); // Current VERSION0.3.2, no release bump.
  assert.deepEqual(validateSkillMetadata(successor), incompatible);
  for (const text of [legacy, successor]) {
    assert.deepEqual(validateSkillMetadata(text, '0.3.3'), compatible); // Proposed, not shipped guard fixture.
    for (const runtime of ['0.0.9', '0.3.4', '0.4.0', '1.0.0']) assert.deepEqual(validateSkillMetadata(text, runtime), incompatible);
    for (const runtime of [undefined, null, {}, 0, '', '0.3.3-preview.1', '00.3.3']) {
      if (runtime === undefined) continue; // Omitted internal argument intentionally uses own VERSION.
      assert.deepEqual(validateSkillMetadata(text, runtime), missing);
    }
  }
});

test('each unsupported well-formed scalar differs from missing, duplicated or malformed evidence', () => {
  for (const key of Object.keys(fields)) {
    assert.deepEqual(validateSkillMetadata(fixtureText({ ...fields, [key]: 'unsupported' })), incompatible, key);
    const omitted = { ...fields } as Record<string, string>; delete omitted[key];
    assert.deepEqual(validateSkillMetadata(fixtureText(omitted)), missing, key);
    const line = `  ${key}: "${fields[key as keyof typeof fields]}"`;
    for (const value of [line, `  ${key}: "other"`]) assert.deepEqual(validateSkillMetadata(fixtureText().replace(line, `${line}\n${value}`)), missing, key);
    for (const value of ['[]', '{}', '*alias', '!tag value', '"unterminated', '"escaped\\nvalue"', '', '|', 'value: nested', '""']) {
      assert.deepEqual(validateSkillMetadata(fixtureText().replace(line, `  ${key}: ${value}`)), missing, `${key}:${value}`);
    }
  }
  assert.deepEqual(validateSkillMetadata(fixtureText(fields, 'session-peer')), incompatible);
  for (const text of [fixtureText().replace('name: session-peer-ts\n', ''), fixtureText().replace('name: session-peer-ts', 'name: session-peer-ts\nname: session-peer-ts'),
    fixtureText().replace('metadata:', 'metadata: []'), fixtureText().replace('metadata:', 'metadata:\nmetadata:'),
    fixtureText().replace('  version:', '    version:'), fixtureText().replace('  version:', '\tversion:'), 'no frontmatter', '---\n---\n']) {
    assert.deepEqual(validateSkillMetadata(text), missing);
  }
});

test('limited scalar grammar accepts comments, quoting, CRLF and ignores unrelated root fields', () => {
  const legacy = fixtureText();
  assert.deepEqual(validateSkillMetadata(legacy.replace('metadata:', 'version: ignored-root-value\nmetadata: # section').replace('"0.1.0"', '0.1.0 # version')), compatible);
  assert.deepEqual(validateSkillMetadata(legacy.replaceAll('"', "'").replaceAll('\n', '\r\n')), compatible);
  assert.deepEqual(validateSkillMetadata('\uFEFF' + legacy), missing);
  assert.deepEqual(validateSkillMetadata(legacy.replace('\nmetadata:', '\rmetadata:')), missing);
  assert.deepEqual(validateSkillMetadata(legacy + '\u0000'), missing);
});

test('reader counts whole-file UTF8 bytes and accepts exact limit, not overflow or invalid UTF8', t => {
  const { file } = fixture(t); const bytes = Buffer.from(fixtureText());
  assert.deepEqual(validateSkillMetadata(fixtureText() + 'é'.repeat(SKILL_METADATA_LIMIT / 2)), unreadable);
  writeFileSync(file, Buffer.concat([bytes, Buffer.alloc(SKILL_METADATA_LIMIT - bytes.length, 0x78)]));
  assert.deepEqual(withoutPath(inspectSkill(file)), compatible);
  writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from('x')]));
  assert.deepEqual(withoutPath(inspectSkill(file)), unreadable);
  writeFileSync(file, Buffer.concat([bytes, Buffer.from([0xc3, 0x28])]));
  assert.deepEqual(withoutPath(inspectSkill(file)), unreadable);
  writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]));
  assert.deepEqual(withoutPath(inspectSkill(file)), missing);
});

test('reader rejects directories and POSIX FIFOs without reading, supports managed symlink entrypoints', t => {
  const { root, file } = fixture(t), directory = join(root, 'directory'); mkdirSync(directory);
  assert.deepEqual(withoutPath(inspectSkill(directory)), unreadable);
  const absent = inspectSkill(join(root, 'absent')); assert.equal(absent.status, 'missing'); assert.equal('verification' in absent, false);
  if (process.platform !== 'win32') {
    const fifo = join(root, 'fifo'); execFileSync('mkfifo', [fifo]);
    assert.deepEqual(withoutPath(inspectSkill(fifo)), unreadable);
    const alias = join(root, 'alias'); symlinkSync(file, alias);
    assert.deepEqual(withoutPath(inspectSkill(alias)), compatible); assert.equal(inspectSkill(alias).path, file);
  }
});

test('reader verifies descriptor/path stability for growth, truncation, replacement and same-size mutation', async t => {
  for (const mutation of ['growth', 'truncation', ...(process.platform === 'win32' ? [] : ['replacement']), 'same-size'] as const) {
    await t.test(mutation, st => {
      const { file } = fixture(st), originalRead = fs.readSync;
      let changed = false;
      st.mock.method(fs, 'readSync', ((fd: any, ...args: any[]) => {
        const count = (originalRead as any)(fd, ...args);
        if (!changed) {
          changed = true;
          if (mutation === 'growth') fs.appendFileSync(file, 'x'.repeat(SKILL_METADATA_LIMIT));
          else if (mutation === 'truncation') fs.truncateSync(file, 0);
          else if (mutation === 'replacement') { fs.unlinkSync(file); writeFileSync(file, fixtureText()); }
          else { const text = fixtureText(); writeFileSync(file, text.replace('local only', 'other only')); }
        }
        return count;
      }) as typeof fs.readSync); syncBuiltinESMExports();
      assert.deepEqual(withoutPath(inspectSkill(file)), unreadable);
    });
  }
});

test('reader rechecks path and descriptor after EOF and never accepts a replaced installed alias', { skip: process.platform === 'win32' }, t => {
  const { root, file } = fixture(t), alias = join(root, 'alias'), second = join(root, 'second');
  writeFileSync(second, fixtureText()); symlinkSync(file, alias);
  const originalRead = fs.readSync; let changed = false;
  t.mock.method(fs, 'readSync', ((fd: any, ...args: any[]) => {
    const count = (originalRead as any)(fd, ...args);
    if (!count && !changed) { changed = true; fs.unlinkSync(alias); symlinkSync(second, alias); }
    return count;
  }) as typeof fs.readSync); syncBuiltinESMExports();
  assert.deepEqual(withoutPath(inspectSkill(alias)), unreadable); assert.equal(changed, true);
});

test('each success/error path closes exactly its opened descriptor with bounded reads and no execution', t => {
  const { file } = fixture(t), originalOpen = fs.openSync, originalClose = fs.closeSync, originalRead = fs.readSync;
  let opened: number[] = [], closed: number[] = [], largestRequest = 0, injectReadError = false;
  t.mock.method(fs, 'openSync', ((...args: any[]) => { const fd = (originalOpen as any)(...args); opened.push(fd); return fd; }) as typeof fs.openSync);
  t.mock.method(fs, 'closeSync', (fd: number) => { closed.push(fd); originalClose(fd); });
  t.mock.method(fs, 'readSync', ((fd: any, bytes: any, offset: any, length: any, position: any) => {
    largestRequest = Math.max(largestRequest, length); assert.ok(bytes.length <= SKILL_METADATA_LIMIT + 1);
    if (injectReadError) throw Object.assign(new Error('private detail'), { code: 'EIO' });
    return (originalRead as any)(fd, bytes, offset, length, position);
  }) as typeof fs.readSync); syncBuiltinESMExports();
  const before = readFileSync(file); opened = []; closed = [];
  assert.deepEqual(withoutPath(inspectSkill(file)), compatible); assert.deepEqual(closed, opened); assert.equal(opened.length, 1);
  injectReadError = true; opened = []; closed = [];
  const failed = inspectSkill(file); assert.deepEqual(withoutPath(failed), unreadable); assert.deepEqual(closed, opened); assert.equal(opened.length, 1);
  assert.ok(largestRequest <= SKILL_METADATA_LIMIT + 1); injectReadError = false;
  assert.deepEqual(readFileSync(file), before); assert.equal(JSON.stringify(failed).includes('private detail'), false);
  // Metadata cannot cause executable, network, instruction or reference calls:
  // inspection only calls the filesystem reader and pure validator.
});

test('raw open permission errors retain their envelope and FIFO replacement cannot reach read', t => {
  const { file } = fixture(t), originalOpen = fs.openSync; let code = 'EACCES';
  t.mock.method(fs, 'openSync', (() => { throw Object.assign(new Error('private detail'), { code }); }) as typeof fs.openSync); syncBuiltinESMExports();
  for (code of ['EACCES', 'EPERM']) assert.deepEqual(withoutPath(inspectSkill(file)), { status: 'permission_denied', code: 'permission_denied' });
  for (code of ['ENOENT', 'ENOTDIR']) assert.deepEqual(withoutPath(inspectSkill(file)), unreadable); // Disappearance after stat is conflicting read evidence.
  code = 'EIO'; assert.deepEqual(withoutPath(inspectSkill(file)), unreadable);
  t.mock.restoreAll(); syncBuiltinESMExports();
  if (process.platform !== 'win32') {
    t.mock.method(fs, 'openSync', ((path: any, ...args: any[]) => { fs.unlinkSync(file); execFileSync('mkfifo', [file]); return (originalOpen as any)(path, ...args); }) as typeof fs.openSync); syncBuiltinESMExports();
    assert.deepEqual(withoutPath(inspectSkill(file)), unreadable);
  }
});


test('inspection does not execute runtimes, fetch references, or write installed state', t => {
  const { file } = fixture(t), before = readFileSync(file); let calls = 0;
  const deny = () => { calls++; throw new Error('forbidden side effect'); };
  for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'] as const) t.mock.method(childProcess, method, deny);
  for (const method of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync'] as const) t.mock.method(fs, method, deny);
  t.mock.method(globalThis, 'fetch', deny); syncBuiltinESMExports();
  assert.deepEqual(withoutPath(inspectSkill(file)), compatible);
  assert.equal(calls, 0); assert.deepEqual(readFileSync(file), before);
});

test('post-EOF growth is conflicting evidence and early descriptor rejection still closes it', t => {
  const { file } = fixture(t), read = fs.readSync, close = fs.closeSync, stat = fs.fstatSync;
  let closed = 0, mutate = true;
  t.mock.method(fs, 'closeSync', (fd: number) => { closed++; close(fd); });
  t.mock.method(fs, 'readSync', ((fd: any, ...args: any[]) => {
    const count = (read as any)(fd, ...args);
    if (!count && mutate) { mutate = false; fs.appendFileSync(file, 'x'); }
    return count;
  }) as typeof fs.readSync); syncBuiltinESMExports();
  assert.deepEqual(withoutPath(inspectSkill(file)), unreadable); assert.equal(closed, 1);
  t.mock.restoreAll(); syncBuiltinESMExports(); closed = 0;
  t.mock.method(fs, 'closeSync', (fd: number) => { closed++; close(fd); });
  t.mock.method(fs, 'fstatSync', ((fd: any, ...args: any[]) => {
    const info = (stat as any)(fd, ...args); return { ...info, isFile: () => false };
  }) as typeof fs.fstatSync); syncBuiltinESMExports();
  assert.deepEqual(withoutPath(inspectSkill(file)), unreadable); assert.equal(closed, 1);
});
