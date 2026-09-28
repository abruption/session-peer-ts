# Python compatibility and npm migration

Updated 2026-09-28 KST. Python reference: **1.0.2**,
[`47c2371`](https://github.com/abruption/session-peer/tree/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core).
The published TS baseline remains **0.1.0**,
[`0edc4f8`](https://github.com/abruption/session-peer-ts/tree/0edc4f8ae05256698f591b7402e89cd3d5858eef/src).
The matrix now includes **source development for 0.2.0 (#16/#17/#18)**: unified listing,
bounded Codex home discovery and safe selection/inactive opt-in. These features
are not in the npm 0.1.0 archive;
source package metadata stays at 0.1.0 until separate release preparation.
All other rows retain their baseline scope. Do not use version equality alone
to mix development builds and published binaries over SSH; test the same build
on both ends. `referenceVersion: "1.0.2"` names the comparison baseline, not a
complete parity guarantee. See [VALIDATION.md](VALIDATION.md) for dated evidence.

## Feature and command matrix

**Implemented** means the stated bounded behavior exists. **Partial** means a
related command exists with the differences shown. **Planned** means no usable
TS equivalent yet. **Deliberately different** identifies a maintained boundary,
not a missing implementation. Issue links describe work, not available features.

| Surface | Python 1.0.2 | TS source (published differences noted) | Status / follow-up |
| --- | --- | --- | --- |
| Claude discovery and inbox submission | Local POSIX socket / Windows named pipe; PID or name; discovery rechecked before submission | Same transport families and recheck; Windows process start identity and authenticated pipe checks | Implemented; native fixtures are not live ACKs |
| `list` selection | Unified agent list; optional agent; bounded multiple Codex homes; partial discovery diagnostics | Source: combined Claude/Codex by default, optional agent/home filters, bounded multi-home inventory and partial diagnostics. Published 0.1.0 still requires an agent and explicit Codex home | Implemented in source for [#16](https://github.com/abruption/session-peer-ts/issues/16), 0.2.0; no Antigravity adapter |
| Codex active queue | Saved UUID, unique live writer, real lock/owner checks, pre-submit revalidation | Source: same protections, full UUID, implicit unique-live selection or explicit home; all known candidates checked | Implemented in source for [#17](https://github.com/abruption/session-peer-ts/issues/17), 0.2.0 |
| Implicit home / inactive queue | Select unique live home; explicit inactive opt-in under separate guards | Source: unique live selection; explicit saved inactive home with opt-in and verified inactive candidates. Public 0.1.0 has neither | Implemented in source for #17, 0.2.0; no wake/resume |
| `doctor` | Readiness diagnostics; return-route check is opt-in | Source: read-only local/SSH metadata, per-agent/home results, capabilities and bounded TS skill compatibility. Published 0.1.0 has no doctor | Implemented in source for [#18](https://github.com/abruption/session-peer-ts/issues/18), 0.2.0; no return-route probing |
| CLI input, help and names | Human text or JSON; positional or named/stdin message; Unicode casefold matching | JSON required; named `--message`/`-m` or stdin only; minimal top-level help; ASCII case-insensitive names, Unicode names require PID | Partial; [#19](https://github.com/abruption/session-peer-ts/issues/19), 0.2.0. Published 0.1.0 help still says “preview”; source help now describes unified list |
| From / Reply-To | Caller detection, automatic return-route metadata, structured URI resolution | From uses Codex environment UUID only; explicit `--reply-address`; local/SSH Reply-To URI parsing with conflict checks | Partial; [#21](https://github.com/abruption/session-peer-ts/issues/21), 0.3.0 |
| SSH | Python source streamed to POSIX remote Python; multiple hosts/options/host metadata | Same-version installed TS CLI required; one host; strict preflight; JSON stdin; explicit Windows PowerShell path | Partial; [#20](https://github.com/abruption/session-peer-ts/issues/20) hosts/options, [#23](https://github.com/abruption/session-peer-ts/issues/23) deployment/version design, 0.3.0 |
| Updates | Cached advisory client/skill notices; explicit manager-aware update commands | No update cache/command; `--no-update-notice` accepted as a no-op | Planned [#22](https://github.com/abruption/session-peer-ts/issues/22), 0.3.0 |
| Reusable execution API | Agent/transport capability adapters | Package root exposes pure protocol helpers only; no general typed execution API | Planned [#24](https://github.com/abruption/session-peer-ts/issues/24), Future — Agent integrations |
| Skill guidance/setup | Companion skill guidance targets Python | Separate manual skill install; TS-aware guidance/setup remains planned | Planned [#25](https://github.com/abruption/session-peer-ts/issues/25), 0.2.0 |
| MCP | Optional extra, restricted destinations; separate wake permission | Unsupported | Planned [#26](https://github.com/abruption/session-peer-ts/issues/26), Future — Agent integrations |
| Codex wake | Explicit opt-in; platform/version gates; may run a model and alter history | Unsupported; queued does not wake or prove consumption | Planned [#27](https://github.com/abruption/session-peer-ts/issues/27), Future — Agent integrations |
| Antigravity | Experimental registered bridge generation/inbox contract | Unsupported | Planned [#28](https://github.com/abruption/session-peer-ts/issues/28), Future — Agent integrations |
| Paired device client | Optional crypto/device transport and receiver policy | Unsupported | Planned [#29](https://github.com/abruption/session-peer-ts/issues/29) design, [#30](https://github.com/abruption/session-peer-ts/issues/30)–[#32](https://github.com/abruption/session-peer-ts/issues/32), Future — Paired devices and Relay |
| Relay server / hosted control service | Separate infrastructure and deployment | Not part of the TS CLI deliverable | Deliberately different scope; #29 must define client boundaries before implementation |
| Wait / general ACK / exactly-once consumption | No general CLI wait/ACK or exactly-once consumption guarantee | No general CLI wait/ACK or exactly-once consumption guarantee | Shared limit, not a TS parity gap; paired-device deduplication is not end-to-end consumption |

Source anchors at the baselines:
[TS CLI](https://github.com/abruption/session-peer-ts/blob/0edc4f8ae05256698f591b7402e89cd3d5858eef/src/cli.ts),
[writer](https://github.com/abruption/session-peer-ts/blob/0edc4f8ae05256698f591b7402e89cd3d5858eef/src/writer.ts),
[send](https://github.com/abruption/session-peer-ts/blob/0edc4f8ae05256698f591b7402e89cd3d5858eef/src/send.ts),
[protocol](https://github.com/abruption/session-peer-ts/blob/0edc4f8ae05256698f591b7402e89cd3d5858eef/src/protocol.ts);
[Python parser](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/cli.py),
[commands](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/commands.py),
[Codex](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/codex.py).

## Environment and installation ownership

| Setting / surface | TS source behavior / migration consequence |
| --- | --- |
| `CLAUDE_CONFIG_DIR`, `ANTHROPIC_CONFIG_DIR` | Claude config precedence: first nonempty value in that order, otherwise `~/.claude`. No Codex home is required for Claude listing. |
| `CODEX_HOME`, default `~/.codex`, macOS Orca account homes | Source: bounded automatic Codex listing and writer safety inventory. Codex **send** still requires `--codex-home`. Published 0.1.0 requires it for Codex list too. No recursive disk scan. |
| `SESSION_PEER_CODEX_HOMES` | Source: JSON array of absolute or `~/` paths adds required listing homes and writer candidates. Invalid list configuration is rejected as a whole with other sources preserved; send keeps fail-closed inventory. Published 0.1.0 uses it only for writer checks. |
| `CODEX_THREAD_ID`, `CODEX_SESSION_ID` | Valid UUID enables default From metadata; `--no-from` disables it. Claude/Antigravity caller detection is not implemented. |
| Reply/update/Relay settings from Python | No blanket compatibility. Only the flags and environment reads in the TS baseline above are implemented. Do not infer a route or permission from an environment variable or From header. |
| Runtime and native dependency | TS needs Node 22.13+ within 22.x or Node 24.x, plus a matching native lock binary. Python is not a TS runtime fallback. |
| CLI ownership | Both distributions install `session-peer`; npm does not remove Python/uv/pipx/venv installations. Select one path deliberately and update it through its owning manager. |
| Skills | Install separately and explicitly; no package `postinstall` downloads a skill or invokes another package manager. |

## Source unified listing contract — #16 / 0.2.0

`node dist/cli.js list --json` combines Claude and saved Codex rows. Use
`--agent claude` to skip all Codex inventory, or `--agent codex` to skip Claude.
`--codex-home PATH` pins only Codex discovery (also in a combined list) and
bypasses unrelated environment/Orca/configuration errors. It is inapplicable to
`--agent claude`. A configured empty string is invalid JSON: unset
`SESSION_PEER_CODEX_HOMES` or use `[]` to disable extra homes.

Automatic sources are visited in order: default `~/.codex`, nonempty `CODEX_HOME`,
immediate macOS Orca account homes, then `SESSION_PEER_CODEX_HOMES`. Canonical
aliases merge source labels; UUIDs in distinct homes stay distinct. Every Codex
row includes `codexHome` and `stateDb`; identity is host + canonical home + UUID.
Rows sort by descending `updatedAt`, home and UUID using Unicode code-point
ordering. `--all` independently includes archived records in every home and
unreachable Claude records. Discovery success does not imply an active writer.

Per-home `status` is `ok`, `absent` or `error`; missing optional default/Orca DBs
are `absent`. Missing argument/environment/configured homes are errors, even
when they alias an optional source. Empty readable DBs are `ok` with zero rows.
Aggregate Codex status is `not_installed` only when no DB is readable and there
are no errors; that is exit 0. Any inventory/home/agent failure yields exit 1
while preserving other rows. Error codes are `state_db_missing`,
`state_db_not_regular`, `permission_denied`, `state_db_read_failed`,
`home_resolution_failed`, `candidate_enumeration_failed`, or
`invalid_home_configuration`. Errors use fixed text, never raw exception bodies.
Inventory errors appear in `discovery.codex.errors`; per-home errors in `homes`.
Top-level `codexHome` appears only for exactly one candidate and no inventory
errors; consumers should use each row's home.

The same listing and filters execute in the SSH destination's environment;
nonzero partial responses retain rows and diagnostics. No recursive scan,
inbox connection, writer selection or queue submission is part of listing.
SQLite is read-only but its existing WAL bookkeeping caveat still applies.
Listing availability never relaxes send's lock/owner/revalidation checks.
The shared enumerators reject a set empty extra-home variable and require named
homes for both list and send. Listing may return partial results; send refuses
any unreadable inventory and never uses listing results as authorization.
Pinned listing bypasses unrelated configuration, but pinned send checks all sources.

Source: [discovery.ts](https://github.com/abruption/session-peer-ts/blob/main/src/discovery.ts),
[CLI](https://github.com/abruption/session-peer-ts/blob/main/src/cli.ts),
[writer](https://github.com/abruption/session-peer-ts/blob/main/src/writer.ts).
Contracts: [discovery.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/discovery.test.ts)
ports Python unified/multi-home cases; native Windows SSH/partial-envelope checks
are in [windows-contract.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/windows-contract.test.ts).
The Python oracle runs in POSIX CI; deterministic fixtures and injected filesystem
failures run on Windows too. Error injection is not a real Windows ACL test.

## JSON result compatibility

Do not parse human messages or assume an optional key exists. Python's
`schemaVersion: 1` and TS's `schemaVersion: 1` are not identical field contracts.
TS normal envelopes have `schemaVersion`, `host`, `command`, `ok`, `version`,
`referenceVersion`; caught failures omit the two version fields. Exit codes are
0 (success), 1 (operation error), 2 (usage/refusal as classified by the command).

| Field / path | Python 1.0.2 | TS (source differences noted) |
| --- | --- | --- |
| `list.sessions`, `discovery` | Unified/per-agent and per-home diagnostics; partial results can remain with `ok:false` | Source: Claude rows then Codex rows; readable homes survive failed homes/agents with `ok:false`, exit 1. Published 0.1.0 has only selected-agent/single-home results |
| `send.status`, `submitted` | Submission/wake/transport-specific details; do not assume a uniform error shape | `validated:false`, `posted:true` (Claude), `queued:true` (Codex); caught refusal is `refused:false`, unknown is `unknown:null` |
| `consumptionConfirmed` | False for native submission; queueing is not consumption | Always false on send results, including refusal/unknown |
| `target`, `chars`, `dryRun`, `codexHome` | Target and home details depend on agent; Codex target includes `id`/`name`, with separate `agent` | Success/dry-run target has `agent` plus `id` or `pid`/`name`; `chars` counts enveloped code points; `codexHome` only on Codex success/dry-run |
| `queueId` | Present if native queue stdout supplies an ID | Source #17: optional bounded native confirmation ID on successful queue only; absent in public 0.1.0 |
| `codexHomeResolution` | Resolution diagnostics on Codex success and some refusals | Source #17: sanitized resolution on success and failures after resolution begins; private owner fingerprints remain internal. Absent in public 0.1.0 |
| `remoteVersion` | Optional remote `list` metadata after version discovery (also update diagnostics); not universal on send | Absent; exact TS version banner must pass preflight; mismatch is a refusal |
| `replyRoute`, `addressResolution` | Optional metadata when route advertised / Reply-To destination resolved | Absent; explicit envelope/URI support does not imply these JSON fields |
| `wake` | Optional, opt-in; failed activation may still have `submitted:true` and `ok:false` | Absent; unsupported option |
| SSH metadata | Requested/resolved host and SSH metadata; multi-host list may be an array | Verified remote response adds `host`/`sshHost`; caught local SSH failure reports the local host; no host aggregation |
| `error`, `retryAllowed` | Error/detail fields vary by path; submission may already have happened | Fixed error codes, caught failure has `retryAllowed:false`; native stderr/message body are not copied into errors |
| `clientUpdate`, `skillUpdates` | Optional advisory notice metadata | Absent |

An **absent** submission field is not `false`; `null` is not `false` either.
Check `ok`, command, status, exit code and presence separately. TS unknown means
submission may have happened; never automatically resend. A Python wake error
with `submitted:true` must not be retried as a fresh send. A missing reply or target exit
alone does not establish consumption or failure. Observe ACK in the receiver
TUI separately. Further #20 changes must test success, refused, partial and
unknown output, including absent/null/false distinctions.

Output sources: TS CLI/send above; Python
[commands](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/commands.py),
[Codex queue/wake](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/codex.py),
[SSH errors](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/ssh.py).

## Transport, size and failure boundaries

| Boundary | Python 1.0.2 | TS (source differences noted) |
| --- | --- | --- |
| Remote prerequisite | POSIX-compatible remote shell and usable Python; source delivered over stdin. Native Windows destination is not this SSH path | Installed same-version TS CLI + supported Node/native dependency. POSIX shell by default; explicit `--remote-platform win32` uses PowerShell and a `.cmd` launcher |
| Message on SSH | Base64 body in quoted remote argv; source on stdin | Message in UTF-8 stdin JSON; PowerShell's encoded command contains launcher/flag, not the message |
| Remote body/command | 90,000-character remote message cap; fully quoted UTF-8 SSH command capped at 131,071 bytes after base64/argument expansion | Stdin reader capped at 4,100,000 bytes, including JSON framing/escaping. No unlimited stream; OS argv limits still apply when invoking native queue |
| General message | At most 1,000,000 characters; Codex at most 32 KiB UTF-8 | At most 1,000,000 Unicode code points; Codex at most 32,768 UTF-8 bytes; rejects blank/NUL |
| Envelope overhead | From/Reply-To and encoding may reduce usable body budget | Limits apply after From/Reply-To envelope creation; JSON escaping can exhaust wire budget sooner |
| Preflight and refusal | Source transport and path-specific diagnostics, not exact installed-TS preflight | Before message dispatch, version mismatch/auth/host trust/unreachable/timeout produce fixed refusal codes and `submitted:false` |
| After dispatch | Respect submission metadata; failed wake/transport does not prove nothing was submitted | Lost/malformed/unverified response or nonzero/timed-out native queue after spawn is unknown with `submitted:null`, no automatic retry |

Sources: Python
[limits](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/common.py),
[SSH construction](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/ssh.py);
TS CLI/send above. UTF-8 byte limits are not character counts. Local native
Windows support, WSL/POSIX SSH and TS native Windows SSH are separate paths.

## Migrating a workflow to npm

1. **Inspect command ownership.** Run `type -a session-peer` (POSIX) or
   `Get-Command session-peer -All` (PowerShell), then `session-peer --version`.
   Record the Python interpreter/venv or owning uv/pipx/package manager before
   changing PATH. Do not delete another manager's files or overwrite its shim.
2. **Install the chosen published version explicitly.** For the public baseline:
   `npm install --global --ignore-scripts session-peer@0.1.0`.
   Verify the resolved command/version again. An isolated npm prefix and explicit
   launcher path allow side-by-side evaluation. Install any desired skill
   separately: `npx skills add abruption/session-peer-skill` (review its source
   and target before choosing where to install). The companion skill baseline
   0.3.1 (`f43a5000a2a7fe43025a41ac792ed355502620aa`) targets Python; TS guidance
   remains #25 work, so do not assume all skill commands work in TS.
3. **Make selection and output explicit.** Replace bare `list` with
   `session-peer list --agent claude --json`, or
   `session-peer list --agent codex --codex-home /absolute/home --json`.
   Use a full Codex UUID and explicit home for send. For Claude use PID when
   Unicode name matching matters. Replace positional messages with `--message`
   or UTF-8 stdin; update parsers using the JSON table above. Development source
   additionally supports unfiltered/multi-home list as described in the #16
   contract; installing published 0.1.0 does not enable it.
4. **Validate before submission.** Use `send ... --json --dry-run`. Review the
   target/home, then remove `--dry-run` only for an intended submission. Check
   posted/queued separately from receiver ACK; do not retry unknown outcomes.
   Do not test migration against unrelated live sessions.
5. **Migrate each SSH endpoint deliberately.** Install the exact same TS version
   remotely; Python's same-named CLI does not pass TS preflight. Set an absolute
   `--remote-bin` where PATH is ambiguous; for Windows add
   `--remote-platform win32` and the `.cmd` path. Retain existing SSH host trust
   and authentication; a control socket is not new authorization. Account for
   the size limits above and lack of multi-host aggregation.
6. **Keep unsupported workflows on an explicit Python path.** Updates,
   MCP, wake, Antigravity and paired devices need their existing implementation
   until their issues are delivered. Doctor is available in development source;
   public npm 0.1.0 still requires Python for diagnostics. Updating npm does not update Python, skills,
   external Relay infrastructure or a remote host automatically. To return to
   Python, select its recorded path or uninstall only the npm-owned installation.

## Evidence and ongoing maintenance

| Evidence class | What it establishes | What it does not establish |
| --- | --- | --- |
| Baseline source review above | Implemented branches, flags, bounds and optional fields at pinned SHAs | Behavior of a different release or a live destination |
| POSIX CI fixtures | Read-only SQLite/reference discovery, real local fixture locks/sockets, CLI/SSH failure contracts, packaging on Node 22/24 | Live model consumption or all OS/architecture combinations |
| Windows CI native fixtures | x64 Node 22/24: real kernel locks, Restart Manager PID/SID/start evidence, ownership/revalidation races, queue fixture, actual PowerShell/.cmd with fake SSH endpoint, installed native binary/package checks | Real network SSH authentication, real Codex queue acceptance, Windows arm64, receiver ACK |
| Dedicated live observations | Only the recorded target/runtime/OS/arch and observed submission/ACK in [VALIDATION.md](VALIDATION.md#real-tui-and-ssh-checks) | General qualification of all builds/agents; fixture pass is never ACK |
| Public registry checks | Exact package hashes, provenance/signature metadata and isolated installation for the recorded release | Live-agent delivery or consumption |

The implemented rows map to these repeatable checks:

- [conformance.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/conformance.test.ts): Claude/Codex discovery against the pinned Python oracle, unsupported schema/row/command refusal, empty-PATH runtime.
- [transport.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/transport.test.ts): real POSIX inbox, guarded queue, wrong/competing writer, unknown native outcome, inert Reply-To, host boundaries, SSH preflight/framing/loss.
- [windows.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/windows.test.ts) and [windows-contract.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/windows-contract.test.ts): the bounded Windows native contracts described above.
- [input-boundaries.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/input-boundaries.test.ts): exact 1,000,000-code-point / 32,768-byte message bounds, envelope overhead, 4,100,000-byte escaped JSON wire bound and invalid UTF-8 refusal. Python SSH limits are source-inspected here; these TS tests do not exercise the Python transport.
- [types.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/types.test.ts), [package-smoke.ts](https://github.com/abruption/session-peer-ts/blob/main/test/package-smoke.ts), [release.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/release.test.ts): pure typed helpers, package/native loading, artifact and publication gates. They do not test future update/provisioning implementations.

Windows expansion belongs to [#34](https://github.com/abruption/session-peer-ts/issues/34);
this matrix belongs to [#33](https://github.com/abruption/session-peer-ts/issues/33).
Each feature PR must update its rows, sources, evidence date and affected README
languages. Changes to JSON, env, defaults, runtime/remote requirements or packaging
must include the corresponding acceptance tests. Keep planned features distinct
from supported behavior and deliberate exclusions; milestone assignment is not
a release commitment. Recheck the exact packaged copy during release review.


## Source Codex home selection — #17 / 0.2.0

This is development source behavior, not a claim about the immutable npm 0.1.0
archive. `send --to codex:UUID` selects only a unique stable live writer across
bounded known homes. `--codex-home` pins the destination but still inventories
competitors. A unique live writer without a saved row yields
`thread_not_yet_persisted`; an unknown owner or multiple live writers refuses.
An unsaved live competitor is checked too. Listing does not authorize sending.

`--allow-inactive-codex-home` requires an explicit home (including a home in a
Reply-To URI), a saved thread there, and all candidates verified inactive.
Ordinary inactive sends retain `error: inactive_writer` with resolution reason
`inactive_queue_requires_opt_in`. No wake, resume, native DB write, wait or ACK
is added. Dry-run validates once and submits zero messages. Actual submission
re-enumerates and compares all candidates, saved-row presence, DB file identity,
lock-file identity and live owner evidence immediately before one native queue
call. Evidence changes refuse; changes after the final check remain an OS/native
queue race, not an exactly-once guarantee. Post-spawn failures remain unknown,
`submitted: null`, `retryAllowed: false`; a queue ID is not an ACK.

| Home/configuration | Source send behavior |
| --- | --- |
| Unset `SESSION_PEER_CODEX_HOMES`, or `[]` | No extra candidates |
| Empty/whitespace, malformed JSON, relative/non-string/NUL array entry | Reject entire configuration, even with explicit destination |
| Absolute or `~/` array entries | Canonicalized, deduplicated, required homes |
| Explicit argument, nonempty `CODEX_HOME`, configured home missing DB | `home_inventory_unreadable`; candidate `state_db_missing` |
| Optional default/Orca home missing DB | Allowed as absent, but requested UUID lock still checked |
| Unreadable DB, unresolved path, unknown writer | Refuse; never skip a competitor using partial results |

Migration from 0.1.0: unset an empty `SESSION_PEER_CODEX_HOMES` or set it to `[]`;
remove stale `CODEX_HOME` instead of relying on its missing DB being ignored.
These guards are stricter than Python 1.0.2's selected-missing-DB exemption and
saved-match writer inspection: this source checks even unsaved competitors.

`codexHomeResolution` has `schemaVersion: 1`, `status` (`selected`, `explicit`,
`ambiguous`, `unknown`), canonical `selected` or null, fixed `reason`, and
`candidates`. Each candidate has `codexHome`, `sources`, `savedThread`
(boolean/null), `writerLock` (`not_checked`, `held`, `free`, `absent`, `unknown`),
optional `activity`, and fixed `reason`. Uninspected candidates remain explicit.
No raw subprocess stdout/stderr, PID start fingerprint, UID or command is exported.
Errors before home resolution (invalid options/message or missing executable)
need not include this field. SSH resolves on the destination and preserves these
fields on verified responses; response loss cannot supply trusted diagnostics.

`queueId` is included only when successful native stdout contains exactly one
line `Queued message ID for thread UUID.` for the requested UUID. ID must be
1–128 ASCII alphanumeric/`.`/`_`/`:`/`-` characters, starting alphanumeric.
Missing, malformed or multiple confirmations omit the field without retrying or
changing successful queue status. Failed native processes never expose an ID.

Contracts: `test/codex-homes.test.ts`, `test/transport.test.ts` and
`test/windows-contract.test.ts`. These are fixtures, not real recipient ACKs.

## Source read-only doctor — #18 / 0.2.0

Evidence date: 2026-09-28. `doctor --json [--agent claude|codex]` supports local
inspection and the existing version-checked SSH/stdin JSON transport. Published
npm 0.1.0 does not contain this command. Both SSH endpoints must use the same
source build; the unchanged development version string alone is insufficient.

`ok:true`, exit 0 and `diagnosticCompleted:true` mean the diagnostic command
completed, including when agents are unavailable. `ready` is a metadata
precondition summary for the selected agents, **not authorization to send**.
Per-agent results remain in `agents`; per-home Codex results retain source labels,
required/optional status and missing, permission, unsupported-schema or unknown
codes. Explicit doctor home inspection bypasses unrelated inventory, like list;
it does not replace send's stricter competitor checks. Codex executable paths
are inspected for accessibility and never executed, even with `--codex-bin`.
An accessible DB and executable do not verify a live writer (`writerVerified:false`).

Claude checks bounded numeric session records (regular files, maximum 64 KiB),
process identity and inbox metadata. POSIX checks the socket file; Windows checks
process identity and a named-pipe advertisement, **not pipe existence or availability
for connection**. `verification` states this distinction. Invalid records and
unknown/permission inspections are counted. There is no inbox connection, queue
submission, lock acquisition, chmod, configuration mutation, wake, login, or
credential read. Native process arguments, stderr and session names/bodies are
not emitted. Host/home and executable paths are intentionally reported.

`capabilities` describes implementation support: `list/send/doctor:true`,
`wake/wait/ack/consumptionConfirmation:false`, `agents:[claude,codex]`,
`transports:[local,ssh]`; `implementation:typescript` distinguishes runtime identity.
These are implementation capabilities, not evidence of agent readiness or ACK.

`skills` inspects only `~/.agents/skills/session-peer-ts/SKILL.md` and
`<explicit home, CODEX_HOME, or ~/.codex>/skills/session-peer-ts/SKILL.md`.
No skill installation or reference traversal occurs. The #25 TS skill contract
requires metadata version/min/full `0.1.0`, implementation `typescript`, and
capability policy `probe-help`; missing/malformed/incompatible metadata is
reported separately and does not change agent readiness. This conservative
metadata check does not certify instruction content. Generic Python
`session-peer` skills are not inferred compatible. No `--check-reply-to` probe
or general reply-observation API is implemented.

Acceptance evidence: `test/diagnostics.test.ts` ports Python diagnostic cases for
missing homes/tools, unsupported schema, per-home results, permission/unknown
boundaries, invalid/stale session records, read-only inspection and unavailable
inbox; adds source capabilities, bounded skill metadata, stdio and POSIX SSH
fixtures. `test/windows-contract.test.ts` checks doctor through real encoded
PowerShell/.cmd fixture SSH, without queue dispatch. Fixture evidence is not a
live-agent or delivery/consumption test.
