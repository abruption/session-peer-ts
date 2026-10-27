# Releasing session-peer

Publication is manual. Merging, pushing, tagging or creating a GitHub release
never dispatches `publish.yml`. Python session-peer and its Relay release train
remain independent. The last directly verified npm Trusted Publisher mapping
for `abruption/session-peer-ts`, `publish.yml`, environment `npm` allowed
`npm stage publish` only. Stage-only permission remains the required policy;
the historical 0.3.2 settings-read exception is recorded below. The workflow
uses OIDC and no npm token. The protected GitHub environment requires a reviewer
and permits deployments from `main` only.

## 0.5.1 dependency hotfix procedure — 2026-10-27 KST

Issue #163 pins smol-toml 1.9.1 to reject malformed repeated exponent signs in
Codex configuration. It preserves explicit relocated-storage refusal and the
four exact 0.5.0 skill profiles in a finite 0.5.1 row. This is a parser correctness
patch, not a claimed CVE remediation or newly qualified platform/ACK feature.
Draft #155, research #82/#142 and the repository-only reporter #160 are excluded.

The read-only registry baseline is latest=0.5.0, preview=0.1.0-preview.1 and
0.5.1 absent. Previous stable integrity is
`sha512-lLc7SFRUydY5TjcX8aE18kgfC88Wi4Mx/OXcbLlk0W9yH+JYLkxGwmZIiC7S1bczFgXzsP3xSe8DqiD7YplpDw==`.
Previous provenance endpoint:
`https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.5.0`.

1. Merge the reviewed patch under normal protections and require the exact
   merged-main release gate, Windows Node 22/24 and CodeQL checks.
2. Freshly verify npm ownership, pending stages, stage-only Trusted Publisher,
   package publish-MFA and the protected npm environment/main restriction.
   Historical exceptions apply only to their named releases; any unread gate
   needs a current explicit user exception.
3. Verify reproducible exact-source archive bytes, all packaged Markdown,
   isolated installation/version/removal and default/undefined/inspectSkill
   behavior. Both SSH endpoints must use exactly 0.5.1.
4. Obtain source approval naming the exact merged 40-character SHA,
   `session-peer@0.5.1`, `stable-stage` and eventual latest promotion to 0.5.1.
5. Dispatch the approved source/version/mode once; inspect retained Actions
   bytes before protected-environment approval and stage/provenance before the
   separate final npm 2FA approval. Do not retry an uncertain upload.
6. Verify public bytes, registry signatures/provenance and isolated lifecycle,
   preserve preview and record publication. Create the authorized v0.5.1 tag
   and GitHub Release on the verified publication source. No fleet install.

## Public 0.5.0 checkpoint — 2026-10-21 KST

