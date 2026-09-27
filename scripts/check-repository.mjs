import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
const read = path => readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(pkg.name, 'session-peer');
assert.equal(pkg.private, false);
assert.deepEqual(pkg.publishConfig, { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'preview' });
assert.deepEqual(pkg.bin, { 'session-peer': 'dist/cli.js' });
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);
assert.deepEqual(lock.packages[''].bin, pkg.bin);
assert.equal(read('src/protocol.ts').match(/export const VERSION = '([^']+)'/)[1], pkg.version);

const locales = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'];
const marker = '<!-- docs-contract: preview-candidate; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->';
for (const file of locales) {
  const content = read(file);
  for (const token of [marker, 'npm ci --ignore-scripts',
    'npm pack --ignore-scripts', `npm install --global --ignore-scripts ./session-peer-${pkg.version}.tgz`,
    `npm install --global --ignore-scripts session-peer@${pkg.version}`,
    `session-peer ${pkg.version} (typescript)`, 'consumptionConfirmed', 'submitted:null',
    'https://github.com/abruption/session-peer-ts', 'https://github.com/abruption/session-peer',
    ...locales.map(name => `](${name})`)]) {
    assert.ok(content.includes(token), `${file}: missing contract token ${token}`);
  }
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(existsSync(resolve(target)), `${file}: missing local link ${target}`);
  }
}

function ignored(path) {
  try {
    execFileSync('git', ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--quiet', path]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}
for (const path of ['node_modules/sample', 'dist/cli.js', '.worktree/example/file', '.env',
  '.env.local', '.npmrc', 'fixture.db', 'private.key', 'evidence/local.json', 'package.tgz']) {
  assert.ok(ignored(path), `must ignore ${path}`);
}
for (const path of ['package-lock.json', '.env.example', 'src/cli.ts', 'test/fixtures/public.json',
  '.github/workflows/ci.yml', ...locales]) {
  assert.ok(!ignored(path), `must not ignore ${path}`);
}
if (process.env.PR_TITLE) {
  assert.match(process.env.PR_TITLE, /^(feat|fix|docs|chore|refactor|test|perf|ci|build|revert)(\([^)]+\))?!?: \S/);
}
console.log('Repository metadata, four README contracts, links and ignore rules: OK');
