# Releasing session-peer previews

The package is publication-ready (`private:false`), not automatically published.
Merging, pushing, tagging or publishing a GitHub release does not run publish.yml.
Only an explicitly approved manual dispatch can upload. Python session-peer and
its Relay release train remain independent.

## Before the first dispatch

1. Merge the reviewed preparation PR and require main's exact-commit `cli` CI
   (`release gate`) to pass. Match versions in package.json, lockfile,
   src/protocol.ts and four READMEs. Only `X.Y.Z-preview.N` versions and the
   `preview` dist-tag are supported; stable publication needs another review.
2. In GitHub Settings → Environments, create **npm** with at least one required
   reviewer. Restrict deployments to protected main. A solo maintainer may also
   be the dispatcher: this is explicit approval, not two-person separation.
   Do not bypass protection. Preflight rejects missing environments or reviewer
   rules. This PR does not create or relax environment protection.
3. Confirm npm account 2FA, package-name ownership and creation permissions.
   A registry 404 does not reserve the name. Review VALIDATION.md and architecture
   coverage; historical real-TUI ACKs predate the command rename. Do not claim
   full native-agent architecture coverage from CI fixtures.
4. For the initial **0.1.0-preview.0 only**, repository secret **NPM_TOKEN** supplies
   bootstrap authentication. Use a short-expiry, least-privilege granular token
   permitting this new package. Noninteractive direct publication requires a token
   allowed to bypass npm's 2FA prompt. Secret existence does not establish its
   permissions. Do not weaken account policy automatically: stop if unsuitable
   and use an approved local interactive first publish instead.
   Never put credentials in files, logs, issues or chat. Builds/tests/packing
   never receive this secret.
5. Obtain final approval for the exact main commit, version and mode. A merged
   preparation PR is not publication approval. Optional GitHub draft release
   notes must target that same commit; the workflow creates no tag or release.
   Runtime changes require separate reviewed evidence.

## First package: bootstrap-token

### Initial failed attempt (2026-09-27)

[Run 36308424358](https://github.com/abruption/session-peer-ts/actions/runs/36308424358)
attempted the old npm name `session-peer-ts@0.1.0-preview.0`. Build and artifact
checks passed, but the registry refused the PUT with HTTP 403 / E_STAGE_REQUIRED:
the supplied token could only stage, and the package did not exist. A Sigstore
provenance entry was created before that rejection; it is not proof of npm
publication. Both npm names returned 404 during the subsequent read-only check.

The intended npm name is now **session-peer**; the GitHub repository remains
**abruption/session-peer-ts**. Renaming does not fix the authentication restriction.
Do not rerun the old workflow or switch it to staging: a new package cannot be
created by staging. Before an approved new attempt, the owner must resolve the
initial direct-publication authorization or perform an approved interactive
first publish with 2FA. Do not disable 2FA, automatically replace credentials or
assume changing a token option bypasses current npm policy. The stored secret's
value and settings were not inspected. This PR does not reattempt publication.

### Inputs after authentication is resolved

Actions → **npm preview publication** → Run workflow → **main**:

- mode: `bootstrap-token`
- version: `0.1.0-preview.0`
- confirmation: `session-peer@0.1.0-preview.0 bootstrap-token`

Preflight requires current main SHA, successful exact-commit main CI and the
protected npm environment. Bootstrap refuses **any existing registry package**
under this name. The prepare job tests without publication credentials, packs
twice, compares hashes, checks the allowlist and tests installation/uninstallation
of the exact tarball. Its retained artifact includes tarball and manifest.json
(commit, SHA-256 and SHA-512 integrity). Actions are pinned by commit; release
builds use Node 24/npm 11.15.0 without dependency caches or lifecycle scripts.

After environment approval, a fresh job downloads the artifact without rebuilding,
rechecks main/CI/registry and validates its contents. Only one `npm publish`
step receives NPM_TOKEN (`--tag preview --access public --provenance
--ignore-scripts`). OIDC permission is also granted for provenance. Upload
network retries are disabled. Do not rerun failed or uncertain publication.

Verification compares registry integrity and preview tag, rejects accidental
latest promotion, requires registry attestation metadata, runs `npm audit
signatures`, and fresh-installs/uninstalls the published version. Only a passed
verification completes bootstrap release; a successful upload alone does not.
Bounded read-only propagation checks are not upload retries.

## Register npm Trusted Publisher after the first release

npmjs.com → package **session-peer** → Settings → Trusted publishing:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `abruption` |
| Repository | `session-peer-ts` |
| Workflow filename | `publish.yml` (no directory prefix) |
| Environment name | `npm` |
| Allowed actions | Stage-only: `npm stage publish`, not direct `npm publish` |

The workflow must exist on main. npm does not validate the connection on save;
validate it with the next authorized staged version. GitHub-hosted runners are
required. Public GitHub + public npm OIDC publishing provides provenance.

After verifying bootstrap and configuring trust, revoke its token in npm and
remove GitHub NPM_TOKEN. Set npm publishing access to **Require two-factor
authentication and disallow tokens**. These account changes need owner approval
and are not performed by this workflow. trusted-stage never references NPM_TOKEN;
an OIDC failure must not cause token fallback. Remove the bootstrap branch in a
follow-up PR.

## Later previews: trusted-stage

Prepare a new immutable preview version through a PR. Dispatch main with mode
`trusted-stage`, its exact version and confirmation
`session-peer@<version> trusted-stage`. The same gates apply. The package must
already exist; published versions are refused. One `npm stage publish` runs
with OIDC and the preview tag.

**A successful staged run is pending approval, not a public release.** Record its
stage ID from npm output. Review its tarball against the retained manifest and
approve with 2FA in npmjs.com or interactive `npm stage approve`. OIDC cannot
approve, list or view stages. Public registry metadata cannot reveal pending
stages, so collisions fail at the registry and need manual inspection, not retries.

After approval, check out the exact source commit and download that run artifact
into `release-dist/`. With Node 24 and npm 11.15.0:

```sh
node scripts/release.mjs artifact
node scripts/release.mjs verify
```

Neither command publishes. verify uses public reads, an isolated no-lifecycle
install and signature checks; it needs no publish token. Do not announce release
completion until it passes. Stable promotion and fleet installation remain
separate decisions.

## Failure handling

Missing/invalid token, 2FA challenge, missing environment, bad OIDC mapping,
non-404 registry errors, stale main, conflicting versions, upload timeout and
hash mismatch are stop conditions. Never automatically change auth mode, retry
upload, unpublish, move a tag, reuse a version or promote latest to obtain green
checks. Inspect registry/staged state and retained evidence first. Read-only
verification of the exact artifact may be repeated; publication may not.
A broken/partial public release requires a reviewed new version and approval.

## Sources

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing)
- [npm stage CLI and token/2FA behavior](https://docs.npmjs.com/cli/v11/commands/npm-stage)

Requirements checked 2026-09-27: OIDC needs npm ≥11.5.1, staging ≥11.15.0, both
with Node ≥22.14.0. Application support remains Node 22.13+ within 22.x and 24.x;
release-tool requirements are separate.
