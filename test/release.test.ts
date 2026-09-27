import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validatePackage, validateDispatch, validateGitHubGate, validateRegistryState,
  validateArtifact, validatePublished, waitForPublishedVersion, packageFiles } from '../scripts/release.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: 'abruption/session-peer-ts', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: sha, RELEASE_MODE: 'bootstrap-token',
  RELEASE_VERSION: pkg.version, RELEASE_CONFIRMATION: `session-peer@${pkg.version} bootstrap-token` };

test('release dispatch requires exact main, version, explicit confirmation and preview contract', () => {
  const bootstrap = { ...pkg, version: '0.1.0-preview.0' };
  validateDispatch(bootstrap, { ...env, RELEASE_VERSION: bootstrap.version,
    RELEASE_CONFIRMATION: `session-peer@${bootstrap.version} bootstrap-token` });
  assert.throws(() => validatePackage({ ...pkg, name: 'session-peer-ts' }));
  assert.throws(() => validatePackage({ ...pkg, types: undefined }));
  assert.throws(() => validatePackage({ ...pkg, exports: {} }));
  assert.throws(() => validateDispatch(pkg, { ...env, RELEASE_CONFIRMATION: `session-peer-ts@${pkg.version} bootstrap-token` }));
  for (const patch of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'fork/session-peer-ts' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { RELEASE_VERSION: '9.0.0' }, { RELEASE_MODE: 'publish' },
    { RELEASE_CONFIRMATION: '' }, { GITHUB_SHA: 'main; echo unsafe' }]) {
    assert.throws(() => validateDispatch(pkg, { ...env, ...patch }));
  }
  for (const patch of [{ private: true }, { version: '1.0.0' }, { publishConfig: { ...pkg.publishConfig, tag: 'latest' } },
    { repository: { url: 'https://example.com' } }, { scripts: { ...pkg.scripts, prepublishOnly: 'echo unsafe' } }]) {
    assert.throws(() => validatePackage({ ...pkg, ...patch }));
  }
  const later = pkg;
  const laterEnv = { ...env, RELEASE_VERSION: later.version, RELEASE_CONFIRMATION: `session-peer@${later.version} bootstrap-token` };
  assert.throws(() => validateDispatch(later, laterEnv));
  validateDispatch(later, { ...laterEnv, RELEASE_MODE: 'trusted-stage', RELEASE_CONFIRMATION: `session-peer@${later.version} trusted-stage` });
});

test('release gate rejects moved main, absent/failed/pending CI and missing environment reviewers', () => {
  const main = { commit: { sha } };
  const run = { head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' };
  const runs = { workflow_runs: [run] };
  const environment = { name: 'npm', protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] };
  validateGitHubGate(sha, main, runs, environment);
  assert.throws(() => validateGitHubGate('b'.repeat(40), main, runs, environment));
  for (const workflow_runs of [[], [{ ...run, event: 'pull_request' }], [{ ...run, status: 'in_progress' }],
    [{ ...run, conclusion: 'failure' }, run]]) {
    assert.throws(() => validateGitHubGate(sha, main, { workflow_runs }, environment));
  }
  assert.throws(() => validateGitHubGate(sha, main, runs, { name: 'npm', protection_rules: [] }));
  assert.throws(() => validateGitHubGate(sha, main, runs, { name: 'npm', protection_rules: [{ type: 'required_reviewers', reviewers: [] }] }));
});

test('bootstrap refuses existing packages and OIDC refuses missing or already published versions', () => {
  validateRegistryState(pkg, 'bootstrap-token', null);
  const existing = { name: pkg.name, versions: {} };
  assert.throws(() => validateRegistryState(pkg, 'bootstrap-token', existing));
  assert.throws(() => validateRegistryState(pkg, 'trusted-stage', null));
  validateRegistryState(pkg, 'trusted-stage', existing);
  assert.throws(() => validateRegistryState(pkg, 'trusted-stage', { ...existing, versions: { [pkg.version]: {} } }));
  assert.throws(() => validateRegistryState(pkg, 'trusted-stage', {
    ...existing, 'dist-tags': { latest: '0.1.0-preview.0' }
  }), /latest_points_to_prerelease/);
});

test('release artifact binds version, allowlist, commit, SHA-256 and registry integrity', () => {
  const bytes = Buffer.from('test artifact');
  const manifest = { name: pkg.name, version: pkg.version, filename: `${pkg.name}-${pkg.version}.tgz`, commit: sha,
    files: packageFiles, sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  validateArtifact(pkg, manifest, bytes, sha);
  for (const patch of [{ filename: '../escape.tgz' }, { version: '1.0.0' }, { commit: 'b'.repeat(40) },
    { files: [...packageFiles, '.npmrc'] }, { sha256: '0'.repeat(64) }, { integrity: 'sha512-invalid' }]) {
    assert.throws(() => validateArtifact(pkg, { ...manifest, ...patch }, bytes, sha));
  }
  assert.throws(() => validateArtifact(pkg, manifest, Buffer.from('tampered'), sha));
  const document = { name: pkg.name, 'dist-tags': { preview: pkg.version }, versions: { [pkg.version]: {
    dist: { integrity: manifest.integrity, attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/example' } }
  } } };
  validatePublished(pkg, manifest, document);
  assert.throws(() => validatePublished(pkg, manifest, { ...document, 'dist-tags': { latest: pkg.version, preview: pkg.version } }));
  assert.throws(() => validatePublished(pkg, manifest, {
    ...document, 'dist-tags': { latest: '0.1.0-preview.0', preview: pkg.version }
  }), /latest_points_to_prerelease/);
  assert.throws(() => validatePublished(pkg, manifest, { ...document, versions: {} }));
  assert.throws(() => validatePublished(pkg, { ...manifest, integrity: 'different' }, document));
});
test('publication verification waits through delayed 404s without any write', async () => {
  const published = { versions: { [pkg.version]: {} } };
  let reads = 0, waits = 0;
  const found = await waitForPublishedVersion(pkg, async () => ++reads <= 6 ? null : published,
    async ms => { assert.equal(ms, 2000); waits++; }, 8);
  assert.equal(found, published);
  assert.equal(reads, 7);
  assert.equal(waits, 6);
  await assert.rejects(waitForPublishedVersion(pkg, async () => null, async () => {}, 3),
    /registry_version_not_visible_after_read_only_wait/);
});

test('publish workflow is manual, fixed preview, no rebuild with credentials, isolated bootstrap secret', () => {
  const source = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^  (push|pull_request|pull_request_target|release|workflow_call|schedule):/m);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /environment: npm/);
  assert.equal((source.match(/secrets\.NPM_TOKEN/g) ?? []).length, 1);
  assert.equal((source.match(/id-token: write/g) ?? []).length, 1);
  assert.match(source, /if: inputs.mode == 'bootstrap-token'\n        env:\n          NODE_AUTH_TOKEN: \$\{\{ secrets.NPM_TOKEN \}\}/);
  assert.match(source, /NPM_CONFIG_FETCH_RETRIES: '0'/);
  assert.doesNotMatch(source, /--tag latest|npm dist-tag|npm unpublish/);
  const publishJob = source.split('\n  publish:\n')[1];
  assert.doesNotMatch(publishJob, /npm (ci|run build|test)/);
  assert.match(publishJob, /npm stage publish/);
  assert.match(publishJob, /node scripts\/release.mjs preflight && node scripts\/release.mjs artifact/);
  for (const match of source.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
});
