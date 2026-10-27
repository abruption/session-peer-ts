# TypeScript skill metadata guard

This document retains the original TS source proposal and dated design review for [#118](https://github.com/abruption/session-peer-ts/issues/118), based on the companion [Draft #20 at `963c3d7`](https://github.com/abruption/session-peer-skill/blob/963c3d748a11b1164013ee26c9c0ef285c52b285/docs/typescript-compatibility.md). Companion [design acceptance at `699a325`](https://github.com/abruption/session-peer-skill/blob/699a3251830c30c62d0f812363faf4d0eb0c8e0c/docs/typescript-compatibility.md) records the full static review of the exact candidates below on 2026-10-09. This design-only acceptance does not authorize runtime merge/release, successor skill metadata/publication, installation or pin changes, content authenticity, or live delivery support.

## 0.5.1 finite row — 2026-10-27 KST release preparation

The 0.5.1 source candidate explicitly accepts the same four exact metadata
profiles as public 0.5.0: skill 0.1.0, 0.2.0, 0.2.1 and 0.3.0. Compiled default,
explicit `undefined`, explicit 0.5.1 and outer `inspectSkill` use this finite row.
The literal compatible result remains
`compatible / skill_contract_compatible / metadata_only`. Changed profiles and
unreviewed runtime identities such as 0.5.2 remain incompatible; malformed
runtime identities remain `unknown / skill_metadata_missing` without a
`verification` property. All historical rows remain explicit and unchanged.

The TOML dependency-correctness patch does not change this metadata parser or
its bounded reader, publish a new skill, adopt another installation pin or add
platform/ACK qualification. Runtime publication still requires its release gates;
these source fixtures are not proof of an actual npm publication. The existing
four-language skill 0.2.1 source/hash below remain unchanged.

## 0.5.0 finite row — historical release preparation

The 0.5.0 source candidate explicitly carries forward the same four exact skill
profiles as public 0.4.0: 0.1.0, 0.2.0, 0.2.1 and 0.3.0. The 0.3.0 profile
retains its `runtime-min-version: 0.1.0`, `runtime-full-version: 0.4.0`,
`runtime-implementation: typescript` and `runtime-capability-policy: probe-help`;
there is no new skill metadata or range-based acceptance. Compiled/default,
explicit `undefined`, explicit 0.5.0 and outer `inspectSkill` use that finite row.
Historical rows, parser/reader behavior, mismatch/unknown envelopes and the
immutable complete-file review fixtures stay unchanged. Unreviewed 0.5.1 and
0.6.0 identities remain incompatible, while malformed runtime identities remain
unknown with no verification field. Compatibility remains `metadata_only`, not
content authentication, feature qualification, send permission or ACK evidence.

This source change does not establish npm publication or install/update a skill.
The four-language guidance continues to use the published skill 0.2.1 source
`0f494cabd05901c03161dc91792dcf89f8e96631` and SHA-256
`8c3520f95e0d6807303be96bfa06df69887ddaf76be05f1905505d0a956820c3`.
Acceptance of the existing 0.3.0 metadata profile does not adopt a new installation
pin. Linux/Windows native observation and automatic ACK support are unaffected.

## Public 0.4.0 guard verification — 2026-10-18 KST

The public 0.4.0 tarball from source
`dde3923efe116f87f38b1639b29b889d2b832e44` has verified registry integrity
`sha512-mMNJ118atoflhpFTkf2+DtO7MRf7FQnPK3lKWbq/vd8Xvb5DsjUtAgydIBOcd3Xj9BCYGqM50aFhzUr4dDGHSw==`.
An isolated, version-specific npm installation ran its actual bundled pure
validator against published skill 0.2.1 and the complete companion Draft #37
candidate at `a969260cd511b7b81631884ff856edaf0d0d457b` (22,973 raw UTF-8 bytes,
SHA-256 `7571c79fb7ac164002daf0bf3aa7c5ba40ca8d99f5610a04d7860eee7b27df68`).
Compiled default, explicit undefined, explicit 0.4.0 and outer `inspectSkill`
returned exactly compatible/skill_contract_compatible/metadata_only. Historical
0.3.2–0.3.6 identities rejected the new profile, and unreviewed 0.3.7/0.4.1
identities remained incompatible. Supplying a historical identity to this new
helper is not execution of a historical CLI.

These are bounded metadata checks: candidate instructions were not executed,
and no native delivery, model or ACK test was added. The isolated installation
was removed. The candidate remains a separately approved skill-publication
step, not an installed skill or adopted pin. Existing published 0.2.1 source
and hash remain unchanged. The earlier fixture/checkpoint records below retain
their original exact bytes and scope.

## 0.4.0 finite row

TS source/package 0.4.0 preserves the three reviewed profiles accepted by public 0.3.6 (skill 0.1.0, 0.2.0 and published 0.2.1) and adds exactly `0.3.0 / typescript / min 0.1.0 / full 0.4.0 / probe-help` for runtime 0.4.0 only. Compiled default, explicit `undefined`, explicit 0.4.0 and outer `inspectSkill` use this finite row. All historical runtime/profile verdicts remain unchanged; old runtime identities reject the new profile, and 0.3.7, 0.4.1 and other unreviewed runtime identities remain incompatible. Parser/reader behavior and malformed/unsupported envelopes are unchanged. This is a finite row, not a SemVer range or a skill publication.

### Exact companion 0.3.0 candidate review — 2026-10-18 KST

The complete companion [Draft PR #37 checkpoint `b8ff909ffc5fe1e5b22c66a5c302be8332a76038`](https://github.com/abruption/session-peer-skill/blob/b8ff909ffc5fe1e5b22c66a5c302be8332a76038/docs/candidates/session-peer-ts-0.3.0.md) is retained as `test/fixtures/ts-skill-0.3.0-candidate.md`: **20,162 raw UTF-8 bytes**, SHA-256 `1ae3690cb5d03777bf448cf06496fed27e4a9329deb03741d6d956a3b13c5ed4`. Exact-content review found no normative blocker and accepted this profile direction at design level only. The helper fixtures check exact bytes/hash, fatal UTF-8, compiled default/undefined/explicit 0.4.0 and outer inspection, with historical, future and malformed runtime rejection. The fixture is excluded from the npm package and its instructions are never executed by these checks.

This is candidate-specific design/content review, not approval to install or publish the skill. The retained candidate still names its older feature checkpoint and review-only status; that source text is not evidence that its final guidance has been reviewed against the eventual published runtime. After actual supporting-runtime publication, final skill content and metadata require a fresh exact-head/whole-byte review and separate human publication approval. Runtime publication does not publish or install a skill. Existing four-language guidance retains the published 0.2.1 immutable source/hash below until a separately approved skill release is actually public; only then may a later guidance change adopt its immutable pin.

## 0.3.6 finite row — historical checkpoint

TS source/package 0.3.6 explicitly carries the same three reviewed skill profiles as public 0.3.5: 0.1.0, 0.2.0 and published 0.2.1. The immutable 0.2.1 source/hash below are unchanged. Default/undefined/outer inspection use compiled VERSION=0.3.6; an explicit 0.3.5 helper still returns its historical reviewed verdict. 0.3.7 and other unreviewed identities remain incompatible. Parser/reader behavior and all malformed/unsupported envelopes remain unchanged; this is an explicit finite row, not a SemVer range or a new skill release.

## Published skill 0.2.1 adoption — 2026-10-14 KST

The four guides now pin the independently published [TS skill 0.2.1 release](https://github.com/abruption/session-peer-skill/releases/tag/session-peer-ts-v0.2.1) to immutable source [`0f494cabd05901c03161dc91792dcf89f8e96631`](https://github.com/abruption/session-peer-skill/tree/0f494cabd05901c03161dc91792dcf89f8e96631/session-peer-ts). Annotated tag object `4e7df7d8f99863e86b477eacce958033d7280246` peels to that source. The complete `SKILL.md` is **13,996 raw UTF-8 bytes**, SHA-256 `8c3520f95e0d6807303be96bfa06df69887ddaf76be05f1905505d0a956820c3`. The tag, source and file identities were independently rechecked after publication; the reviewed PR head `dc303b513d9da862f2ce21d648e168fdd847ae95` and published source have identical SKILL bytes.

Public npm TS 0.3.5, source `a2057940ba19056fcaaa5551a7820f7414bd3bfa`, accepts the exact profile: skill `0.2.1`, implementation `typescript`, minimum `0.1.0`, documented feature reference `0.3.2`, policy `probe-help`. It retains legacy skill 0.1.0 and 0.2.0 acceptance. Public 0.3.2/0.3.3/0.3.4 reject skill 0.2.1; future runtime/profile combinations are not inferred from version ranges. The published 0.3.5 tarball's validator accepted these exact complete bytes with compiled default, explicit `undefined`, explicit 0.3.5 and outer `inspectSkill`; supplied historical/future identities were rejected. These helper checks are not executions of historical CLIs.

The published bytes are retained as an offline guidance fixture, distinct from the earlier candidate fixture. `compatible / skill_contract_compatible / metadata_only` is a bounded metadata result, not content authentication, send permission, delivery or ACK. Runtime and skill installation/update remain separate and manager-owned; no postinstall, global installation or implicit update was performed. Python reference 1.0.2 and Python skill pins remain unchanged; unshipped 0.4 handoff/observer/ACK and experiments are excluded. Earlier candidate, pending-publication and 0.2.0 pin records below are dated history, not the current installation guidance.

## Separate version meanings

The skill repository tag, Python skill revision, TS skill revision, and npm runtime version are independent. `runtime-min-version` describes the skill's baseline CLI compatibility floor; `runtime-full-version` describes its documented published CLI feature coverage reference. Neither is a security recommendation, a doctor-acceptance rule, permission to send, or evidence of platform/native compatibility. Optional operations still need their actual resolved TS executable's version/help and prerequisites.

The published 0.3.4 checkpoint at [`afed4a5a8945012faf1b23d52cffecb70470a5b3`](https://github.com/abruption/session-peer-ts/tree/afed4a5a8945012faf1b23d52cffecb70470a5b3) has the following finite runtime/profile matrix. The 0.4.0 candidate row and historical 0.3.6 row are documented above; the dated 0.3.5 successor rollout below is historical and does not change that immutable published artifact:

| Inspecting runtime | Skill version | Implementation | Minimum | Full | Policy | Verdict |
|---|---|---|---|---|---|---|
| `0.3.2` | `0.1.0` | `typescript` | `0.1.0` | `0.1.0` | `probe-help` | compatible |
| `0.3.2` | `0.2.0` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | incompatible |
| `0.3.3` (published) | `0.1.0` | `typescript` | `0.1.0` | `0.1.0` | `probe-help` | compatible, published guard |
| `0.3.3` (published) | `0.2.0` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | compatible, published guard |
| `0.3.4` (source/package) | `0.1.0` | `typescript` | `0.1.0` | `0.1.0` | `probe-help` | compatible, compiled guard |
| `0.3.4` (source/package) | `0.2.0` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | compatible, compiled guard |
| Other valid runtime/profile | Any | Any | Any | Any | Any | incompatible |
| Unavailable/malformed runtime identity | Any | Any | Any | Any | Any | unknown |

All compatible rows also require exactly one `name: session-peer-ts`. Inspection uses this runtime’s compiled `VERSION`, without executing a binary. Public 0.3.3 accepts both reviewed profiles, while the immutable public 0.3.2 artifact remains legacy-only. The immutable published 0.3.4 source/package uses compiled `VERSION=0.3.4` and preserves the two exact reviewed profiles; its guard rejects unreviewed runtimes such as 0.3.5. The 0.3.5 source/package adds its reviewed finite row and compiled default as documented below, without changing that published artifact. At the earlier PR #134 checkpoint, compiled `VERSION` was 0.3.3 and the added 0.3.4 row was exercised through explicit validator arguments. That checkpoint is historical; source support does not establish registry publication. Tests exercise exact profiles, mismatches and unreviewed runtimes. Every later runtime/profile row needs explicit review; minimum/full arithmetic does not replace this finite matrix.

## Limited grammar and results

This is a bounded frontmatter string-map grammar, not a generic YAML parser. The file begins with `---` and LF/CRLF, and closes its frontmatter with `---`. Exactly one root `name` scalar and one root `metadata:` map are required. The root `name` occupies one line; an indented non-comment continuation is malformed even across blank/comment lines or when the name follows the metadata map. Indented non-comment content before any root field is also malformed. Metadata entries have two-space indentation, lowercase ASCII keys, and no duplicates. Required metadata keys are `version`, `runtime-implementation`, `runtime-min-version`, `runtime-full-version`, and `runtime-capability-policy`.

Values are unescaped single/double-quoted strings or plain ASCII tokens beginning with a letter/digit and continuing with letters, digits, `.`, `_`, `/`, or `-`. A scalar value is separated from its colon by at least one literal ASCII space; comments require a separating space. For root `name`, the parser first requires that literal space and then removes leading whitespace with JavaScript `trimStart()` before parsing the scalar: `name:` followed by a literal space, a tab and the scalar is accepted, while a tab immediately after the colon is malformed. Metadata scalar separators retain their spaces-only grammar. Plain and quoted root names can occur before or after the metadata map. Quoted or noncanonical root key spellings are rejected rather than ignored as possibly ambiguous protected fields. Within `name` and `metadata`, YAML escape interpretation, tags, aliases, sequences, nested maps and block scalars are unsupported. Unrelated root fields and their indented content are ignored until the next root field; this does not permit a continuation of `name`. Protected name/map/scalar grammar does not parse or validate ignored field contents. Instruction bodies are never interpreted. The whole file must be valid UTF-8. A leading BOM, lone CR, and forbidden control characters are rejected. Body bytes are read; `metadata_only` is not a promise to avoid reading them.

| Evidence | Status / code | `verification` |
|---|---|---|
| Absent entrypoint (`ENOENT`/`ENOTDIR` before established file evidence) | missing / skill_missing | absent |
| Raw `EACCES`/`EPERM` reaching reader catch | permission_denied / permission_denied | absent |
| I/O failure, non-regular, overflow, invalid UTF-8, conflicting file evidence | unknown / skill_metadata_unreadable | absent |
| Missing/duplicate required name or scalar, missing/multiple map, unsupported syntax, BOM/control error | unknown / skill_metadata_missing | absent |
| Healthy bounded legacy/successor metadata; unavailable/malformed inspecting runtime identity, including ambiguous non-scalar evidence (proposed G04) | unknown / skill_metadata_missing | absent |
| Well-formed but unsupported name, tuple, or valid runtime | incompatible / skill_contract_mismatch | metadata_only |
| Exact supported runtime/profile/name | compatible / skill_contract_compatible | metadata_only |

The proposed **G04** expectation is fixed as exactly `{ status: 'unknown', code: 'skill_metadata_missing' }`, with no `verification` property, when the inspecting runtime identity is unavailable or malformed, including ambiguous non-scalar identity evidence. Its precondition is healthy bounded legacy/successor metadata: a readable regular file within the byte budget, valid UTF-8, stable file/path evidence, and valid frontmatter/name/profile. Earlier reader failures retain their own envelopes. The existing [`test/skill-metadata.test.ts`](https://github.com/abruption/session-peer-ts/blob/3cd52c166638e4833798e979a55ac71a0405d740/test/skill-metadata.test.ts) test `finite runtime/profile matrix preserves public 0.3.2 and checks the 0.3.3 candidate proposal` asserts this exact object for both profiles with explicit `null`, `{}`, `0`, `''`, `'0.3.3-preview.1'`, and `'00.3.3'` runtime arguments. An omitted or explicitly `undefined` helper argument uses the compiled `VERSION` default and is not an unavailable-identity fixture; the candidate test asserts both omitted and explicit `undefined` arguments use that compiled default. A valid but unsupported stable runtime (for example, `0.3.5` in the published 0.3.4 checkpoint; `0.3.6` in the 0.3.5 source/package row) instead returns exactly `{ status: 'incompatible', code: 'skill_contract_mismatch', verification: 'metadata_only' }`. This documents the TS proposal's G04 expectation covered by the exact static design acceptance below; it does not establish runtime publication or live delivery.

The proposed **G07** result for missing, duplicated, or syntactically malformed required frontmatter name/map/scalar evidence is exactly `{ status: 'unknown', code: 'skill_metadata_missing' }`, with no `verification` property. This applies after bounded regular-file evidence, valid UTF-8, and file/path stability have been established; earlier reader failures retain their own envelopes. A well-formed unsupported name or scalar remains `incompatible / skill_contract_mismatch / metadata_only`. The static grammar fixtures and `root name forbids continuations across comments or map boundaries while ignored fields retain their scope` establish this distinction. Both profiles are tested with plain/quoted names before or after metadata, one/two/four-space continuations, blank/comment-separated continuations, orphan indentation, and exact outer inspection results. Controls preserve comments, CRLF, unrelated field content, instruction bodies, and well-formed unsupported name results. This documents the TS proposal's G07 expectation covered by the exact static design acceptance below; it does not establish runtime publication or live delivery.

Path canonicalization preserves managed symlink installations. As before, wrapped canonicalization errors can reach the checker as `home_resolution_failed` and therefore `unknown`, rather than a raw permission result. No raw error message or instruction text is returned.

These are intentional changes from public TS `0.3.2` at [`f335f07`](https://github.com/abruption/session-peer-ts/blob/f335f07352c842f2f6ceb12bd2ca6274b52f69f7/src/diagnostics.ts): its checker does not validate root name and classifies missing/duplicate/malformed required metadata scalars as incompatible. Its missing/permission/unknown outputs already omit `verification`; this proposal preserves that placement. Public 0.3.2 historical behavior is not re-described as the future source grammar. Neither `compatible` verdict authenticates bytes, approves a send, or proves consumption/ACK.

## Reader bound and file evidence

The budget is **65,536 whole-file raw UTF-8 bytes**, including BOM, whitespace, line endings and body. The reader allocates and reads at most **65,537 bytes**, with one overflow-detection byte. Pre-read size checks are an early rejection, not the only bound. Fatal UTF-8 decoding happens after the bounded read.

The original entrypoint is canonicalized so a separately managed symlink installation remains usable. The canonical target is inspected with `lstat`, then opened read-only (POSIX also uses `O_NONBLOCK` and `O_NOFOLLOW`). The descriptor must be a regular file and match pre-open device/inode/size/mtime/ctime. After bounded reading, descriptor and path evidence must still match and the original entrypoint must resolve to the same canonical target. Length must match the initial size. Growth, truncation, replacement, alias change, and same-size timestamp changes produce unknown, never a tuple verdict. Disappearance after initial file evidence is conflicting evidence, not a fresh absent-entrypoint result. Every opened descriptor is closed by `finally`.

The proposed **B04** fixture `reader rejects observed malformed-content rewrites during bounded chunked reads and closes its descriptor` rewrites the same file after the first real four-byte read, preserving its inode and size. Separate cases replace a protected scalar with malformed syntax or introduce invalid UTF-8. The first returned nonempty chunk is explicitly asserted to contain four bytes, outside reader error handling. Captured read chunks, including that unchanged first chunk, must concatenate to the actual malformed payload; an explicitly observable timestamp change establishes conflicting file evidence. Each case asserts exactly `unknown / skill_metadata_unreadable`, preserved path, no `verification` property, bounded read requests/allocation, and closure of the inspected descriptor exactly once. Fixture failures and assertions are checked outside the reader's error handling. This tests rejection of an observed mutation before parsing or decoding; it does not claim that either parser ran on the malformed bytes. Static malformed/UTF-8 fixtures separately establish their classifications. No atomic snapshot or malicious same-user writer guarantee follows from these tests.

These checks detect observed changes; they do not authenticate content against a malicious same-user writer capable of restoring identical metadata, atomically freeze a file, or impose an I/O deadline on arbitrary filesystems. Windows uses read-only opens and regular-file checks; POSIX special-file and symlink replacement cases are exercised on POSIX. Windows fixtures cover portable reader, profile, grammar, resource, and growth/truncation behavior through the native CI suite.

## Fixtures and rollout

`test/skill-metadata.test.ts` exercises exact legacy/candidate matrix rows, unknown and future runtimes, every required scalar's missing/equal-duplicate/conflicting-duplicate/malformed/unsupported cases, wrong name/implementation, comments/quoting/CRLF, exact and overflow byte bounds, invalid UTF-8/BOM, regular files/FIFO, growth/truncation/replacement/alias changes including post-EOF changes, descriptor cleanup, bounded read allocation, raw error envelopes and zero runtime/network/write side effects. These are isolated local/CI fixtures, not installed-skill or delivery experiments. `test/diagnostics.test.ts` retains production doctor integration coverage.

### Exact companion design acceptance — 2026-10-09 KST

Companion [Draft #20 acceptance at `699a3251830c30c62d0f812363faf4d0eb0c8e0c`](https://github.com/abruption/session-peer-skill/blob/699a3251830c30c62d0f812363faf4d0eb0c8e0c/docs/typescript-compatibility.md) accepts the finite runtime/profile matrix, limited parser/status envelopes, G07 root-name rule, and B04 reader fixtures for these exact reviewed candidates:

| Candidate | Reviewed source head | Reviewed design document SHA-256 |
| --- | --- | --- |
| TS #126 | [`ba18bb806a6ba503381259b4255211af3adc0336`](https://github.com/abruption/session-peer-ts/blob/ba18bb806a6ba503381259b4255211af3adc0336/docs/design/typescript-skill-compatibility.md) | `3d003cb3541add314941a8d72dc03648f4cabf7ab5a6d3a83d60ff8cc24fb8ea` |
| Release Draft #129 | [`bfb3d6f1256ab076a76660e08a7bf1ad071a6c6c`](https://github.com/abruption/session-peer-ts/blob/bfb3d6f1256ab076a76660e08a7bf1ad071a6c6c/docs/design/typescript-skill-compatibility.md) | `43244535795e22e720516415d79766cffa017b59daf9f070e1cfae632d19fbd1` |

This was read-only source, test and document review with CI-status confirmation; no tests were rerun in that review. At this dated checkpoint, the runtime and successor skill were unpublished. Acceptance applies to design and fixture profiles at the named heads; it does not authorize runtime merge/release, final successor skill metadata, publication, installation or pin changes, and establishes no live delivery, consumption or ACK. The two nonblocking syntax-precision follow-ups recorded in that acceptance are clarified here and covered by added plain-name-after-map and root whitespace fixtures, without changing parser behavior.

At the earlier 2026-10-09 coordination checkpoint, a dry-run found an inactive companion session and queued nothing, and a later authorized request was queued without established consumption or a review response. Those attempts remain historical evidence only; the immutable acceptance record above supplies the subsequent design review. Final skill metadata/publication/pin changes still require their own approval.

The rollout requirement at that checkpoint was that, after separate merge/release authorization, the guard runtime must actually be published and its exact source/artifact/profile evidence recorded **before** finalizing and separately publishing successor skill metadata. Only then may the reviewed immutable skill pin and four-language guidance/PARITY change together. At that preparation checkpoint, the proposal did not modify the companion/Python repository or existing skill pin, Python runtime/reference/parity, global installation, PATH, or metadata release. No postinstall or automatic deployment is introduced. Unshipped 0.4 handoff/ACK/observation and unsupported wake/Antigravity/Relay/MCP remain outside this work.


## Published skill follow-up — 2026-10-12 KST

The dated proposal/review above preceded publication. Public npm 0.3.3 uses source [`c0ed30273b9e9c0049df86ae3c38486a94289527`](https://github.com/abruption/session-peer-ts/tree/c0ed30273b9e9c0049df86ae3c38486a94289527), independently of the skill revision. The companion [release `session-peer-ts-v0.2.0`](https://github.com/abruption/session-peer-skill/releases/tag/session-peer-ts-v0.2.0) points to immutable source [`8482cf644507c682915e35c85aa3384c53864906`](https://github.com/abruption/session-peer-skill/tree/8482cf644507c682915e35c85aa3384c53864906/session-peer-ts). Its annotated tag object is `de7d619aebdfb4a8fe86893dc70728f646032e8d`. The final `SKILL.md` is 12,835 bytes with SHA-256 `00c6fc343fdbeb8f6dc1b1ee1b730f04cef71bbfb08205a7be3559202f1d8804`; the tag target and file bytes were rechecked against that exact source for this follow-up.

Final metadata is skill `0.2.0`, implementation `typescript`, minimum `0.1.0`, full `0.3.2`, policy `probe-help`. Four-language guidance now pins that published source. This publication checkpoint does not turn `metadata_only` into instruction authenticity, execution authority, full platform qualification, consumption or ACK. Python metadata and the Python 1.0.2 parity/reference pin remain unchanged.

The 0.3.4 source/package preserves both exact published profiles through its compiled default. PR #134 initially checked that row only through explicit validator arguments with compiled VERSION 0.3.3; the subsequent 0.3.4 preparation changed the runtime version. No skill metadata change, new skill publication, installation or future-range compatibility is included.

<a id="draft-successor-profile-planning--139"></a>

## 0.3.5 source support and successor rollout — #139

The preparation notes and rollout conditions in this section are retained from 2026-10-13. Publication and current pin adoption are recorded in [the 2026-10-14 checkpoint](#published-skill-021-adoption--2026-10-14-kst).

[#139](https://github.com/abruption/session-peer-ts/issues/139) tracks the separate successor profile and rollout for updated TS skill documentation. The 0.3.5 source/package adds exactly the skill 0.2.1 profile below while retaining legacy 0.1.0 and published 0.2.0. Its complete candidate bytes/profile were reviewed for guard preparation as recorded below; final skill publication wording, immutable release and installation pin remain separate. Source/package support does not itself establish npm or skill publication.

At the original [Draft #140 checkpoint `b917769`](https://github.com/abruption/session-peer-ts/tree/b917769047db41dedcb4aa1367a1b89915beb000), compiled VERSION was 0.3.4 and candidate 0.3.5 support was exercised only through helper arguments. [PR #144](https://github.com/abruption/session-peer-ts/pull/144) integrated that implementation and the compiled-default/full-file tests; its merge source is `5409d0acd4b559c09920a63c5fd7f11fd10f5737`. At that release-preparation checkpoint, compiled VERSION was 0.3.5. Public 0.3.4 remains immutable; at that preparation checkpoint, no successor skill installation pin was approved.

| Inspecting source/package runtime | Skill version | Implementation | Minimum | Full | Policy | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `0.3.5` (source/package) | `0.1.0` | `typescript` | `0.1.0` | `0.1.0` | `probe-help` | compatible / skill_contract_compatible / metadata_only |
| `0.3.5` (source/package) | `0.2.0` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | compatible / skill_contract_compatible / metadata_only |
| `0.3.5` (source/package) | `0.2.1` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | compatible / skill_contract_compatible / metadata_only |
| Published `0.3.2`, `0.3.3`, or `0.3.4` | Proposed `0.2.1` profile above | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | incompatible / skill_contract_mismatch / metadata_only |
| Unreviewed `0.3.6`, `0.4.0`, or other future runtime | Any of these profiles | Any | Any | Any | Any | incompatible / skill_contract_mismatch / metadata_only |

The minimum/full values retain their existing meanings; neither implies acceptance by earlier inspectors or introduces a version range. Compatible results require the existing exact name, grammar and bounded stable-file evidence. Reader errors, malformed metadata and unavailable runtime identity retain their existing envelopes. An explicit runtime argument is test evidence, not evidence that that runtime was built, installed or published.

Companion [PR #33](https://github.com/abruption/session-peer-skill/pull/33), merged at [`eb239fb358336d85b49bab2c80e4ea39037d1374`](https://github.com/abruption/session-peer-skill/tree/eb239fb358336d85b49bab2c80e4ea39037d1374), updates TS documentation for published runtime `0.3.4` while preserving the `0.2.0` frontmatter. Its newer main-file bytes are not a replacement for the immutable `session-peer-ts-v0.2.0` release or an approved new TS skill installation pin. Companion [issue #31](https://github.com/abruption/session-peer-skill/issues/31) concerns the distinct, unshipped `0.4` scope; this profile extension does not adopt or publish that feature scope.

The required rollout order remains:

1. Review the exact candidate profile and fixtures, then obtain separate authorization to merge and actually publish its supporting TS runtime. Record that runtime's exact version, source and artifact evidence.
2. Obtain separate skill approval, finalize its metadata and content, and publish an immutable TS skill tag/source. A runtime helper fixture alone cannot authorize this step.
3. Update the four-language TS guides and PARITY together to the reviewed, published immutable skill source.

At that preparation checkpoint, until those steps completed, the existing skill source pin `8482cf644507c682915e35c85aa3384c53864906` and its published metadata remain unchanged. The original Draft #140 did not change the runtime version. The 0.3.5 source/package activates the reviewed finite profile through its compiled version; Python skill/runtime/reference/parity, installation, PATH, postinstall behavior, delivery/ACK support and operational settings remain unchanged. It does not authorize merge, tags, runtime/skill publication or a live experiment.

## 0.3.5 preparation boundary — 2026-10-13 KST

The candidate is based on main `afed4a5a8945012faf1b23d52cffecb70470a5b3` plus unmerged Draft #140 `b917769047db41dedcb4aa1367a1b89915beb000`. The initial companion inactive-session dry-run was refused without submission. After user activation, a stable-writer dry-run passed and one review request was queued under correlation `STS-035-SKILL-PROFILE-REVIEW-20261013-A`; consumption, review and agreement remain unconfirmed. Profile numbers and complete successor bytes require explicit companion agreement before the rollout can close. Issue #139 therefore remains open. Public skill 0.2.0 source `8482cf644507c682915e35c85aa3384c53864906`, SHA-256 `00c6fc343fdbeb8f6dc1b1ee1b730f04cef71bbfb08205a7be3559202f1d8804`, remains the installation pin. Draft #106–#109, Side Session #82 and steering #142 are excluded. Release preparation is not runtime or skill publication approval.

## Conditional successor-profile review — 2026-10-13 KST

The companion reply under `STS-035-SKILL-PROFILE-REVIEW-20261013-A` reported `conditional_profile_direction_accepted` for Draft #140 exact head `b917769047db41dedcb4aa1367a1b89915beb000`. Its reported source/test/document hashes were independently rechecked against that commit:

| File at the reviewed dependency head | SHA-256 |
| --- | --- |
| `src/skill-metadata.ts` | `2a6e2a572d563cd57ebda825aca5d278dd786fbaea12a33caa258b8e436d4e60` |
| `test/skill-metadata.test.ts` | `93b5c50a2da9df14939f404c67f9bb2dc07ea790816c4eee2bf1b759780f9052` |
| `docs/design/typescript-skill-compatibility.md` | `cbda1b7038d32e8b0f948cdb2c57c7486cb7b37be6e5fd416a097615f5f743a5` |

That review did not test the release candidate compiled default or accept full successor instruction bytes. The preparation now adds direct literal-result assertions for omitted runtime, explicit `undefined` and outer `inspectSkill` against each of the three profiles with compiled `VERSION=0.3.5`; it still requires exact-head companion review and complete SKILL candidate bytes/hash. This is conditional direction, not full design/content freeze, publication support or merge/release authorization. Existing published pin and runtime-first rollout requirements remain.

## Exact complete successor candidate review — 2026-10-13 KST

Companion [Draft #35](https://github.com/abruption/session-peer-skill/pull/35) at exact source [`9db5420b45568dd08fc43d406dbf9ad1952f7891`](https://github.com/abruption/session-peer-skill/blob/9db5420b45568dd08fc43d406dbf9ad1952f7891/session-peer-ts/SKILL.md) supplies the complete proposed skill 0.2.1. It is **13,930 raw UTF-8 bytes**, SHA-256 `96d5a0d049f8a4d193703af3583b198a91079d44ae373de34e94a54e2296a4d6`. TS setup document SHA-256 is `b9f34cf06840c63c1d26dd835c512ce4b6e457063d1808eb73bc7e9f5ebc70e7`; compatibility document SHA-256 is `495420a268841c8da6f9bc68039e65dc52cb95aba52e33ab906710826eeb2b43`. These exact downloaded bytes and hashes were verified independently, not inferred from the message.

A read-only full-content comparison with companion base `eb239fb358336d85b49bab2c80e4ea39037d1374` found only revision metadata and candidate/doctor/adoption introduction changes; the subsequent CLI, help, platform, permission, security, no-ACK and unknown/no-resend instructions are unchanged. The candidate distinguishes minimum/full from doctor acceptance, retains the published 0.2.0 pin, and requires actual guard publication plus separate skill approval before adoption. The companion accepted the release-default source/fixture amendment at TS `08c507ca1c2a3805b189ee05bfdd32b0d3d2dacb` for design only.

The complete bytes are mirrored in `test/fixtures/ts-skill-0.2.1-candidate.md`, excluded from npm distribution and not an installation pin. The test checks full-file length/hash and fatal UTF-8, compiled-default/undefined/explicit 0.3.5 and outer `inspectSkill` acceptance, and rejection by explicit historical 0.3.2/0.3.3/0.3.4 and future 0.3.6/0.4.0 rows. Reading this fixture never executes the instruction body.

TS accepts these exact candidate bytes/profile for **design/content review of the proposed guard preparation**, contingent on the documented tests and human review gates. This is not a joint final publication freeze, content authentication, installation approval or runtime/skill release permission. Final skill wording after actual runtime publication changes the bytes and requires a new exact-head/hash review. That final artifact, immutable install pin and synchronized four-language guidance remain separate later steps.
