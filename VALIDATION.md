# Validation record — updated 2026-10-30 KST

## 0.5.2 preparation scope — 2026-10-30 KST

Preparation baseline is merged main
`1b9e762c154e1050b04f98d5c36cee0d332cf484`: #169's storage guards, scoped parity
matrix and current-version maintenance, plus #160's repository-only local static
qualification reporter. This release preparation selects package/banner/current
examples 0.5.2 and one finite doctor row preserving the four exact 0.5.1 skill
profiles. Historical evidence, the ordinary Python 1.1.0 oracle, frozen handoff
fixtures, native observation profiles and independent skill pins stay separate.

The guarded local loader-source versions are Codex 0.160.1, 0.162.1 and 0.165.0.
Source review and fixture refusal tests are not new native submission, positive
managed-preference/MDM, Linux/Windows observation, live delivery or ACK
qualification. Ordinary signed-in file-auth/keyring/cloud-unclassifiable homes
can refuse even when their accounts would not receive cloud policy. Windows
Codex send/dry-run remain unqualified and refuse before submission; ordinary
Claude behavior is separate. The owned stdio route requires its actual opened
storage binding. Existing unknown/no-resend and explicit operator-confirmed
receipt boundaries are retained.

The reporter measures only operator-selected local static metadata/digests and
keeps execution/ownership/qualification predicates independent. Its source
script, tests and two review/design documents are excluded from the npm archive;
it is not an installed command, SDK API, readiness certificate, deployment or
cleanup engine. Draft #155 and experiments #82/#142 remain excluded. The
remaining remote/platform acceptance gates in #20/#23/#130/#131/#132 are not
completed by this release preparation.

