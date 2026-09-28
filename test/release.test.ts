import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validatePackage, validateDispatch, validateGitHubGate, validateRegistryState,
  validateArtifact, validatePublished, waitForPublishedVersion, packageFiles } from '../scripts/release.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: 'abruption/session-peer-ts', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: sha, RELEASE_SHA: sha, RELEASE_MODE: 'stable-stage',
  RELEASE_VERSION: pkg.version, RELEASE_CONFIRMATION: `session-peer@${pkg.version} stable-stage` };

test('release dispatch binds stable and preview modes to exact versions, tags and main', () => {
  validateDispatch(pkg, env);
  assert.throws(() => validatePackage({ ...pkg, name: 'session-peer-ts' }));
  assert.throws(() => validatePackage({ ...pkg, types: undefined }));
  assert.throws(() => validatePackage({ ...pkg, exports: {} }));
  assert.throws(() => validateDispatch(pkg, { ...env, RELEASE_CONFIRMATION: `session-peer-ts@${pkg.version} stable-stage` }));
  for (const patch of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'fork/session-peer-ts' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { RELEASE_VERSION: '9.0.0' }, { RELEASE_SHA: 'b'.repeat(40) }, { RELEASE_SHA: undefined }, { RELEASE_MODE: 'publish' },
    { RELEASE_MODE: 'bootstrap-token' }, { RELEASE_MODE: 'trusted-stage' },
    { RELEASE_CONFIRMATION: '' }, { GITHUB_SHA: 'main; echo unsafe' }]) {
    assert.throws(() => validateDispatch(pkg, { ...env, ...patch }));
  }
  for (const patch of [{ private: true }, { version: '1.0.0' }, { publishConfig: { ...pkg.publishConfig, tag: 'preview' } },
    { repository: { url: 'https://example.com' } }, { scripts: { ...pkg.scripts, prepublishOnly: 'echo unsafe' } }]) {
    assert.throws(() => validatePackage({ ...pkg, ...patch }));
  }
  const preview = { ...pkg, version: '0.1.0-preview.2', publishConfig: { ...pkg.publishConfig, tag: 'preview' } };
  validateDispatch(preview, { ...env, RELEASE_MODE: 'trusted-stage', RELEASE_VERSION: preview.version,
    RELEASE_CONFIRMATION: `session-peer@${preview.version} trusted-stage` });
  assert.throws(() => validateDispatch(preview, { ...env, RELEASE_VERSION: preview.version,
    RELEASE_CONFIRMATION: `session-peer@${preview.version} stable-stage` }));
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

test('0.2.0 stable staging requires verified 0.1.0 and unchanged preview/tag baselines', () => {
  const previewDist = { integrity: 'sha512-h4SMvrQ/LWA9osd4EHIs9rSTqv1u+S3MXQAmn+yG/gZ9+7NwYMutq+Oa5K/0ggIq61Wfwdh11Cv+5YdEffiNMA==',
    attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.1.0-preview.1' } };
  const stableDist = { integrity: 'sha512-/FtILLgUpIAgqf5FsdU5/x17IGeWO3ylmm47gbSyN3hHjD40pp5gtOeAXU3zqmye/cx7PE52Pp/oLa0ZgZyDQQ==',
    attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.1.0' } };
  const current = { name: pkg.name, versions: { '0.1.0': { dist: stableDist }, '0.1.0-preview.1': { dist: previewDist } },
    'dist-tags': { latest: '0.1.0', preview: '0.1.0-preview.1' } };
  validateRegistryState(pkg, 'stable-stage', current);
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', null));
  assert.throws(() => validateRegistryState(pkg, 'trusted-stage', current));
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', { ...current,
    versions: { ...current.versions, [pkg.version]: {} } }), /version already published/);
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', { ...current,
    'dist-tags': { ...current['dist-tags'], latest: '0.1.0-preview.1' } }), /stable_baseline_changed/);
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', { ...current,
    'dist-tags': { ...current['dist-tags'], preview: '0.1.0-preview.0' } }), /stable_preview_baseline_changed/);
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', { ...current,
    versions: { ...current.versions, '0.1.0-preview.1': { dist: { ...previewDist, integrity: 'sha512-other' } } } }), /verified_preview_changed/);
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', { ...current,
    versions: { ...current.versions, '0.1.0-preview.1': { dist: { ...previewDist, attestations: undefined } } } }));
  const preview = { ...pkg, version: '0.1.0-preview.2', publishConfig: { ...pkg.publishConfig, tag: 'preview' } };
  assert.throws(() => validateRegistryState(preview, 'trusted-stage', { ...current, 'dist-tags': { latest: '0.1.0-preview.0' } }), /latest_points_to_prerelease/);
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', { ...current, versions: { ...current.versions, '0.1.0': { dist: { ...stableDist, integrity: 'tampered' } } } }), /verified_stable_changed/);
  assert.throws(() => validateRegistryState(pkg, 'stable-stage', { ...current, versions: { ...current.versions, '0.1.0': { dist: { ...stableDist, attestations: undefined } } } }));
  validateRegistryState(preview, 'trusted-stage', { ...current,
    'dist-tags': { latest: '0.1.0', preview: '0.1.0-preview.1' } });
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
  const document = { name: pkg.name, 'dist-tags': { latest: pkg.version, preview: '0.1.0-preview.1' }, versions: { [pkg.version]: {
    dist: { integrity: manifest.integrity, attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/example' } }
  } } };
  validatePublished(pkg, manifest, document);
  assert.throws(() => validatePublished(pkg, manifest, { ...document,
    'dist-tags': { latest: '0.1.0-preview.0', preview: '0.1.0-preview.1' } }), /stable_latest_missing/);
  assert.throws(() => validatePublished(pkg, manifest, {
    ...document, 'dist-tags': { latest: pkg.version, preview: pkg.version }
  }), /stable_preview_changed/);
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

test('publish workflow stages stable and preview through OIDC without tokens or rebuilding', () => {
  const source = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /source_sha:/);
  assert.equal((source.match(/RELEASE_SHA: \$\{\{ inputs.source_sha \}\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /^  (push|pull_request|pull_request_target|release|workflow_call|schedule):/m);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /environment: npm/);
  assert.doesNotMatch(source, /NPM_TOKEN|npm publish\s/);
  assert.equal((source.match(/id-token: write/g) ?? []).length, 1);
  assert.match(source, /if: inputs.mode == 'stable-stage'\n        env:\n          NODE_AUTH_TOKEN: ''\n        run: npm stage publish .* --tag latest /);
  assert.match(source, /if: inputs.mode == 'trusted-stage'\n        env:\n          NODE_AUTH_TOKEN: ''\n        run: npm stage publish .* --tag preview /);
  assert.match(source, /NPM_CONFIG_FETCH_RETRIES: '0'/);
  assert.doesNotMatch(source, /npm dist-tag|npm unpublish/);
  const publishJob = source.split('\n  publish:\n')[1];
  assert.doesNotMatch(publishJob, /npm (ci|run build|test)/);
  assert.match(publishJob, /npm stage publish/);
  assert.match(publishJob, /node scripts\/release.mjs preflight && node scripts\/release.mjs artifact/);
  for (const match of source.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
});
