import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const repository = 'abruption/session-peer-ts';
export const registry = 'https://registry.npmjs.org';
export const packageFiles = ['CONTRIBUTING.md', 'LICENSE', 'README.ja.md', 'README.ko.md',
  'README.md', 'README.zh-CN.md', 'RELEASING.md', 'SECURITY.md', 'VALIDATION.md',
  'dist/cli.js', 'dist/discovery.js', 'dist/process.js', 'dist/protocol.js', 'dist/send.js',
  'dist/writer.js', 'dist/index.js', 'dist/index.d.ts', 'dist/cli.d.ts',
  'dist/discovery.d.ts', 'dist/process.d.ts', 'dist/protocol.d.ts',
  'dist/send.d.ts', 'dist/writer.d.ts', 'package.json'].sort();
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = (bytes, algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const npm = args => execFileSync('npm', args, { encoding: 'utf8', timeout: 120000 });

export function validatePackage(pkg) {
  assert.equal(pkg.name, 'session-peer');
  assert.equal(pkg.types, './dist/index.d.ts');
  assert.deepEqual(pkg.exports, { '.': { types: './dist/index.d.ts', import: './dist/index.js' } });
  assert.equal(pkg.private, false);
  assert.match(pkg.version, /^\d+\.\d+\.\d+-preview\.\d+$/, 'preview versions only');
  assert.deepEqual(pkg.bin, { 'session-peer': 'dist/cli.js' });
  assert.equal(pkg.repository.url, `git+https://github.com/${repository}.git`);
  assert.deepEqual(pkg.publishConfig, { registry: `${registry}/`, access: 'public', tag: 'preview' });
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'prepublishOnly', 'publish', 'postpublish']) {
    assert.equal(pkg.scripts?.[hook], undefined, `no ${hook} lifecycle hook`);
  }
}

export function validateDispatch(pkg, env) {
  validatePackage(pkg);
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.ok(['bootstrap-token', 'trusted-stage'].includes(env.RELEASE_MODE));
  assert.equal(env.RELEASE_VERSION, pkg.version);
  assert.equal(env.RELEASE_CONFIRMATION, `${pkg.name}@${pkg.version} ${env.RELEASE_MODE}`);
  if (env.RELEASE_MODE === 'bootstrap-token') {
    assert.equal(pkg.version, '0.1.0-preview.0', 'bootstrap is limited to the initial version');
  }
}

export function validateGitHubGate(sha, main, runs, environment) {
  assert.equal(main.commit.sha, sha, 'main moved: prepare a new reviewed run');
  const matching = runs.workflow_runs.filter(run => run.head_sha === sha && run.event === 'push' && run.head_branch === 'main');
  assert.ok(matching.length > 0, 'main CI not found');
  assert.equal(matching[0].status, 'completed');
  assert.equal(matching[0].conclusion, 'success', 'latest exact-commit main CI must pass');
  assert.equal(environment.name, 'npm');
  assert.ok(environment.protection_rules?.some(rule => rule.type === 'required_reviewers' && rule.reviewers?.length > 0),
    'create npm environment with a required reviewer before dispatch');
}

async function get(url, token) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } : {} });
  if (response.status === 404) return null;
  assert.equal(response.status, 200, `read-only API failed: HTTP ${response.status}`);
  return response.json();
}

export function validateRegistryState(pkg, mode, document) {
  if (mode === 'bootstrap-token') {
    assert.equal(document, null, 'bootstrap refuses any existing registry package');
  } else {
    assert.ok(document && document.name === pkg.name, 'OIDC staging requires an existing package');
    assert.ok(!document.versions?.[pkg.version], 'version already published; do not repeat');
  }
  // Public metadata cannot reveal pending stages. A duplicate stage is a hard
  // registry error; inspect it interactively, never retry or replace it here.
}

async function preflight(pkg) {
  const env = process.env;
  validateDispatch(pkg, env);
  assert.ok(env.GH_TOKEN, 'GitHub read token required');
  const base = `https://api.github.com/repos/${repository}`;
  const [main, runs, environment] = await Promise.all([
    get(`${base}/branches/main`, env.GH_TOKEN),
    get(`${base}/actions/workflows/ci.yml/runs?head_sha=${env.GITHUB_SHA}&event=push&per_page=100`, env.GH_TOKEN),
    get(`${base}/environments/npm`, env.GH_TOKEN)
  ]);
  assert.ok(main && runs && environment, 'required GitHub configuration missing');
  validateGitHubGate(env.GITHUB_SHA, main, runs, environment);
  validateRegistryState(pkg, env.RELEASE_MODE, await get(`${registry}/${pkg.name}`));
  console.log('Publication preflight passed; no package uploaded.');
}

