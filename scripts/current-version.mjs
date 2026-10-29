import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '..');
const allowedFiles = new Set([
  'src/protocol.ts', 'README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md',
  'docs/guide.md', 'docs/guide.ko.md', 'docs/guide.ja.md', 'docs/guide.zh-CN.md',
  'docs/api.md', 'docs/shorthand.md', 'PARITY.md',
]);
const numeric = '(?:0|[1-9]\\d*)';
const prerelease = `(?:${numeric}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = `${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?`;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only the explicitly inventoried version spans are replaced. Authored text,
// historical versions and independently versioned pins remain literal context.
export function planCurrentVersions(version, files, inventory) {
  assert.match(version, new RegExp(`^${versionPattern}$`), 'package.json: unsupported version');
  assert.ok(Array.isArray(inventory) && inventory.length > 0, 'empty current-version inventory');
  const seen = new Set();
  const changes = [];
  for (const entry of inventory) {
    assert.deepEqual(Object.keys(entry).sort(), ['file', 'templates'], 'invalid inventory entry keys');
    assert.ok(allowedFiles.has(entry.file), `unmanaged current-version path: ${entry.file}`);
    assert.ok(!seen.has(entry.file), `duplicate inventory file: ${entry.file}`);
    seen.add(entry.file);
    assert.ok(Array.isArray(entry.templates) && entry.templates.length > 0, `${entry.file}: empty templates`);
    const original = files.get(entry.file);
    assert.equal(typeof original, 'string', `${entry.file}: missing input`);
    const replacements = [];
    const matchedLines = new Set();
    for (const slot of entry.templates) {
      assert.deepEqual(Object.keys(slot).sort(), ['line', 'occurrences'], `${entry.file}: invalid slot keys`);
      assert.ok(Number.isSafeInteger(slot.occurrences) && slot.occurrences > 0, `${entry.file}: invalid slot count`);
      assert.ok(typeof slot.line === 'string' && !/[\r\n]/.test(slot.line) && slot.line.includes('{{version}}'),
        `${entry.file}: expected a single-line version template`);
      const parts = slot.line.split('{{version}}');
      const pattern = new RegExp(`^${parts.map(escape).join(`(${versionPattern})`)}(?=\\r?$)`, 'gm');
      const matches = [...original.matchAll(pattern)];
      assert.equal(matches.length, slot.occurrences, `${entry.file}: expected ${slot.occurrences} matches for ${slot.line}`);
      for (const match of matches) {
        assert.ok(!matchedLines.has(match.index), `${entry.file}: overlapping version slots`);
        matchedLines.add(match.index);
        replacements.push({ index: match.index, length: match[0].length, text: parts.join(version) });
      }
    }
    let updated = original;
    for (const replacement of replacements.sort((a, b) => b.index - a.index)) {
      updated = updated.slice(0, replacement.index) + replacement.text + updated.slice(replacement.index + replacement.length);
    }
    if (updated !== original) changes.push({ file: entry.file, before: original, after: updated });
  }
  assert.ok(seen.has('src/protocol.ts'), 'runtime VERSION must be inventoried');
  assert.deepEqual([...seen].sort(), [...allowedFiles].sort(), 'inventory must cover the fixed current-version file set');
  const runtime = inventory.find(entry => entry.file === 'src/protocol.ts');
  assert.deepEqual(runtime.templates, [{ line: "export const VERSION = '{{version}}';", occurrences: 1 }], 'only runtime VERSION is managed in src/protocol.ts');
  return changes;
}

function readRegular(root, file) {
  let path = root;
  for (const part of file.split('/')) {
    path = join(path, part);
    assert.ok(!lstatSync(path).isSymbolicLink(), `${file}: symlinks are not managed`);
  }
  assert.ok(lstatSync(path).isFile(), `${file}: expected regular file`);
  return readFileSync(path, 'utf8');
}

export function currentVersions(root = repository, mode = '--check') {
  assert.ok(mode === '--check' || mode === '--update', 'usage: node scripts/current-version.mjs --check|--update');
  const pkg = JSON.parse(readRegular(root, 'package.json'));
  const lock = JSON.parse(readRegular(root, 'package-lock.json'));
  assert.equal(lock.version, pkg.version, 'package-lock.json version must match package.json; update package metadata first');
  assert.equal(lock.packages[''].version, pkg.version, 'package-lock.json root version must match package.json');
  const inventory = JSON.parse(readRegular(root, 'scripts/current-version-fields.json'));
  // Validate the full plan, including every destination, before the first write.
  const files = new Map();
  for (const entry of inventory) {
    assert.ok(allowedFiles.has(entry.file), `unmanaged current-version path: ${entry.file}`);
    files.set(entry.file, readRegular(root, entry.file));
  }
  const changes = planCurrentVersions(pkg.version, files, inventory);
  if (mode === '--check') {
    assert.equal(changes.length, 0, `current-version drift: ${changes.map(change => change.file).join(', ')}; run npm run version:update`);
  } else {
    for (const change of changes) writeFileSync(join(root, change.file), change.after);
  }
  return changes.map(change => change.file);
}

function isEntryPoint() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isEntryPoint()) {
  try {
    assert.equal(process.argv.length, 3, 'usage: node scripts/current-version.mjs --check|--update');
    const changed = currentVersions(repository, process.argv[2]);
    console.log(process.argv[2] === '--check' ? 'Current-version inventory: OK' : `Current-version update: ${changed.length} files`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
