import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const repository = 'abruption/session-peer-ts';
export const registry = 'https://registry.npmjs.org';
const stableVersion = '0.3.1';
const previousStable = '0.3.0';
const previousStableIntegrity = 'sha512-mdtikUMrGmMrdVSvPXdJcZeouTeuixOTzGwFKPhN66ATZqTohu9HKbejgOwXJe0/zrO+nt9asCAzAEhiHWDYGA==';
const verifiedPreview = '0.1.0-preview.1';
const verifiedPreviewIntegrity = 'sha512-h4SMvrQ/LWA9osd4EHIs9rSTqv1u+S3MXQAmn+yG/gZ9+7NwYMutq+Oa5K/0ggIq61Wfwdh11Cv+5YdEffiNMA==';
export const packageFiles = ['UNICODE-LICENSE.txt', 'dist/casefold.js', 'dist/casefold.d.ts', 'dist/help.js', 'dist/help.d.ts', 'dist/output.js', 'dist/output.d.ts', 'CONTRIBUTING.md', 'LICENSE', 'PARITY.md', 'README.ja.md', 'README.ko.md',
  'README.md', 'README.zh-CN.md', 'RELEASING.md', 'SECURITY.md', 'VALIDATION.md',
  'docs/guide.md', 'docs/guide.ko.md', 'docs/guide.ja.md', 'docs/guide.zh-CN.md', 'docs/api.md', 'docs/shorthand.md', 'shorthand/sp.sh', 'shorthand/sp.ps1', 'docs/design/remote-deployment.md',
  'dist/cli.js', 'dist/discovery.js', 'dist/diagnostics.js', 'dist/process.js', 'dist/protocol.js', 'dist/replies.js', 'dist/send.js', 'dist/ssh.js',
  'dist/windows.js', 'dist/writer.js', 'dist/index.js', 'dist/index.d.ts', 'dist/cli.d.ts',
  'dist/discovery.d.ts', 'dist/diagnostics.d.ts', 'dist/process.d.ts', 'dist/protocol.d.ts',
  'dist/replies.d.ts', 'dist/send.d.ts', 'dist/ssh.d.ts', 'dist/windows.d.ts', 'dist/writer.d.ts', 'dist/updates.js', 'dist/updates.d.ts', 'package.json'].sort();
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = (bytes, algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const npm = args => execFileSync('npm', args, { encoding: 'utf8', timeout: 120000 });

export function validatePackage(pkg) {
  assert.equal(pkg.name, 'session-peer');
  assert.equal(pkg.types, './dist/index.d.ts');
  assert.deepEqual(pkg.exports, { '.': { types: './dist/index.d.ts', import: './dist/index.js' } });
  assert.equal(pkg.private, false);
  assert.ok(pkg.version === stableVersion || /^\d+\.\d+\.\d+-preview\.\d+$/.test(pkg.version),
    'only reviewed preview versions and 0.3.1 stable are supported');
  assert.deepEqual(pkg.bin, { 'session-peer': 'dist/cli.js' });
  assert.equal(pkg.repository.url, `git+https://github.com/${repository}.git`);
  assert.deepEqual(pkg.publishConfig, { registry: `${registry}/`, access: 'public',
    tag: pkg.version === stableVersion ? 'latest' : 'preview' });
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
  assert.equal(env.RELEASE_MODE, pkg.version === stableVersion ? 'stable-stage' : 'trusted-stage');
  assert.equal(env.RELEASE_SHA, env.GITHUB_SHA, 'approved_source_sha_changed');
  assert.equal(env.RELEASE_VERSION, pkg.version);
  assert.equal(env.RELEASE_CONFIRMATION, `${pkg.name}@${pkg.version} ${env.RELEASE_MODE}`);
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
  assert.ok(document && document.name === pkg.name, 'OIDC staging requires an existing package');
  assert.ok(!document.versions?.[pkg.version], 'version already published; do not repeat');
  if (pkg.version === stableVersion) {
    assert.equal(mode, 'stable-stage');
    const previous = document.versions?.[previousStable];
    assert.equal(previous?.dist?.integrity, previousStableIntegrity, 'verified_stable_changed');
    assert.equal(new URL(previous.dist.attestations.url).origin, registry, 'verified stable provenance required');
    assert.equal(document['dist-tags']?.latest, previousStable, 'stable_baseline_changed');
    assert.equal(document['dist-tags']?.preview, verifiedPreview, 'stable_preview_baseline_changed');
    const preview = document.versions?.[verifiedPreview];
    assert.equal(preview?.dist?.integrity, verifiedPreviewIntegrity, 'verified_preview_changed');
    assert.equal(new URL(preview.dist.attestations.url).origin, registry, 'verified preview provenance required');
  } else {
    assert.equal(mode, 'trusted-stage');
    validateLatestTag(pkg, document);
    if (pkg.version === '0.1.0-preview.1') {
      assert.equal(document['dist-tags']?.preview, '0.1.0-preview.0', 'preview_baseline_changed');
    }
  }
  // Public metadata cannot reveal pending stages. A duplicate stage is a hard
  // registry error; inspect it interactively, never retry or replace it here.
}

function validateLatestTag(pkg, document) {
  const latest = document['dist-tags']?.latest;
  if (pkg.version === '0.1.0-preview.1') {
    // The initial publication assigned latest as well as preview to preview.0.
    // Preserve that exact legacy tag for this candidate; never move it in CI.
    assert.equal(latest, '0.1.0-preview.0', 'legacy_latest_changed');
  } else {
    assert.ok(!/-[0-9A-Za-z]/.test(latest ?? ''),
      'latest_points_to_prerelease: resolve the existing tag through a separately reviewed npm action');
  }
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
  if (pkg.version === stableVersion) {
    assert.equal(document['dist-tags']?.latest, pkg.version, 'stable_latest_missing');
    assert.equal(document['dist-tags']?.preview, verifiedPreview, 'stable_preview_changed');
  } else {
    assert.equal(document['dist-tags']?.preview, pkg.version, 'preview_tag_missing');
    validateLatestTag(pkg, document);
  }
  assert.equal(new URL(version.dist.attestations.url).origin, registry, 'provenance metadata required');
}

// A successful upload can precede registry propagation. Reads and waits only:
// this function never uploads, changes tags or changes authentication.
export async function waitForPublishedVersion(pkg, read = () => get(`${registry}/${pkg.name}`),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 30) {
  assert.ok(Number.isSafeInteger(attempts) && attempts > 0 && attempts <= 30);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const document = await read();
    if (document?.versions?.[pkg.version]) return document;
    if (attempt + 1 < attempts) await wait(2000);
  }
  throw new Error('registry_version_not_visible_after_read_only_wait; inspect registry before any new publication');
}

