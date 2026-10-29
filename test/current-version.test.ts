import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentVersions, planCurrentVersions } from '../scripts/current-version.mjs';

type Inventory = { file: string; templates: { line: string; occurrences: number }[] }[];
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const inventory: Inventory = JSON.parse(read('scripts/current-version-fields.json'));
const version: string = JSON.parse(read('package.json')).version;
const files = () => new Map(inventory.map(entry => [entry.file, read(entry.file)]));
const immutable = ['VALIDATION.md', 'RELEASING.md', 'docs/design/typescript-skill-compatibility.md',
  'src/skill-metadata.ts', 'src/native-profiles.ts', 'test/fixtures/python-reference.pin.json'];
const sentinel = '\nHistorical release 0.5.1; Python 1.1.0; skill 0.3.0; Codex 0.162.1.\n' +
  'sha256 00c6fc343fdbeb8f6dc1b1ee1b730f04cef71bbfb08205a7be3559202f1d8804\n';

function fixture(t: { after: (fn: () => void) => void }) {
  const path = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-current-version-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), text);
  };
  for (const [file, text] of files()) write(file, text + sentinel);
  for (const file of immutable) write(file, read(file));
  write('scripts/current-version-fields.json', JSON.stringify(inventory));
  const pkg = JSON.parse(read('package.json'));
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(Number.isSafeInteger(patch), 'synthetic fixture expects a stable source version');
  pkg.version = `${major}.${minor}.${patch + 1}`;
  const lock = JSON.parse(read('package-lock.json'));
  lock.version = lock.packages[''].version = pkg.version;
  write('package.json', JSON.stringify(pkg));
  write('package-lock.json', JSON.stringify(lock));
  const get = (file: string) => readFileSync(join(path, file), 'utf8');
  return { path, write, get, version: pkg.version as string };
}

test('current inventory checks without writes and is idempotent at package version', () => {
  assert.deepEqual(planCurrentVersions(version, files(), inventory), []);
  assert.deepEqual(currentVersions(root, '--check'), []);
  const crlf = new Map([...files()].map(([file, text]) => [file, text.replace(/\r?\n/g, '\r\n')]));
  assert.deepEqual(planCurrentVersions(version, crlf, inventory), [], 'CRLF checkout remains unchanged');
});

test('synthetic patch update changes only explicit slots and preserves history and pins', t => {
  const f = fixture(t);
  const paths = [...inventory.map(entry => entry.file), ...immutable, 'package.json', 'package-lock.json'];
  const before = new Map(paths.map(file => [file, f.get(file)]));
  assert.throws(() => currentVersions(f.path, '--check'), /current-version drift/);
  for (const [file, text] of before) assert.equal(f.get(file), text, `${file}: check must be read-only`);
  const expected = planCurrentVersions(f.version, new Map(inventory.map(entry => [entry.file, f.get(entry.file)])), inventory);
  assert.equal(expected.length, inventory.length, 'synthetic update must exercise every managed file');
  assert.deepEqual(currentVersions(f.path, '--update').sort(), expected.map(change => change.file).sort());
  for (const change of expected) {
    assert.equal(f.get(change.file), change.after);
    assert.ok(f.get(change.file).endsWith(sentinel), `${change.file}: history, source hash and independent pins preserved`);
    assert.ok(!before.get(change.file)!.includes(f.version), 'next version must be unique to the fixture update');
    assert.equal(f.get(change.file).replaceAll(f.version, version), before.get(change.file),
      `${change.file}: every authored character outside version spans remains identical`);
  }
  for (const file of [...immutable, 'package.json', 'package-lock.json']) assert.equal(f.get(file), before.get(file), file);
  assert.deepEqual(currentVersions(f.path, '--check'), []);
  assert.deepEqual(currentVersions(f.path, '--update'), [], 'second update must be byte-idempotent');
});

test('invalid final slot prevents every write', t => {
  const f = fixture(t);
  const malformed: Inventory = structuredClone(inventory);
  malformed.at(-1)!.templates.push({ line: 'missing {{version}} slot', occurrences: 1 });
  f.write('scripts/current-version-fields.json', JSON.stringify(malformed));
  const before = inventory.map(entry => [entry.file, f.get(entry.file)]);
  assert.throws(() => currentVersions(f.path, '--update'), /expected 1 matches/);
  for (const [file, text] of before) assert.equal(f.get(file), text);
});

test('inventory rejects missing, duplicate, overlapping, unexpected and escaping slots', () => {
  const inputs = files();
  assert.throws(() => planCurrentVersions(version, inputs, inventory.slice(1)));
  assert.throws(() => planCurrentVersions(version, inputs, [...inventory, inventory[0]]), /duplicate/);
  const overlap = structuredClone(inventory);
  overlap[0].templates.push(overlap[0].templates[0]);
  assert.throws(() => planCurrentVersions(version, inputs, overlap), /overlapping/);
  const escape = structuredClone(inventory);
  escape[0].file = '../README.md';
  assert.throws(() => planCurrentVersions(version, inputs, escape), /unmanaged/);
  const ambiguous = structuredClone(inventory);
  ambiguous[0].templates[0].occurrences++;
  assert.throws(() => planCurrentVersions(version, inputs, ambiguous), /matches/);
  const unknown = structuredClone(inventory) as (Inventory[number] & { output?: string })[];
  unknown[0].output = '/tmp/arbitrary';
  assert.throws(() => planCurrentVersions(version, inputs, unknown), /invalid inventory entry keys/);
  assert.throws(() => planCurrentVersions('0.5.2; command', inputs, inventory), /unsupported version/);
});

test('lock drift and symlink destinations are rejected before any update', t => {
  const f = fixture(t);
  const initial = f.get('src/protocol.ts');
  const lock = JSON.parse(f.get('package-lock.json'));
  lock.version = version;
  f.write('package-lock.json', JSON.stringify(lock));
  assert.throws(() => currentVersions(f.path, '--update'), /package-lock/);
  assert.equal(f.get('src/protocol.ts'), initial);
  lock.version = f.version;
  f.write('package-lock.json', JSON.stringify(lock));
  // Creating an arbitrary symlink requires privileges on Windows. The updater's
  // regular-file guard is exercised on POSIX; lock validation runs everywhere.
  if (process.platform === 'win32') return;
  const target = join(f.path, 'outside.md');
  writeFileSync(target, f.get('PARITY.md'));
  rmSync(join(f.path, 'PARITY.md'));
  symlinkSync(target, join(f.path, 'PARITY.md'));
  assert.throws(() => currentVersions(f.path, '--update'), /symlinks/);
  assert.equal(f.get('src/protocol.ts'), initial);
  assert.equal(readFileSync(target, 'utf8'), read('PARITY.md') + sentinel);
});

test('CLI accepts only check/update and no arbitrary root or output arguments', () => {
  const script = join(root, 'scripts/current-version.mjs');
  const good = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.match(good, /Current-version inventory: OK/);
  for (const args of [[], ['--unknown'], ['--update', '--root', '/tmp']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage:/);
  }
});


test('CLI check runs through symlink entries with both Node resolution modes', t => {
  if (process.platform === 'win32') { t.skip('symlink privilege is not required on Windows'); return; }
  const dir = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-version-entry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const link = join(dir, 'version.mjs');
  symlinkSync(join(root, 'scripts/current-version.mjs'), link);
  for (const flags of [[], ['--preserve-symlinks-main']]) {
    const result = spawnSync(process.execPath, [...flags, link, '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Current-version inventory: OK/);
  }
});
