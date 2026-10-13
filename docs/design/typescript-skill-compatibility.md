# TypeScript skill metadata guard

This document retains the original TS source proposal and dated design review for [#118](https://github.com/abruption/session-peer-ts/issues/118), based on the companion [Draft #20 at `963c3d7`](https://github.com/abruption/session-peer-skill/blob/963c3d748a11b1164013ee26c9c0ef285c52b285/docs/typescript-compatibility.md). Companion [design acceptance at `699a325`](https://github.com/abruption/session-peer-skill/blob/699a3251830c30c62d0f812363faf4d0eb0c8e0c/docs/typescript-compatibility.md) records the full static review of the exact candidates below on 2026-10-09. This design-only acceptance does not authorize runtime merge/release, successor skill metadata/publication, installation or pin changes, content authenticity, or live delivery support.

## Separate version meanings

The skill repository tag, Python skill revision, TS skill revision, and npm runtime version are independent. `runtime-min-version` describes the skill's baseline CLI compatibility floor; `runtime-full-version` describes its documented published CLI feature coverage reference. Neither is a security recommendation, a doctor-acceptance rule, permission to send, or evidence of platform/native compatibility. Optional operations still need their actual resolved TS executable's version/help and prerequisites.

The published 0.3.4 checkpoint at [`afed4a5a8945012faf1b23d52cffecb70470a5b3`](https://github.com/abruption/session-peer-ts/tree/afed4a5a8945012faf1b23d52cffecb70470a5b3) has the following finite runtime/profile matrix. The separate issue #139 / Draft #140 extension and 0.3.5 preparation are documented below; it does not change that immutable published artifact:

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

All compatible rows also require exactly one `name: session-peer-ts`. Inspection uses this runtime’s compiled `VERSION`, without executing a binary. Public 0.3.3 accepts both reviewed profiles, while the immutable public 0.3.2 artifact remains legacy-only. The immutable published 0.3.4 source/package uses compiled `VERSION=0.3.4` and preserves the two exact reviewed profiles; its guard rejects unreviewed runtimes such as 0.3.5. Issue #139 / Draft #140 adds a separate proposal below. The 0.3.5 preparation changes the candidate compiled default, without changing that published artifact. At the earlier PR #134 checkpoint, compiled `VERSION` was 0.3.3 and the added 0.3.4 row was exercised through explicit validator arguments. That checkpoint is historical; source support does not establish registry publication. Tests exercise exact profiles, mismatches and unreviewed runtimes. Every later runtime/profile row needs explicit review; minimum/full arithmetic does not replace this finite matrix.

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

The proposed **G04** expectation is fixed as exactly `{ status: 'unknown', code: 'skill_metadata_missing' }`, with no `verification` property, when the inspecting runtime identity is unavailable or malformed, including ambiguous non-scalar identity evidence. Its precondition is healthy bounded legacy/successor metadata: a readable regular file within the byte budget, valid UTF-8, stable file/path evidence, and valid frontmatter/name/profile. Earlier reader failures retain their own envelopes. The existing [`test/skill-metadata.test.ts`](https://github.com/abruption/session-peer-ts/blob/3cd52c166638e4833798e979a55ac71a0405d740/test/skill-metadata.test.ts) test `finite runtime/profile matrix preserves public 0.3.2 and checks the 0.3.3 candidate proposal` asserts this exact object for both profiles with explicit `null`, `{}`, `0`, `''`, `'0.3.3-preview.1'`, and `'00.3.3'` runtime arguments. An omitted or explicitly `undefined` helper argument uses the compiled `VERSION` default and is not an unavailable-identity fixture; the candidate test asserts both omitted and explicit `undefined` arguments use that compiled default. A valid but unsupported stable runtime (for example, `0.3.5` in the published 0.3.4 checkpoint; `0.3.6` in the Draft #140 helper extension) instead returns exactly `{ status: 'incompatible', code: 'skill_contract_mismatch', verification: 'metadata_only' }`. This documents the TS proposal's G04 expectation covered by the exact static design acceptance below; it does not establish runtime publication or live delivery.

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

## Draft successor profile planning — #139

[#139](https://github.com/abruption/session-peer-ts/issues/139) proposes a separate successor profile for the updated TS skill documentation. The profile and inspecting runtime below are **Draft candidates**, not an agreed contract or published support. They do not replace the published matrix above. At the original [Draft #140 checkpoint `b917769`](https://github.com/abruption/session-peer-ts/tree/b917769047db41dedcb4aa1367a1b89915beb000), compiled `VERSION=0.3.4` rejected the proposed `0.2.1` skill profile by default and candidate `0.3.5` support was exercised only through explicit helper arguments. This 2026-10-13 preparation now uses candidate compiled `VERSION=0.3.5`; the candidate default inspector accepts the three exact profiles below. Neither dependency PR #140 nor this preparation is merged or published. Exact companion profile and complete final skill bytes remain unagreed, and no new skill installation pin is approved.

| Candidate inspecting runtime | Skill version | Implementation | Minimum | Full | Policy | Proposed verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `0.3.5` (unpublished compiled candidate / helper fixture) | `0.1.0` | `typescript` | `0.1.0` | `0.1.0` | `probe-help` | compatible / skill_contract_compatible / metadata_only |
| `0.3.5` (unpublished compiled candidate / helper fixture) | `0.2.0` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | compatible / skill_contract_compatible / metadata_only |
| `0.3.5` (unpublished compiled candidate / helper fixture) | `0.2.1` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | compatible / skill_contract_compatible / metadata_only |
| Published `0.3.2`, `0.3.3`, or `0.3.4` | Proposed `0.2.1` profile above | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | incompatible / skill_contract_mismatch / metadata_only |
| Unreviewed `0.3.6`, `0.4.0`, or other future runtime | Any of these profiles | Any | Any | Any | Any | incompatible / skill_contract_mismatch / metadata_only |

The proposed minimum/full values retain their existing meanings; neither implies acceptance by earlier inspectors or introduces a version range. Compatible results require the existing exact name, grammar and bounded stable-file evidence. Reader errors, malformed metadata and unavailable runtime identity retain their existing envelopes. An explicit runtime argument is test evidence, not evidence that that runtime was built, installed or published.

Companion [PR #33](https://github.com/abruption/session-peer-skill/pull/33), merged at [`eb239fb358336d85b49bab2c80e4ea39037d1374`](https://github.com/abruption/session-peer-skill/tree/eb239fb358336d85b49bab2c80e4ea39037d1374), updates TS documentation for published runtime `0.3.4` while preserving the `0.2.0` frontmatter. Its newer main-file bytes are not a replacement for the immutable `session-peer-ts-v0.2.0` release or an approved new TS skill installation pin. Companion [issue #31](https://github.com/abruption/session-peer-skill/issues/31) concerns the distinct, unshipped `0.4` scope; this patch-profile proposal does not adopt or publish that feature scope.

The required rollout order remains:

1. Review the exact candidate profile and fixtures, then obtain separate authorization to merge and actually publish its supporting TS runtime. Record that runtime's exact version, source and artifact evidence.
2. Obtain separate skill approval, finalize its metadata and content, and publish an immutable TS skill tag/source. A runtime helper fixture alone cannot authorize this step.
3. Update the four-language TS guides and PARITY together to the reviewed, published immutable skill source.

Until those steps complete, the existing skill source pin `8482cf644507c682915e35c85aa3384c53864906` and its published metadata remain unchanged. The original Draft #140 did not change the runtime version. This preparation changes the candidate version only; Python skill/runtime/reference/parity, installation, PATH, postinstall behavior, delivery/ACK support and operational settings remain unchanged. It does not authorize merge, tags, runtime/skill publication or a live experiment.

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
