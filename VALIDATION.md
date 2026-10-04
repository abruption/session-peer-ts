# Validation record — updated 2026-10-04 KST

This dated record covers the 0.3.1 source candidate and public 0.3.0, 0.2.1 and 0.2.0 verification, historical 0.1.0
public verification, candidate checks and live-agent observations. Older sections
describe their stated checkpoint rather than current feature availability.
It does not claim complete Python parity.
Python reference: v1.0.2, commit `47c23713d0a2a3c11ebde6186afd8c43489b8b65`.

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
| Windows x64 | Build/type checks, Claude named-pipe/auth/stale-record fixtures, held/free kernel locks, writer ownership and pre-submit races, native queue outcome fixtures, PowerShell/.cmd SSH framing through a fake endpoint, package/native-load smoke and audit. |

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