For source provenance, #169's reviewed head
`76f556cca869da95ad4368af914bad6f0f43af3d` passed its current-head matrix and
release gate; its macOS Node 24 retry followed an execution-free hosted-runner
capacity cancellation. #160's integrated head
`d2760958ebf5f1f160fb716af54e63dabcce8862` passed 12 checks in
[run 40980450661](https://github.com/abruption/session-peer-ts/actions/runs/40980450661).
Its local full suite recorded 503 tests: 491 pass, 0 fail, 11 platform skips and
1 existing TODO. The earlier integrated macOS Node 24 result had observation
`unsupported` instead of `pending`; the original cause remains unconfirmed.
The follow-up added assertion diagnostics only and did not relax outcomes,
deadlines or product guards. A later pass does not establish that original cause.
These 0.5.1 implementation-head results do not substitute for final 0.5.2
source, package, profile and exact merged-main checks.

At this dated preparation checkpoint the public registry baseline is
latest=0.5.1, preview=0.1.0-preview.1 and target 0.5.2 absent. Fresh authenticated
publisher/MFA/pending-stage checks, final-source approval, staging and publication
belong to their separate release gates. No new live-host/native/model/ACK
experiment, existing user-session input, global installation or operational
change is claimed. Final release-preparation PR and artifact records must name
the exact tested source and bytes before source/publication approval.


## 0.5.1 dependency patch preparation — 2026-10-27 KST

Baseline source: main `028780338310c9cfe469e1e1587857f730e99a1a`.
The only intervening change from public 0.5.0 is README download-badge wording.
Fresh npm advisory bulk checks across current main and the four open PR locks
reported no advisory; open Dependabot and CodeQL alerts were empty. The scheduled
[audit run](https://github.com/abruption/session-peer-ts/actions/runs/40295976850)
on that exact main passed npm audit and signature/provenance checks on 2026-10-26.
These facts do not prove the absence of every vulnerability.

The actionable dependency defect is official smol-toml 1.9.1's
[repeated-exponent-sign fix](https://github.com/squirrelchat/smol-toml/releases/tag/v1.9.1).
With installed 1.9.0, `foo=3e++20` and `foo=3e--20` both produced `{foo:3}`.
Two new doctor/transport regressions failed before the update: doctor reported
`available` instead of `unknown`, and send/dry-run did not report
`codex_config_unreadable`. With pinned 1.9.1 both regressions pass, including
root/nested invalid numbers, valid single-sign controls and no fixture queue call
on refusal. This establishes incorrect malformed-config handling, not an actual
relocated-storage bypass, credential exposure or live-agent exploit.

The tests use isolated fixture homes/queues. No existing user session, remote
host, global installation or native/model/ACK experiment is used. Full package,
profile/release and current-head CI results belong to the patch PR and its exact
source. This dated preparation record does not claim publication or fresh npm
publisher/MFA settings approval.


## 0.5.0 preparation scope — 2026-10-20 KST

This release preparation includes the merged platform groundwork from #153,
#156 and #154, package/banner/current examples for 0.5.0, one finite doctor
row preserving the four existing profiles, and the public 0.4.0 release
baseline. It does not activate the Linux candidate, Windows tree cleanup,
Windows handoff storage/native observation or Windows-client jump.

The proposed #155 deployment harness and its new qualification claims are
excluded. Its implementation and review evidence remain in that Draft PR
for minimum-contract redesign under #23; they are not release evidence.
The existing remote-deployment ADR stays at the main-branch version.

Independent test-only fixes to persisted queue/initialize readiness and
warm WAL fixture lifetime are retained. They change neither runtime guards
nor observation deadlines or assertions; the original CI timeout causes
remain unproven. Historical platform and mutation runs below keep their
recorded source checkpoints and do not qualify new 0.5.0 support cells.

Final source, current-head CI and rebuilt artifact results belong to the
release-preparation PR. Preparation performs no staging, publication,
new native/model/ACK experiment or global installation.


## Windows client jump ProxyCommand probe — #20, 2026-10-20 KST

Unreleased branch source (`windowsProxyCommand`, CLI gate unchanged) on a
Windows x64 test host: Windows 10 x64 (10.0.19045), PowerShell 5.1, Node
24.16.0, inbox-path Win32-OpenSSH `OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2`
(file version 9.5.4.1), administrator account, dedicated temporary prefix.
No network destination: the generated `ProxyCommand` program was a compiled
argv-dump `ssh.exe` that recorded `GetCommandLineW`, the real UCRT argv
(`ucrtbase` `_configure_wide_argv`) and its parent process, then exited, so
the real `ssh.exe` failed with 255 before any key exchange. `-F none` and
prefix-only known-hosts files were used.

- 27 of 27 cells matched the source-derived model: 3 dump paths (plain; a
  directory with spaces, `'`, `100%`, `(x) ^&!;,=#$`, `%PATH% %h %p %%`;
  Unicode/emoji with `#`) × 3 hops (`hop@jump`, `h_o.p-1@jump.example:2200`,
  `hop@[2001:db8::2]:22`) × 3 targets (`dummyhost`, IPv6 `2001:db8::1` with
  `-p 2222`, and a quoted `HostName` containing a space and `-oProxyCommand=x`).
  The raw command line equalled the percent-expanded value exactly; the UCRT
  argv equalled the intended hop argv (all hardening options, `-W [host]:port`
  as one argument, `-- <hop>`); the parent was the System32 `ssh.exe` itself,
  so no `cmd.exe` ran and `%PATH%`, `^&` stayed literal. OpenSSH lowercased
  the configured `HostName` before `%h` expansion.
- `ssh.cmd` and UNC paths were refused with `ssh_jump_unsupported_ssh_path`.
- On the same host, `test/ssh-jump-windows.test.ts`: 4/4 pass; `npm run
  test:windows`: 317 tests, 179 pass, 0 fail, 138 POSIX-only skips, including
  the native `ssh_jump_unsupported_platform` refusal test.
  `fs-ext-extra-prebuilt` loaded after `npm ci --ignore-scripts`.
- Observation, not yet analysed: in this non-interactive SSH session the real
  `ssh.exe` (even `ssh -G`) did not exit within 15 s when its stdin was a
  Node pipe or file, and exited promptly with stdin ignored (`NUL`). The probe
  therefore used ignored stdin. Windows-client SSH with pipe stdin is not
  covered by this record; enabling needs that analysis first.
- Cleanup: the prefix was removed and no process with the prefix in its path or
  command line remained.

The probe ran at branch revision `9d54fa3dfbb0c50a1f9624461a43a3f02824706b`
(the `windowsProxyCommand` code is unchanged by later comment and documentation
commits). The probe driver, the argv-dump source and host-identifier-free
results are kept out of the repository as review material, identified by
SHA-256 in the change description. A later correction makes the driver's exit
status depend on every cell, including refusal cells; it was not re-run, and
the recorded cells were all individually successful.

This is evidence for quoting only. Windows `--ssh-jump` stays refused: no hop
or destination connection, version other than 9.5p1, non-administrator
account, or #131 owned-process-tree cleanup (timeout, overflow, interrupt) was
exercised. Production Windows `run()` kills only the direct child; #131
leaves tree cleanup as an unselected preparation backend, so cleanup of a
`ProxyCommand` descendant is not guaranteed and blocks enabling. A stop
there remains an unknown effect with no resend.


## #131 Windows tree-cleanup backend and storage guard (preparation, not selected) — source, 2026-10-20 KST

This is a source change on top of main `98074a0fb8c4aa6dbab32203fee79ac8244faf0b`,
not a release. Production behaviour is unchanged on every platform. On Windows,
`run()` still terminates only the direct child; descendants may linger, the
child keeps its full timeout, and no new result field or signal handling was
added.

Review established a design limit for owning a process tree on Windows 10
without native code:
- Descendant ownership cannot be proven. GetProcessTimes creation/exit values
  are UTC wall-clock instants, not monotonic generations, and Win32_Process
  ParentProcessId may refer to a reused PID.
- After a clock rollback, a child of an earlier holder of a parent's PID can
  satisfy any creation-time ordering. Handle-holding fixes only the current
  identity.
- A sound boundary needs the child created inside a Job object (suspended,
  assigned, resumed), which Node's spawn cannot do.

The candidate backend `reapWindowsTree` is therefore kept unselected. It uses
held handles only, holds the visible tree before any kill, and classifies from
the post-hold snapshot only, by UTC creation-time ordering. That classifier is
provisional, not an ownership proof, and is known to be unsound under a clock
rollback. Confirmation requires a post-kill snapshot. Any observed PID swap, or
any vanished, denied or unlisted candidate, makes the result unconfirmed. Only
classifier-accepted candidates are killed. Its tests cover the algorithm and
record the rollback limit as a todo named as an unresolved design limit
(never counted as a pass or skip).

The storage guard is a read-only owner-SID/protected-DACL/reparse inspection
plus a protected private-leaf creator. It is not connected to the handoff
ledger, which still refuses Windows with `handoff_storage_unsupported`.
Accepting the token's default owner (an elevated administrator's
Administrators) is a weaker, group-wide boundary. Creator precheck, creation
and postcheck are not atomic. Null-DACL, parent-ACL and creator-race handling
remain unqualified while it is unconnected. Like the existing inspection code,
it resolves `powershell.exe` through PATH rather than a SystemRoot-pinned path.

Checkpoints. Each result belongs to the commit it was run on:
- Full local suite, macOS arm64 / Node 24.16.0, at `3dc405d`:
  - build, test types, `npm run test:package`, repository checks and
    `git diff --check` passed;
  - `npm test`, with the pinned Python 1.1.0 reference
    `8ca77cf31254c8287a2593fe484bb30a7dba2727`, passed with zero failures.
- Mutation checks, on the `f06041d` tree. Each guard was removed in turn, and
  every removal made its regression test fail. The eight guards are:
  - confirm only after a post-kill snapshot;
  - doubt on an observed PID swap;
  - no earlier-row inheritance for unlisted candidates;
  - doubt on gone or denied candidates;
  - doubt on unlisted candidates;
  - reject a root after an observed exit;
  - the creation-time check;
  - hold the visible tree before any kill.
- Comment, wording and test-name changes only, at `534d3fb`: light checks.
- At the final head, the native process-tree fixture was redesigned. Light
  checks, the focused local files and a Windows rerun of the two new test files
  cover it (below).

Separately authorized isolated runs used a Windows x64 test host: Windows 10
19045, PowerShell 5.1, Node 24.16.0 x64. The account was an administrator,
elevated over SSH. Each run used a dedicated temporary prefix and the host lock.

Runs on earlier heads, with the backend selected or exercised natively, found
and fixed:
- a detached helper exited at once;
- PowerShell 5.1 wrapped the JSON path array;
- an elevated administrator's files are owned by Administrators;
- a Node child's job ends its descendants.

Those earlier native backend runs let the classifier terminate processes it
accepted on the test host. The final head no longer runs the backend natively:
its kills cannot be bounded to fixture identities, and isolated-host approval
does not authorize terminating foreign processes.

At `f06041d`, `npm run test:windows` and `npm run test:package` passed on that
host.

Earlier fixture heads, through `534d3fb`, started a `PING.EXE` with a 600 s
lifetime and cleaned it up by PID. A grandchild could therefore have outlived a
run. Afterwards, cleanup was checked only through process command lines
containing the prefix (and later a read-only `PING.EXE` listing). Those checks
showed nothing, but no actual leak was observed or ruled out beyond them.

From the final fixture onward:
- The child and grandchild have explicit lifetimes: about 25 s for the child
  (`run()` ends it earlier through its own handle) and about 11 s for PING.
- They are never killed by PID; the test only observes PID presence until
  both are absent, then removes its directory last.
- Unreadable PIDs, or a PID still present or unknown, keep the evidence and
  fail the cleanup.
- Presence is not identity: a reused PID can look present, and an error other
  than ESRCH is reported as unknown.
- The mocked helper-transport test is skipped on win32, so a mock that misses
  can never open its fake PIDs there.

The native tests on Windows are the production baseline and the storage cases;
the reruns of the two new files are in the PR.

ACLs of existing paths were not changed; the tests set a protected DACL only on
new leaves inside the prefix. The interrupt behaviour of production `run()` on
Windows is unchanged and untested here. The following remain unrun: the Windows
CI job (where the native tests are registered), non-admin and non-elevated
cells, arm64 and cold-boot helper latency. No live agent session or message,
policy, service or account change was made.


## Unreleased Linux arm64 observation candidate — #130, 2026-10-20 KST

Source-only follow-up on the published 0.4.0 runtime; no version change.
Native selection is one exact `(process.platform-process.arch, native version,
source commit, platformOs, storage binding, owner inspection, artifact)` table
with no version range, libc/arch fallback or cross-platform inheritance.
Selectable rows are the two historical darwin-arm64 rows. A **linux-arm64 /
Codex 0.162.1 / `092d3acd…`** candidate pinned to the upstream
`aarch64-unknown-linux-musl` executable is recorded but **not activated**
(see "Activation decision" below); every Linux tuple is unsupported.

Head history: the live injection below ran with the candidate temporarily
selectable (local build of the later `b804115` tree); `b804115` and
`2f3b35d` committed it as a selectable row. Review round 2 found two
identity gaps, and the final head moves it to a non-selectable candidate.

Linux mechanics: owned app-server storage binding reads only that child's
`/proc/<pid>` (direct child, own group, all UIDs, exe inode, stable start time,
exact canonical paths, deleted descriptors refused); writer owner evidence
also requires `/proc/locks` to name the lsof owner as the sole exclusive
`flock` holder (Codex `File::try_lock`) without changing the generation; the
executable digest is checked within the original deadline.

Evidence on a Linux arm64 test host (kernel 7.0 aarch64, Node 24.18.0, ext4),
recorded in `test/fixtures/linux-observation-native-evidence.json`:

- Artifact: the user-owned standalone binary's SHA-256 `071cbe8d…cabe5` equals
  the executable extracted from upstream `rust-v0.162.1`
  `codex-aarch64-unknown-linux-musl.tar.gz` (`bf3ca271…`) and `.zst`.
- Schema: `codex app-server generate-json-schema --experimental` with empty
  isolated HOME/CODEX_HOME produced queue/add params/response, item/started
  and turn/completed hashes and an 84-method notification set identical to
  the darwin 0.162.1 evidence.
- Live injection, separately user-approved, in one new dedicated TUI thread
  started by absolute path with `--sandbox read-only --ask-for-approval never`
  (trust via a `-c` override; `config.toml` unchanged). No other Codex writer
  was live. The TUI showed an "Update available" menu with "Update now"
  preselected; it was dismissed with Esc and nothing was updated.
- A new thread is not saved (no `threads` row or history projection) until its
  first turn; a dry-run first refused `thread_not_yet_persisted`. One synthetic
  bootstrap prompt was therefore typed (turn 1). Whether the earlier Darwin
  dedicated threads had such a prior turn is **not recorded** in their evidence.
- The first send was refused **before effect** (`evidence_unsupported`,
  `submitted=false`): the structural capability check used a version-only
  lookup that became ambiguous once 0.162.1 had two platform rows. It was fixed
  (regression test failed on the pre-fix code and passed after; it now uses a
  hermetic two-platform table) and exactly one approved resend
  of the same synthetic probe followed.
- That send exited 0 with `status=queued`, `submitted=true`,
  `consumptionConfirmed=false`, state `delivered`, wait satisfied: one
  matching client-ID row (native item ID different), linked turn, writer
  generation unchanged and kernel flock holder equal to the lsof owner.
  `handoff status` and an independent `handoff wait` exited 0. ACK remained
  `not_requested`; the model's reply was not answered or treated as ACK.
  Two model turns ran in total.
- Cleanup: only the owned tmux session was killed; the codex PID and its
  `/proc/locks` entries were gone, and the private prefix and ledger were
  removed. The native thread record and Codex's own empty lock files remain;
  Codex removed one earlier stale empty lock file itself at startup.

Review follow-ups (same date):

- SSH destination requests cannot select a Linux row (`sshDestination: false`);
  a qualified linux-arm64 destination refuses required delivery before effect
  with zero queue calls and keeps the best-effort ordinary send. Darwin keeps
  its 0.4.0 destination behaviour. At `2f3b35d` (row selectable) a Linux-host
  regression showed the old code entering the row path over SSH and the fixed
  code refusing; at the final head no Linux row is selectable and the policy
  is covered by hermetic synthetic-table tests.
- Executable digest and procfs binding now run in an owned worker: at the
  original remaining budget the supervisor requests termination of the
  worker's group and the caller refuses; actual reaping of a worker blocked in
  uninterruptible kernel I/O may occur later, when the kernel returns. This is
  a refusal-at-deadline guarantee, not a bound on how long a blocked kernel
  call takes. The `--procfs-owner` reads run inside the already
  deadline-bounded writer-probe process. Canonical-path `lstat` checks remain
  in the caller, as on Darwin.
- Retained identity: the generation still binds the lock fingerprint, lsof
  pid/uid/command and `ps lstart` (1-second resolution). The kernel tick start
  time and flock holder are checked within each probe invocation, not against
  the original send, and the TUI writer's executable bytes are not pinned
  (only the owned queue child's artifact is). PID reuse within the same second
  by another `codex` that re-acquires the unchanged lock inode would not be
  detected. A retained Linux kernel identity needs a ledger-schema field and
  is a follow-up; generation compatibility was kept.
- External review inputs received summaries of the native send/status/wait
  JSON and generation values, not the raw records; the root review audited the
  raw private records separately.

Activation decision (review round 2): the row is not activated because (1)
only the owned queue child's executable is digest-pinned, while the original
TUI writer is checked by lsof command/pid/uid and `ps lstart`, so a
different-version or gnu writer holding the lock beside a pinned musl queue
binary is not distinguished; and (2) the writer's kernel start time is not
retained across send and independent wait. Safely closing (2) needs an
optional private ledger field owned by the ledger, so both are frozen as the
follow-up design in PARITY.md rather than pushed as an unreviewed schema
change. Recorded artifact/schema/injection evidence and the procfs machinery
remain; SSH destination requests can never select a Linux row. The worker
comment now limits its hard bound to the worker's supervisor refusal;
caller-side `realpath`/`stat`/`lstat` stay synchronous with deadline checks
only.

Full suites at the `dd21302` source checkpoint (candidate not activated): on
Darwin 27.0 arm64 / Node 24.16 the full `npm test` (with the pinned Python
reference) passed 400, failed 0, skipped 8 (5 Windows-only, 3 Linux-only). On
the Linux arm64 test host it passed 376, failed 0, skipped 28
(Darwin-qualified and Windows-only), with every Linux-only native case
passing; that run used only fixtures in a private prefix, with no
credentials, model turn or install change. The raw Linux log has no HEAD
marker; it is tied to the checkpoint by the executor's run record. Earlier
checkpoints' counts (`b804115`, `2f3b35d`) are superseded.

Later documentation/comment/evidence-description commits (`ffe8afc` and the
following one) changed no runtime statement. At those heads only light gates
ran: `npm run build`, `npm run test:types`, the related linux-observation,
app-server and metadata-observation tests (80 pass, 0 fail, 3 skipped),
`node scripts/check-repository.mjs` and `git diff --check`. No new full-suite,
Linux-host or live-model run was performed at those heads.
Queued/delivered remain distinct from receipt ACK or work completion.

## Public 0.4.0 — 2026-10-18 KST

`session-peer@0.4.0` is public. Registry checks confirmed `latest=0.4.0` and
unchanged `preview=0.1.0-preview.1`. The publication source is
`dde3923efe116f87f38b1639b29b889d2b832e44`, merged from
[PR #151](https://github.com/abruption/session-peer-ts/pull/151). Its complete tree
matched reviewed head `bfbadfa42513791899fc8d2b5441238bbe5b2c4e`.
Exact-main [CLI run 39076708873](https://github.com/abruption/session-peer-ts/actions/runs/39076708873)
and [CodeQL run 39076708830](https://github.com/abruption/session-peer-ts/actions/runs/39076708830)
passed.

[Publication workflow 39077096491](https://github.com/abruption/session-peer-ts/actions/runs/39077096491)
completed successfully on attempt 1 for that exact source. Its Ubuntu preparation
job passed **383 total / 355 passed / 0 failed / 28 skipped**; these are the
actual platform-scoped counts, not the macOS preparation counts below. Build,
types, repository checks, reproducible package smoke, isolated installation and
removal, and npm audit passed. The uploaded artifact ID was `12117507059`, with
ZIP SHA-256 `b4eb62a6c68be0319d5d7013f11d11e9b438866f3a63359cc1808c91cbe61494`.
The ZIP digest identifies the artifact container, not the package tarball.

The reviewed, local, Actions, staged and public `session-peer-0.4.0.tgz` bytes
matched. The public tarball is 321,256 bytes and contains the exact 71-file
allowlist. All 18 packaged Markdown documents matched the publication source.
The release helper validated the exact downloaded artifact rather than a later
rebuild. Package hashes are:

- SHA-256: `84adc8b50ef8f03a2c2170e3c36a97b573f28a6bcbeb7dbc965e16c3b37a57c9`.
- npm integrity: `sha512-mMNJ118atoflhpFTkf2+DtO7MRf7FQnPK3lKWbq/vd8Xvb5DsjUtAgydIBOcd3Xj9BCYGqM50aFhzUr4dDGHSw==`.

Registry signature audit passed. Public attestation subjects matched the exact
tarball SHA-512, and the SLSA payload bound the repository, `refs/heads/main`,
`.github/workflows/publish.yml`, source `dde3923efe116f87f38b1639b29b889d2b832e44`,
`workflow_dispatch`, and run `39077096491/attempts/1`. This was also verified
cryptographically with npm 11.15.0's bundled Sigstore verifier, including the
certificate/transparency material and the exact workflow identity
`https://github.com/abruption/session-peer-ts/.github/workflows/publish.yml@refs/heads/main`
with issuer `https://token.actions.githubusercontent.com`. These cryptographic
checks are distinct from merely decoding and comparing the payload. A separate
fresh isolated package installation, CLI/list check and removal passed; no user
installation was replaced.

Fresh authenticated checks confirmed no conflicting pending stage and the
Trusted Publisher's stage-only permission. The user explicitly waived this
release's separate web **publish 2FA policy inspection**; that policy was not
freshly audited. The protected GitHub `npm` environment required reviewer
`abruption`, disallowed administrator bypass, and allowed only `main`; environment
and repository Actions secret counts were both zero. The environment approval
and final npm 2FA approval were completed by the user. The approved stage was
`414547b1-1b55-45dc-a0a4-9ca40407beec`. OIDC staging used no token fallback or
protection bypass. Staging success was not treated as publication before registry
verification.

The annotated `v0.4.0` tag object is
`7aad7bc6400499fbc1c323bd62f2210b3507fc9a`, peeled to the exact publication source
`dde3923efe116f87f38b1639b29b889d2b832e44`.
[GitHub release v0.4.0](https://github.com/abruption/session-peer-ts/releases/tag/v0.4.0)
was published as the latest release. No replacement source was assigned to the
published package or tag.

Publication added no new native/model, remote-host delivery or ACK qualification.
Native observation retains the previously recorded exact Codex 0.160.1/0.162.1
and macOS arm64 scope; explicit `operator_confirmed` receipts on supported POSIX
ledgers remain separate from automatic ACK collection. Linux observation,
Windows observation/private storage, and authenticated automatic receipt
producer/collector bootstrap remain follow-ups #130, #131 and #132. Queue
acceptance, injection, turn completion and plain replies do not automatically
establish receipt ACK; unknown outcomes never authorize a resend.

The published TS skill remains 0.2.1 at immutable source
`0f494cabd05901c03161dc91792dcf89f8e96631`, with SKILL SHA-256
`8c3520f95e0d6807303be96bfa06df69887ddaf76be05f1905505d0a956820c3`.
The separate skill 0.3.0 candidate and finite runtime/profile review do not
publish, install or adopt a new skill pin. Skill finalization and publication
require their separate approval and exact artifact checks.

## 0.4.0 preparation checks — 2026-10-18 KST

Preparation source checkpoint `2fc936fa1557fd59ce561446d5239c7030df3d56`
uses locally integrated dependency tree `d83635d6ed1c668fc33e42754f652c123350ddad`
and the 0.4.0 version/baseline/finite skill row. These are local preparation
checkpoints, not publication or a claim that the projected dependency commit is
merged. The release PR records final merged dependency/source SHAs and its own
current-head CI/reviews. Later rebases must preserve the verified runtime/test
tree or rerun affected checks.

The dependencies were subsequently merged in authorized order with exact-head
squash binding and no protection bypass: #106 `81d1aece70b414b6aef00641076bd2716f630f6e`,
#107 `1e788be6b02c414b3c7de5bbad37afc7e293c2ff`,
#108 `d645a692f8e402dd224691410fa89be502e45383`,
#109 `be6adb26f844e7158362a8fcd6d379fbe8d46864`. Each merged tree matched its
reviewed head. Release preparation was rebased onto that final main; its tree
was unchanged before this documentation addition.

#109 CI39045571298 first failed one macOS Node22 SSH fixture with a pre-queue
`app_server_owner_changed`; other matrix jobs passed. Local Node24 focused and
parallel diagnostics passed, followed by official Node22.23.3 arm64 focused/full
387/382/0/5 passing checks. The local Node22 path contains spaces, so a private
test-only POSIX/JS shebang adapter preserved exact binary/filename/arguments;
this was not an unmodified CI-environment reproduction or a runtime guard change.
The initial unadapted local run failed because of those invalid fixture
shebangs and is excluded from product diagnosis. The original CI cause remains
unconfirmed. Only failed macOS22/release-gate jobs were rerun once on the same
source; attempt2 passed. Both current-head automatic reviews completed without
findings. The initial failure is not reclassified as an all-green first run.
Final main and preparation-head CI/review results are recorded in the release PR.

On macOS arm64 / Node 24.16.0, `npm test` (including build and type checking)
passed **389 total / 384 passed / 0 failed / 5 Windows-only skipped**. The oracle
is the hash-checked isolated published Python 1.1.0 source
`8ca77cf31254c8287a2593fe484bb30a7dba2727`; ordinary conformance and pure validator
comparisons do not establish end-to-end runtime parity. Initial preparation
exposed two stale update-notice regex expectations, corrected before the final
passing run. `npm run test:package` passed reproducible archive checks, isolated
install/removal, and bash/zsh shorthand contract/lifecycle checks. Repository
structure, links/anchors and diff checks passed; npm audit reported zero
vulnerabilities. The CLI reports `session-peer 0.4.0 (typescript)`.

The finite 0.4.0 metadata row retains the three published profiles and the exact
proposed skill 0.3.0/min0.1.0/full0.4.0/probe-help tuple. Complete Draft37 fixture
`b8ff909ffc5fe1e5b22c66a5c302be8332a76038` is 20,162 raw UTF-8 bytes, SHA-256
`1ae3690cb5d03777bf448cf06496fed27e4a9329deb03741d6d956a3b13c5ed4`.
Default/undefined/explicit/outer-inspection and historical/future/malformed
fixtures pass. This is candidate-specific metadata/content review, not a
published skill, content authentication, execution, final whole-byte freeze or
installation-pin adoption. Public skill 0.2.1 source/hash remain unchanged.

Fresh regression evidence covers prepared recipient continuity, encrypted
journal/key failures, overlapping wait operations, actual queue-process build
mismatch, executable replacement, expired probes and SQLite replacement across
the durable guard/final owner check. These use synthetic private homes, owned
Node children, scripted/native-shaped protocol peers and actual Darwin lsof
against those owned fixture descriptors. No new actual Codex/model/user-session
input, remote-host delivery, automatic receipt or ACK qualification was performed.
Native observation remains limited to the earlier recorded exact macOS profiles;
Linux/Windows observation and automated receipt bootstrap remain #130–#132.

Read-only registry checks on this preparation date found latest=0.3.6,
preview=0.1.0-preview.1, 0.4.0 absent, and previous stable integrity matching the
new release baseline. No authenticated pending-stage/publisher/MFA audit,
publication dispatch, environment approval, final npm approval, tag, release or
fleet/global installation was performed. Historical exceptions do not carry
forward. Local packaging hashes before this record/final source are not the
final release artifact; the PR records exact committed-source artifact checks.

## Public 0.3.6 — 2026-10-14 KST

`session-peer@0.3.6` is public; verified `latest=0.3.6` with unchanged `preview=0.1.0-preview.1`. Publication source is `27fc741f7dabf075e3d6f19f48f3e71d7bdc27a6`, merged from [PR #148](https://github.com/abruption/session-peer-ts/pull/148). The prepared source tree matched reviewed head `526fc9aaa53e674a9bc6882a6dd207c67c402904`; exact-main CLI run 38495616148 and CodeQL run 38495616311 passed. [Stage-only run 38496584629](https://github.com/abruption/session-peer-ts/actions/runs/38496584629) completed with protected GitHub npm environment and final user npm approval. Stage ID was `c6b468f1-6ac2-4301-80c6-03f16cb36038`.

Reviewed local, retained Actions, staged and public tarballs are byte-identical. SHA-256: `510e06ea1e118ceadb4096ec2fe9e564b2832e133aa0a21614d8b12db1764181`; registry integrity: `sha512-8uR9/x9q2AWp/zfJox0CMgm919M7kxpAjR2vGd/ntuS2AAwQh4ohbDmAtyxLyLoEE8IPsZVEbPKHCChvIJBuoQ==`. Every packaged Markdown document (18) matched the reviewed source. Registry signatures and publish/provenance attestations share the archive's exact SHA-512 subject. SLSA provenance binds repository `abruption/session-peer-ts`, `refs/heads/main`, `.github/workflows/publish.yml`, source `27fc741f…` and run 38496584629 / attempt 1. `npm audit signatures` and isolated version-specific install/list/uninstall passed on macOS arm64/Node 24.16.0 / npm 11.15.0. These packaging checks do not qualify new native delivery or ACK behavior.

The annotated `v0.3.6` tag object is `0b51f02e7fd19c132a550bcfac4ae795f914f0dd`; its peeled source is the publication commit above. [GitHub release v0.3.6](https://github.com/abruption/session-peer-ts/releases/tag/v0.3.6) is published as Latest. This verification record is a later documentation update; the immutable npm artifact/tag continue to point to the original publication source.

The user explicitly skipped fresh Trusted Publisher mapping and web publish-MFA policy reads for this 0.3.6 publication. Neither setting is claimed as freshly audited. Ownership/pending stages, GitHub environment reviewer/main-only/no-admin-bypass/zero-secret gates were checked; protected environment and final npm approval were completed. No token fallback, settings change or protection bypass was introduced. Runtime and published skill 0.2.1 remain separately managed; Python 1.0.2 reference and preview are unchanged. SSH still requires identical TS versions on both ends. No fleet/global installation, actual native/model send/consumption/ACK test or unshipped 0.4 feature was added.

## 0.3.6 preparation checks — 2026-10-14 KST

This patch starts from merged PR #146/main `602cfc09b31ce8aad23e1dd9382a2448a61143f9`, whose exact-main CLI38493362484 and CodeQL38493362496 passed. Source/package/banner/current examples are 0.3.6 and its explicit finite row carries the same three skill profiles as public 0.3.5; the published skill0.2.1 source/hash and Python1.0.2 oracle remain unchanged. Draft #106–#109, #82 and #142 are excluded.

Local macOS arm64 / Node24.16.0 validation: npm test193total/188passed/0failed/5Windows-onlyskips; build/types, metadata/guidance, release baseline, repository links/anchors and diff checks passed. The archived Python oracle was verified byte-for-byte against public1.0.2 source `47c23713d0a2a3c11ebde6186afd8c43489b8b65` before conformance tests. Package smoke passed reproducible packing and isolated install/uninstall plus bash/zsh shorthand contract/lifecycle. npm audit reported0vulnerabilities. An initial scoped run had two stale expected update-banner regex failures; both were corrected before the passing final full run. Package hashes before this record was added are not final release artifacts. Exact candidate-source/retained artifact hashes and final CI/review gates are recorded in the preparation PR; this record itself is not publication evidence.

Read-only registry baseline was latest0.3.5, preview0.1.0-preview.1 and target0.3.6absent. Public0.3.5 bytes/integrity/provenance source/run matched the historical publication; those are not fresh publisher/MFA-setting audits. After npm login, pending-stage list was empty and sole maintainer was abruption. The user explicitly skipped the TrustedPublisher lookup for this0.3.6 release. The user separately skipped the fresh web package publish-MFA policy read for this 0.3.6 publication; neither skipped setting is freshly confirmed. Protected environment approval and actual final npm stage 2FA remain required. GitHub npm environment required reviewer abruption, disallowed administrator bypass, allowed main only and held zero secrets, as did repository Actions. No settings/token/protection change, native/model input, actual delivery/ACK, fleet/global install or publication occurred in these preparation checks.

## 0.3.5 pre-staging document correction — 2026-10-13 KST

Merged source `5409d0acd4b559c09920a63c5fd7f11fd10f5737` has the same tree as reviewed `6fdf9d65fb0b62cca3801a3733af07add5fb6553`. Exact-main CLI38370116243 and CodeQL38370116569 passed. PR #144 automatic Code/Security reviews completed for the matching source tree. Code Review reported a P2 finding on the current unmerged README label; this correction addresses that finding across all four READMEs/guides. No Security Review finding was reported, and no extra review mention was posted. The #140 implementation is included through #144 rather than a separate #140 merge.

Artifact-document review found current, undated README/guide lines calling 0.3.5 unmerged and current skill descriptions still referring to unagreed source proposals. This document-only correction removes those lines, states implemented 0.3.5 source/profile support without claiming registry publication, and preserves historical preparation records, skill publication/pin boundaries, exact-version SSH, Python reference and runtime behavior. Corrected-source/artifact and latest exact-head checks are recorded in [correction PR #145](https://github.com/abruption/session-peer-ts/pull/145). Its initial correction [source `6dd52e794c1fa2a092bf56b644a49aa01a95aa2a`](https://github.com/abruption/session-peer-ts/tree/6dd52e794c1fa2a092bf56b644a49aa01a95aa2a) passed [CLI38372744965](https://github.com/abruption/session-peer-ts/actions/runs/38372744965) and [CodeQL38372743145](https://github.com/abruption/session-peer-ts/actions/runs/38372743145), then Codex review identified two additional P2 documentation findings (remaining undated candidate descriptions and this missing correction link). Those findings are corrected by the follow-up; the linked PR records its new exact source, artifact and rerun gates, while the initial run links remain historical checkpoint evidence. No staging, publication, native delivery/ACK or operations change is performed by this checkpoint.

## 0.3.5 preparation boundary — 2026-10-13 KST

Base main is `afed4a5a8945012faf1b23d52cffecb70470a5b3`, plus unmerged [Draft #140](https://github.com/abruption/session-peer-ts/pull/140), checkpoint `b917769047db41dedcb4aa1367a1b89915beb000`. The preparation changes candidate source/package/banner/current installation examples to 0.3.5 and makes its exact three-profile guard the compiled default. Immutable public 0.3.4 still supports only the two existing profiles; the proposed skill 0.2.1 tuple is not an agreed or published successor.

Companion exact-profile and complete-final-bytes agreement remains pending. The initial inactive-session dry-run was refused without submission. After user activation, a stable-writer dry-run passed and one review request was queued under correlation `STS-035-SKILL-PROFILE-REVIEW-20261013-A`; consumption, review and agreement remain unconfirmed. #139 remains open. Published skill source `8482cf644507c682915e35c85aa3384c53864906` and SHA-256 `00c6fc343fdbeb8f6dc1b1ee1b730f04cef71bbfb08205a7be3559202f1d8804` remain unchanged. Python reference/parity 1.0.2, historical validation and native-effect boundaries remain intact. Draft #106–#109, #82 and #142 are excluded.

Read-only registry verification found `latest=0.3.4`, `preview=0.1.0-preview.1`, 0.3.5 absent, and the exact previous stable integrity matching the release baseline. No authenticated publication-settings audit was performed.

Local pre-commit checkpoint on macOS arm64 / Node 24.16.0 / npm 11.15.0: `npm ci --ignore-scripts`, `npm run build`, `npm run test:types`, `npm test`, `npm run test:package`, `node scripts/check-repository.mjs`, `npm audit` and `git diff --check` passed. Full tests: 191 total / 186 passed / 0 failed / 5 Windows-only skipped. Focused metadata/release/updates/integration tests passed 47/47 after correcting one notice-regex fixture from current→current to current→future. The verified Python oracle remains `47c23713d0a2a3c11ebde6186afd8c43489b8b65`; its vendored compatibility fixture matches byte-for-byte. Package smoke includes reproducible packing, isolated installation/removal and bash/zsh shorthand contract/lifecycle checks. Audit found zero vulnerabilities.

Public registry read at this checkpoint confirmed latest 0.3.4, preview 0.1.0-preview.1, target 0.3.5 absent, and the pinned previous integrity/attestation metadata URL. This is not an authenticated stage/publisher/MFA audit or a new signature/provenance-content verification. Exact committed-source pack/artifact, all packaged Markdown byte comparisons and current-head CI results are recorded separately in preparation issue [#143](https://github.com/abruption/session-peer-ts/issues/143)'s linked PR, so local pre-commit checks are not substituted for those later gates. Windows native CI must be checked independently; skipped local tests and historical 0.3.4 Windows fixtures are not new 0.3.5 native steering/observation evidence. No live agent delivery/ACK, merge, staging, environment approval, npm 2FA, tag, publication or fleet installation was performed.

### Conditional profile-review follow-up — 2026-10-13 KST

After the initial preparation, the companion conditionally accepted the profile direction at dependency #140 head `b917769047db41dedcb4aa1367a1b89915beb000`; it did not accept release-default validation or complete successor SKILL bytes. The follow-up adds literal compatible-result assertions for default/undefined/outer inspection of all three profiles without changing runtime code. Scoped metadata/guidance tests and build/types checks are separately rerun for this follow-up; their exact counts, source/artifact and current-head CI are recorded in PR #144. Initial 191/186/0/5 full-suite and prior artifact records remain checkpoint-specific. Full content agreement remains pending.

### Exact successor candidate checkpoint — 2026-10-13 KST

The earlier pending agreement statements above describe their initial preparation checkpoints. Companion [Draft #35](https://github.com/abruption/session-peer-skill/pull/35), source `9db5420b45568dd08fc43d406dbf9ad1952f7891`, now provides the complete 13,930-byte skill 0.2.1 candidate, SHA-256 `96d5a0d049f8a4d193703af3583b198a91079d44ae373de34e94a54e2296a4d6`. Independent full-content/hash comparison and compiled guard/default/undefined/outer-inspection tests support candidate-specific design/content acceptance; see [the exact review](docs/design/typescript-skill-compatibility.md#exact-complete-successor-candidate-review--2026-10-13-kst). This is a test fixture, not a published skill, approved installation pin or final joint publication freeze. Final skill wording/bytes after actual guard publication require another exact review and separate release approval. Published pin8482cf6 remains unchanged. Local scoped tests passed24/24; exact source/artifact/current-head CI and review status are recorded in PR #144. No instruction execution, live delivery/ACK, merge, staging or publication is claimed.

## 0.3.4 artifact documentation correction — 2026-10-12 KST

The approved-source prepare run [38193012263](https://github.com/abruption/session-peer-ts/actions/runs/38193012263) at `1c99b39138c26a5ec08245f78f133d058bc354f0` passed tests/packaging and produced the same bytes as the local archive, SHA-256 `a0026b157ca9444931243cb60416ac24ad773bd118425852650e6671a545d773`. Independent packaged-document review then found stale current-description text in the skill design and PARITY: the package compiled VERSION was 0.3.4, but those paragraphs still said 0.3.3 and marked the added row as an unreleased proposal without clearly restricting it to PR #134 history.

The artifact documentation gate therefore failed. The workflow was cancelled before protected environment approval: prepare succeeded, publish was cancelled, and no npm upload or public publication occurred. The rejected archive and Actions manifest are retained for comparison; they were not edited in place. The correction describes current source/package VERSION 0.3.4 while explicitly retaining the original PR #134 checkpoint as history. Runtime logic, finite profile values, metadata/pins, release baseline and all other packaged documents are unchanged.

A new reviewed source and artifact require fresh exact-source staging approval. The earlier approved SHA and settings-read exception remain external historical records, not authority to stage changed bytes. No new publication result is claimed here.

## 0.3.4 preparation checkpoint — 2026-10-12 KST

Base main: `c210ee963741f77153df10038c28e228ea7a902f`, merged [PR #134](https://github.com/abruption/session-peer-ts/pull/134). Exact base main CLI [38191285491](https://github.com/abruption/session-peer-ts/actions/runs/38191285491) and CodeQL [38191285293](https://github.com/abruption/session-peer-ts/actions/runs/38191285293) completed successfully, including Windows Node 22/24. Draft 0.4 PR #106–#109 and experimental #82 are excluded. This is preparation, not approval to stage or publish.

Candidate source/package/banner/installation examples are 0.3.4. The registry read at this checkpoint was `latest=0.3.3`, `preview=0.1.0-preview.1`, 0.3.4 absent; previous stable integrity is the public value recorded below. This read does not establish authenticated pending stages, package MFA or Trusted Publisher settings.

Local macOS arm64, Node 24.16.0/npm 11.15.0:

- `npm ci --ignore-scripts`, `npm run build`, `npm run test:types`: PASS.
- `npm test`: 190 total, 185 PASS, 0 FAIL, 5 Windows-only SKIP. The first preparation run had 183 PASS/2 FAIL/5 SKIP because two update-notice regexes retained the old current/latest pair. Updating those expectations to 0.3.4/0.3.5 produced the successful final run; no production logic was changed to satisfy them.
- Python conformance uses the existing verified `47c23713d0a2a3c11ebde6186afd8c43489b8b65` reference. The Python1.0.2 parity pin is unchanged.
- `npm run test:package`: PASS, reproducible package and isolated installation/removal, bash/zsh shorthand contract and lifecycle. No global installation.
- `node scripts/check-repository.mjs`, `git diff --check`: PASS. `npm audit`: zero vulnerabilities.

The physical Windows 24-case synthetic fixture evidence below belongs to the PR #134 correction at version 0.3.3, not to a new physical 0.3.4 installation, live queue/injection or ACK experiment. Preparation will additionally validate its exact committed artifact and current-head CI before review completion; their source/hash results belong in the PR record and are not fabricated here. Publication/environment approval/final npm2FA/tag/fleet operations are not performed by these checks.

## Public 0.3.3 checkpoint — rechecked 2026-10-12 KST

The earlier candidate/preparation sections below are dated history, not the
current publication state. npm `latest` is `0.3.3`, `preview` is
`0.1.0-preview.1`, and the public 0.3.3 metadata exposes integrity
`sha512-5OQ7eUlR5Oy3RHFRoR3FuBkV7LT72dfjfBEbWRCY5wYP7Dz8TmN2jlRPpo2SFHPAwosFc0WIt8Iis/vyHckxRg==`
and its registry attestation URL. The existing publication workflow
[37907833518](https://github.com/abruption/session-peer-ts/actions/runs/37907833518)
completed successfully at source `c0ed30273b9e9c0049df86ae3c38486a94289527`.
This follow-up read checks metadata/run identity; it does not redo signature or
provenance authentication and does not publish anything.

## Windows SSH patch verification — #133, 2026-10-12 KST

An isolated patch checkout based on public 0.3.3 source
`c0ed30273b9e9c0049df86ae3c38486a94289527` forwards the native
`$LASTEXITCODE` from both encoded PowerShell commands. A missing native exit
fails with 1. The strict response validator, version/host-key guards and
one-request/no-resend behavior are unchanged. A separate explicit, unreleased
0.3.4 skill matrix row is tested with validator arguments; package/compiled
runtime version stays 0.3.3.

Physical destination: Windows 10 x64 (10.0.19045), PowerShell 5.1.19041.6456,
Node 24.16.0. The client was macOS arm64 / Node 24.16.0. Existing key/trust
and fixed BatchMode/StrictHostKeyChecking were used, without configuration
changes. All 24 SSH fixture scenarios passed:

- Six synthetic native outcomes, each tested with a legacy launcher control,
  explicit exit forwarding and the corrected complete local CLI: success/0,
  refusal/1, refusal/2, complete success/255, malformed/2 and missing stdout/0.
- Native refusal/2 now yields client exit2 with refused/submitted:false.
  Complete success/255 retains queued/submitted:true and the fixture queueId,
  with sshTransport failure, client exit1, consumptionConfirmed:false and
  retryAllowed:false. Malformed/missing outputs remain unknown/submitted:null.
- Nonzero exact-banner preflight (legacy/control/CLI) and mismatched-version
  preflight make zero request calls. Mixed ordered results through two aliases
  of the **same** destination retain success/refusal and call once per entry.
- Missing native executable with no LASTEXITCODE returns1 rather than0.

Raw legacy/forward controls produced identical decoded stdout for the six outcomes;
only exit forwarding changed. Message data remained in stdin, not the encoded
command or native argv. The disposable native executable emitted synthetic
metadata: no actual agent session, Codex queue, model, injection or ACK was
invoked. Only the owned remote test directory was written and removed;
absence was independently verified. This is Windows-destination evidence,
not Windows-client jump support or two-machine/native-agent qualification.

The new portable command/framing regression passed 5/5 with the existing
SSH-response CLI suite. Actual PowerShell regression coverage is also added
to the existing Windows-native contract suite; CI results belong to the PR
head. The first local full-suite attempt used the physical-harness temporary
root, whose type:module package boundary invalidated CommonJS fixture scripts
(149 passed, 36 failed, five skipped). That test-environment error was corrected
by separating the test root; it is not reported as an all-green run.
The next full run exposed two existing exact-command expectations that needed
the new exit-forwarding suffix; those expectations still assert the complete
quoted/hardened command. The final `npm test` passed 190 tests: 185 passed,
zero failed, five Windows-only skips, including successful build and type
checks. `test:package` passed reproducible packing, isolated installation and
removal, and bash/zsh shorthand contract/lifecycle checks. Repository/link and
diff checks passed, and npm audit reported zero vulnerabilities. Conformance
used the existing Python 1.0.2 reference at
`47c23713d0a2a3c11ebde6186afd8c43489b8b65`; the entrypoint, core and compatibility
fixture (19 files) were byte-compared with the exact upstream archive before
execution. No reference repin was made.

Initial PR CI `38187131255` passed the added real-PowerShell exit regression on
Windows Node 22 but failed the following existing SSH contract's absolute
call-count assertion: it inherited the new subtest's log entries. The fixture
now explicitly initializes that existing subtest's own SSH call log; its exact
request-count assertions are preserved. This was test isolation, not a runtime
failure or a CI rerun treated as an unchanged-head success. Final PR-head CI
results are recorded in the PR after the correction.

## 0.4.0 scoped acceptance follow-up — 2026-10-11 KST

The user approved qualified macOS arm64 Codex observation and explicit operator
confirmation as the limited 0.4.0 scope. #69/#70/#71/#72 remain together. Linux
client-ID observation #130, Windows observation/private handoff storage #131
and voluntary receipt producer/authenticated collector bootstrap #132 are
Future extensions, not mandatory platforms/collectors for this release. Required
unsupported goals still refuse before effect; ordinary queues/manual receipts
do not qualify native observation or automated receipt authentication.

The source follow-up updates four-language README/guide scope, API and PARITY
without changing runtime or the frozen contract/pin bytes. Dated 0.3.3 preparation
evidence is retained; installation examples and explicitly unreleased handoff
sections are distinguished. SQLite may evaluate body-bearing cells internally;
body/error values are not returned to JavaScript or ordinary output.

Pure-validator cross-runtime checks invoke exact published Python 1.1.0
`8ca77cf31254c8287a2593fe484bb30a7dba2727` standalone and canonical handoff
module hashes, never its main/ledger/native CLI/collector. Five tests/45 data
cases passed: 19 accepted examples spanning all seven states, 12 schema/privacy/
ACK/retry negatives, four Python unsupported-observation state projections,
four Claude optional-absence/native-profile cases and six Codex native-profile
cases. Python UUID reason names remain distinct from TS. The first launch lacked
the reference environment (ENOENT), and the next run exposed an incorrect
expected Python UUID reason; both were corrected before the final pass. This is
actual pure-function comparison, not native delivery/receipt/runtime parity.

Focused ACK core/CLI checks passed 55/55 after adding wrong correlation/epoch/
generation and malformed/private-input negatives, byte-identical ledger
preservation and positive/duplicate operator confirmation with no native queue.
The companion guidance candidate is tracked in session-peer-skill #31. Its named
session was inactive at dry-run, so no message was queued and no wake/resume was
used. Existing skill metadata/immutable pin are not upgraded by this work.

The SSH handoff suite passed 14/14 on macOS arm64. Three destination-side Codex
fixtures cover exact-ID injection, no injection before deadline and queue-response
loss, with original preparation binding and at most one queue RPC. These use fake
SSH and a scripted native peer, not a new remote/native qualification. The request
budget is 15 seconds; the harness has a separate 20-second cleanup limit.

Integrated `npm test` (including build and type checks) passed 347 tests:
342 pass, zero fail, five Windows-only skips on macOS arm64 / Node 24.16.0.
Packaging and exact-head CI are recorded in PR #109. Tests are separate from the
earlier KR/US real ordinary queues and local native qualification. Issue checklists
and publication approval are separate gates; no merge/release/tag operation is
included here.

## 0.4.0 owner-probe fixture follow-up — 2026-10-11 KST

CI run `38110140277` at test/docs checkpoint
`60895b46d8758c7427b90bc154414bd4d01487e7` failed the macOS Node 22
positive-acceptance/ledger-failure regression: it returned
`app_server_owner_changed` before the intended persistence failure.
The other platform jobs passed; the release gate failed, so this run is not
all green. CodeQL run `38110137845` passed with no open branch alerts.
The holder remains alive until test cleanup; no holder expiry was found.
The bounded owner probe had four extra Node starts for its fake lsof/ps tools,
in addition to the production 250ms sample interval. This is a fixture startup
burden consistent with the failure, not proof of its precise timing cause.

The fixture now uses static POSIX scripts for lsof/ps and keeps owner evidence
as separate raw NUL-delimited data. PID, UID, start identity, changed-owner
checks, real lock holder and cleanup are preserved. Production 800ms probe
budget, 250ms recheck, refusal behavior and regression assertions are unchanged.
No runtime, native qualification or platform-support change is part of this fix.
The focused macOS arm64 / Node 24.16.0 delivery suite passed 16/16, including
the intended persistence failure and changed-owner refusal. Follow-up full
validation and exact-head CI are recorded in PR #109.

## 0.4.0 real Linux SSH submission checks — 2026-10-11 KST

The unpublished development checkpoint `e83fcffa2dbee33de0694e30b6420d83a128fc5e`
was copied explicitly to fresh, private marked test prefixes on two Linux
arm64 hosts. Both ends used that candidate, rather than the public npm package
whose version label is also 0.3.3. Candidate/dependency archive SHA-256 was
`aadfd3630b67d905a8f474e305f972c7bf670a99365c62dd53fa83d1e04764da`;
each destination verified the hash before extraction. No global installation,
profile, service, SSH trust, native configuration or authentication change was
made. SSH used strict host-key checking, batch authentication and no control
socket. Each private destination ledger was explicitly initialized.

On the first host, Node 24.16.0 / native Codex 0.162.1, the user-authorized
existing session passed saved-thread and unique stable live-writer dry-run
checks. One best-effort correlated send exited 0 with `queued`,
`submitted=true`, an optional native `queueId` and handoff `submitted`.
Observation and automatic ACK remained `unsupported`; a later status query
preserved those facts. A requested voluntary reply was not yet received at
this checkpoint; no transcript or queue polling was used to infer receipt.

On the second host, Node 24.18.0 / native Codex 0.159.2, the existing saved
session was inactive and dry-run correctly refused with `inactive_writer`.
It was neither resumed nor queued through inactive opt-in. A separately owned
read-only test TUI in an already trusted working directory produced READY,
passed unique live-writer dry-run, and received exactly one candidate SSH
submission. The original terminal displayed its requested identification
response. An explicit operator confirmation bound to the original correlation,
ledger epoch and generation was recorded before any separate wait: confirmation
and status exited 0 with `acknowledged`, `assurance=operator_confirmed`,
`late=false`; a subsequent acknowledged wait exited 0 with `satisfied` and
performed no submission. This is operator attestation, not automated receipt
authentication or native client-ID observation. The test TUI closed and
`inspectWriter` then reported inactive/absent. Its native test record remains;
no existing native record was deleted.

On both hosts, required `--wait-for delivered` refused before effect with
`evidence_unsupported`, `submitted=false` and retry disallowed. Best-effort
results retained `consumptionConfirmed=false`; neither queue receipt nor
terminal response changed that field. These are real SSH/native ordinary-queue
checks, not Linux observation qualification: Linux native app-server/client-ID
projection and automatic original-sender SSH ACK bootstrap remain unsupported.
Both marked remote prefixes and their test ledgers were removed with ownership
checks, and their absence was verified. Local evidence retains only the test
results; public descriptions omit host/account paths and session identifiers.

## 0.4.0 integrated SSH review checkpoint — 2026-10-11 KST

Independent read-only review used Claude Code 2.1.296 with tools disabled and
no session persistence. The first 163,540-byte input timed out after 240 seconds
(exit 143, no response), so it supplied no review evidence. One narrower
104,671-byte retry completed in 268.508 seconds with exit 0, `is_error=false`
and actual model `claude-opus-5-5` (first-party). Its input SHA-256 was
`69169aacf2c7f02d6606aebbdb23961e2694a0845e86875f2848469ea97a1718`,
unchanged before/after the call. Neither call edited files or ran tests.

The review identified two required corrections: a complete successful
preparation followed by SSH failure must refuse the actual send, and a
post-submission persistence failure must preserve a verified pending wait
instead of losing its identifiers or inventing a terminal record. A stopped
wait with the wrong process exit is also discarded without discarding separate
native acceptance facts. These fixes and the earlier partial/no-EOF input
deadline correction have focused regression tests; subsequent integrated
test results are recorded separately. The review input predates those final
corrections and is not a whole-final-commit external verification.

A subsequent internal source audit found that failed-wait normalization could
discard the original malformed/missing `error` before envelope validation. The
regression now rejects that handoff while retaining independently valid native
acceptance facts. The first integrated full run recorded 337 total / 331 pass /
1 failure / 5 skips: a sub-millisecond early probe cutoff attempted to commit a
timeout before its exact monotonic deadline and therefore retained pending
state. The fix waits out only that fractional tail within the existing budget;
it neither extends the deadline nor invents a persisted terminal result. The
corrected run is recorded below.

The corrected integrated macOS arm64 / Node 24.16.0 run used the exact published
Python 1.1.0 export as `SESSION_PEER_PYTHON_ROOT` and
`PYTHONDONTWRITEBYTECODE=1`: `npm test` (build, test:types and all test files)
passed **337 total / 332 passed / zero failed / five Windows-only skipped**.
The preceding focused SSH/delivery run passed 27/27. Repository/link/anchor and
diff checks passed; `npm audit` reported zero vulnerabilities. These fixture
results do not widen the native/platform or actual Windows evidence above.

The first packaging invocation failed its reproducibility check because this
validation document was edited between its two packs. That invocation is not a
successful package check. Source/document edits were then stopped before the
repeat packaging check; its result and the exact-commit artifact are reported
in the PR checkpoint separately.

The apparent fanout deadline extension follows the frozen **per-destination**
budget, rather than one aggregate invocation deadline. Each destination keeps
one setup/preparation/effect/observation budget with its cleanup reserve;
sequential fanout can take their sum. Independent clocks cannot measure SSH
transit delay, and an unknown source result may precede a delayed destination
effect. No retry is authorized. A rejected dry-run timeout example lacked the
required prepared correlation and already fails option validation; it did not
require a runtime change.

## 0.4.0 additional native verification — 2026-10-11 KST

These are unpublished development checks on isolated, newly created test
sessions. They do not establish final whole-commit/full-suite CI or authorize
publication. Existing working sessions received no test message. Evidence is
bounded to the tested compiled components; later integrated checks are separate.

### Codex: exact metadata observation and manual confirmation

On macOS arm64 / Node 24.16.0, native Codex **0.162.1**, upstream source
`092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`, was checked against the
version/platform/source and live evidence in
[`metadata-observation-native-evidence.json`](test/fixtures/metadata-observation-native-evidence.json).
The production reader matched the original exact client message ID, original
thread and generation before/after observation, and a positively linked
completed turn. Native item ID differed from client ID; neither that turn
completion nor the queue receipt was treated as ACK. The probe returned
bounded IDs/status only, with no body or history API output. SQLite internally
projects metadata from a body-bearing cell; this is not a promise that SQLite
never accesses body bytes.

Actual CLI checks used two additional fresh test threads, **one native queue
attempt per thread**, with no fallback or resubmission. Both observe-send
commands exited 0 with `status=queued`, `submitted=true`,
`consumptionConfirmed=false` and retry disallowed. A separate delivered wait
on the first thread was satisfied with exact injection evidence; status query
exited 0. Starting that wait before manual confirmation lost provable ordering:
confirmation correctly exited 1 with `receipt_order_unprovable`, retaining
original delivery facts and performing no requeue.

On the second thread, the operator verified the test-only voluntary response
against the original correlation, then confirmed **before starting another
wait**. Confirmation and status exited 0 with `state=acknowledged`,
`assurance=operator_confirmed`, `late=false`; a subsequent acknowledged wait
was satisfied and exited 0. This is an explicit operator attestation, not an
automated receipt collector or model identity proof. Automated receipt
capability remains unsupported. All owned test terminals were closed. Native
home test records were retained; no existing native record was deleted.

The fixture records exact compiled component hashes, including
`dist/metadata-observation.js` SHA-256
`4d01dae9a90f4cda3c7b45bf0c126067bff403f345d0d23bc593cc57363e0f83`
and `dist/handoff-ledger.js`
`efb46bcd1892ba9eb843a4ae603987f15ce535d942938dfe2c0e98a1343edcb9`.
These identify the tested components, not a final integrated commit.

### Claude: correlated submission and unsupported required ACK

A separate test-only Claude Code **2.1.296 / Opus 5.5** session on macOS
arm64 / Node 24.16.0 produced a READY response. Its launch identity, PID and
fresh private working directory were checked before each submission. Native
Claude assigned a non-null name; nullable names remain synthetic fixture
coverage. No tools, commands, file tasks or external messages were requested.

A prepared-ID correlated send and a separate best-effort `--request-ack`
send each submitted exactly once and exited 0 with `status=posted`,
`submitted=true`, `consumptionConfirmed=false`, handoff state `submitted`
and retry disallowed. Each produced its own identification-marker response
in the owned terminal. Subsequent status queries retained state `submitted`,
`injectionObserved=false` and ACK `not_requested`/`unsupported`: a plain
assistant response was not promoted to machine ACK or native observation.
Required `--wait-for acknowledged` instead exited 1 before effect with
`evidence_unsupported`, `status=refused`, `submitted=false` and unsupported
ACK/wait. Its marker never appeared in the owned terminal. Zero effect is
supported by the pre-effect code/result contract and terminal check, not socket
instrumentation. The terminal closed; its PID and native registry record were
absent. Private workspace, message files and sender ledger were removed.

The tested Claude compiled `dist/cli.js` SHA-256 was
`7195f5bd049bdba7ffbffd1d69473d9b90f9a42646851697e1df149054dc5d1f`;
`dist/handoff-operations.js` was
`99e15fbd8ad04e5f28490512b61bf0296b21d96ee787d63d1b8293e905f8665e`.
This earlier build differs from the subsequent Codex build; these results
must not be presented as a single final whole-commit run. Default native CLI
authentication was used without reading, copying or recording credentials.

### Windows: separate failed real-host fixture gate

The actual Windows 10 x64 / Node 24.16.0 suite recorded **266 total,
155 passed, 2 failed, 109 skipped**. The child failure and enclosing failure
refer to one underlying fake-SSH path, not two independent runtime defects.
The unsupported native-platform qualification guard selection separately
passed 3/3; it does not qualify observation on Windows.

Additional strict/batch SSH diagnostics compiled the repository C# fixture.
Twelve minimal Node/PowerShell child-launch controls passed across standard
stream redirection and window settings; encoded PowerShell `exit 0` also
passed. The owned test `.cmd --version` command instead reproduced
`Win32Exception: Access is denied` in `Process.StartWithCreateProcess`, with
both ordinary and isolated HOME/USERPROFILE, including a failure followed by
a successful `exit 0` control in the same executable. General process creation
worked; the exact host cause remains unverified. A recent Defender event query
with no matches neither identifies nor excludes a security product/policy.
The **real-host SSH fixture gate remains unpassed**; fixture CI is distinct
and cannot erase this result. No policy, permission, service, guard or execution
bypass was applied. No real agent/native queue was invoked by these Windows
fixtures. The marked remote diagnostic directory was deleted and its absence
confirmed. No private hostnames, account paths or session identifiers are
included here. Windows native observation, SSH handoff, automated ACK,
restart/crash continuity and other native versions/platforms remain outside
these successful macOS checks.

### Windows follow-up: alternate test launcher

Further controls on the same Windows 10 x64 / Node 24.16.0 host separated
launcher behavior without changing policies, permissions, services or production
guards. C#/.NET Framework launching PowerShell 5.1 `-EncodedCommand` reproduced
AccessDenied for both the owned `.cmd` wrapper and a direct Node version command.
The same PowerShell 5.1 encoded command launched by Node succeeded, as did
PowerShell 5.1 `-File`, direct `cmd.exe /d /s /c`, and the already installed
PowerShell 7 alternatives. This identifies a tested launcher-dependent difference;
it does not establish which security product or host setting caused the failure.

The test-only C# fake SSH now delegates to a fixed Node helper, preserving
PowerShell 5.1, `-NoProfile -NonInteractive -EncodedCommand`, the encoded request,
stdin, stdout/stderr and exit behavior. No execution-policy option or production
fallback was added. The helper's 55-second child limit remains inside the fake
SSH parent's 60-second limit; harness timeout returns 254, not native success.

An isolated copy of checkpoint `e83fcffa2dbee33de0694e30b6420d83a128fc5e`
with only those three test-file changes passed build/types, the Windows native
contract **9/9**, and `npm run test:windows`: **295 total / 165 passed / zero
failed / 130 skipped**. Unsupported native-platform guards separately passed
3/3. This replaces the failed fixture execution path with a validated alternate
test launcher; the original failure record above remains historical evidence.
It neither qualifies Windows native observation/ACK nor proves a real remote
agent send. The final C# fixture additionally requires the exact production
PowerShell prefix and one base64 token. Three real-host controls passed: exact
version command exits 0, a changed option is refused with exit 2, and trailing
whitespace is refused with exit 2. The C# file SHA-256 was
`b7845190939d4d915c56d1d072f23f5eeac3447a9994791d0b06ea2f0f147c38`.
The final guarded contract repeat and ownership-checked cleanup are reported
in the PR checkpoint. The integrated macOS arm64 / Node 24.16.0 run after these
test-file changes passed build/types and all tests: **337 total / 332 passed /
zero failed / five Windows-only skipped**, using the same exact Python 1.1.0
reference export. Repository/diff checks passed and audit reported zero
vulnerabilities. No runtime source or package metadata changed in this follow-up.

## Python 1.1.0 ordinary comparison — 2026-10-11 KST

Unpublished 0.4.0 development checkpoint: an isolated `git archive` export of
published Python 1.1.0 commit `8ca77cf31254c8287a2593fe484bb30a7dba2727`
was compared with the #69 worktree at `d62e813c8146e9832659654a850734fc986fd3d7`.
Only the subsequent published-design identity correction was pending; it did
not change the selected list/discovery source. No user's Python checkout,
agent home or saved thread was used. Archive SHA-256:
`7243c124398ec3b4cf4541881788dac955247d50949339e5f9f659bbb0d15ff9`.

macOS arm64 / Node 24.16.0 / Python 3.15.0 command:

```sh
SESSION_PEER_PYTHON_ROOT=<exact-reference-export> TASK_TEMP=<private-fixtures> PYTHONDONTWRITEBYTECODE=1 node --import ./test/fixtures/isolate-env.mjs --experimental-strip-types --test test/conformance.test.ts test/discovery.test.ts
```

Result: **21 tests, 21 passed, zero failed/cancelled/skipped**, exit 0 and empty
stderr. The private fixture directory was empty after test cleanup. These
existing tests compare ordinary listing/discovery projections and exercise
synthetic refusal paths; they do not establish full send/handoff/SSH
interoperability, native model delivery or ACK. No real native queue, message,
receipt, installation, policy or operation change occurred.

The subsequent candidate ordinary reference pin uses this exact release;
`test/fixtures/python-reference.pin.json` records its scope and selected source
hashes. `compatibility-v1.json` SHA-256 remains
`afd5a0b37562bb6a81afa9c20628bfae0cfe4d1caf9e88db402005fc42aabcd7`,
byte-identical to the historical 1.0.2 fixture. Frozen handoff design bytes and
the historical design baseline are unchanged. The earlier 0.3.x validation
records below retain their actual 1.0.2 oracle; the public npm 0.3.3 artifact
is not rewritten. Current integrated CI on the new pin is a separate gate.

After applying the candidate reference-pin changes on the #69 worktree based
on `f99417b`, `npm run build` and `npm run test:types` passed. The same isolated
reference export was used for the conformance/discovery/updates/handoff-contract
selection: **44 tests passed, zero failed/cancelled/skipped**, exit 0. The new
source-hash pin checks executed. Update tests use fixture registries and private
caches, not the public registry or an actual installation update. The repository
metadata/link/anchor checker and `git diff --check` passed. These are candidate
checks before root integration/current-head CI, not a public release or broader
native/ACK validation.

## 0.3.3 candidate preparation — 2026-10-09 KST

Preparation [#128](https://github.com/abruption/session-peer-ts/issues/128)
integrates the still-unmerged dependency heads: documentation #125
`d4c91387b8c968d45a822f82b69ff9333f4ae0bf`, ordinary SSH #127
`8c882fab220ade044d00beb9d23bf6ecb7727bdc`, and Draft skill guard #126
`f10b97115830d5968ff7a0583dc470643c3cbeda`, based on main
`b12699e108c0857b029d4b5c72f82414eb64b21c`. This is an unpublished
review candidate, not a merged release SHA or publication authorization.
The 0.4.0 handoff/app-server/observer drafts are excluded. Exact companion
successor-profile acceptance remains pending; candidate `VERSION=0.3.3`
exercises a proposed finite row, not published skill compatibility.

Local macOS arm64, Node 24.16.0 checks at preparation checkpoint
`de0472aa6e5ac94d29f227d04dc93671b4d45646`:

- `npm test`: 183 tests, 178 passed, zero failed, five Windows-only skips.
  This command also ran `npm run build` and `npm run test:types` successfully.
  Conformance used the existing Python 1.0.2 oracle at
  `47c23713d0a2a3c11ebde6186afd8c43489b8b65`; no reference repin.
- The release, skill-metadata, updates and multi-host integration selection
  passed 41 tests before the full suite.
- `npm run test:package`: reproducible package, fresh isolated installation,
  native dependency loading, bash/zsh shorthand contract, actual fixture
  version replacement (`0.3.3` to `0.3.3-fixture.1`) and removal passed.
- `node scripts/check-repository.mjs`, `git diff --check` and `npm audit`
  passed; audit reported zero vulnerabilities.

The first candidate CI run `37886970517` failed its Windows Node 22
same-size metadata mutation fixture: the automatic timestamp change was not
observed while the file was open. The fixture now explicitly advances mtime
and asserts that metadata changed after inspection returns; fixture mutation
errors also propagate outside the reader’s conservative error handler, so
a setup/assertion failure cannot count as expected refusal. No timing sleep
is used. This tests an
observable metadata change, not an atomic snapshot or undetectable writes.
Runtime reader behavior is unchanged. After this test-only correction,
`npm run build`, `npm run test:types` and the 15 skill-metadata tests passed
locally. Corrected exact-head Windows/aggregate CI results belong in the PR;
the first failed run is not reported as all green.

The registry baseline was read as `latest=0.3.2`,
`preview=0.1.0-preview.1`, and 0.3.3 absent. Previous stable integrity matches
its public record below. Authenticated pending-stage, Trusted Publisher,
package MFA and protected-environment policy reads were not performed for
this preparation. They remain fresh pre-publication gates.

The strict SSH and bounded metadata evidence is fixture/CI evidence described
in the dependency design documents. No live agent delivery, ACK, real remote
SSH qualification, crash recovery or fleet update was performed here. Local
Windows-only skips are not passes; candidate CI and exact post-merge main CI
must be reported separately at their own exact heads. Local artifact hashes
and current-head CI results are recorded in the preparation PR, without
substituting them for an approved Actions publication artifact.

## Public 0.3.2 — 2026-10-07 KST

`session-peer@0.3.2` was published at **2026-10-07 13:34:36 KST**
(`2026-10-07T04:34:36.456Z`). Verified registry tags: `latest=0.3.2`,
`preview=0.1.0-preview.1` unchanged. Publication source is
`f335f07352c842f2f6ceb12bd2ca6274b52f69f7` (PR #112 after #111), with exact-main
CLI run `37570782974` and CodeQL run `37570783335` both successful.

Stage-only Trusted Publisher workflow [37571653938](https://github.com/abruption/session-peer-ts/actions/runs/37571653938)
completed prepare and publish. The approved inputs were exact source above,
version `0.3.2`, mode `stable-stage`; protected GitHub environment approval and
separate npm 2FA approval followed. Stage ID:
`2226865d-2dac-4d42-bd4e-2e1c998b9833`.

- Retained Actions archive, downloaded staged tarball and public registry
  tarball were byte-identical. SHA-256:
  `a1ded0c99765f25d0570aa8a38e2ccf0c1c4760b3e25de2b1f20f56061b90540`.
- Registry integrity:
  `sha512-VNlzBqELXLFI8uCopfEdYrfweIacHeP6dMK32/4vwQJy8fUIKC64c5WCE3IwQVeCTKGMz9mXSxhzZnXmSGMuuA==`.
- Public publish/SLSA attestation subject digests matched the tarball. SLSA
  named the exact source above, `abruption/session-peer-ts`, `publish.yml` and
  run `37571653938/attempts/1`.
- `node scripts/release.mjs artifact` and `verify` passed against the retained
  Actions artifact: allowlist/version/source/hash, registry integrity/tags,
  attestation metadata, npm signature audit, fresh isolated installation and
  removal. All 16 packaged Markdown files byte-matched publication source.
- Authenticated stage listing and ownership were checked. Fresh Trusted
  Publisher permission/package MFA settings reads requested reauthentication;
  the operator instructed skipping those reads. This is a recorded exception
  to the settings-read gate for the historical 0.3.2 release, not completion
  of those reads. No fresh settings confirmation is claimed. Actual OIDC
  staging, protected environment review and separate proof-of-presence
  publication are execution evidence; they do not establish the skipped
  permission or MFA policies. No setting was changed. Future releases require
  their own policy checks and approvals.

The Windows destination qualification below used published **0.3.1**, not
0.3.2 live delivery. Runtime delta in 0.3.2 is VERSION only; no 0.4.0 drafts
were included. #20 Windows-client jump and #23 remaining qualification/design
follow-ups remain open. GitHub tag/Release and fleet upgrades are not claimed.
The preparation checkpoints below describe their dated pre-publication state.


## 0.3.2 preparation checkpoint — 2026-10-07 KST

This is an unpublished patch candidate based on main
`488ddddac302ba2ad0841061dc8df9187ff6a983`. The public stable version is
0.3.1. The 0.4.0 handoff, app-server and observation drafts are not included.
Runtime changes in this candidate are limited to the version marker; remote
validation and deployment documentation do not enable Windows-client jump or
a deploy helper.

Local macOS arm64, Node 24.16.0 checks:

- `npm test`: 151 tests, 146 passed, zero failed, five Windows-only skips;
  the command also builds the source and checks test types. Conformance used
  the existing Python 1.0.2 reference checkout at `47c2371`; no reference repin.
- `npm run test:package`: reproducible package, fresh isolated installation,
  native dependency loading, bash/zsh shorthand contract and A-to-B fixture
  update/uninstall lifecycle passed.
- `node scripts/check-repository.mjs`: metadata, four README/guide contracts,
  links/anchors and ignore rules passed.

These are candidate checks, not an exact-main Actions artifact or publication
verification. Public npm staging and release approvals remain separate.

## Windows SSH destination F5 — 2026-10-07 KST

The dedicated-key SSH authentication, isolated installation and operator checks
below used **published 0.3.1**, not a claimed 0.3.2 release. Destination:
Windows 10 Pro x64 build 19045, PowerShell 5.1, Node 24.16.0 (ABI 137), bundled
npm 11.13.0, administrator account. All installation, caches, test fixtures and
child HOME/TEMP writes were confined to a newly created dedicated test prefix.
The account/host was not disposable and was not a non-administrator test.
Existing PATH, profiles, SSH server configuration and Python installation were
preserved.

Package SHA-256:
`ba8b85b03229bc99ca30d52251790d7e75b90551de924b99edce22570f7fa401`.
Registry integrity and all three dependency archives matched the lockfile at
`6b48092a0e42992d2d970dd2ff5cf457f62d3ff2`.
Operator-side signature audit verified four registry signatures and three
attestations; the package SLSA subject digest, source SHA, repository and
`publish.yml` matched. Upload bytes were checked again before offline install.

- Offline installation used absolute Node/npm paths, separate empty user/global
  npm configuration files, empty cache and `--ignore-scripts`; installed lock
  integrities matched the pinned dependency set.
- The self-locating `.cmd` wrapper returned the exact 0.3.1 banner in staging
  and after `Directory.Move` activation. Native Windows file locking passed.
- Operator CLI over SSH used `--host`, `--remote-platform win32` and an
  explicit `--remote-bin` pointing to the isolated wrapper. Both commands
  passed the same-version `--version` preflight before `--stdio-request`.
  Doctor returned `ok:true`, `diagnosticCompleted:true`,
  `ready:false`, exit 0; nonexistent-target send dry-run
  `no_reachable_target`, `status:refused`, `submitted:false`, exit 1. Local
  wrapper dry-run exit 2 is separate evidence. No actual agent message sent.
- Operator checks preceded receipt publication and activation-lock release.

The private Windows storage/recovery fixture matrix returned **31 passed,
zero failed, three untested**. These are native storage and local-wrapper
fixtures; only the primary install additionally has operator SSH evidence.

| Exercised group | Result |
|---|---|
| Absent/empty/file/foreign classification; junction and foreign owner | Expected classifications/refusals |
| Matching receipt reuse; missing receipt recovery under a fresh lock | Passed; original marker runId retained in recovery receipt |
| Corrupt/mismatched/orphan receipt; unsafe receipt DACL/junction | Refused |
| Inconsistent marker; modified manifest; existing target activation | Refused |
| Lock contention; missing owner; wrong/unconfirmed owner; explicit override | Expected refusals and explicit-only recovery |
| Ended-run break followed by fresh-lock reverify; existing receipt preservation | Passed |
| Rollback without positive caller-unused evidence | Refused |
| Confirmed rollback, failed-verification rollback, caller rollback | Passed |
| Configured-install retention refusal; verified unused install+receipt removal | Passed |
| Copied Node24 path changes identity; staging never treated as final install | Passed |

The three untested matrix cells were F6 same-path runtime enforcement,
non-admin/other architectures, and a complete Node-22 installation/recovery
qualification. Node22 direct smoke below is separate. These fixtures do not
prove adversarial races or a production deploy helper. Final cleanup was
performed only after checking harness ownership and the saved fixture inventory.
The test prefix was removed; cleanup reported the existing Python launcher
unchanged. A separate post-cleanup SSH read verified prefix absence and the
same launcher SHA-256. Dedicated SSH authorization remains separate from
runtime installation; no private key or password is included in this record.

An additional Node 22.23.3 x64 (ABI 127) direct-CLI banner and native-lock
smoke passed against the same installed published package. The Node ZIP
matched the HTTPS-served official SHASUMS256; no GPG-signature check was
performed. This was not a second Node-22 installation/identity or recovery
matrix. Windows-client jump, non-admin, other architectures and F6
runtime-identity enforcement remain outside this qualification. The earlier
Linux run and its untested newer recovery rules remain historical evidence.


This dated record covers public 0.3.2, 0.3.1, 0.3.0, 0.2.1 and 0.2.0
verification; the historical 0.3.2 preparation checkpoint; historical 0.1.0
public verification; earlier candidate checks and live-agent observations. Older sections
describe their stated checkpoint rather than current feature availability.
It does not claim complete Python parity.
Python reference: v1.0.2, commit `47c23713d0a2a3c11ebde6186afd8c43489b8b65`.

## Public 0.3.1 — 2026-10-04 KST

`session-peer@0.3.1` was published at `2026-10-04T14:32:10.826Z`
(23:32:10.826 KST). The public registry reports `latest=0.3.1` and unchanged
`preview=0.1.0-preview.1`.

- Published source: `6b48092a0e42992d2d970dd2ff5cf457f62d3ff2`, the #104 merge.
  [Exact-main CI](https://github.com/abruption/session-peer-ts/actions/runs/37208760455)
  and [CodeQL](https://github.com/abruption/session-peer-ts/actions/runs/37208760542)
  passed. [Publication run](https://github.com/abruption/session-peer-ts/actions/runs/37209205194)
  completed prepare/publish; GitHub records `abruption` approving environment `npm`.
- Stage ID: `5d846a99-18a7-4ec0-873e-b1b05056fb42`. The authenticated stage
  download, retained Actions artifact, exact-source local pack and public tarball
  are byte-identical: 190,315 bytes, 51 files. All 16 packaged Markdown files were
  compared byte for byte with the published source. The source tree equals the
  reviewed preparation head; commit identity is the merged SHA above.
- SHA-256: `ba8b85b03229bc99ca30d52251790d7e75b90551de924b99edce22570f7fa401`.
- Registry integrity:
  `sha512-iZq06dbm6NavHuPZYMIxAnzQN5ksqm66yufpppddVWUYkuaG5TJvktbUXTSX7v3BBFnuybEJekI0KSaDo3Xfbg==`.
- Public publish/SLSA attestation subject digests match the package SHA-512.
  Provenance binds the source SHA, repository, `.github/workflows/publish.yml`
  and run `37209205194/attempts/1`. Public registry metadata names GitHub Actions
  as Trusted Publisher and `abruption` as approver.
- `release.mjs artifact` and `verify` passed from the exact publication source
  and artifact on macOS arm64, Node 24.16.0/npm 11.15.0. Verification includes
  npm signature/attestation audit and a fresh public `--ignore-scripts` install,
  `session-peer 0.3.1 (typescript)`, empty isolated Claude listing and clean removal.
  Independent public-key/DSSE checks also passed for the subject digests and
  signatures; npm's audit provides the package signature/attestation trust validation.

The 0.3.1 archive includes the reliability fixes and the migration wording
correction missing from 0.3.0. It retains dated preparation/public-history
records; this post-publication section is a later repository record, not a
same-version tarball replacement. No restaging or republication was performed.

SSH endpoints must use identical TS versions: 0.3.0 and 0.3.1 refuse each other
at preflight. Existing #20/#23 and update-notice Windows validation gaps remain.
Windows evidence is CI fixtures; the installation evidence above is local macOS.
The 0.2.1 demo's actual ACK remains historical. No fleet upgrade or GitHub tag/
Release creation is claimed. Draft #82 remains experimental and unmerged.

## 0.3.1 candidate checks — 2026-10-04 KST

Source candidate on merged main `cb661ff4f323f637673d528f05992a2bb275fefc`
after #103, #101, #96, #95 and #102. The local runtime and fixture checks below
ran at checkpoint `71668d112929576d22a83b2dd269cfb98d3f567a`; later candidate
changes only add this dated record. See the [patch contracts](PARITY.md#031-reliability-fixes).
This section records preparation, not public 0.3.1 publication.

- macOS arm64, Node 24.16.0/npm 11.15.0; `npm ci --ignore-scripts`, build,
  `test:types` and `npm test` passed: 151 tests, 146 passed, 5 Windows-only
  skipped, 0 failed. Python conformance used the pinned 1.0.2 reference above.
  The full suite includes `test/transport.test.ts`; a Windows command is not
  evidence that this POSIX transport suite ran on Windows.
- The inactive storage fixture starts without a writer or lock holder. Its
  valid saved-thread DB reports `activity=inactive`, `writerLock=absent` before
  and after testing. Without opt-in it refuses before the storage guard; with
  opt-in, dry-run validates without calling Codex and send queues exactly once.
  Root bare and escaped `sqlite_home` settings and malformed configuration then
  refuse without another queue call. Nested-only root/non-root doctor tests
  use the normal diagnostic DB schema and do not authorize sending.
- Reply-To tests cover nested URI/agent confusion with zero SSH/queue calls,
  and normal Claude names/Codex routes. SSH fixtures cover unnamed Claude PID
  targets and malformed per-host outcomes without retry. Registry tests include
  POSIX FIFO/race/size handling and healthy rows; UID 0 is simulated through
  controlled identity observations with a real held native lock, not a root login.
- `test:package` passed the 51-file allowlist, reproducible packaging, clean
  installation/removal and Bash/zsh shorthand contract/lifecycle. Repository
  metadata, four-language docs/links and `git diff --check` passed. `npm audit`
  reported 0 vulnerabilities. The exact runtime dependency `smol-toml@1.9.0`
  is locked; it is installed as a dependency, not bundled into the allowlist.
- `release.mjs pack` and `artifact` passed at the checkpoint, including identical
  repeated pack bytes and isolated `--ignore-scripts` install/version/list/removal.
  The final documentation-only candidate is repacked and compared with source
  in the preparation PR; its local artifact is not a future merged-main artifact.
- Registry preparation baseline: `latest=0.3.0`, `preview=0.1.0-preview.1`,
  0.3.1 absent. The helper pins the public 0.3.0 integrity recorded below and
  retains the preview pin. No dispatch, npm stage/promotion, tag or fleet change
  follows from these checks.

Windows evidence for the fixes is CI fixtures. Existing Windows-client jump,
remote deployment and update-notice validation gaps remain. Live-agent delivery
or ACK was not exercised by these fixture tests. Publication still requires the
new exact merged SHA/version/mode approval and runbook gates in RELEASING.md.

## Public 0.3.0 — 2026-10-03 KST

`session-peer@0.3.0` was published at `2026-10-03T05:14:44.917Z`
(14:14:44.917 KST). The registry reports `latest=0.3.0` and unchanged
`preview=0.1.0-preview.1`.

- Published source: `05418b21fcdef890826325d56b07bb3dabce3bb0`, the #89 merge.
  Its [exact-main CI](https://github.com/abruption/session-peer-ts/actions/runs/37096923337)
  and [CodeQL](https://github.com/abruption/session-peer-ts/actions/runs/37096922981)
  passed. The [stage-only publication run](https://github.com/abruption/session-peer-ts/actions/runs/37098738865)
  completed prepare/publish; GitHub records `abruption` approving environment `npm`.
- Stage ID: `cc0797c4-fbde-4cb0-a01b-806ff8409b39`. The authenticated stage
  download, retained Actions artifact and public registry tarball were compared
  byte for byte. All were the same 184,811-byte, 51-file package.
- SHA-256: `96315c907339ed7f2def7ac3a02c40b621ca385448884eb69b7d2d975771b797`.
- Registry integrity:
  `sha512-mdtikUMrGmMrdVSvPXdJcZeouTeuixOTzGwFKPhN66ATZqTohu9HKbejgOwXJe0/zrO+nt9asCAzAEhiHWDYGA==`.
- Public SLSA provenance matches the package SHA-512, source SHA, repository,
  `.github/workflows/publish.yml` and run `37098738865/attempts/1`.
- From the exact published source/artifact, `release.mjs artifact` and `verify`
  passed on macOS arm64, Node 24.16.0/npm 11.15.0. A fresh public install with
  `--ignore-scripts` printed `session-peer 0.3.0 (typescript)`, listed no Claude
  sessions in its isolated home, and uninstalled with its launcher removed.
  `npm audit signatures` cryptographically verified registry signatures for
  **3 packages** and attestations for **2 packages**; these are package counts.

### Released documentation and scope

The released archive retains a stale migration sentence in PARITY.md claiming
that multi-host aggregation is absent, although its 0.3.0 feature contract and
runtime support ordered repeated `--host` results. [PR #91](https://github.com/abruption/session-peer-ts/pull/91)
corrected the source at `f6fedfc08c0f374eec1a3b5e2e6bfd09bc98dd71`.
That correction is **not in the immutable public 0.3.0 archive**; it will be
included when a later version is packaged. The corrected local candidate was
not the published artifact. No replacement stage or same-version republication
was executed after the public release was confirmed.

SSH still requires the same TS version on both ends: 0.2.1 and 0.3.0 refuse each
other at preflight. Coordinate endpoint upgrades. #20 remains partial for
Windows-client jump routing; #23's Windows deployment cell and newer Linux
receipt/recovery rules remain unvalidated. Update notices' Windows refresh,
failure and forged-field cells also remain unverified. Public installation
evidence above is local macOS evidence; Windows evidence is CI fixtures. No
fleet upgrade or GitHub tag/release is claimed by this record. The demo's actual
0.2.1 ACK remains its own historical evidence.

## 0.3.0 candidate checks — 2026-10-03 KST

Candidate source: main after #79, #84, #86, #85, #75 and #83 plus the 0.3.0
preparation PR. Changes and known limitations are listed in
[PARITY.md](PARITY.md#030-remote-usability-and-maintenance). The local checks
below ran at checkpoint `ed2548cda56f369a9d46fecf8c0c4ddbff2e5e78` on base
`b910cca6ba2f84d5ca6e4d5c234cafcaf3fcbd58`; later commits on the preparation PR
changed documentation only. Local macOS arm64,
Node 24.16.0/npm 11.15.0, with the pinned Python reference: 121 tests, 116
passed, 5 Windows-only skipped, 0 failed; `test:types`, package smoke (including
the Bash/zsh shorthand contract and lifecycle), repository checker and
`npm audit` (0 vulnerabilities) passed. Release `pack` and `artifact` validated
the 51-file allowlist, and an isolated `--ignore-scripts` install of the local
tarball into a temporary prefix printed `session-peer 0.3.0 (typescript)` and
uninstalled cleanly. The packaged READMEs and guides were read from that tarball.
Each included PR passed the full macOS/Linux/Windows Node 22/24 matrix,
CodeQL and the release gate on its head. These are fixture results, not
live-TUI ACKs and not public release evidence. At this candidate checkpoint,
publication still required the procedure in
[RELEASING.md](RELEASING.md#030-stable-release-procedure) and a dated public
record. Completed public evidence is recorded [above](#public-030--2026-10-03-kst).

## Remote deployment workflow, POSIX cell (#23 F5) — 2026-10-02 KST

The operator workflow in
[docs/design/remote-deployment.md](docs/design/remote-deployment.md) was run by
hand on a user-provided Linux host (label `linux-x64-sandbox`). All work was
confined to a new, dedicated test directory that was removed afterwards; the
host itself is not disposable. Host egress could not be disabled, so offline
install flags were used and nothing was downloaded on the host. This covers
the **POSIX cell only**. The Windows cell has not been run, so the
F5 criterion of #23 remains open. Nothing outside a single test root on the
destination was written. No agent session was contacted, and no message was
submitted.

### Environment

| Item | Value |
| --- | --- |
| Destination | Debian 13 (trixie), Linux 6.18, x86_64, glibc 2.41, non-root account without sudo, umask 0077 |
| SSH | Server OpenSSH_10.0p2 Debian-7+deb13u4. Client OpenSSH_10.3p1 with `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ConnectTimeout=10`, the pre-pinned host-key alias, and no control socket. No host key was accepted or edited |
| Destination Node | None on PATH. Official `node-v24.21.0-linux-x64` (npm 11.19.0, ABI 137) and `node-v22.23.3-linux-x64` (npm 10.9.9, ABI 127) were unpacked inside the test root |
| Operator | macOS arm64, Node 24.16.0. `session-peer` 0.2.1 was installed from the verified tarball into a private temporary prefix, not globally |

### Integrity (step 1, on the operator)

All of the following were verified on the operator before any upload.

- **`session-peer-0.2.1.tgz`**
  - SHA-256 `6bf3c99d12260ce2e9421909b27326f1663ce6945aa798bc90ca1e17da675e43`, equal to the [0.2.1 record](#public-021--2026-09-29-kst).
  - Integrity `sha512-bPjriJZf…5nw0Mg==`, equal to the registry value.
  - SLSA provenance names commit `a9c42334da8f7faf83f0b9bb1fe52f1c695dfe8d` and `.github/workflows/publish.yml`.
- **Dependencies, pinned to that commit's `package-lock.json`**
  - `fs-ext-extra-prebuilt-2.2.14.tgz`: SHA-256 `1a2b5bf6…a712`; SHA-512 matches the lockfile.
  - `nan-2.29.0.tgz`: SHA-256 `038073cb…8af6`; SHA-512 matches the lockfile.
- **Registry signatures:** `npm audit signatures` in a scratch offline install reported 2 verified registry signatures and 1 verified attestation.
- **Node tarballs** (downloaded from nodejs.org): SHA-256 matched `SHASUMS256.txt` for v22.23.3 and v24.21.0. The OpenPGP signature on `SHASUMS256.txt` was **not** verified, because no `gpg` was available.
- **After upload:** the destination's `sha256sum` matched for every uploaded file.

### Installs produced

All installs used `<node> <npm-cli.js> install --offline --ignore-scripts`
with an empty per-run cache, an empty `--userconfig` and an isolated `HOME`.
Each added 3 packages, and the staging `package-lock.json` integrity values
equal the release lockfile.

| Install | Recorded Node | id16 | Manifest SHA-256 | Files |
| --- | --- | --- | --- | --- |
| A | v24.21.0, ABI 137 | `3220dc6bc02772f0` | `65da80c7…f7f3f` | 153 |
| B (Node path change) | v22.23.3, ABI 127, different path | `d323791c5632ed2e` | `5e12598a…6aea5` | 153 |
| S (swap path) | v24.21.0 at a path later swapped | `111e7af6bc1de967` | — | 153 |

The identity JSON contained `package`, `version`, `sha256`, `lockIntegrity`,
`platform:"linux"`, `arch:"x64"`, `libc:"glibc"`, `nodeMajor`, `modules` and
the Node realpath (redacted here).

### Results

| Step or case | Outcome |
| --- | --- |
| 2. Root trust | `lstat` from the account home down to the root: real directories, owned by the user, mode 700, no symlinks |
| 3. Staging | Created exclusively, mode 700; destination SHA-256 equal to the operator's |
| 5–6. Staging probe, with no final directory present | The self-locating wrapper printed `session-peer 0.2.1 (typescript)` under `env -i PATH=/usr/bin:/bin`. The native `flock` probe loaded from staging (Node 24 ABI 137; Node 22 ABI 127) |
| 7. Activation under lock | `mkdir` lock taken, target `absent`, `fs.renameSync` succeeded |
| 8. Post-activation checks | Real directory, owned, mode 700; staging gone; marker hash and name match; manifest matches; wrapper banner exact; native probe ok. The receipt was written, then the lock released |
| 8. Operator `doctor --host --remote-bin <absolute path> --json` (A, B and S) | `ok:true`, `diagnosticCompleted:true`, `implementation:"typescript"`, `version:"0.2.1"`, `ready:false` (no agents in the isolated home). Only A ran it **before** its receipt and lock release (see the order deviation below) |
| 8. Operator `send --host … --to 999999 --dry-run --json` (A and B) | `ok:false`, `error:"no_reachable_target"`, `status:"refused"`, `submitted:false`, exit 2. Not run for S |
| Same identity already installed | `already_provisioned`; this run's staging was discarded. Abbreviated: staging was created and classified without a second install |
| Foreign directory at the target | `foreign` (`no_valid_marker`). Activation refused with `target_exists`; retention removal refused with `foreign_refused`; the foreign file's SHA-256 was unchanged |
| Empty directory at the target | `empty`. Activation refused with `target_exists` |
| `rename(2)` on this kernel | Non-empty `ENOTEMPTY`; **empty replaced**; file `ENOTDIR`; symlink `ENOTDIR`; absent ok. This matches the ADR's stated POSIX scope |
| Python-style stub on a test-only PATH | Preflight with it as `--remote-bin` gave `remote_version_mismatch`. Its SHA-256 `19b6aab2…fec0` was identical before and after all cases |
| Lock contention | A second acquire gave `EEXIST` (`lock_held`) |
| Failed activation | A staging tree altered after its manifest was written activated, then post-activation checks failed (`manifest:false`). It was rolled back through `.failed-*` and deleted; the target was absent afterwards |
| Run died after activation (no receipt) | Lock `held`, `autoStale:false`; target `owned_no_receipt`. Break-lock naming another run was refused. After the operator journal confirmed that the run had ended, break-lock rolled back the unreceipted target. This was the rule at that date; the current ADR instead releases the old lock and recovers under a fresh lock, which is unvalidated |
| Run died after its receipt | Break-lock kept the install (`kept`) and removed only the lock; the install then classified as `already_provisioned` |
| Lock without `owner.json` | `held_unowned`, `autoStale:false`. A break naming a run was refused, and a new acquire was refused. It was removed only by an explicit unowned break |
| Same-path Node major swap 24→22 (install S) | **Undetected**, as the ADR states: the wrapper exited 0 with the exact banner, and the native probe loaded the Node 22 binary. The harness's existing-target check still reported `already_provisioned`. A runtime-identity comparison (the logic proposed for `launch.mjs`) reported `differs:["nodeMajor","modules"]`. Recomputing step 2 produced a new identity (`f4f323b466c56e60`) |
| Rollback to a previous directory | After callers were switched back from B to A, operator `doctor` via A returned `ok:true` |
| Retention | Removing A while it was configured was refused (`configured_for_caller`). B was removed together with its receipt. The foreign fixture was refused |
| Cleanup | Markers and receipts were listed, then the whole test root was deleted and confirmed absent |

### Deviations and limits

- **Root location:** the root was `<test-root>/data/session-peer-ts`, which is
  the ADR layout with `XDG_DATA_HOME=<test-root>/data`.
- **Network:** destination egress could not be disabled. Offline npm flags
  were used instead, and nothing was downloaded on the destination.
- **Execution:** the steps were driven by a test harness script, uploaded and
  hash-checked, and run with the recorded Node. This is not the proposed F6
  helper; the identity launcher, manifest and lock exist only in that harness.
- **Isolation shim:** the operator `doctor` and `send` runs went through a
  test-only shim (`env -i`, with `HOME`, `CLAUDE_CONFIG_DIR` and
  `SESSION_PEER_CODEX_HOMES` inside the test root, and `PATH=/usr/bin:/bin`)
  in front of the install wrapper. This kept discovery from reading the
  account's real agent directories. Version preflight still executed the
  install wrapper.
- **Initial npm check:** the first `npm --version` checks ran with the
  account's real `HOME`. npm's user configuration was therefore readable to
  that process. No writes outside the test root were observed, but this was
  not independently verified, and the account's npm directories were
  deliberately not inspected. All later npm runs used the isolated `HOME`,
  which remained empty.
- **Operator-check order (harness deviation):** in the original execution
  order of the private log, only install A ran the operator `doctor` and
  dry-run before writing its receipt and releasing the lock, as step 8
  required. B (run B3) wrote its receipt and released the lock first, and ran
  the operator checks afterwards. S wrote its receipt and released the lock
  before an operator `doctor`, and had no dry-run. For B and S, step 8 is
  therefore only partially evidenced. Their remote activation, verification,
  native-lock and lock results stand as recorded. This is based on the
  original command order and timestamps in the private log, which is
  chronological and was not rearranged.
- **Rule version:** the run used the ADR rules at the PR's fifth commit.
  Recovery, receipt and trust rules added later were not exercised here.
- **Harness gap:** the existing-target check did not recompute runtime
  identity, which is why it reported `already_provisioned` after the swap.
- **Not covered:** Windows (the F5 cell is still open), arm64, musl, macOS
  destinations, glibc older than 2.28, and the empty-directory race window.

## Public 0.2.1 — 2026-09-29 KST

`session-peer@0.2.1` is public. Registry publication time is
`2026-09-28T23:45:16.923Z` (08:45:16 KST). Verified `latest=0.2.1` and
unchanged `preview=0.1.0-preview.1`.

- Source: `a9c42334da8f7faf83f0b9bb1fe52f1c695dfe8d`, release PR #67.
- Exact-main CI: [36498904152](https://github.com/abruption/session-peer-ts/actions/runs/36498904152), successful.
- Staging run: [36499231956](https://github.com/abruption/session-peer-ts/actions/runs/36499231956), successful (`prepare` and `publish`).
- Artifact: `session-peer-0.2.1.tgz`; SHA-256 `6bf3c99d12260ce2e9421909b27326f1663ce6945aa798bc90ca1e17da675e43`.
- Registry integrity: `sha512-bPjriJZf7OQ5niZafwxNgMYo0DVpZldELEjp640xAfBMjBCAJatT2hPMTG9oV7xDX2ULCPUmox9+vFWc5nw0Mg==`, identical to the retained artifact manifest.
- SLSA provenance names source `a9c42334…` and run 36499231956 attempt 1, workflow `.github/workflows/publish.yml`.

The user approved the exact main SHA/0.2.1/stable-stage, separately approved the
protected GitHub npm environment, and reported final npm 2FA promotion complete.
Before environment approval, the retained Actions artifact was reviewed against
the exact source: all four READMEs, the four guides, `docs/api.md`, PARITY,
RELEASING, VALIDATION, SECURITY and CONTRIBUTING matched byte for byte; package
version, `VERSION` and the packaged CLI banner were 0.2.1. After promotion,
`release.mjs artifact` and `release.mjs verify` passed registry integrity/tag/
attestation checks, npm signature audit, fresh version-specific installation and
uninstall on macOS Node 22.14.0.

Not independently recorded here: the stage ID, a byte comparison of the staged
tarball, the authenticated pending-stage list and the Trusted Publisher UI; the
reviewing workstation had no npm session. The registry integrity equals the
retained artifact. This record adds no live-agent ACK claim. No republishing, tag
deletion, GitHub release/tag creation or fleet installation was performed.

## 0.2.1 candidate checks — 2026-09-29 KST

Candidate source: main after #62, #63, #64 and #66 plus the 0.2.1 preparation PR.
Changes are listed in [PARITY.md](PARITY.md#021-reliability-and-hardening).
Local macOS arm64 Node 22.14.0 with the pinned Python reference: 77 tests, 73
passed, 4 Windows-only skipped; package smoke, repository checker, `npm audit`
(0 vulnerabilities), release `pack` and `artifact` validation passed. Each
included fix PR passed the full macOS/Linux/Windows Node 22/24 matrix, CodeQL and
the release gate on its head. These are fixture results, not live-TUI ACKs and not
public release evidence; 0.2.1 publication requires the procedure in
[RELEASING.md](RELEASING.md#completed-021-stable-release-procedure) and a dated public record.

## Public 0.2.0 — 2026-09-28 KST

`session-peer@0.2.0` is public. Registry publication time is
`2026-09-28T04:28:39.027Z` (13:28:39 KST). Verified `latest=0.2.0` and
unchanged `preview=0.1.0-preview.1`; authenticated pending-stage list is empty.

- Source: `2107c4c9f3a2ad9deca42f4e0dd9673d2e5fb3ce`, release PR #44.
- Exact-main CI: [36377144969](https://github.com/abruption/session-peer-ts/actions/runs/36377144969), successful.
- Staging run: [36377508658](https://github.com/abruption/session-peer-ts/actions/runs/36377508658), successful; Node 24 / npm 11.15.0.
- Stage: `479ce166-c252-4f71-88d6-9a9bda4c4e92`, tag `latest`, GitHub Actions trusted automation.
- Artifact: `session-peer-0.2.0.tgz`; SHA-256 `2def227c0e6d997b2fd292c1f7cfaec2d4330e654caf703fcb100eadafb418c2`.
- Registry integrity: `sha512-wXUVn2GdF3fKAjJA9cUKIiBc9YVswnfBNALo2nxhXqmpCqC7/9N+AQJct/06RAU7stbcbrfY55JQ15PPESXwHw==`.

The user approved the exact main SHA/stable-stage, separately approved the
protected GitHub npm environment, and reported final npm 2FA promotion complete.
Before dispatch, the npm UI showed the Trusted Publisher mapping to this repo,
`publish.yml`, environment `npm`, with `npm stage publish` permission only.
GitHub required reviewer and main-only environment policy were checked.
The existing package setting permitted 2FA or bypass-enabled automation tokens;
this release did not change that setting and used OIDC staging.

Codex reviewed the retained Actions artifact against the exact source: all four
READMEs plus PARITY, RELEASING and VALIDATION matched byte for byte. The tarball
downloaded from npm staging was byte-identical to that retained artifact.
After promotion, `release.mjs verify` passed registry integrity/tag/attestation
checks, npm signature audit, fresh version-specific installation, version banner,
isolated empty Claude listing and uninstall on macOS Node 22.14.0. Published
provenance names the exact source SHA and run above. The npm 0.2.0 page rendered
the version-specific README and install command correctly when inspected.

This public-package check does not add a new live-agent ACK or cross-device
submission claim. Platform fixture evidence remains the exact-main CI above;
historical live-agent observations below retain their original versions.
The immutable npm tarball contains the dated pre-publication checkpoint; this
post-publication record is a later GitHub documentation update. No republishing,
tag deletion, GitHub release/tag creation or fleet installation was performed.

## Source discovery for 0.2.0 — 2026-09-28 KST

Issue #16 adds combined Claude/Codex listing and bounded multiple-home inventory.
The source feature is not present in the immutable npm 0.1.0 archive. It does
not enable implicit Codex send selection or inactive queueing (#17).

`test/discovery.test.ts` ports the Python 1.0.2 unified-list/multi-home cases:
optional absence versus explicit missing sources, alias/source merging and
cross-home UUID identity, global ordering/archived filters, whole invalid-config
rejection, per-home/agent partial failure, pinned-home bypass, destination-side
stdio/SSH inventory and nonzero partial envelopes. Temporary SQLite files and
local socket/pipe records are isolated; listing opens no inbox connection and
leaves DB contents unchanged. Permission/canonicalization/enumeration failures
are injected deterministically on every OS, not claimed as Windows ACL evidence.

The suite runs in macOS/Linux Node 22/24 CI with the pinned Python oracle, and
in Windows x64 Node 22/24 CI with native fixtures but no Python oracle. The
Windows SSH fixture additionally executes actual PowerShell/.cmd and checks
partial listing rows while a native writer is held, with no new queue call.
Windows test files run serially so concurrent PowerShell compilation does not
consume the native inspector's fixed timeout; assertions and production deadlines
are unchanged. Separately (#65), the compiling `Add-Type` owner inspection now has
a 20000 ms deadline after a slow runner exceeded 8000 ms on main (CI run
36419550921, attempt 1). The compile-free creation-time probe moved from 8000 ms
to 15000 ms (#78) after CI run 36542897023 (`windows-native (24)`) killed it at its
8000 ms deadline (observed 8024 ms including termination; the probe's actual
completion time is unknown). 15000 ms is a mitigation margin, not proof that slow
machines or CI never exceed it. Probes run sequentially, once per probe-eligible
Claude session record (N, including stale records), so a full scan's worst-case
probe budget is roughly 15 × N seconds plus I/O and termination overhead, an
increase of 7 × N seconds over the former 8 × N; the compiling path's 20000 ms
deadline is per call, not a scan bound. A Claude dry-run scans once and returns
after selection. A real Claude send scans during selection and, only if selection
succeeds, again during revalidation, so its worst case is about 15 × (N1 + N2)
seconds for the two scans' record counts; a refusal at selection has no second scan.
Timeouts still exclude the process. Each native subtest
cleans its children even after assertion failure. Package smoke verifies unified empty discovery without executables on PATH.
These are fixture contracts, not new live-TUI ACKs. CI evidence belongs to the
issue's PR-head checks; publication requires separate release preparation.

## Public 0.1.0 — 2026-09-27 KST

`session-peer@0.1.0` was published at `2026-09-27T11:23:51.466Z`
(20:23:51 KST), according to the public registry. Its source was
`0edc4f8ae05256698f591b7402e89cd3d5858eef` and
[run 36315310094](https://github.com/abruption/session-peer-ts/actions/runs/36315310094)
created npm stage `e8f7941e-9ad1-4039-9132-285c900ed61d` after the separate
stable-stage and protected-environment approvals. The owner then confirmed npm
2FA approval. The run itself records staging, not the later public verification.

The release-session checks recorded matching public registry integrity and
provenance metadata, npm signature audit, fresh isolated installation and
uninstallation. The 2026-09-28 KST read-only recheck downloaded the public
tarball and independently matched both hashes below against the run manifest
and registry. Registry metadata included provenance and one package signature.
At that recheck, `latest` was `0.1.0` and `preview` was `0.1.0-preview.1`.

- SHA-256: `41189d771a94c14775f8ef297d887627f4ab12819856bb18efff291e03c2e269`
- Integrity: `sha512-/FtILLgUpIAgqf5FsdU5/x17IGeWO3ylmm47gbSyN3hHjD40pp5gtOeAXU3zqmye/cx7PE52Pp/oLa0ZgZyDQQ==`

These are package-delivery checks, not new live-TUI ACK evidence for the
published build. Historical ACKs below retain their original scope.

### Packaged documentation discrepancy

The immutable 0.1.0 tarball contains the earlier four READMEs and validation/
release notes written before publication. Its English README still describes
0.1.0 as release source awaiting approval. That wording is stale; it does not
mean the public stable package is unavailable. The later GitHub README fix
[PR #15](https://github.com/abruption/session-peer-ts/pull/15) could not change
an already published archive. Corrected packaged documentation requires a new
version; never republish 0.1.0 to replace its README.

The npm version page returned HTTP 403 to the read-only web reader during the
2026-09-28 check, so its rendered README was not verified. The tarball contents
were inspected directly. See the exact-artifact documentation review in
[RELEASING.md](RELEASING.md#documentation-gate-for-the-next-release).

## Current CI scope

All three operating systems run Node 22/24. The checks differ:

| Platform | Automated scope |
| --- | --- |
| macOS/Linux | Full contract suite, type checks, Python reference fixtures, package smoke, release pack/artifact checks and audit. |
| Windows x64 | Build/type checks, Claude named-pipe/auth/stale-record fixtures, held/free kernel locks, writer ownership and pre-submit races, Codex storage-refusal fixtures and synthetic native-exit/SSH response outcomes, PowerShell/.cmd SSH framing through a fake endpoint, package/native-load smoke and audit. |

Windows runs its native suite, not the POSIX/Python reference suite. Both
Windows Node jobs are required by the aggregate release gate. The x64/Node 24
user-observed ACKs below remain separate one-shot evidence, not Windows arm64 or
live Node 22 qualification. See [PARITY.md](PARITY.md) for the versioned matrix.

## 0.1.1 milestone verification work — 2026-09-28 KST

[PR #37](https://github.com/abruption/session-peer-ts/pull/37) expands Windows
fixture coverage for #34 and adds the #33 compatibility/migration guide.
No runtime feature, package version or public npm tag changes in this work.
The initial expanded Windows x64 Node 22/24 suite and all other platform jobs
passed [run 36357787318](https://github.com/abruption/session-peer-ts/actions/runs/36357787318)
at commit `5c84e91`. Final PR-head checks must include the additional controlled
sampling races and packaged guide; use the PR's latest required release gate.

The Windows C# fixture holds actual LockFileEx locks and supplies native process
PID/SID/start evidence through Restart Manager. Tests cover wrong and competing
openers, lock replacement between samples, owner replacement during pre-submit
revalidation, dry-run zero calls, one queue submission, inactive/ambiguous refusal,
nonzero/timeout unknown outcomes without retry or stderr leakage. Sampling-race
tests control the delay only; lock/process/owner inspection remains native.

The isolated `ssh.exe` fixture records the wire request and runs actual
PowerShell with a `.cmd` path containing spaces. It checks exact-version
preflight, stdin JSON, refusal/unknown handling and one native fixture queue.
It does not connect to a network or authenticate a real SSH host. Package smoke
checks the installed `.cmd` launcher, empty discovery, declarations, installed
native lock binary, repeat-pack hashes and uninstall. No fixture result is
real Codex queue acceptance, live-TUI ACK or Windows arm64 evidence.

## Public 0.1.0-preview.1 — 2026-09-27 KST

The preview.1 candidate and exact merged main passed macOS/Linux Node 22/24,
native Windows Node 22/24 and the release gate. A separate gate change preserved
the existing `latest: 0.1.0-preview.0` while permitting preview.1 staging.
[Run 36313884100](https://github.com/abruption/session-peer-ts/actions/runs/36313884100)
staged the exact main commit `f65d3ee99cc26ff4a267aef84e31a308d034ac80`
through the stage-only OIDC Trusted Publisher. After separate environment and
npm 2FA approvals, the public registry showed `preview: 0.1.0-preview.1` and
unchanged `latest: 0.1.0-preview.0`.

The npm stage tarball matched the retained run artifact byte for byte. Its
SHA-256 was `d154beac93893b60b0695e5a6296e185beb8dbd05188ffe04befb74d29966110`.
The public SHA-512 integrity and provenance metadata matched the manifest;
`npm audit signatures`, fresh version-specific install, CLI version and empty
Claude discovery checks, and uninstall passed. This verifies package delivery,
not a new live Claude/Codex message ACK from the published build.

## Historical 0.1.0 stable candidate

The preparation updated the version handshake, package metadata, four README
languages, release gates and tests. Native delivery logic was unchanged.
Candidate and exact merged-main CI preceded the separately approved staging,
npm 2FA approval and public checks recorded above. Those approvals did not
authorize a GitHub tag or fleet installation.

## Historical 0.1.0-preview.1 candidate checks

After #7–#10 were merged, the versioned candidate passed the local macOS
arm64 Node 22 contract suite (23 passed, two Windows-only tests skipped),
TypeScript test type-check, package/declaration smoke test, four-README
repository checks and `npm audit` (zero vulnerabilities). The package smoke
test repeated packing with the same SHA-256 and verified isolated install and
uninstall. The new candidate was not sent to a live agent and was not published
by these checks. Windows Node 22/24 and macOS/Linux Node 22/24 checks were also
required on the candidate PR and exact merged `main` before publication.

## Historical initial automated checks

- 14 tests pass locally on macOS arm64 / Node 22.14.0.
- Real fixture SQLite DBs, Unix inbox sockets and separate C processes holding
  actual advisory locks; Python is the discovery oracle, not the implementation.
- Refused inactive/ambiguous/wrong-owner cases; one native fixture queue call;
  native nonzero after spawn and SSH response loss remain unknown with no retry.
- Package file allowlist, same-build repeat SHA-256, clean prefix installation,
  empty-PATH discovery and uninstall pass. npm audit reports 0 vulnerabilities.
- CI defines macOS/Linux × Node 22/24; see the repository Actions results for
  those runs rather than treating this local check as their substitute.

## Real TUI and SSH checks

### Native Windows candidate — 2026-09-27 KST

An isolated prefix under the Windows user's Temp directory was installed from
this branch's local tarball. The existing Python CLI was not removed or
overwritten. Node 24.16.0 and npm 11.13.0 were present. Windows native
`list` found the live Claude inbox; Codex dry-run verified the saved thread,
kernel lock, single same-user `codex.exe` opener and stable start time. Mac
mini → Windows SSH preflight used an explicit Windows platform, remote `.cmd`
path and an already authenticated OpenSSH control socket; no host-key bypass
or new login was introduced.

One message per target was submitted from this candidate through Windows SSH.
The CLI returned Claude `posted` and Codex `queued`, with
`consumptionConfirmed:false`. The user separately confirmed exact response
lines in both Windows native TUIs:

- Claude: `ACK TS-WIN4-CLAUDE-20260927-A`
- Codex: `ACK TS-WIN4-CODEX-20260927-B`

These ACKs are user-observed responses, not direct terminal-pane capture by
the test runner. No retry was made. This is one-shot evidence, not a soak or
all-architecture qualification. Windows x64 was tested; Windows arm64 and
Node 22 remain untested in this live check. Python remains installed.

Dedicated, newly created Claude/Codex test TUIs only. The user approved trusting
the two otherwise empty test folders. Agent permissions were not changed.
Each route passed discovery and no-delivery dry-run before exactly one send.
ACKs below were observed as separate **assistant response lines in the owned
live tmux panes**, not copied from submitted prompts, queues or transcript files.

| Route | Native target | Submission | Actual response |
| --- | --- | --- | --- |
| Mac mini local | Claude Code 2.1.281 | posted | `ACK TS186-LOCAL-CLAUDE-8fc721d0` |
| Mac mini local | Codex CLI 0.157.1 | queued | `ACK TS186-LOCAL-CODEX-cb042ac9` |
| Mac mini → MacBook SSH | Claude Code 2.1.281 | posted | `ACK TS186-SSH-CLAUDE-f0275ade` |
| Mac mini → MacBook SSH, structured Reply-To URI as destination | Codex CLI 0.157.1 | queued | `ACK TS186-SSH-CODEX-a771e96c` |

Local Node: 22.14.0. Remote MacBook: 24.20.0, selected by a task-owned wrapper
because its normal PATH selected unsupported Node 26. KR Linux Node 24.16.0
also passed real SSH version negotiation and empty Claude discovery. KR native
agent delivery was not tested. No service was restarted or global CLI replaced.

The CLI itself still reports `consumptionConfirmed:false`; external ACK review
does not change that contract. This is a one-shot functional test, not a soak.
Local self-SSH was denied by the existing SSH authentication configuration; no
credentials or host-key bypass were introduced. Reverse SSH was not asserted.

## Historical runtime build checked on both Macs

Compiled module SHA-256 values matched between the local build and the isolated
MacBook installation used for the SSH ACK tests:

```text
0b708f1211330ff489b6a405e0ebb71d2b3b392acdb19c216dba18e7b23016c7  cli.js
1d8c41dfc174d950e2196c64f93b324f09befa388a5b303439c390a526ffda48  discovery.js
c3187c99c46364730e46e35ef23d8f3a37e541593b2a6f9c3945dce979e7e99c  process.js
b716fed8fe6c8c04047f8485a6e3f982d6e64e5638df570b3b8c2a128f88c81e  protocol.js
dd946024a61ce8721c273d47e911494c0c8facd62facd9b791a451b90cb702bf  send.js
c441567e83c64c7d5735708936e9a42b68dd9ea0cdf0ef95538da7919d550496  writer.js
```

These hashes and real-TUI ACKs precede the public command rename to
`session-peer` (the npm package was then named `session-peer-ts`). The rename changes the
CLI version banner to `session-peer 0.1.0-preview.0 (typescript)` and the default
SSH executable to `session-peer`; it does not change native delivery logic.
Fresh package-install and SSH fixture tests cover the renamed entry point and
reject a different implementation on remote PATH before sending. The earlier
ACKs are not represented as a new live test of the renamed build.

The npm package name was subsequently changed to `session-peer` before a
successful publication; the GitHub repository remains `session-peer-ts`.
Package identity, tarball naming and publication confirmations are covered by
package/release fixtures, not claimed as new live ACK evidence.

## Remaining evidence limits

Windows arm64, IPv6 literals, Relay/MCP/wake, full Python CLI parity and
automatic reverse-route detection remain outside this evidence. Registry
publication checks for preview.1 and stable 0.1.0 are recorded above separately
from the historical live-agent ACKs. Future publication still requires the
approvals and gates in RELEASING.md. Native dependency prebuild availability
must be tested on each architecture claimed by a future release.


## 2026-09-28 — #17 source Codex home selection (0.2.0 development)

Source adds implicit unique-live selection, explicit inactive opt-in, sanitized
resolution diagnostics and optional native queue IDs. npm 0.1.0 remains the
published baseline; no release or tag operation is part of this work.

Local macOS arm64 / Node 22.14.0: 47 tests passed, 3 Windows-only tests skipped.
Fixtures cover real flock holders, implicit selection, explicit conflicts,
multiple writers, unsaved first turns, inactive opt-in, configuration truth table,
DB/inventory/lock evidence changes, zero-submit dry-run and unknown/no-retry.
The Windows suite adds equivalent selection/metadata cases to its native
LockFileEx and owner-swap tests, plus inactive flag/queue ID through PowerShell SSH.
Initial PR CI run `36368300629` passed macOS/Linux and Windows x64 on Node
22/24, including package smoke and the release gate. Latest-head results are
recorded in PR #39; a fixture result is not a recipient ACK.
No live agents, native DB writes, Python/Relay operations or real SSH destinations
were exercised. See PARITY.md for the intentional stricter missing-home policy.

## 2026-09-28 — source doctor for 0.2.0 (#18)

Read-only doctor fixture coverage adds missing/unsupported/permission/unknown
home and tool results, separate command success/readiness, truthful capabilities,
Claude inbox metadata without connection, bounded TS skill compatibility,
stdio framing and SSH doctor round trips. Codex executables are inspected but
never run. No live sessions, user homes, inbox dispatch or delivery ACK are used.
Windows CI includes the portable diagnostics suite and encoded PowerShell/.cmd
SSH checks in the existing native fixture. Windows pipe advertisements remain
metadata evidence, not proof of a connectable pipe. Public npm 0.1.0 is unchanged;
these tests do not constitute release or publication approval.

## Source #19 CLI usability — 2026-09-28

The 0.2.0 development source adds text output, complete list/send/doctor help, positional
message compatibility and Unicode 14.0.0 exact casefold. No npm publication or
live-agent ACK is claimed. `test/cli-usability.test.ts` is included in the native
Windows test command and the macOS/Linux suite. It verifies output/exit codes,
partial discovery, parse-before-stdin behavior, Unicode collisions and PID
selection using isolated process/socket fixtures. Windows posting ownership is
covered by the existing native fixture suite; the new name fixture is dry-run on
Windows. Version metadata remains 0.1.0 until separate release preparation.

## 2026-09-28 — Source skill integration (#25, preparing 0.2.0)

Separate `session-peer-ts` companion skill source and pinned Skills CLI 1.7.0
setup are prepared without npm publication or new skill tags. Original Python
skill content stays unchanged. Runtime examples use temporary homes/SQLite only;
Codex inactive dry-run verifies zero submission and no queue/database mutation.
The companion lifecycle test installs, replaces from a second isolated source,
lists and removes project/global copies for Codex and Claude Code, preserving a
Python skill fixture. No production agent homes are edited, and no live TUI ACK
is claimed. npm installs continue using `--ignore-scripts`.

Independent read-only review used Antigravity `gemini-3.1-pro-high`. Its concrete
clarification (absolute remote launcher paths) was verified against the CLI and
applied to the companion skill. Parent review corrected the TS `retryAllowed`
field name and made capability checks require affirmative supported help entries.
Real GitHub exact-commit installation was also exercised in isolated scopes;
installation commands do not depend on a moving tag.


## 0.2.0 release preparation — 2026-09-28 KST

Feature source: main `b87eb39a32f8678cd93789ce81792d5f248fdfa6`, following #43.
Issues #16/#17/#18/#19/#25 are implemented. This release updates the package,
lockfile, version handshake, four READMEs and stable-stage baseline to 0.2.0.
The baseline is verified public 0.1.0; preview stays at 0.1.0-preview.1. No 0.2.0
preview publication is assumed. The new workflow requires the reviewed exact
main SHA as `source_sha` and rejects any different runtime source SHA.

The integrated feature tree passed macOS/Linux/Windows Node 22/24 CI in run
36370904539. Release-specific local tests, retained candidate hash, packaged
prose review and exact-head CI are recorded in the release PR. Local artifacts
are not the later exact-main workflow artifact; staging requires its own hash
review and npm 2FA approval. This dated preparation record does not assert that
0.2.0 has been publicly published or verified. Historical real-TUI ACKs do not
constitute a new 0.2.0 ACK test. Companion skill source is independently pinned
and managed; its repository PR/merge status is not an npm runtime dependency.