async function verify(pkg) {
  const { manifest } = artifact(pkg);
  const document = await waitForPublishedVersion(pkg);
  validatePublished(pkg, manifest, document);
  freshInstall(pkg, `${pkg.name}@${pkg.version}`, true);
  const message = `Verified ${pkg.name}@${pkg.version}: registry integrity, ${pkg.publishConfig.tag} tag, attestation metadata, npm signature audit, fresh install and uninstall.\n`;
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
    const diagnostic = /approved_source_sha_changed/.test(error.message) ? 'approved_source_sha_changed'
      : /verified_stable_changed/.test(error.message) ? 'verified_stable_changed'
      : /stable_baseline_changed/.test(error.message) ? 'stable_baseline_changed'
      : /stable_preview_baseline_changed/.test(error.message) ? 'stable_preview_baseline_changed'
      : /verified_preview_changed/.test(error.message) ? 'verified_preview_changed'
      : /stable_latest_missing/.test(error.message) ? 'stable_latest_missing'
      : /stable_preview_changed/.test(error.message) ? 'stable_preview_changed'
      : /legacy_latest_changed/.test(error.message) ? 'legacy_latest_changed'
      : /preview_baseline_changed/.test(error.message) ? 'preview_baseline_changed'
      : /latest_points_to_prerelease/.test(error.message) ? 'latest_points_to_prerelease'
      : /registry_version_not_visible_after_read_only_wait/.test(error.message) ? 'registry_version_not_visible'
      : /preview_tag_missing/.test(error.message) ? 'preview_tag_missing' : error.name;
    console.error(`Release gate failed (${diagnostic}). Stop; do not retry publication. Inspect the failed gate and registry state.`);
    process.exitCode = 1;
  }
}
