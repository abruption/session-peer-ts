// Private Windows storage guard (#131): owner SID, DACL and reparse fixtures
// run everywhere; native cases (real ACLs, junctions) run only on win32.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { type SpawnSyncReturns } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { HandoffLedger } from '../dist/handoff-ledger.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWindowsPrivateDirectory, inspectWindowsStorage, verifyWindowsPrivate, windowsAncestors, windowsStorageFailure,
  type WindowsAce, type WindowsStorageEntry, type WindowsStorageReport } from '../dist/windows.js';

const USER = 'S-1-5-21-1111111111-2222222222-3333333333-1001', ADMINS = 'S-1-5-32-544', SYSTEM = 'S-1-5-18';
const own = (extra: Partial<WindowsAce> = {}): WindowsAce => ({ sid: USER, allow: true, rights: 2032127, inherited: false, inherits: true, ...extra });
function report(leaf: Partial<WindowsStorageEntry>, ancestors: Partial<WindowsStorageEntry>[] = []): WindowsStorageReport {
  const paths = ['C:\\', 'C:\\Users', 'C:\\Users\\fixture', 'C:\\Users\\fixture\\ledger'];
  const parents = paths.slice(0, -1).map((path, index) => ({ path, exists: true, directory: true, reparse: false, ...ancestors[index] }));
  return { user: USER, entries: [...parents, { path: paths.at(-1)!, exists: true, directory: true, reparse: false,
    owner: USER, protected: true, nullDacl: false, rules: [own()], ...leaf }] };
}

test('Windows private storage paths are local drive paths decomposed to every component', () => {
  assert.deepEqual(windowsAncestors('C:\\Users\\fixture\\ledger'), ['C:\\', 'C:\\Users', 'C:\\Users\\fixture', 'C:\\Users\\fixture\\ledger']);
  assert.deepEqual(windowsAncestors('d:\\a\\\\b\\'), ['d:\\', 'd:\\a', 'd:\\a\\b']);
  for (const path of ['\\\\server\\share\\ledger', '\\\\?\\C:\\ledger', '\\\\.\\pipe\\x', 'ledger', 'C:ledger', '/tmp/ledger', 'C:\\a\\..\\b', 'C:\\a\nb', 'C:\\a\0b']) {
    assert.equal(windowsAncestors(path), undefined, JSON.stringify(path));
  }
});

test('Windows private storage requires owner SID, an owner-only protected DACL and no reparse point', () => {
  assert.equal(windowsStorageFailure(report({}), 'directory'), undefined);
  // Deny ACEs never widen access.
  assert.equal(windowsStorageFailure(report({ rules: [own(), { ...own(), sid: 'S-1-1-0', allow: false }] }), 'directory'), undefined);
  // Files inherit the private directory's owner-only ACE.
  assert.equal(windowsStorageFailure(report({ directory: false, protected: false, rules: [own({ inherited: true, inherits: false })] }), 'file'), undefined);
  const cases: [WindowsStorageReport, 'directory' | 'file', string][] = [
    [report({ reparse: true }), 'directory', 'reparse_point'],
    [report({}, [{}, { reparse: true }]), 'directory', 'reparse_point'],
    [report({}, [{}, {}, { reparse: true }]), 'file', 'reparse_point'],
    [report({ exists: false }), 'directory', 'missing'],
    [report({}, [{}, { exists: false }]), 'directory', 'missing'],
    [report({ directory: false }), 'directory', 'not_directory'],
    [report({}), 'file', 'not_file'],
    [report({ owner: ADMINS }), 'directory', 'owner_mismatch'],
    [report({ nullDacl: true, rules: [] }), 'directory', 'acl_missing'],
    [report({ rules: [own(), own({ sid: 'S-1-1-0' })] }), 'directory', 'acl_broad'],
    [report({ rules: [own(), own({ sid: 'S-1-5-11', inherits: true })] }), 'directory', 'acl_broad'],
    [report({ rules: [own(), own({ sid: 'S-1-5-32-545', inherited: true })] }), 'directory', 'acl_broad'],
    [report({ rules: [own(), own({ sid: SYSTEM })] }), 'directory', 'acl_broad'],
    [report({ rules: [own(), own({ sid: ADMINS, inherited: true })] }), 'directory', 'acl_broad'],
    [report({ directory: false, rules: [own(), own({ sid: 'S-1-3-0', inherited: true })] }), 'file', 'acl_broad'],
    [report({ protected: false }), 'directory', 'acl_inherited'],
    [report({ rules: [own({ inherited: true })] }), 'directory', 'acl_inherited'],
    [{ user: USER, entries: [] }, 'directory', 'inspection_failed'],
  ];
  for (const [value, kind, reason] of cases) assert.equal(windowsStorageFailure(value, kind), reason, JSON.stringify(value.entries.at(-1)));
  let calls = 0;
  verifyWindowsPrivate('C:\\Users\\fixture\\ledger', 'directory', () => { calls++; return report({}); });
  assert.throws(() => verifyWindowsPrivate('C:\\Users\\fixture\\ledger', 'directory', () => report({ owner: ADMINS })),
    (error: Error & { code?: string }) => error.code === 'handoff_storage_untrusted' && !error.message.includes(ADMINS));
  assert.equal(calls, 1);
});

