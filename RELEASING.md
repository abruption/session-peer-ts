# Releasing session-peer

Publication is manual. Merging, pushing, tagging or creating a GitHub release
never dispatches `publish.yml`. Python session-peer and its Relay release train
remain independent. The npm Trusted Publisher for `abruption/session-peer-ts`,
`publish.yml`, environment `npm` allows `npm stage publish` only. The workflow
uses OIDC and no npm token. The protected GitHub environment requires a reviewer
and permits deployments from `main` only.

## 0.3.1 stable release procedure

0.3.1 is a source candidate for the [reliability fixes](PARITY.md#031-reliability-fixes),
not a claim of public publication. Previous stable 0.3.0 integrity is pinned:
`sha512-mdtikUMrGmMrdVSvPXdJcZeouTeuixOTzGwFKPhN66ATZqTohu9HKbejgOwXJe0/zrO+nt9asCAzAEhiHWDYGA==`.
The public attestation metadata URL is
`https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.3.0`.
The script enforces the integrity, tags and registry origin of attestation URLs;
provenance contents and full URLs require separate manual comparison with the
dated public records. Preserve `preview=0.1.0-preview.1` and its pinned integrity.

1. Merge the reviewed 0.3.1 preparation PR and require successful exact-main CI,
   including Windows Node 22/24, CodeQL and the release gate.
2. Confirm npm environment reviewers/main-only deployment policy, package
   ownership/2FA and stage-only Trusted Publisher mapping. Inspect authenticated
   `npm stage list session-peer`; stop on a conflicting stage.
3. Require 0.3.1 absent, `latest=0.3.0` and `preview=0.1.0-preview.1`, and compare
   the pinned integrity and public provenance records before approval.
4. Obtain final approval naming the exact merged 40-character main SHA,
   **0.3.1**, **stable-stage** and `latest` promotion to 0.3.1. Release preparation
   does not authorize dispatch, and historical approvals cannot be replayed.
5. Dispatch `publish.yml` with `mode=stable-stage`, `version=0.3.1`,
   `source_sha=<approved main SHA>` and
   `confirmation=session-peer@0.3.1 stable-stage`.
6. Download the prepare job's `npm-release-<SHA>` artifact and apply the
   documentation gate below before the separate protected npm environment approval.
7. Record the stage ID and compare staged bytes with the retained artifact.
   Separate final npm 2FA approval publishes 0.3.1 and promotes `latest`.
8. On the exact source/artifact, run `release.mjs artifact` and `verify`, then
   append dated public evidence to VALIDATION.md.

SSH endpoints must use the same TS version. 0.3.0 and 0.3.1 refuse each other;
coordinate upgrades. Preserve the known #20/#23 and Windows update-notice
validation limitations documented in PARITY.md. Do not claim fleet upgrades,
GitHub tags/releases or live-agent ACK from packaging or CI fixtures.

## Public release checkpoint — 0.3.0 (2026-10-03 KST)

`session-peer@0.3.0` is public with `latest=0.3.0` and unchanged
`preview=0.1.0-preview.1`; see the [dated verification and documentation
discrepancy](VALIDATION.md#public-030--2026-10-03-kst). The published source is
`05418b21fcdef890826325d56b07bb3dabce3bb0`, not the later #91 documentation
correction. The completed steps below are history. Do not replay them or stage
0.3.0 again; a later release requires a newly reviewed version, registry
baseline and exact source approval.

<a id="current-public-release--021"></a>

## Public release checkpoint — 0.2.1 (2026-09-29 KST)

`session-peer@0.2.1` was published on 2026-09-29 KST. Public verification passed
with `latest=0.2.1` and unchanged `preview=0.1.0-preview.1`; see the
[dated 0.2.1 verification record](VALIDATION.md#public-021--2026-09-29-kst).
0.2.0 was published on 2026-09-28 KST
([record](VALIDATION.md#public-020--2026-09-28-kst)). The completed 0.2.1 and
0.2.0 procedures below are history, not repeatable dispatches. A future release
requires a new reviewed version and baseline preparation PR.

<a id="030-stable-release-procedure"></a>

## Completed 0.3.0 stable release procedure

The reviewed stable target is 0.3.0, the remote usability and maintenance
release ([changes and known limitations](PARITY.md#030-remote-usability-and-maintenance)).
Its preparation PR pins previous stable 0.2.1 integrity:
`sha512-bPjriJZf7OQ5niZafwxNgMYo0DVpZldELEjp640xAfBMjBCAJatT2hPMTG9oV7xDX2ULCPUmox9+vFWc5nw0Mg==`
(recorded attestation URL
`https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.2.1`; the script
checks only its registry origin).
The preview integrity remains pinned as a preservation check. No existing tag is
removed. These historical steps alone do not constitute public evidence; see
the [dated verification record](VALIDATION.md#public-030--2026-10-03-kst) for
the actual outcome and archive documentation discrepancy.

1. Merge the reviewed 0.3.0 preparation PR into main and require successful
   exact-main CI (including Windows Node 22/24, CodeQL and the release gate).
2. Check npm environment reviewers and main-only deployment policy, package
   ownership/2FA and stage-only Trusted Publisher mapping. Inspect pending stages
   with authenticated `npm stage list session-peer`; stop on a conflicting stage.
3. Require 0.3.0 absent, `latest=0.2.1` and `preview=0.1.0-preview.1`. The script
   enforces these tags, the exact 0.2.1 and preview integrity values, and that their
   attestation metadata URLs are on the npm registry origin. It does not pin
   provenance contents or the full attestation URL; compare those manually with
   the dated public records before approval.
4. Obtain final approval naming the **exact merged main SHA** (40 characters),
   **0.3.0**, **stable-stage** and `latest` promotion to 0.3.0. An instruction to
   prepare the release does not identify a future merged SHA. Do not replay any
   historical approval.
5. Dispatch `publish.yml` on main with `mode=stable-stage`, `version=0.3.0`,
   `source_sha=<approved 40-character main SHA>`, and
   `confirmation=session-peer@0.3.0 stable-stage`.
6. Before approving the protected npm environment, download the prepare job's
   `npm-release-<SHA>` artifact and apply the documentation gate below, including
   `docs/shorthand.md` and `docs/design/remote-deployment.md`.
7. Staging uses Node 24/npm 11.15.0 (release-tool requirements in [Sources](#sources))
   and OIDC with upload retries disabled. Record the stage ID, compare the staged
   tarball with the retained artifact, and obtain the separate final npm 2FA
   approval, which publishes 0.3.0 and promotes `latest`.
8. After approval, run `node scripts/release.mjs artifact` and
   `node scripts/release.mjs verify` on that exact source/artifact and append dated
   public evidence to VALIDATION.md.

Release notes must state that SSH requires the same version on both ends, so
0.2.1 and 0.3.0 hosts refuse each other at preflight; upgrade endpoints together.
They must also list the known limitations: `--ssh-jump` is refused on Windows
clients (#20 Partial); the remote deployment design (#23) is a proposal whose
Windows cell and newest receipt/recovery rules are unvalidated; update notices
are opt-in, and their Windows refresh, failure and forged-field cells are
unverified.

## Completed 0.2.1 stable release procedure

The reviewed stable target is 0.2.1, a reliability and hardening update
([changes](PARITY.md#021-reliability-and-hardening)). Previous stable 0.2.0
integrity is pinned:
`sha512-wXUVn2GdF3fKAjJA9cUKIiBc9YVswnfBNALo2nxhXqmpCqC7/9N+AQJct/06RAU7stbcbrfY55JQ15PPESXwHw==`.
The preview integrity remains pinned as a preservation check. No existing tag is
removed.

1. Merge the reviewed 0.2.1 preparation PR into main and require successful
   exact-main CI (including Windows Node 22/24 and the release gate).
2. Check npm environment reviewers and main-only deployment policy, package
   ownership/2FA and stage-only Trusted Publisher mapping. Inspect pending stages
   with authenticated `npm stage list session-peer`; stop on a conflicting stage.
3. Require 0.2.1 absent, `latest=0.2.0`, `preview=0.1.0-preview.1`, and the 0.2.0
   and preview integrity/provenance records unchanged. The script enforces these.
4. Obtain final approval naming **exact main SHA**, **0.2.1**, **stable-stage** and
   `latest` promotion to 0.2.1. Do not replay any historical approval.
5. Dispatch `publish.yml` on main with `mode=stable-stage`, `version=0.2.1`,
   `source_sha=<approved 40-character main SHA>`, and
   `confirmation=session-peer@0.2.1 stable-stage`.
6. Before approving the protected npm environment, download the prepare job's
   `npm-release-<SHA>` artifact and apply the documentation gate below.
7. Staging uses Node 24/npm 11.15.0 and OIDC with upload retries disabled. Record
   the stage ID, compare the staged tarball with the retained artifact, and obtain
   the separate final npm 2FA approval, which publishes 0.2.1 and promotes `latest`.
8. After approval, run `node scripts/release.mjs artifact` and
   `node scripts/release.mjs verify` on that exact source/artifact and append dated
   public evidence to VALIDATION.md.

Release notes must list the stricter 0.2.1 refusals (option-name values,
SSH usage exit code 2, `sqlite_home`, Windows batch shims, relative Reply-To
`codexHome`). SSH requires the same version on both ends, so 0.2.0 and 0.2.1
hosts refuse each other at preflight; upgrade the endpoints together.

## Historical pre-0.2.0 baseline checked 2026-09-28 KST

`session-peer@0.1.0` is public. The registry records publication at
`2026-09-27T11:23:51.466Z`; the 2026-09-28 KST recheck found
`latest: 0.1.0` and `preview: 0.1.0-preview.1`. See the
[dated stable verification record](VALIDATION.md#public-010--2026-09-27-kst)
for source, staging run, artifact hashes, approvals and evidence limits.

## Completed 0.2.0 stable release procedure

The reviewed stable target is 0.2.0. Previous stable 0.1.0 integrity is pinned:
`sha512-/FtILLgUpIAgqf5FsdU5/x17IGeWO3ylmm47gbSyN3hHjD40pp5gtOeAXU3zqmye/cx7PE52Pp/oLa0ZgZyDQQ==`.
The prior preview integrity below remains pinned as a preservation check, not a
claim that a 0.2.0 preview was published. Neither existing tag is removed.

1. Merge the reviewed release preparation PR into main and require successful
   exact-main CI (including Windows Node 22/24 and the release gate).
2. Check npm environment reviewers and main-only deployment policy, package
   ownership/2FA and stage-only Trusted Publisher mapping. Inspect pending stages
   with authenticated `npm stage list session-peer`; stop on a conflicting stage.
3. Require 0.2.0 absent, `latest=0.1.0`, `preview=0.1.0-preview.1`, and both prior
   integrity/provenance records unchanged. The script enforces these baselines.
4. Obtain final approval naming **exact main SHA**, **0.2.0**, **stable-stage** and
   `latest` promotion to 0.2.0. An instruction to begin release preparation does
   not identify a future merged SHA. Do not replay any historical approval.
5. Dispatch `publish.yml` on main with `mode=stable-stage`, `version=0.2.0`,
   `source_sha=<approved 40-character main SHA>`, and
   `confirmation=session-peer@0.2.0 stable-stage`. Both workflow jobs bind
   `source_sha` to their actual `GITHUB_SHA`; moved main or mismatched input fails.
6. Before approving the protected npm environment, download the prepare job's
   `npm-release-<SHA>` artifact. Review its exact manifest/hash and packaged prose
   using the documentation gate below. Only this artifact proceeds to staging.
7. Staging uses Node 24/npm 11.15.0 and OIDC, with upload retries disabled. Record
   the stage ID, compare the staged tarball with the retained artifact, and obtain
   the separate final npm 2FA approval. Stage approval publicly publishes 0.2.0
   and promotes `latest`; staging alone does neither.
8. After approval, use that exact source/artifact to run `node scripts/release.mjs
   artifact` and `node scripts/release.mjs verify`. Verify 0.2.0 integrity,
   provenance/signatures, fresh version-specific install/uninstall, latest=0.2.0
   and unchanged preview. Append dated public evidence; do not alter a tarball.

GitHub tags/releases, companion skill merge/installation and fleet rollout are
separate operations. The companion skill is pinned and independently managed;
this npm release neither installs it nor requires executing its instructions.
The procedures below for 0.1.0 are historical, not current dispatch inputs.

## Documentation gate for the next release

The published 0.1.0 archive retained pre-publication README wording even after
GitHub documentation was corrected. Apply this required manual artifact review
before environment approval for staging, and confirm the same artifact again
before npm 2FA approval. The automated hash/file-list checks do not judge prose.

1. Read `package/README.md`, all three translated READMEs,
   `package/VALIDATION.md`, `package/PARITY.md` and `package/RELEASING.md` from the exact retained
   tarball. Compare them with the reviewed release source, not just GitHub main.
   For example, `tar -xOf /absolute/path/reviewed.tgz package/README.md` reads
   the packaged English README without installing it.
2. Match installation versions, CLI banners and POSIX/PowerShell tarball names
   against the archive's package.json. Update all four languages together and
   run the repository checker. Fixed `session-peer-<version>.tgz` examples are
   part of this review, not timeless filenames.
3. Use release wording that remains accurate after publication. Keep candidate
   checks dated and historical; record previously published versions explicitly.
   Do not claim the candidate is already publicly verified. Avoid an undated
   assertion that the archive's own version is unpublished or awaiting approval;
   keep pending approval status in the staging record instead.
4. Match CI claims to the actual workflow and platform depth. Keep fixture,
   native submission and separately observed ACK evidence distinct. Use the versioned
   matrix in PARITY.md; planned features are not current capability.
5. Record reviewer, source SHA, tarball SHA-256 and the documentation review in
   the release approval record. A wording failure requires a reviewed source
   correction and new candidate artifact with its own checks/approval; never
   edit a validated tarball in place or overwrite a published version.
6. After publication, verify registry integrity/provenance/signatures and the
   version-specific install as usual, inspect the npm rendered README when
   accessible, and append a dated public-validation record in GitHub. Preserve
   any discrepancy between that later record and immutable packaged documents.

## Historical preview baseline before stable — 2026-09-27

`session-peer@0.1.0-preview.1` was staged from main commit
`f65d3ee99cc26ff4a267aef84e31a308d034ac80` in
[run 36313884100](https://github.com/abruption/session-peer-ts/actions/runs/36313884100)
and published after a separate 2FA approval. The staged tarball matched the
retained run artifact byte for byte. Public verification passed registry
integrity, provenance metadata, `npm audit signatures`, fresh installation and
uninstallation. The artifact SHA-256 was
`d154beac93893b60b0695e5a6296e185beb8dbd05188ffe04befb74d29966110`;
registry integrity is
`sha512-h4SMvrQ/LWA9osd4EHIs9rSTqv1u+S3MXQAmn+yG/gZ9+7NwYMutq+Oa5K/0ggIq61Wfwdh11Cv+5YdEffiNMA==`.
At that pre-stable checkpoint, `preview` pointed to preview.1 and `latest`
pointed to preview.0. The subsequent approved stable release changed `latest`
to 0.1.0; the historical baseline is not the current registry state.

## Historical 0.1.0 stable procedure (completed)

1. Merge the reviewed 0.1.0 preparation PR. Require successful `cli` CI on the
   exact merged `main` commit, including the release gate and Windows Node 22/24.
   Match `0.1.0` in package.json, lockfile, src/protocol.ts and all four READMEs.
   Review [VALIDATION.md](VALIDATION.md): fixture CI and the historical real-TUI
   ACKs have different scope. The stable candidate changes the version handshake
   and release controls, not native delivery behavior.
2. Confirm the `npm` environment still has a required reviewer and permits only
   protected main. Confirm npm account 2FA, package ownership and the Trusted
   Publisher's stage-only mapping above. Do not bypass environment protection.
3. Read the public registry. `0.1.0` must be absent; `preview` must still point
   to preview.1 and `latest` to preview.0. The published preview.1 integrity and
   provenance must match the verified baseline above. Inspect pending stages with
   `npm stage list session-peer` through an authenticated owner session;
   public registry metadata cannot reveal them.
4. Obtain final approval for the **exact main SHA**, `0.1.0` version and
   `stable-stage` mode. A merged PR is not publication approval. The approval
   must also cover promotion of npm `latest` to `0.1.0` when the stage is
   approved. GitHub tag, release and fleet installation need separate decisions.

Dispatch Actions → **npm staged publication** → Run workflow → **main**:

- mode: `stable-stage`
- version: `0.1.0`
- confirmation: `session-peer@0.1.0 stable-stage`

The prepare job requires exact-main CI and the protected npm environment. It
checks the registry baseline, tests on Node 24/npm 11.15.0 without publish
credentials, packs twice, compares hashes, checks the allowlist and installs and
uninstalls the exact tarball in isolation. The retained `npm-release-<SHA>`
artifact contains the tarball and manifest.json with commit, SHA-256 and
SHA-512 integrity. Actions are pinned by commit; no dependency cache or package
lifecycle scripts are used.

After environment review, the publish job downloads that artifact without
rebuilding and repeats the main/CI/registry and artifact checks. Only one
`npm stage publish ... --tag latest --provenance --ignore-scripts` step runs with
OIDC. Network upload retries are disabled. **A successful staged workflow is
pending npm approval, not a public release.** Record the stage ID. Download its
tarball, compare it byte for byte with the retained run artifact, and obtain a
separate final approval before the owner approves that exact stage with 2FA on
npmjs.com or through interactive `npm stage approve <stage-id>`. OIDC cannot
approve, list or view stages.

After 2FA approval, check out the exact source commit and download the run
artifact into `release-dist/`. With Node 24 and npm 11.15.0:

```sh
node scripts/release.mjs artifact
node scripts/release.mjs verify
```

Neither command publishes. Verification requires the public 0.1.0 integrity,
registry provenance metadata, `latest: 0.1.0`, unchanged
`preview: 0.1.0-preview.1`, npm signature audit, and fresh install/uninstall. Announce
stable availability only after this passes. Review a Git tag, GitHub release or
fleet rollout separately.

## Later previews

The manual workflow still accepts `trusted-stage` for a new immutable preview
version with package `publishConfig.tag: preview`; it stages with OIDC and never
directly publishes. Preview preflight refuses an already published version and
requires `latest` to be stable or absent. The historical preview.1 exception
required its exact legacy `latest: 0.1.0-preview.0` and cannot authorize a
future version. Every stage needs artifact review and a separate 2FA approval.

## Failure handling

Missing environment protection, bad OIDC mapping, stale main, failed CI,
conflicting version or tag state, an existing stage, upload timeout, hash
mismatch and non-404 registry errors are stop conditions. Do not automatically
retry an uncertain upload, change authentication mode, move a tag, unpublish,
reuse a version or approve a stage. Inspect the run, stage and public registry
first. Registry propagation may lag a successful approval: `verify` performs
bounded read-only waits, never a second upload. A broken public release needs a
reviewed new version and its own approval.

The first preview.0 used a bootstrap token, and the registry assigned both
`preview` and `latest` to it despite `--tag preview`. That bootstrap path is
closed in this workflow. On 2026-09-29 KST the owner revoked the bootstrap token
and deleted the repository `NPM_TOKEN` secret; the repository and `npm`
environment now hold no Actions secrets. Publishing relies only on OIDC.

## Sources

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing)
- [npm stage CLI](https://docs.npmjs.com/cli/v11/commands/npm-stage)

OIDC needs npm >=11.5.1 and staging needs npm >=11.15.0 with Node >=22.14.0.
Application support remains Node 22.13+ within 22.x and 24.x; release-tool
requirements are separate.
