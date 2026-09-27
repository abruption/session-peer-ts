# Releasing session-peer

Publication is manual. Merging, pushing, tagging or creating a GitHub release
never dispatches `publish.yml`. Python session-peer and its Relay release train
remain independent. The npm Trusted Publisher for `abruption/session-peer-ts`,
`publish.yml`, environment `npm` allows `npm stage publish` only. The workflow
uses OIDC and no npm token. The protected GitHub environment requires a reviewer
and permits deployments from `main` only.

## Current public release

`session-peer@0.1.0` is public. The registry records publication at
`2026-09-27T11:23:51.466Z`; the 2026-09-28 KST recheck found
`latest: 0.1.0` and `preview: 0.1.0-preview.1`. See the
[dated stable verification record](VALIDATION.md#public-010--2026-09-27-kst)
for source, staging run, artifact hashes, approvals and evidence limits.

The existing stable-stage code is specific to the completed 0.1.0 release and
refuses that already published version. Preparing a later stable version needs
a reviewed update to package versions, registry baselines, release gates and
tests; changing a workflow input alone is insufficient. The procedure below is
historical and must not be replayed to republish 0.1.0.

## Documentation gate for the next release

The published 0.1.0 archive retained pre-publication README wording even after
GitHub documentation was corrected. Apply this required manual artifact review
before environment approval for staging, and confirm the same artifact again
before npm 2FA approval. The automated hash/file-list checks do not judge prose.

1. Read `package/README.md`, all three translated READMEs,
   `package/VALIDATION.md` and `package/RELEASING.md` from the exact retained
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
   native submission and separately observed ACK evidence distinct. Plans in
   #33/#34 are not current capability or coverage.
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
closed in this workflow. The repository `NPM_TOKEN` secret and any remaining
bootstrap credential should be removed through a separate owner-approved account
operation; this PR neither reads nor changes those credentials.

## Sources

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing)
- [npm stage CLI](https://docs.npmjs.com/cli/v11/commands/npm-stage)

OIDC needs npm >=11.5.1 and staging needs npm >=11.15.0 with Node >=22.14.0.
Application support remains Node 22.13+ within 22.x and 24.x; release-tool
requirements are separate.