[GitHub v0.5.0](https://github.com/abruption/session-peer-ts/releases/tag/v0.5.0)
and npm 0.5.0 are public from
`12f98f2793b78f647107368c06e83286c5026e05`.
The reviewed/Actions/public tarball SHA-256 is
`50f603d9e5b6db8a99b4bcab464767ad30ff38ecac3fbebc22fc03fdd4c66b1d`;
[stage-only run 39415871999](https://github.com/abruption/session-peer-ts/actions/runs/39415871999)
records publication and human gates. Its GitHub release retains the complete
public validation and settings-read exception record. The following 0.5.0
procedure is historical and must not be replayed for 0.5.1.

## 0.5.0 stable release procedure — 2026-10-20 KST

The 0.5.0 source includes platform-qualification groundwork from #153, #156
and #154. The #155 remote-maintenance harness is deferred for minimum-contract
redesign under #158 and is excluded from this release. Linux native observation, Windows
handoff storage/observation, Windows-client jump and automated receipt ACK are
not enabled. #130/#131/#20/#23 retain their remaining acceptance gates.
Experiments #82/#142 are excluded. Runtime publication does not publish, install
or repin the companion skill; the finite doctor row preserves the four exact
0.4.0 profiles.

Read-only preparation baseline: npm latest=0.4.0,
preview=0.1.0-preview.1. The verified previous stable integrity is
`sha512-mMNJ118atoflhpFTkf2+DtO7MRf7FQnPK3lKWbq/vd8Xvb5DsjUtAgydIBOcd3Xj9BCYGqM50aFhzUr4dDGHSw==`.
Previous attestation metadata:
`https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.4.0`.
Recheck registry state and target-version absence before staging.

1. Merge reviewed preparation and require exact merged-main release-gate,
   Windows Node 22/24 and CodeQL success, plus current-source review.
2. Perform fresh authenticated owner/pending-stage/Trusted-Publisher/package-MFA
   and GitHub npm environment checks. Historical settings-read exceptions and
   approvals do not carry forward; unread gates require a current user exception.
3. Validate reproducible exact-source packing, isolated installation/removal,
   compiled/default metadata acceptance and every packaged Markdown file under
   the documentation gate below. Both SSH endpoints must use exactly 0.5.0.
4. Obtain separate approval naming the merged 40-character main SHA,
   `session-peer@0.5.0`, `stable-stage` and eventual latest promotion to 0.5.0.
5. Dispatch only the approved source/version/mode. Review retained Actions bytes
   before protected-environment approval, verify staged bytes/provenance, then
   obtain separate final npm 2FA approval. Never repeat an uncertain upload.
6. Verify public integrity/signatures/provenance and isolated install/removal,
   preserve preview and record publication source. Create tags/GitHub release
   only with separate authorization. No fleet/global installation is implied.

This procedure records the required gates; preparation does not claim current
settings were audited or approvals completed. The historical 0.4.0 procedure
below must not be replayed for 0.5.0.

## Public release checkpoint — 0.4.0 (2026-10-18 KST)

`session-peer@0.4.0` is public with latest=0.4.0 and unchanged
preview=0.1.0-preview.1. Publication source is
`dde3923efe116f87f38b1639b29b889d2b832e44`; stage-only workflow
[39077096491](https://github.com/abruption/session-peer-ts/actions/runs/39077096491)
completed once after exact-source approval, protected GitHub npm environment
approval and final user npm approval. Reviewed, merged-source, retained Actions,
staged and public archives are byte-identical. Public signature/provenance and
isolated installation/removal checks passed; see the
[public validation record](VALIDATION.md#public-040--2026-10-18-kst).
[GitHub v0.4.0](https://github.com/abruption/session-peer-ts/releases/tag/v0.4.0)
and its annotated tag point to that same immutable source.

The Trusted Publisher mapping was freshly checked as stage-only. The user
explicitly skipped the separate web package publish-2FA policy read for this
publication; that policy is not freshly audited. Actual environment and final
npm approvals were completed. This exception applies only to the completed
0.4.0 release. The procedure below is historical: do not replay its approvals,
repeat its stage or republish this immutable version. Future releases require
their own baseline, reviewed source and approvals. Runtime publication does not
publish or install the separately managed companion skill.

## 0.4.0 scoped release preparation — 2026-10-18 KST

This candidate includes #106–#109: the frozen design, private sender fencing,
bounded app-server integration and qualified delivery observation. It preserves
ordinary opt-out results. Native observation is qualified only for the recorded
macOS arm64 Codex versions/topology; explicit operator confirmation is separate
from automatic receipt ACK. Linux/Windows native observation and automated
receipt producer/collector remain follow-ups #130–#132. Experiments #82/#142 are
excluded. Preparation does not publish the package or complete those follow-ups.

Read-only registry baseline: latest=0.3.6, preview=0.1.0-preview.1; 0.4.0 must
remain absent before staging. Previous stable integrity:
`sha512-8uR9/x9q2AWp/zfJox0CMgm919M7kxpAjR2vGd/ntuS2AAwQh4ohbDmAtyxLyLoEE8IPsZVEbPKHCChvIJBuoQ==`.
Previous attestation metadata:
`https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.3.6`.
Recheck tags, exact integrity and provenance source before staging. Historical
settings-read exceptions and publication approvals do not carry forward.

1. Review and merge the release preparation; require successful exact merged-main
   release gate, Windows Node 22/24 and CodeQL checks, plus current-head reviews.
2. Fresh authenticated reads verify ownership, pending stages, stage-only Trusted
   Publisher mapping, package publish-MFA and protected GitHub npm environment.
   Any unread gate needs a current explicit user exception; no protections change.
3. Validate exact-source reproducible packing, isolated version/install/removal,
   skill metadata defaults and every packaged Markdown file under the
   [documentation gate](#documentation-gate-for-the-next-release).
4. Obtain separate approval naming the exact merged 40-character main SHA,
   `session-peer@0.4.0`, `stable-stage` and eventual latest promotion to 0.4.0.
5. Dispatch only the approved source/version/mode; review retained Actions bytes
   before environment approval, then verify staged bytes/provenance and obtain
   separate final npm 2FA approval. Never repeat an uncertain upload.
6. Verify public integrity/provenance/signatures and isolated install/removal;
   preserve preview and record publication source before creating an authorized
   tag/GitHub Release. No fleet/global install is authorized.

Both SSH endpoints require exactly 0.4.0. The published skill 0.2.1 pin remains
unchanged. The exact proposed skill 0.3.0 tuple has candidate-specific design/content
review and a test-only complete-file fixture; it is not a released skill or
approved installation pin. Supporting-runtime publication precedes separately approved
skill finalization/publication and later guidance-pin adoption.

## Public release checkpoint — 0.3.6 (2026-10-14 KST)

Public `session-peer@0.3.6` was verified with latest=0.3.6 and unchanged preview=0.1.0-preview.1. Source `27fc741f7dabf075e3d6f19f48f3e71d7bdc27a6`, stage-only run 38496584629, reviewed/Actions/staged/public tarball identity, provenance/signature audit and isolated install/removal are recorded in [the public validation checkpoint](VALIDATION.md#public-036--2026-10-14-kst). [GitHub v0.3.6](https://github.com/abruption/session-peer-ts/releases/tag/v0.3.6) and its annotated tag use that same publication source.

The user-approved settings-read exceptions below apply only to this completed 0.3.6 publication. Actual protected environment and final npm approvals were completed; skipped settings are not newly audited. The following 0.3.6 procedure is historical. Do not replay approvals, stage 0.3.6 again or republish this immutable version. A later release requires a new baseline, reviewed source and its own approval.

## 0.3.6 stable release procedure

This patch carries PR #146's published TS skill 0.2.1 pin and multilingual guidance from main `602cfc09b31ce8aad23e1dd9382a2448a61143f9`. It preserves the skill's immutable source/hash and all historical release evidence. Package/banner/examples use 0.3.6; its finite metadata row accepts the same three profiles as public 0.3.5. Draft #106–#109, #82 and #142 remain excluded.

Read-only preparation baseline on 2026-10-14 KST: latest=0.3.5, preview=0.1.0-preview.1, target 0.3.6 absent. Previous stable integrity: `sha512-EJc2B5tcruzHXiHDd7tyJjv2DBLYE7IHJiPVHBzLY9fSVasEQRdwx+ZZmiyBF8WHpQ7+pI3SO2VXwsQTgOWP+Q==`; attestation metadata https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.3.5. Recheck before staging. Historical settings-read exceptions do not carry forward.

At the 2026-10-14 preparation checkpoint, the user explicitly skipped the fresh Trusted Publisher lookup for this 0.3.6 publication. The current mapping/permissions are therefore not freshly confirmed; prior stage-only evidence is historical. Pending stages and ownership were checked after npm login. The user separately skipped the web package publish-MFA policy lookup for this 0.3.6 publication; that current policy is also not freshly confirmed. GitHub environment protection and actual final npm stage 2FA approval remain required. No settings, secrets, tokens or protections were changed.

1. Review/merge the release preparation and require exact merged-main CLI/release gate, Windows Node 22/24 and CodeQL success.
2. Fresh authenticated reads verify ownership, pending stages, stage-only Trusted Publisher mapping, package publish-MFA and GitHub npm environment reviewer/main-only protections. Any unread gate remains incomplete unless the user explicitly grants a current exception; settings/protections are never bypassed.
3. Verify exact-source reproducible packing, isolated installation/removal and every packaged Markdown document under the [artifact documentation gate](#documentation-gate-for-the-next-release). Historical and public skill pins remain intact.
4. Obtain separate approval naming the exact merged 40-character main SHA, `session-peer@0.3.6`, `stable-stage` and eventual latest promotion to 0.3.6.
5. Dispatch publish.yml only with that approved SHA/version/mode/confirmation. Review retained Actions bytes before protected environment approval; verify staged bytes/provenance and obtain separate final npm 2FA approval. Never retry an uncertain upload.
6. Verify public bytes/integrity/provenance/signatures and isolated version/install/removal. Preserve preview. Append dated evidence and create the user-requested GitHub v0.3.6 tag/release against the verified publication source, with exact-version SSH and separate skill/runtime lifecycle notes. No fleet install is authorized.

The historical 0.3.5 preparation and settings exceptions below apply to that completed publication only.

## 0.3.5 publication checkpoint — 2026-10-13 KST

PR #144 is merged as `5409d0acd4b559c09920a63c5fd7f11fd10f5737`; its tree matches reviewed preparation `6fdf9d65fb0b62cca3801a3733af07add5fb6553`. Exact-main CLI and CodeQL runs passed. Publication has not started: artifact review found stale current-facing unmerged/candidate text, which requires a document-only correction, human merge and new exact-source/artifact approval. The dated preparation sections below retain their historical scope.

**Current operator exception:** the user explicitly instructed skipping the fresh Trusted Publisher check and separately the web package publish-MFA policy check for this 0.3.5 publication. Neither current mapping/permissions nor package MFA policy is freshly confirmed. Historical stage-only evidence is not reclassified as a current audit. This task changed no publisher settings; the stage-only/OIDC workflow is unchanged, with no token or protection bypass introduced. Package ownership, pending stages, registry and GitHub environment checks remain separate. CLI authentication succeeded, package is public, the sole maintainer is abruption, and the pending-stage list was empty at this checkpoint. These settings-read exceptions apply only to this 0.3.5 publication. Protected GitHub environment approval and actual final npm 2FA remain mandatory separate steps.

## 0.3.5 candidate preparation — #143 (2026-10-13 KST)

The candidate uses main `afed4a5a8945012faf1b23d52cffecb70470a5b3` plus unmerged [Draft #140](https://github.com/abruption/session-peer-ts/pull/140), checkpoint `b917769047db41dedcb4aa1367a1b89915beb000`. It changes candidate VERSION/banner/package/examples to 0.3.5 and supports a proposed exact skill 0.2.1 profile, preserving the two existing profiles. Companion agreement on the exact profile and complete final skill bytes remains pending; #139 stays open. No proposed profile is a published skill or approved installation pin. The existing 0.2.0 pin remains unchanged. Draft #106–#109, #82 and #142 are excluded.

Read-only registry baseline verified during preparation: `latest=0.3.4`, `preview=0.1.0-preview.1`, 0.3.5 absent, and previous stable integrity matched the value below. Reverify before staging; this public read is not an authenticated stage/publisher/MFA audit. Previous stable integrity is:
`sha512-O9Uwpa0x1NZ8MNZCk0a1Z4hj7S+v0F0QeOJa+rKfbwcAYzBCSMwqmEWQWZQMWM36SbxVu3RowTSvpwPiKd/BDA==`.
Previous stable attestation metadata: `https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.3.4`.

1. Close the exact profile/fixture agreement gate, review the dependency and preparation, and obtain human merge approval. Require successful exact merged-main release gate, CodeQL and Windows Node 22/24 checks. Preparation alone authorizes no merge or publication.
2. Fresh authenticated reads must verify ownership, pending npm stages, stage-only Trusted Publisher mapping, package MFA and protected GitHub npm environment/reviewer/main-only restrictions. Recheck registry tags, previous integrity, provenance content/source and target absence. Any exception requires an explicit current user decision; historical exceptions are not carried forward.
3. Build and validate the exact-source archive, reproducible packing, isolated installation/removal and every packaged Markdown document under the [artifact documentation gate](#documentation-gate-for-the-next-release). Runtime/banner/archive/current examples must agree on 0.3.5; historical evidence and immutable public pins must remain intact.
4. Obtain separate approval naming the exact merged 40-character main SHA, `session-peer@0.3.5`, `stable-stage` and eventual `latest` promotion to 0.3.5.
5. Only then dispatch `publish.yml` with `source_sha=<approved SHA>`, `version=0.3.5`, `mode=stable-stage`, `confirmation=session-peer@0.3.5 stable-stage`. Review retained Actions bytes before protected environment approval, verify staged bytes/provenance, then obtain final npm 2FA approval. Never retry an uncertain upload or broaden permissions.
6. After publication, verify public integrity/provenance/signatures and isolated install/removal and append dated evidence. Preview stays unchanged. Skill finalization/publication/pin updates, tags/GitHub Releases and fleet installs remain separate decisions.

SSH endpoints require exactly the same TS client version. Public 0.3.4 and candidate 0.3.5 refuse each other. No postinstall, implicit provisioning, delivery/ACK support, auto-resend or 0.4 feature promotion is introduced.

### Exact successor candidate checkpoint — 2026-10-13 KST

The earlier pending agreement statements above describe their initial preparation checkpoints. Companion [Draft #35](https://github.com/abruption/session-peer-skill/pull/35), source `9db5420b45568dd08fc43d406dbf9ad1952f7891`, now provides the complete 13,930-byte skill 0.2.1 candidate, SHA-256 `96d5a0d049f8a4d193703af3583b198a91079d44ae373de34e94a54e2296a4d6`. Independent full-content/hash comparison and compiled guard/default/undefined/outer-inspection tests support candidate-specific design/content acceptance; see [the exact review](docs/design/typescript-skill-compatibility.md#exact-complete-successor-candidate-review--2026-10-13-kst). This is a test fixture, not a published skill, approved installation pin or final joint publication freeze. Final skill wording/bytes after actual guard publication require another exact review and separate release approval. Published pin8482cf6 remains unchanged. Local scoped tests passed24/24; exact source/artifact/current-head CI and review status are recorded in PR #144. No instruction execution, live delivery/ACK, merge, staging or publication is claimed.

## 0.3.4 stable preparation — 2026-10-12 KST

The patch integrates [PR #134](https://github.com/abruption/session-peer-ts/pull/134), merged as `c210ee963741f77153df10038c28e228ea7a902f`: Windows native exit forwarding and independently published TS skill guidance. Draft #106–#109 and #82 are excluded. Preparation is not staging or publication approval.

Read-only registry baseline at this checkpoint: `latest=0.3.3`, `preview=0.1.0-preview.1`, and 0.3.4 absent. Previous stable integrity:
`sha512-5OQ7eUlR5Oy3RHFRoR3FuBkV7LT72dfjfBEbWRCY5wYP7Dz8TmN2jlRPpo2SFHPAwosFc0WIt8Iis/vyHckxRg==`.
Previous stable attestation metadata: `https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.3.3`.
The immutable public 0.3.3 source is `c0ed30273b9e9c0049df86ae3c38486a94289527`. Historical records below are retained.

1. Review and merge this preparation, then require successful exact-main CI/release gate, CodeQL and Windows Node 22/24 for the resulting 40-character main SHA.
2. Fresh authenticated reads must verify ownership, pending npm stages, stage-only Trusted Publisher mapping/permissions, package MFA and protected GitHub npm environment/reviewer/main-only restrictions. Recheck registry tags, previous integrity, provenance content/source and target absence. This preparation performs no authenticated publication settings audit; prior approvals/exceptions do not carry forward.
3. Build and validate the exact-source archive, reproducible packing, isolated installation/removal and every packaged Markdown document. Apply the [artifact documentation gate](#documentation-gate-for-the-next-release); installation examples and runtime/banner/archive must agree on 0.3.4. Preserve historical/fixture and real-effect evidence boundaries.
4. Obtain separate approval naming the exact merged main SHA, `session-peer@0.3.4`, `stable-stage` and eventual `latest` promotion to 0.3.4.
5. Only then dispatch `publish.yml` with `source_sha=<approved SHA>`, `version=0.3.4`, `mode=stable-stage`, `confirmation=session-peer@0.3.4 stable-stage`. Review the retained Actions artifact before protected environment approval. Verify staged bytes and provenance, then obtain separate final npm 2FA approval. Never retry an uncertain upload or broaden publisher permissions.
6. After publication, verify public integrity/provenance/signatures and isolated version/install/removal, and append a dated public record. Leave preview unchanged. Tags/GitHub Releases/fleet installation require their own decisions.

SSH endpoints must both use exactly 0.3.4 when testing this package; public 0.3.3 refuses its banner. Managers/operators own upgrades. No implicit provisioning, postinstall, automatic resend, delivery/ACK support or 0.4 feature promotion is introduced. TS skill metadata/full0.3.2, published pin8482cf6 and Python1.0.2 reference remain independent and unchanged.

## 0.3.3 candidate preparation — #128 (2026-10-09 KST)

This dated checkpoint records preparation only. The candidate integrated reviewed
dependency heads
[PR #125](https://github.com/abruption/session-peer-ts/pull/125) (`d4c9138`),
[PR #127](https://github.com/abruption/session-peer-ts/pull/127) (`8c882fa`), and
[Draft PR #126](https://github.com/abruption/session-peer-ts/pull/126) (`f10b971`).
At this checkpoint all three remained open and unmerged; human review and merge
were required. Candidate integration did not establish an approved main release SHA.
No staging, publication, tag, GitHub Release or fleet rollout is authorized by
preparation [#128](https://github.com/abruption/session-peer-ts/issues/128).

The registry baseline checked at this checkpoint was **latest=0.3.2** and
**preview=0.1.0-preview.1**; 0.3.3 was the new target and was not published at that checkpoint.
Previous stable integrity:
`sha512-VNlzBqELXLFI8uCopfEdYrfweIacHeP6dMK32/4vwQJy8fUIKC64c5WCE3IwQVeCTKGMz9mXSxhzZnXmSGMuuA==`.
Previous stable attestation metadata:
`https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.3.2`.
Preserve the immutable public 0.3.2 source
`f335f07352c842f2f6ceb12bd2ca6274b52f69f7` and all historical evidence below.

1. Review the exact dependency heads and companion guard profile before their
   human merge gate. Review and merge the 0.3.3 preparation after its dependencies.
   Require successful CI and release gate for the exact resulting 40-character
   `main` SHA, including Windows Node 22/24; candidate-only checks do not qualify
   a different main SHA. Record bounded strict SSH/native and metadata reader
   evidence in VALIDATION.md without claiming ACK, consumption, general platform
   qualification or 0.4 features.
2. Perform fresh authenticated reads of package ownership, pending npm stages,
   stage-only Trusted Publisher mapping/permissions, package MFA settings and
   protected GitHub `npm` environment/reviewer/main restrictions. Recheck the
   registry baseline, previous integrity, unchanged preview tag and absence of
   0.3.3. The historical 0.3.2 settings-read exception does **not** carry forward.
   A reauthentication or unread setting leaves this gate incomplete.
3. Build and verify the local candidate archive from that exact merged source,
   including packed four-language documentation:
   package, lockfile, runtime banner, examples and tarball must agree on 0.3.3;
   archive documentation must describe its approved publication state, retain
   dated historical records, and pass the artifact documentation gate. Record
   source SHA, tarball integrity and validation without editing a validated
   archive in place. See [artifact documentation policy](#documentation-gate-for-the-next-release).
4. Obtain a separate approval naming that exact merged `main` SHA, **0.3.3**,
   **stable-stage**, and promotion of `latest` to **0.3.3**. Preparation, dependency
   review and previous release approvals do not authorize this action.
5. Only after that approval dispatch `publish.yml` with `mode=stable-stage`,
   `version=0.3.3`, `source_sha=<approved main SHA>` and
   `confirmation=session-peer@0.3.3 stable-stage`. Download the prepare job’s
   `npm-release-<SHA>` artifact and apply the documentation gate before protected
   GitHub environment approval. Verify staged bytes against that retained
   artifact and review provenance, then obtain the
   **separate final npm 2FA approval** for publication and `latest` promotion.
   Stop on uncertain staging outcomes and inspect the existing stage; do not
   retry uploads or broaden publisher permissions.
6. Verify public integrity, provenance/signatures, exact version and isolated
   install/removal; record the new public checkpoint while keeping preview and
   historical checkpoints intact. Only an **actually published** guard runtime
   can precede separate successor skill finalization/tag/publication/pin updates.
   Companion [Draft #20 design acceptance at `699a325`](https://github.com/abruption/session-peer-skill/blob/699a3251830c30c62d0f812363faf4d0eb0c8e0c/docs/typescript-compatibility.md)
   records static review of exact #126 `ba18bb8` and release Draft #129
   `bfb3d6f` on 2026-10-09; full heads/design hashes are recorded in the
   [guard design](docs/design/typescript-skill-compatibility.md#exact-companion-design-acceptance--2026-10-09-kst). No tests were rerun in that review. At that
   checkpoint, runtime and successor skill were unpublished. Design-only
   acceptance does not authorize runtime merge/release, final successor skill
   metadata/publication/installation or replace pin
   `081cc3c1d16a394bd92824333f4bc61c36951799`.

0.3.2 and 0.3.3 refuse each other's SSH version preflight. Operators and package
managers own coordinated endpoint upgrades; no postinstall, automatic deployment
or uncertain-send retry is introduced. Windows jump-host #20 and provisioning
#23 limitations remain; the Python 1.0.2 oracle and 0.4 proposals stay separate.

## Public release checkpoint — 0.3.2 (2026-10-07 KST)

Public `session-peer@0.3.2` was verified with `latest=0.3.2` and unchanged
`preview=0.1.0-preview.1`; see [the dated record](VALIDATION.md#public-032--2026-10-07-kst).
Publication source: `f335f07352c842f2f6ceb12bd2ca6274b52f69f7`; stage-only run
`37571653938`; stage `2226865d-2dac-4d42-bd4e-2e1c998b9833`.
The Actions/staged/public bytes matched, and integrity, source provenance,
signature audit and isolated install/removal passed. This is not a GitHub
Release/tag or fleet rollout record.

The procedure below is historical for this completed publication. Do not
replay its approvals, stage 0.3.2 again or republish that version. A later
release needs a new baseline, exact source approval and validation.

## Historical 0.3.2 release procedure and recorded exception

Public 0.3.2 publication completed **with a recorded exception to step 2**.
Authenticated ownership and pending stages, GitHub environment protection and
registry baselines were checked. Fresh Trusted Publisher permission and
package MFA settings reads requested reauthentication, and the operator
explicitly instructed skipping those two reads. No fresh confirmation of
either setting is claimed. Successful OIDC staging, protected environment
approval and separate npm 2FA publication are execution evidence; they do not
establish the skipped settings. This exception applies only to the historical
0.3.2 release; future releases require their own checks and approvals.

The release preparation is based on reviewed main `488ddddac302ba2ad0841061dc8df9187ff6a983`; 0.4 feature branches are excluded. The required pre-staging baseline is **0.3.1**, with `latest=0.3.1` and `preview=0.1.0-preview.1`; these are preconditions, not a permanent statement of registry state. Check the registry and dated validation record for publication status. Previous stable integrity is pinned to:
`sha512-iZq06dbm6NavHuPZYMIxAnzQN5ksqm66yufpppddVWUYkuaG5TJvktbUXTSX7v3BBFnuybEJekI0KSaDo3Xfbg==`.
Previous stable attestation metadata: `https://registry.npmjs.org/-/npm/v1/attestations/session-peer@0.3.1`. Historical records below remain historical.

1. Review and merge the 0.3.2 preparation PR, then require successful CI and release gate for the exact merged main SHA, including Windows Node 22/24. Check the current deployment qualification evidence in VALIDATION.md; pending F5 evidence is not a pass.
2. Required preflight: recheck package ownership/2FA, npm environment protection, stage-only Trusted Publisher permissions and authenticated pending stages; verify registry baselines. Historical 0.3.2 execution: ownership, authenticated stages, environment protection and registry baselines were checked; fresh Trusted Publisher permissions and package MFA settings reads were explicitly skipped under the recorded operator exception above. Those two reads are not marked complete.
3. Obtain separate approval naming the exact merged 40-character main SHA, **0.3.2**, **stable-stage**, and promotion of `latest` to 0.3.2. Preparation approval and previous release approvals do not authorize staging or publication.
4. Only after that approval, dispatch publish.yml with `mode=stable-stage`, `version=0.3.2`, `source_sha=<approved main SHA>` and `confirmation=session-peer@0.3.2 stable-stage`. Review the staged artifact and complete separate npm 2FA approval before publication.

0.3.1 and 0.3.2 refuse each other's SSH version preflight. Upgrade both endpoints together only after the chosen source or publication is approved; never retry an unknown send outcome.

## Public release checkpoint — 0.3.1 (2026-10-04 KST)

At this dated checkpoint, `session-peer@0.3.1` was public with `latest=0.3.1` and unchanged
`preview=0.1.0-preview.1`; see the [dated verification](VALIDATION.md#public-031--2026-10-04-kst).
Published source is `6b48092a0e42992d2d970dd2ff5cf457f62d3ff2` and publication
run is `37209205194`. The completed procedure below is historical: do not replay
its approval, stage 0.3.1 again or republish it. A later release needs a newly
reviewed version, baseline and exact source approval.

<a id="031-stable-release-procedure"></a>

## Completed 0.3.1 stable release procedure

The reviewed 0.3.1 source candidate covered the [reliability fixes](PARITY.md#031-reliability-fixes).
The steps below are history; the public outcome is recorded above. Previous
stable 0.3.0 integrity was pinned:
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
