# TypeScript skill metadata guard proposal

This is the TS source implementation proposal for [#118](https://github.com/abruption/session-peer-ts/issues/118), based on the companion [Draft #20 at `963c3d7`](https://github.com/abruption/session-peer-skill/blob/963c3d748a11b1164013ee26c9c0ef285c52b285/docs/typescript-compatibility.md). Exact successor approval remains a companion review gate. This document does not establish publication, an installation pin, content authenticity, or live delivery support.

## Separate version meanings

The skill repository tag, Python skill revision, TS skill revision, and npm runtime version are independent. `runtime-min-version` describes the skill's baseline CLI compatibility floor; `runtime-full-version` describes its documented published CLI feature coverage reference. Neither is a security recommendation, a doctor-acceptance rule, permission to send, or evidence of platform/native compatibility. Optional operations still need their actual resolved TS executable's version/help and prerequisites.

The finite source proposal is:

| Inspecting runtime | Skill version | Implementation | Minimum | Full | Policy | Verdict |
|---|---|---|---|---|---|---|
| `0.3.2` | `0.1.0` | `typescript` | `0.1.0` | `0.1.0` | `probe-help` | compatible |
| `0.3.2` | `0.2.0` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | incompatible |
| `0.3.3` (source proposal) | `0.1.0` | `typescript` | `0.1.0` | `0.1.0` | `probe-help` | proposed compatible |
| `0.3.3` (source proposal) | `0.2.0` | `typescript` | `0.1.0` | `0.3.2` | `probe-help` | proposed compatible, exact companion review pending |
| Other valid runtime/profile | Any | Any | Any | Any | Any | incompatible |
| Unavailable/malformed runtime identity | Any | Any | Any | Any | Any | unknown |

All compatible rows also require exactly one `name: session-peer-ts`. Inspection uses this runtime's compiled `VERSION`, without executing a binary. The current source retains `VERSION=0.3.2`; it cannot accept the successor on the production inspection path. Pure validator tests supply `0.3.3` to exercise the proposed guard. This is neither a version bump nor a generic future-version guarantee. Every later runtime/profile row needs explicit review.

## Limited grammar and results

This is a bounded frontmatter string-map grammar, not a generic YAML parser. The file begins with `---` and LF/CRLF, and closes its frontmatter with `---`. Exactly one root `name` scalar and one root `metadata:` map are required. Metadata entries have two-space indentation, lowercase ASCII keys, and no duplicates. Required metadata keys are `version`, `runtime-implementation`, `runtime-min-version`, `runtime-full-version`, and `runtime-capability-policy`.

Values are unescaped single/double-quoted strings or plain ASCII tokens beginning with a letter/digit and continuing with letters, digits, `.`, `_`, `/`, or `-`. A scalar value is separated from its colon by at least one space; comments require a separating space. Quoted or noncanonical root key spellings are rejected rather than ignored as possibly ambiguous protected fields. YAML escape interpretation, tags, aliases, sequences, nested maps and block scalars are unsupported. Unrelated root fields are ignored; instruction bodies are never interpreted. The whole file must be valid UTF-8. A leading BOM, lone CR, and forbidden control characters are rejected. Body bytes are read; `metadata_only` is not a promise to avoid reading them.

| Evidence | Status / code | `verification` |
|---|---|---|
| Absent entrypoint (`ENOENT`/`ENOTDIR` before established file evidence) | missing / skill_missing | absent |
| Raw `EACCES`/`EPERM` reaching reader catch | permission_denied / permission_denied | absent |
| I/O failure, non-regular, overflow, invalid UTF-8, conflicting file evidence | unknown / skill_metadata_unreadable | absent |
| Missing/duplicate required name or scalar, missing/multiple map, unsupported syntax, BOM/control error | unknown / skill_metadata_missing | absent |
| Healthy bounded legacy/successor metadata; unavailable/malformed inspecting runtime identity, including ambiguous non-scalar evidence (proposed G04) | unknown / skill_metadata_missing | absent |
| Well-formed but unsupported name, tuple, or valid runtime | incompatible / skill_contract_mismatch | metadata_only |
| Exact supported runtime/profile/name | compatible / skill_contract_compatible | metadata_only |

The proposed **G04** expectation is fixed as exactly `{ status: 'unknown', code: 'skill_metadata_missing' }`, with no `verification` property, when the inspecting runtime identity is unavailable or malformed, including ambiguous non-scalar identity evidence. Its precondition is healthy bounded legacy/successor metadata: a readable regular file within the byte budget, valid UTF-8, stable file/path evidence, and valid frontmatter/name/profile. Earlier reader failures retain their own envelopes. The existing [`test/skill-metadata.test.ts`](https://github.com/abruption/session-peer-ts/blob/f10b97115830d5968ff7a0583dc470643c3cbeda/test/skill-metadata.test.ts) test `finite runtime/profile matrix preserves public legacy and contains successor source proposal` asserts this exact object for both profiles with explicit `null`, `{}`, `0`, `''`, `'0.3.3-preview.1'`, and `'00.3.3'` runtime arguments. An omitted or explicitly `undefined` helper argument uses the compiled `VERSION` default and is not an unavailable-identity fixture; the test covers omitted arguments and deliberately skips `undefined` in that fixture loop. A valid but unsupported stable runtime (for example, `0.3.4`) instead returns exactly `{ status: 'incompatible', code: 'skill_contract_mismatch', verification: 'metadata_only' }`. This fixes the TS proposal's G04 expectation for companion review; it does not establish joint approval or shipped behavior.

Path canonicalization preserves managed symlink installations. As before, wrapped canonicalization errors can reach the checker as `home_resolution_failed` and therefore `unknown`, rather than a raw permission result. No raw error message or instruction text is returned.

These are intentional changes from public TS `0.3.2` at [`f335f07`](https://github.com/abruption/session-peer-ts/blob/f335f07352c842f2f6ceb12bd2ca6274b52f69f7/src/diagnostics.ts): its checker does not validate root name and classifies missing/duplicate/malformed required metadata scalars as incompatible. Its missing/permission/unknown outputs already omit `verification`; this proposal preserves that placement. Public 0.3.2 historical behavior is not re-described as the future source grammar. Neither `compatible` verdict authenticates bytes, approves a send, or proves consumption/ACK.

## Reader bound and file evidence

The budget is **65,536 whole-file raw UTF-8 bytes**, including BOM, whitespace, line endings and body. The reader allocates and reads at most **65,537 bytes**, with one overflow-detection byte. Pre-read size checks are an early rejection, not the only bound. Fatal UTF-8 decoding happens after the bounded read.

The original entrypoint is canonicalized so a separately managed symlink installation remains usable. The canonical target is inspected with `lstat`, then opened read-only (POSIX also uses `O_NONBLOCK` and `O_NOFOLLOW`). The descriptor must be a regular file and match pre-open device/inode/size/mtime/ctime. After bounded reading, descriptor and path evidence must still match and the original entrypoint must resolve to the same canonical target. Length must match the initial size. Growth, truncation, replacement, alias change, and same-size timestamp changes produce unknown, never a tuple verdict. Disappearance after initial file evidence is conflicting evidence, not a fresh absent-entrypoint result. Every opened descriptor is closed by `finally`.

These checks detect observed changes; they do not authenticate content against a malicious same-user writer capable of restoring identical metadata, atomically freeze a file, or impose an I/O deadline on arbitrary filesystems. Windows uses read-only opens and regular-file checks; POSIX special-file and symlink replacement cases are exercised on POSIX. Windows fixtures cover portable reader, profile, grammar, resource, and growth/truncation behavior through the native CI suite.

## Fixtures and rollout

`test/skill-metadata.test.ts` exercises exact legacy/candidate matrix rows, unknown and future runtimes, every required scalar's missing/equal-duplicate/conflicting-duplicate/malformed/unsupported cases, wrong name/implementation, comments/quoting/CRLF, exact and overflow byte bounds, invalid UTF-8/BOM, regular files/FIFO, growth/truncation/replacement/alias changes including post-EOF changes, descriptor cleanup, bounded read allocation, raw error envelopes and zero runtime/network/write side effects. These are isolated local/CI fixtures, not installed-skill or delivery experiments. `test/diagnostics.test.ts` retains production doctor integration coverage.

Before merging successor acceptance, obtain exact companion review of this profile, grammar, matrix and fixtures. A dry-run coordination attempt found the saved companion session inactive; no message was queued and no inactive opt-in was used. This is not evidence that the companion has reviewed the proposal.

After separate merge/release authorization, the guard runtime must actually be published and its exact source/artifact/profile evidence recorded **before** finalizing and separately publishing successor skill metadata. Only then may the reviewed immutable skill pin and four-language guidance/PARITY change together. This PR does not modify the companion/Python repository, existing skill pin, Python runtime/reference/parity, global installation, PATH, or metadata release. No postinstall or automatic deployment is introduced. Unshipped 0.4 handoff/ACK/observation and unsupported wake/Antigravity/Relay/MCP remain outside this work.