function windows(t: TestContext) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); Object.defineProperty(process, 'platform', platform); });
}
const result = (stdout: string, fields: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> =>
  ({ pid: 9, status: 0, signal: null, output: [], stdout, stderr: 'private-native-output', ...fields });

test('Windows storage inspection is read-only, path-encoded and strictly parsed', t => {
  windows(t);
  const path = 'C:\\Users\\fixture\\private ledger', value = report({});
  value.entries = windowsAncestors(path)!.map((entry, index, all) => ({ ...value.entries[Math.min(index, value.entries.length - 1)]!, path: entry,
    ...(index === all.length - 1 ? {} : { owner: undefined, protected: undefined, nullDacl: undefined, rules: undefined }) }));
  value.entries = JSON.parse(JSON.stringify(value.entries));
  let done = result(JSON.stringify(value));
  const calls: { args: readonly string[]; input: string }[] = [];
  t.mock.method(childProcess, 'spawnSync', (_binary: string, args: readonly string[], options: { input: string }) => { calls.push({ args, input: options.input }); return done; });
  syncBuiltinESMExports();
  assert.deepEqual(inspectWindowsStorage(path), value);
  assert.equal(calls[0]!.args.join(' ').includes('private ledger'), false);
  assert.equal(calls[0]!.input.includes('private ledger'), false, 'the path travels base64-encoded only');
  assert.doesNotMatch(calls[0]!.input, /Set-Acl|SetAccessControl|icacls|takeown/i);
  const broken: unknown[] = [
    { ...value, user: 'fixture' }, { ...value, entries: value.entries.slice(1) },
    { ...value, entries: value.entries.map((entry, index) => index === 1 ? { ...entry, path: 'C:\\other' } : entry) },
    { ...value, entries: value.entries.map((entry, index) => index === value.entries.length - 1 ? { ...entry, rules: [{ sid: USER }] } : entry) },
    { ...value, entries: value.entries.map((entry, index) => index === value.entries.length - 1 ? { ...entry, owner: 'Everyone' } : entry) },
  ];
  for (const item of broken) {
    done = result(JSON.stringify(item));
    assert.throws(() => inspectWindowsStorage(path), /windows_owner_inspection_failed/);
  }
  for (const fields of [{ status: 1 }, { error: Object.assign(new Error('private-timeout'), { code: 'ETIMEDOUT' }) }]) {
    done = result(JSON.stringify(value), fields);
    assert.throws(() => inspectWindowsStorage(path), (error: Error) => error.message === 'windows_owner_inspection_failed');
  }
  done = result('not json'); assert.throws(() => inspectWindowsStorage(path), /windows_owner_inspection_failed/);
  const before = calls.length;
  assert.throws(() => inspectWindowsStorage('\\\\server\\share\\ledger'), /handoff_storage_untrusted/);
  assert.equal(calls.length, before, 'an unsupported path never reaches PowerShell');
});

test('Windows private directory creation only creates a new protected leaf', t => {
  windows(t);
  let done = result(''), parent = report({}, []), leaf = report({});
  parent.entries = parent.entries.slice(0, -1);
  const inputs: string[] = [], inspect = (path: string) => path.endsWith('ledger') ? leaf : parent;
  t.mock.method(childProcess, 'spawnSync', (_binary: string, _args: readonly string[], options: { input: string }) => { inputs.push(options.input); return done; });
  syncBuiltinESMExports();
  createWindowsPrivateDirectory('C:\\Users\\fixture\\ledger', inspect);
  assert.match(inputs[0]!, /SetAccessRuleProtection\(\$true, \$false\)/); assert.match(inputs[0]!, /SetOwner\(\$user\)/);
  assert.doesNotMatch(inputs[0]!, /Everyone|Users|icacls|Set-Acl|SetAccessControl/);
  done = result('', { status: 3 }); assert.throws(() => createWindowsPrivateDirectory('C:\\Users\\fixture\\ledger', inspect), /handoff_ledger_exists/);
  done = result('', { status: 1 }); assert.throws(() => createWindowsPrivateDirectory('C:\\Users\\fixture\\ledger', inspect), /handoff_storage_untrusted/);
  // A created leaf that does not verify (e.g. swapped for a junction) is refused.
  done = result(''); leaf = report({ reparse: true });
  assert.throws(() => createWindowsPrivateDirectory('C:\\Users\\fixture\\ledger', inspect), /handoff_storage_untrusted/);
  const before = inputs.length;
  parent = report({}, [{}, { reparse: true }]); parent.entries = parent.entries.slice(0, -1);
  assert.throws(() => createWindowsPrivateDirectory('C:\\Users\\fixture\\ledger', inspect), /handoff_storage_untrusted/);
  for (const path of ['C:\\', '\\\\server\\share\\x', 'relative']) assert.throws(() => createWindowsPrivateDirectory(path, inspect), /handoff_storage_untrusted/);
  assert.equal(inputs.length, before, 'a reparse parent or unsupported path never creates anything');
});

const native = { skip: process.platform !== 'win32' };
test('native win32: a created private directory and its files pass; inherited ACLs and junctions fail', native, t => {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-wstore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = join(root, 'ledger');
  // An ordinary temp directory inherits its parent's broader ACEs.
  assert.notEqual(windowsStorageFailure(inspectWindowsStorage(root), 'directory'), undefined);
  createWindowsPrivateDirectory(ledger);
  assert.equal(windowsStorageFailure(inspectWindowsStorage(ledger), 'directory'), undefined);
  writeFileSync(join(ledger, 'ledger.json'), '{}');
  assert.equal(windowsStorageFailure(inspectWindowsStorage(join(ledger, 'ledger.json')), 'file'), undefined);
  assert.throws(() => createWindowsPrivateDirectory(ledger), /handoff_ledger_exists/);
  const link = join(root, 'link');
  symlinkSync(ledger, link, 'junction');
  assert.equal(windowsStorageFailure(inspectWindowsStorage(link), 'directory'), 'reparse_point');
  assert.equal(windowsStorageFailure(inspectWindowsStorage(join(link, 'ledger.json')), 'file'), 'reparse_point');
  assert.throws(() => createWindowsPrivateDirectory(join(link, 'nested')), /handoff_storage_untrusted/);
});

test('Windows handoff ledger storage stays unsupported and creates nothing', t => {
  windows(t);
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-wledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'ledger'), ledger = new HandoffLedger(path);
  let spawned = 0;
  t.mock.method(childProcess, 'spawnSync', () => { spawned++; return result(''); });
  syncBuiltinESMExports();
  assert.throws(() => ledger.init(), /handoff_storage_unsupported/);
  assert.equal(existsSync(path), false);
  const binding = { agent: 'codex' as const, destination: 'local', target: 'thread', generation: null, payloadDigest: 'a'.repeat(64) };
  assert.throws(() => ledger.prepare(binding), /handoff_storage_unsupported|handoff_history_unavailable/);
  assert.equal(existsSync(path), false); assert.equal(spawned, 0);
});
