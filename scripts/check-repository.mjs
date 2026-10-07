import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
const read = path => readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(pkg.name, 'session-peer');
assert.equal(pkg.private, false);
assert.deepEqual(pkg.publishConfig, { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'latest' });
assert.deepEqual(pkg.bin, { 'session-peer': 'dist/cli.js' });
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);
assert.deepEqual(lock.packages[''].bin, pkg.bin);
assert.equal(read('src/protocol.ts').match(/export const VERSION = '([^']+)'/)[1], pkg.version);

const locales = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'];
const guides = locales.map(file => file.replace('README', 'docs/guide'));
const marker = '<!-- docs-contract: stable-release-source; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->';
for (const file of locales) {
  const content = read(file);
  for (const token of [marker,
    `npm install --global --ignore-scripts session-peer@${pkg.version}`,
    `session-peer ${pkg.version} (typescript)`, 'consumptionConfirmed', 'submitted:null',
    '--dry-run', 'posted', 'queued', 'unknown', 'npm view session-peer dist-tags',
    '](SECURITY.md)', 'https://github.com/abruption/session-peer-ts/security/advisories/new',
    `](${file.replace('README', 'docs/guide')})`, '](docs/api.md)',
    'https://github.com/abruption/session-peer-ts', 'https://github.com/abruption/session-peer', '](PARITY.md)',
    ...locales.map(name => `](${name})`)]) {
    assert.ok(content.includes(token), `${file}: missing contract token ${token}`);
  }
  const topLevelHeadings = file === 'README.ko.md'
    ? ['시연', '빠른 시작', '문서', '라이선스', '지원 및 보안']
    : ['Demo', 'Quick Start', 'Docs', 'License', 'Support and security'];
  const quickStartHeadings = file === 'README.ko.md' ? ['설치', '업데이트'] : ['Install', 'Update'];
  assert.deepEqual([...content.matchAll(/^## (.+)$/gm)].map(match => match[1]),
    topLevelHeadings, `${file}: entry-page structure`);
  assert.deepEqual([...content.matchAll(/^### (.+)$/gm)].map(match => match[1]), quickStartHeadings,
    `${file}: quick-start structure`);
}
for (const file of guides) {
  const content = read(file);
  for (const token of ['npm ci --ignore-scripts', 'npm pack --ignore-scripts',
    `npm install --global --ignore-scripts ./session-peer-${pkg.version}.tgz`,
    'consumptionConfirmed', 'submitted:null', '](../PARITY.md)', '](../VALIDATION.md)']) {
    assert.ok(content.includes(token), `${file}: missing guide contract token ${token}`);
  }
}
function anchors(content) {
  const ids = new Set([...content.matchAll(/<a id="([^"]+)"/g)].map(match => match[1]));
  const seen = new Map();
  const prose = content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of prose.matchAll(/^#{1,6} (.+)$/gm)) {
    const slug = match[1].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
    const count = seen.get(slug) ?? 0;
    ids.add(slug + (count ? `-${count}` : '')); seen.set(slug, count + 1);
  }
  return ids;
}
for (const file of [...locales, ...guides, 'docs/api.md', 'docs/shorthand.md', 'docs/design/remote-deployment.md', 'PARITY.md', 'SECURITY.md']) {
  const content = read(file);
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^[a-z]+:/i.test(match[1])) continue;
    const [target, fragment] = match[1].split('#');
    const path = target ? resolve(dirname(file), target) : resolve(file);
    assert.ok(existsSync(path), `${file}: missing local link ${match[1]}`);
    if (fragment) assert.ok(anchors(read(path)).has(decodeURIComponent(fragment)), `${file}: missing anchor ${match[1]}`);
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
  '.github/workflows/ci.yml', ...locales, ...guides, 'docs/api.md', 'docs/shorthand.md', 'shorthand/sp.sh', 'shorthand/sp.ps1', 'docs/design/remote-deployment.md']) {
  assert.ok(!ignored(path), `must not ignore ${path}`);
}
if (process.env.PR_TITLE) {
  assert.match(process.env.PR_TITLE, /^(feat|fix|docs|문서|chore|refactor|test|perf|ci|build|revert)(\([^)]+\))?!?: \S/);
}
console.log('Repository metadata, four README/guide contracts, links/anchors and ignore rules: OK');
