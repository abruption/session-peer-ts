# Proposal: operator checklist for remote qualification

Status: **Design only; human review required.** Issue [#158](https://github.com/abruption/session-peer-ts/issues/158),
following [#23](https://github.com/abruption/session-peer-ts/issues/23).
Draft date: 2026-10-21. No release version is assigned; priority is P2.

## Purpose and boundary

Help an operator assess one explicitly provisioned, exact-version TypeScript
installation using a small evidence worksheet. The result describes checks;
it neither activates an installation nor authorizes another action.

The [remote deployment ADR](remote-deployment.md) remains a historical proposal
with dated experiments. This checklist does not implement its F2–F6 follow-ups
or adopt its journal, receipt, lock, activation or recovery machinery. The
2026-10-20 decision in #23 supersedes its earlier release planning: Draft #155
is deferred and excluded from 0.5.0. Its commits and evidence remain historical;
they are not the implementation starting point for this proposal.

Installation, rollout, repair, activation, rollback and retention belong to the
operator and the installation's owning manager. No manager takeover, installer,
runtime update, source-streaming fallback, distributed lock, caller accounting,
receipt ownership, recovery/resume protocol or automated cleanup is introduced.
No runtime, CLI flag, schema or program is proposed here.

Existing exact-version SSH preflight, host-key checks, submission/unknown and
no-resend behavior remain requirements. Passing this checklist proves neither
message delivery nor ACK and grants no permission to switch callers, delete
files, break locks, publish receipts or clean up storage. Existing runtime
handoff and ACK contracts are outside this design.

## Operator workflow

1. Select the destination, account, installation path, owning manager and exact
   intended local/remote version. Record the intended OS/architecture and runtime
   cell. If selection or ownership is uncertain, record that uncertainty and stop
   checks that depend on it; do not infer ownership from a marker or directory name.
2. Start a new worksheet with every check `not_checked`. Inspect only explicitly
   selected metadata and record its source and observation time. Reading a file
   never entails executing a discovered wrapper, Node, npm or agent executable.
3. Assess the static and operator-attestation checks below. Preserve missing and
   conflicting evidence. Stop dependent checks on `fail`, `unknown` or
   `unsupported`; remediation is a separate human decision.
4. If separately authorized, the operator may execute a specifically selected
   existing bounded diagnostic, then record its exact command, scope and result.
   Skipping that step leaves its check `not_checked`, without borrowing old results.
5. Review the individual results and evidence limits. Record unresolved cells and
   the next human decision. End the assessment without changing the installation.

This document grants no live experiment authorization. There is no default SSH
connection, registry request, executable discovery/run or agent contact. A future
diagnostic choice must name the destination, inputs, effects and stopping bound
before execution. `doctor --host` invokes SSH and the remote CLI;
`doctor --check-return-route` can initiate a return SSH probe. `send --dry-run`
means validation without submission, not a guarantee of zero writes, process
launches or network activity across its selected route. Diagnostic labels alone
do not establish an effect boundary; installed behavior and options need review.
No real send, ACK request or peer notification is part of this checklist.

## Check states

Each check is local to one assessment invocation and one stated predicate:
`not_checked` → `pass`, `fail`, `unknown` or `unsupported`.

| State | Meaning |
| --- | --- |
| `not_checked` | No assessment of this predicate was attempted in this invocation, including a deliberately skipped diagnostic. |
| `pass` | Sufficient current evidence supports the precise predicate, using its recorded evidence kind and scope. |
| `fail` | Sufficient current evidence demonstrates the predicate is false, such as an established version mismatch. |
| `unknown` | Attempted assessment cannot establish the predicate: missing, unreadable, stale, ambiguous or conflicting evidence, including interrupted diagnostics. |
| `unsupported` | The selected check method cannot assess this platform/runtime/path case; record the specific limitation. This is neither a pass nor a compatibility claim. |

An absent selected file is `fail` for “the selected file exists” but `unknown`
for “this installation uses the intended runtime.” A genuinely unsupported
runtime is `fail` for a supported-runtime requirement when established; it is
not hidden as an unsupported inspection method. Contradictory sources cannot
be resolved by choosing the favorable result. Record the conflict as `unknown`
unless authoritative scoped evidence establishes the predicate is false.

A later inspection is a new observation, recorded alongside the earlier one;
it does not erase a contradiction without explaining its resolution. There is
no aggregate `pass`, automatic “qualified” designation or authorization token.
All checks passing still describes only their individual predicates and scopes.

## Evidence worksheet

Use ordinary text or a table; no machine format or persistence protocol is
required. For each check record the predicate, state, evidence kind, exact source,
observed time, destination/account/path and relevant version/runtime identity,
plus the result and limits. Keep sensitive command output out of shared notes.

Distinguish these evidence kinds:

- **Static metadata:** inspected artifact/version text, path, wrapper contents,
  lockfile or computed hash. It proves only what was read at that time; it cannot
  prove the actually running version, current caller use, storage ownership or
  that a declared runtime path is the one a process uses.
- **Operator attestation:** a named operator's statement about manager ownership,
  intended caller selection or a command result. Record when and where it was
  observed and whether output is available; do not relabel it as executed evidence.
- **Executed diagnostic:** the exact command actually run in this invocation,
  installed CLI/runtime version evidence, destination/account, time, exit status,
  relevant result and observed limits. An observed banner identifies that command
  invocation, not every process, caller or storage owner on the host.
- **Historical or synthetic evidence:** dated previous runs or fixtures, kept as
  references only. Native destination execution must be identified separately
  from fake SSH, local fixtures and CI. None supplies a skipped current check.

Freshness is scoped to the observation, not a reusable time-to-live. A changed
artifact, runtime, destination, account, path, manager or invocation context
invalidates conclusions that depend on it; reinspect or record `unknown`. Record
both the declared identity and what was observed. Do not infer a source commit
from an equal version banner: current wire preflight checks the version line.

Hash equality means matching computed digests under the recorded algorithm and
scope at the observation times. It is not an unconditional proof of byte identity. It authenticates no code and proves no current
use or ownership. A missing/uncomputed hash (`null`, if so transcribed) is unknown,
never “unchanged”; two null hashes are not a successful comparison.

| Minimal check | Evidence sufficient for its limited predicate |
| --- | --- |
| Installation and manager are explicitly selected | Operator attestation naming destination/account/path and manager; uncertain ownership remains unknown. |
| Selected artifact metadata matches the intended version | Current static inspection of the named artifact; independently distinguish any executed banner result. |
| Declared runtime/path/native dependency match the intended cell | Explicit metadata inspection, with missing facts unknown; native loading and actual runtime selection require separately scoped executed evidence. |
| Existing other-manager executables were preserved | Explicit before/after byte measurements of named files, if available; unmeasured entries remain unknown. This does not establish storage ownership. |
| Selected existing diagnostic returned the stated result | Actual authorized invocation and output; `doctor` exit 0 alone does not mean `ready=true`, native lock verified or send authorized. |
| Remaining destination cell has bounded native evidence | Exact dated OS/arch/account/runtime/package/native-check scope; no expansion to another cell or complete platform support. |

## Remaining #23 work and evidence limits

This is a classification of open work, not a new completion claim. “Live” below
means separately scoped native destination execution; none was run for this design.

| Remaining criterion | Appropriate evidence/work | Current disposition |
| --- | --- | --- |
| Explicit same-version provisioning and supported absolute runtime/native dependency | Docs + static metadata + operator selection; live invocation/native load for actual execution | Preserve exact-version refusal. Source-build commit alignment is operator review, not wire enforcement. |
| Owning manager controls rollout/repair/rollback/retention; preserve Python/npm/uv/pipx installations | Docs + operator attestation; named before/after static measurements where needed | No new authority; a marker/hash cannot establish ownership or current callers. |
| Linux requalification under the ADR's later receipt/recovery rules and operator-check → receipt → unlock order | Separate live experiment proposal against the specifically chosen historical contract | Unrun under those later rules. This checklist neither supplies nor requires a replacement recovery engine. |
| Windows destination matrix and other account/architecture/runtime/concurrency cells | Separate live experiment proposals per cell | Bounded historical evidence only; other cells remain unrun. |
| F2–F6 capability/error/identity/provisioning follow-ups | Separate design/implementation review and validation | Proposals, not commands delivered here. No Windows-client jump qualification. |

Historical anchors remain dated: the 2026-10-02 Debian 13 x86_64/glibc 2.41
run used Node 24.21.0/22.23.3 under then-current ADR rules, with incomplete
operator ordering and later recovery rules unvalidated. The 2026-10-07 Windows
10 x64 administrator/PowerShell 5.1 run used published 0.3.1 and Node 24.16.0:
isolated offline installation, wrapper/native lock, operator SSH doctor and
nonexistent-target dry-run, plus 31 native/local fixtures. Windows Node 22.23.3
banner/native-lock smoke is separate from full installation qualification.
See the ADR's dated validation sections and their [validation records](../../VALIDATION.md).
CI/admin-only evidence and these checkpoints do not qualify complete platforms,
current installations, Windows-client jump, delivery or ACK.

## Design acceptance scenarios (review only)

These are bounded paper scenarios, not commands or tests to execute.

| Scenario | Required checklist behavior |
| --- | --- |
| Operator reviews metadata and declines diagnostics | Static predicates may pass; skipped diagnostics stay `not_checked`; no connection or executable run. |
| Metadata version differs from the intended version | Version-match check fails; stop dependent diagnostics pending a human decision. |
| Wrapper declares Node A; available command evidence reports Node B | Runtime agreement is unknown until the discrepancy is resolved; never select the favorable source. |
| Hash cannot be read, or both recorded hashes are null | Comparison is unknown; never report unchanged or authorize deletion. |
| Inspection method cannot interpret the selected native path/platform | Relevant check is unsupported with its limit; unaffected check results remain recorded. |
| Authorized doctor exits 0 with `ready=false` | Command completion may pass; readiness fails if that is its predicate; no inferred native-lock, delivery or ACK success. |
| Authorized diagnostic times out or returns an unparseable result | Record unknown and stop; do not infer completion, submission or permission to retry. |
| Old Windows success is offered for a different account/runtime or a current Linux cell | Keep the dated historical reference; current cell stays unassessed or unknown, according to whether assessment was attempted. |

## Reporter decision and review gate

Choose **checklist only** for this stage. There is no demonstrated need for a
reporter, and no implementation is authorized by this proposal. Revisit only if
operator use exposes repeated, concrete static transcription errors or effort
that a bounded regular-file inspection tool would materially reduce. That would
require a separate accepted design covering native paths, limits, explicit unknown
results and preservation of unaffected entries, without executing discovered tools.

Human review must accept the workflow, evidence limits, state meanings and #23
mapping before any implementation proposal. Any later implementation or live
experiment needs its own explicit scope and authorization. This review does not
close #23, accept #155 or commit work to a release.