export function validateArtifact(pkg, manifest, bytes, sha) {
  validatePackage(pkg);
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.filename, `${pkg.name}-${pkg.version}.tgz`);
  assert.match(manifest.commit ?? '', /^[a-f0-9]{40}$/);
  if (sha) assert.equal(manifest.commit, sha);
  assert.deepEqual(manifest.files, packageFiles);
  assert.equal(manifest.sha256, digest(bytes, 'sha256'));
  assert.equal(manifest.integrity, `sha512-${digest(bytes, 'sha512', 'base64')}`);
}

function artifact(pkg) {
  const manifest = json('release-dist/manifest.json');
  // Validate filename before using it as a path.
  assert.equal(manifest.filename, `${pkg.name}-${pkg.version}.tgz`);
  const filename = resolve('release-dist', manifest.filename);
  validateArtifact(pkg, manifest, readFileSync(filename), process.env.GITHUB_SHA);
  const files = execFileSync('tar', ['-tzf', filename], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(files, packageFiles.map(file => `package/${file}`).sort());
  const packed = JSON.parse(execFileSync('tar', ['-xOf', filename, 'package/package.json'], { encoding: 'utf8' }));
  validatePackage(packed);
  assert.equal(packed.version, pkg.version);
  return { manifest, filename };
}

function freshInstall(pkg, spec, signatures = false) {
  const dir = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-npm-release-'));
  try {
    const home = join(dir, 'home'); mkdirSync(home);
    npm(['install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', '--registry', registry, spec]);
    const cli = join(dir, 'node_modules/.bin/session-peer');
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), ANTHROPIC_CONFIG_DIR: '' };
    assert.equal(execFileSync(process.execPath, [cli, '--version'], { env, encoding: 'utf8', timeout: 15000 }).trim(),
      `session-peer ${pkg.version} (typescript)`);
    const result = JSON.parse(execFileSync(process.execPath, [cli, 'list', '--agent', 'claude', '--json'],
      { env, encoding: 'utf8', timeout: 15000 }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.sessions, []);
    if (signatures) npm(['audit', 'signatures', '--prefix', dir, '--registry', registry]);
    npm(['uninstall', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', pkg.name]);
    assert.equal(existsSync(cli), false);
  } finally { rmSync(dir, { recursive: true }); }
}

function pack(pkg) {
  validatePackage(pkg);
  mkdirSync('release-dist'); // Refuse stale artifacts, never silently reuse them.
  const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', 'release-dist']));
  assert.equal(packed.filename, `${pkg.name}-${pkg.version}.tgz`);
  assert.deepEqual(packed.files.map(file => file.path).sort(), packageFiles);
  const bytes = readFileSync(join('release-dist', packed.filename));
  const manifest = { name: pkg.name, version: pkg.version, filename: packed.filename,
    commit: process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    files: packageFiles, sha256: digest(bytes, 'sha256'), integrity: `sha512-${digest(bytes, 'sha512', 'base64')}` };
  const [again] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', 'release-dist']));
  assert.equal(again.filename, packed.filename);
  assert.equal(digest(readFileSync(join('release-dist', packed.filename)), 'sha256'), manifest.sha256);
  writeFileSync('release-dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  const checked = artifact(pkg);
  freshInstall(pkg, checked.filename);
  console.log(JSON.stringify(manifest));
}

export function validatePublished(pkg, manifest, document) {
  assert.equal(document.name, pkg.name);
  const version = document.versions?.[pkg.version];
  assert.ok(version, 'published version not visible');
  assert.equal(version.dist?.integrity, manifest.integrity);
  assert.equal(document['dist-tags']?.preview, pkg.version);
  assert.notEqual(document['dist-tags']?.latest, pkg.version, 'preview must not become latest');
  assert.equal(new URL(version.dist.attestations.url).origin, registry, 'provenance metadata required');
}

async function verify(pkg) {
  const { manifest } = artifact(pkg);
  let document;
  for (let attempt = 0; attempt < 5; attempt++) {
    document = await get(`${registry}/${pkg.name}`);
    if (document?.versions?.[pkg.version]) break;
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 2000)); // Read-only propagation check.
  }
  assert.ok(document, 'registry publication not visible; do not publish again');
  validatePublished(pkg, manifest, document);
  freshInstall(pkg, `${pkg.name}@${pkg.version}`, true);
  const message = `Verified ${pkg.name}@${pkg.version}: registry integrity, preview tag, attestation metadata, npm signature audit, fresh install and uninstall.\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
  console.log(message);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const pkg = json('package.json');
    const command = process.argv[2];
    assert.ok(['preflight', 'pack', 'artifact', 'verify'].includes(command), 'invalid release helper command');
    if (command === 'preflight') await preflight(pkg);
    if (command === 'pack') pack(pkg);
    if (command === 'artifact') { artifact(pkg); console.log('Artifact validated.'); }
    if (command === 'verify') await verify(pkg);
  } catch (error) {
    // Do not echo response bodies, process environments or child-process output.
    console.error(`Release gate failed (${error.name}). Stop; do not retry publication. Inspect the failed gate and registry state.`);
    process.exitCode = 1;
  }
}
