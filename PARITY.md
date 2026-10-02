# Python compatibility and npm migration

Updated 2026-10-02 KST. Python reference: **1.0.2**,
[`47c2371`](https://github.com/abruption/session-peer/tree/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core).
This matrix describes **TS 0.2.1**: the 0.2.0 unified listing, safe home selection,
read-only doctor, text/help/positional input, Unicode 14.0.0 name matching and
separately managed TS skill guidance (#16/#17/#18/#19/#25), plus the
[0.2.1 reliability and hardening](#021-reliability-and-hardening) changes. Historical **0.1.0**
differences are called out explicitly. Public availability and tags must be
checked in the registry; this document does not assert a publication outcome.
SSH endpoints require the same version; unreleased source builds also require
the same commit. `referenceVersion: "1.0.2"` identifies the comparison baseline,
not complete parity. See [VALIDATION.md](VALIDATION.md) for dated evidence.

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
| CLI input, help and names | Human text or JSON; positional or named/stdin message; Unicode casefold matching | 0.2.0: explicit JSON/text format, positional/named/stdin body, command help, exact Unicode 14.0.0 casefold with PID for ambiguity | Implemented; [#19](https://github.com/abruption/session-peer-ts/issues/19), 0.2.0. Published 0.1.0 help still says “preview”; source help now describes unified list |
| From / Reply-To | Caller detection, automatic return-route metadata, structured URI resolution | From uses Codex environment UUID only; explicit `--reply-address`; local/SSH Reply-To URI parsing with conflict checks | Partial; [#21](https://github.com/abruption/session-peer-ts/issues/21), 0.3.0 |
| SSH | Python source streamed to POSIX remote Python; multiple hosts/options/host metadata | Same-version installed TS CLI required; one host; strict preflight; JSON stdin; explicit Windows PowerShell path | Partial; [#20](https://github.com/abruption/session-peer-ts/issues/20) hosts/options, [#23](https://github.com/abruption/session-peer-ts/issues/23) deployment/version design, 0.3.0 |
| Updates | Cached advisory client/skill notices (on by default); GitHub release check; standalone self-update and remote push; package-manager guidance | Source: `update --check` reads npm dist-tags (`latest`/`preview`) with installation-manager guidance; no self-update or remote update; cached client notices are opt-in (`SESSION_PEER_UPDATE_NOTICE=1`), honor `--no-update-notice`/`SESSION_PEER_NO_UPDATE_NOTICE`; no skill notices. Published 0.2.1 only accepts `--no-update-notice` as a no-op | Partial in source for [#22](https://github.com/abruption/session-peer-ts/issues/22), 0.3.0; [update boundaries](#source-update-checks--22) |
| Reusable execution API | Agent/transport capability adapters | Package root exposes pure protocol helpers only; no general typed execution API | Planned [#24](https://github.com/abruption/session-peer-ts/issues/24), Future — Agent integrations |
| Skill guidance/setup | Companion `session-peer` skill targets Python | Separate `session-peer-ts` companion PR and exact-commit setup; baseline/version/help gates | Source [#25](https://github.com/abruption/session-peer-ts/issues/25), 0.2.0; no tag/publish |
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
| `CODEX_HOME`, default `~/.codex`, macOS Orca account homes | Source: bounded automatic Codex listing and writer safety inventory. Codex send selects a unique stable live home, or validates the explicit home against all competitors. Published 0.1.0 requires it for Codex list too. No recursive disk scan. |
| `SESSION_PEER_CODEX_HOMES` | Source: JSON array of absolute or `~/` paths adds required listing homes and writer candidates. Invalid list configuration is rejected as a whole with other sources preserved; send keeps fail-closed inventory. Published 0.1.0 uses it only for writer checks. |
| `CODEX_THREAD_ID`, `CODEX_SESSION_ID` | Valid UUID enables default From metadata; `--no-from` disables it. Claude/Antigravity caller detection is not implemented. |
| `SESSION_PEER_UPDATE_NOTICE`, `SESSION_PEER_NO_UPDATE_NOTICE`, `SESSION_PEER_CACHE_DIR`, `SESSION_PEER_UPDATE_REGISTRY` | Source #22: opt-in cached notices, opt-out (wins), absolute cache directory override, and npm registry mirror for update checks (HTTPS, or loopback HTTP; no credentials). Python's `XDG_CACHE_HOME` `update.json` is not read; TS uses its own `npm-update.json`. |
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
| `clientUpdate`, `skillUpdates` | Optional advisory notice metadata | Source #22: `clientUpdate` only on the invoking client's completed `list`/`send`/`doctor` JSON results (including a verified SSH result, added locally) when notices are opted in and a fresh npm cache shows a newer stable version; never produced by a `--stdio-request` receiver or on caught failures. `skillUpdates` absent |

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
2. **Install the chosen version explicitly after checking registry availability.** For 0.2.0:
   `npm install --global --ignore-scripts session-peer@0.2.0`.
   Verify the resolved command/version again. An isolated npm prefix and explicit
   launcher path allow side-by-side evaluation. Install any desired skill
   separately using the exact reviewed commit, explicit agent and scope in the
   [README](README.md#agent-skill-explicit-installation). The original companion
   `session-peer` skill targets Python; use distinct `session-peer-ts` guidance.
   Check implementation and supported help; 0.1.0 development builds historically shared their version string with the public baseline.
3. **Make selection and output explicit.** Replace bare `list` with
   `session-peer list --agent claude --json`, or
   `session-peer list --agent codex --codex-home /absolute/home --json`.
   Use a full Codex UUID; preserve the discovered home when selecting a row.
   Unicode names use exact Unicode 14.0.0 casefold; use PID for collisions.
   Supply one positional body, `--message`, or UTF-8 stdin. Keep `--json` for
   machine consumers. 0.2.0 also supports combined listing and text output.
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
6. **Keep unsupported workflows on an explicit Python path.** Remote updates,
   MCP, wake, Antigravity and paired devices need their existing implementation
   until their issues are delivered. Doctor is available in 0.2.0; 0.1.0 lacked this command. Updating npm does not update Python, skills,
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
- [types.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/types.test.ts), [package-smoke.ts](https://github.com/abruption/session-peer-ts/blob/main/test/package-smoke.ts), [release.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/release.test.ts): pure typed helpers, package/native loading, artifact and publication gates. package-smoke also checks installed-path update guidance without network or file changes.
- [updates.test.ts](https://github.com/abruption/session-peer-ts/blob/main/test/updates.test.ts): #22 update checks and notices against a local fixture registry (see below).

Windows expansion belongs to [#34](https://github.com/abruption/session-peer-ts/issues/34);
this matrix belongs to [#33](https://github.com/abruption/session-peer-ts/issues/33).
Each feature PR must update its rows, sources, evidence date and affected README
languages. Changes to JSON, env, defaults, runtime/remote requirements or packaging
must include the corresponding acceptance tests. Keep planned features distinct
from supported behavior and deliberate exclusions; milestone assignment is not
a release commitment. Recheck the exact packaged copy during release review.


## Source Codex home selection — #17 / 0.2.0

This is 0.2.0 behavior; it does not change the immutable npm 0.1.0 archive. `send --to codex:UUID` selects only a unique stable live writer across
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
0.2.0 build; development checkouts should also match commits.

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

## Source CLI usability — issue #19 (2026-09-28)

Version 0.2.0 adds full list/send/doctor help, text rendering and one positional
message. The matrix distinguishes this from historical 0.1.0. The explicit
output requirement is retained: `--json` or `--output-format json|text`; no default
format changes. No selector retains `json_output_required` for compatibility.
Conflicting selectors and all parse errors produce one JSON refusal before stdin
reads/discovery/send. Valid text requests render execution errors as text. Remote
wire requests require JSON even when the caller selects local text output.
Partial discovery preserves rows, diagnostics and nonzero exit status. Terminal
control characters in text labels are escaped; JSON is unchanged.

One positional body, named body or stdin is accepted; combining sources refuses
before reading stdin. `--` terminates option parsing. Empty or whitespace input
is rejected before envelope construction. Existing input/transport budgets and
unknown outcome/no retry boundaries remain.

Claude exact name matching uses Unicode **14.0.0** `CaseFolding.txt` C/F mappings
(default non-Turkic full casefold), pinned independently of Node ICU and Python's
runtime Unicode version. No normalization or fuzzy comparison occurs. ß/ss,
Greek sigma and ligature collisions require PID selection. Unicode data source
and SHA-256 are recorded in `src/casefold.ts`; regenerate offline with
`node scripts/generate-casefold.mjs /path/to/CaseFolding.txt` (hash enforced). The package includes
`UNICODE-LICENSE.txt`. Python builds with newer Unicode databases can differ for
characters added after 14.0.0; this is not a blanket future-Unicode parity claim.
`test/cli-usability.test.ts` covers format/help/input/error boundaries, real local
name/PID selection with collisions, and text escaping on all CI platforms.

## Source TS skill guidance — #25 / 0.2.0

Evidence date: 2026-09-28. TS CLI baseline for this work is `8289da7`; companion
candidate is [`081cc3c1d16a394bd92824333f4bc61c36951799`](https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts).
This is separately reviewed source, not a skill tag or npm release. Published
npm 0.1.0 remains unchanged. There is no runtime setup subcommand: user-invoked
Skills CLI 1.7.0 is the reviewed setup path, with an exact commit, explicit agent,
and explicit project/user scope chosen before running the documented command.

- Ownership: resolve the PATH launcher, require `session-peer X.Y.Z (typescript)`,
  then capture that launcher's help. Python's `referenceVersion` is not a feature
  guarantee. Baseline examples retain explicit agent, Codex home and JSON flags.
- Development capabilities: `doctor`, implicit home selection and inactive opt-in
  require affirmative help support. When top-level help advertises per-command
  help, inspect `send --help` for send flags and `doctor --help` for the supported
  doctor command. Mere mention in an unsupported list does not enable a feature.
  Skill minimum/full runtime metadata mean baseline
  support, not support for every conditional option. No assumption of wake,
  Antigravity, Relay, MCP or general wait support is imported from Python.
- Workflow: fresh list → preserve exact home/PID → dry-run → one authorized send.
  Reply URIs remain data, `queued` is not ACK, and `unknown` never permits retry.
- Metadata contract: separate `session-peer-ts/SKILL.md`, skill version `0.1.0`,
  `runtime-implementation: "typescript"`, `runtime-min-version: "0.1.0"`,
  `runtime-full-version: "0.1.0"`, `runtime-capability-policy: "probe-help"`.
  Missing or incompatible skills can be diagnosed independently of transport
  readiness; the runtime never executes instructions merely to inspect metadata.
- Lifecycle: no npm hooks, downloads, automatic update or overwrite of the Python
  skill. Pinned update repeats `add` for another reviewed commit after inspecting
  local edits. `skills update` follows a moving source and is not this workflow.
- Acceptance evidence: `test/diagnostics.test.ts` already tests the exact
  companion metadata contract as compatible without executing or exposing the
  skill body; compatibility does not authorize sending.
  `test/skill-guidance.test.ts` exercises baseline JSON list,
  selected-home dry-run refusal and gated explicit inactive dry-run in disposable
  SQLite homes; no submission occurs. Companion `scripts/test-ts-skill.mjs`
  exercises real Skills CLI project/global install, replacement-update, list and
  removal for Codex/Claude Code while preserving a Python skill fixture. Those
  are installation/contract fixtures, not live-agent delivery or ACK evidence.

## 0.2.1 reliability and hardening

0.2.1 (#49–#57, #59, #64, #65) tightens existing 0.2.0 behavior and adds no new
command, transport or JSON field. Callers may notice the stricter refusals below.

| Area | Source behavior |
| --- | --- |
| Codex body argv (#49) | Native queue receives `--message=<text>` as one argument, so bodies such as `- item`, `--help` or `-x` are queued as text. The SSH request forwards the body the same way. |
| Codex SQLite location (#50) | An inherited `CODEX_SQLITE_HOME` is removed from the native queue environment. A home whose `config.toml` sets `sqlite_home` is refused as `unsupported_codex_sqlite_home` (unreadable config: `codex_config_unreadable`) in dry-run and send, and `doctor` reports it as unsupported, because validation reads `<home>/state_5.sqlite`. A live writer started with its own `CODEX_SQLITE_HOME` cannot be observed. |
| Option values (#51) | A separate value that is exactly an option name (for example `--message --dry-run`) is `invalid_option` (exit 2), as in Python argparse. Use `--message=<text>`, stdin or `-- <text>` for such text. |
| SSH exit code (#52) | A verified remote response keeps its 0/1/2 exit code locally. |
| Reply-To `codexHome` (#53) | Must be a POSIX or Windows absolute path, matching Python; relative and `~` paths are `invalid_reply_uri`. |
| Text output (#54) | Also escapes U+061C, U+200B–U+200F, U+202A–U+202E, U+2060–U+2069 and U+FEFF. JSON is unchanged. |
| SSH preflight (#55) | Exit 0 with the exact version line passes even when login scripts write to stderr; stderr classification applies only to failed preflights. |
| Windows `--remote-bin` (#56) | Every PowerShell single-quote variant (`'`, U+2018–U+201B) is doubled inside the encoded command. |
| Windows batch shims (#57) | A `.cmd`/`.bat` executable found first on `PATH` (or given explicitly) is reported as `executable_unsupported` by `send` and `doctor`, because Node cannot spawn them without a shell and a shell would interpret the message. Use the native `codex.exe`. |
| Envelope trimming (#59, #64) | Leading/trailing `\n` is trimmed by index scanning instead of `/^\n+\|\n+$/`, which was quadratic on long interior newline runs (CodeQL `js/polynomial-redos`). Trimming semantics are unchanged. |
| Windows owner inspection (#65) | The compiling `Add-Type` owner inspection waits up to 20000 ms; the compile-free creation-time probe keeps 8000 ms. Timeouts still refuse. |

## Source update checks — #22

Evidence date: 2026-10-02. Source only; published npm 0.2.1 has no `update`
command. `session-peer update --check --json [--channel latest|preview]` makes one
GET to `<registry>/-/package/session-peer/dist-tags` (default
`https://registry.npmjs.org/`, 3-second timeout covering the body, 64 KiB body
limit, redirects refused, no retries). `latest` must be a stable npm semver;
`preview` may be a prerelease. Versions follow SemVer 2.0 precedence without a
`v` prefix or build metadata. Python 1.0.2's GitHub tags are a different stream
and are never compared; `referenceVersion` is unrelated to this check.

| Field | Meaning |
| --- | --- |
| `current`, `latest`, `channel`, `distTag` | Running TS version, the dist-tag's version, and the tag name |
| `source` | `npm_registry` |
| `status`, `outdated` | `update_available` (`outdated:true`), `up_to_date` or `ahead` |
| `updated` | Always `false`; nothing is installed |
| `managedBy`, `updateCommand`, `guidance` | Owner from the resolved CLI path, positively identified only: `npm` (global prefix whose `bin/session-peer` symlink or `session-peer.cmd` launcher targets this package: default, Homebrew, nvm, nvm-windows, fnm), `pnpm`/`yarn`/`bun` (global store whose `package.json` declares `session-peer`), `volta`, `npx`. Command only for those owners and only when outdated. `npm_project`/`pnpm_project` (project `package.json` declares the dependency), `source` (checkout) and `unknown` (anything else, such as an unconfirmed nvm-windows prefix) always get `null` plus a `guidance` sentence |
| `skills`, `skillsManagedBy` | Same local TS skill metadata check as `doctor`; `separate` |

Failures use the standard caught-failure envelope with `registry_timeout`,
`registry_unreachable`, `registry_http_error`, `registry_response_invalid`,
`dist_tag_missing` (exit 1), or `invalid_update_registry`,
`unsupported_update_channel` (exit 2). Response bodies are never emitted.
`update` without `--check` is `self_update_unsupported` (exit 2) with `updated:false`,
`managedBy`, `updateCommand` (dist-tag spec, same owner rules), `guidance` and `checkCommand`; it makes no
request. `--host`, other list/send options and `--stdio-request` (error
`remote_update_unsupported`) are refused, so a remote destination never performs
update checks. `doctor` capabilities add `updateCheck:true`, `selfUpdate:false`.

Notices are deliberately **opt-in** (Python's are on by default): agents and
scripts call this CLI frequently, and an unrequested registry call or extra
stderr line would change its no-network default. With
`SESSION_PEER_UPDATE_NOTICE=1` (`1/true/yes/on`), completed local
`list`/`send`/`doctor` results read only the local cache. A fresh (24 h) cache
whose stable `latest` is newer adds `clientUpdate` (`schemaVersion`, `status`,
`current`, `latest`, `channel`, `checkedAt`, `source: "npm_registry_cache"`,
`managedBy`, `command`) to JSON, or one stderr line for text; stdout text is
unchanged. A missing, invalid, future-dated or expired cache spawns one detached
refresh and returns immediately. A failed refresh stores `latest:null`, which
suppresses attempts for 1 hour. Opt-out (`--no-update-notice`,
`SESSION_PEER_NO_UPDATE_NOTICE`) suppresses these background notices and
refreshes and wins over opt-in. An explicit `update --check` is an intended
request: it always contacts the registry and, on `latest`, refreshes the cache.
Cache and network failures never change results or exit codes.

Scope: notices belong to the invoking client. With `--host`, the client adds
`clientUpdate` (or its stderr line) to its own top-level output, including the
verified result obtained over SSH; the `--stdio-request` receiver never reads,
refreshes or produces a notice. The notice is computed once per invocation.
Multi-host execution (#20/#84) is not part of this change: after #84 merges,
#22 must be rebased with an integration test for the array shape, exactly one
refresh per invocation and no wire notices.

Single flight: the refresh lock `npm-update.lock` is created with `O_EXCL` and
holds a random per-acquisition token, which the detached child inherits. Only
that token's holder releases it, and only after re-reading the token; a refresh
without a matching token never touches another generation's lock. A lock older
than 60 s is taken over by renaming a new token file atomically over the exact
stale generation that was observed, so the lock path is never missing and two
takers cannot both win. Release and takeover run under a short `O_EXCL`
`npm-update.lock.takeover` mutex; if it is busy, release leaves the lock to
expire. Residual risk: a mutex older than 60 s is treated as crashed and
removed, which could race only with a holder stalled that long between two file
operations.

Cache: `npm-update.json` (0600, atomic temp-file rename) in a 0700 directory
owned by the user: `SESSION_PEER_CACHE_DIR` (absolute), else
`$XDG_CACHE_HOME/session-peer` on macOS/Linux, `~/Library/Caches/session-peer`,
`~/.cache/session-peer`, or `%LOCALAPPDATA%\session-peer\Cache`. It holds only
package name, channel, version and timestamp. Windows relies on the per-user
profile ACL instead of POSIX modes. No checks or notices modify npm-owned files,
Python installations, remote hosts or skills.

Acceptance evidence: `test/updates.test.ts` (POSIX and Windows CI) covers SemVer
ordering, stable/prerelease tags, invalid/oversized/HTTP/redirect/timeout/offline
registry responses without body leakage, manager guidance per install layout,
including nvm, nvm-windows, fnm, Volta and ambiguous prefixes (`unknown`, no command),
cache paths and modes, opt-in default off, flag/env opt-out, JSON additivity,
text stderr, offline/invalid/expired/future caches, concurrent single-flight
refresh, token-owned lock release (a foreign generation is never deleted, also
by a refresh with an invalid registry), multi-process stale takeover with
exactly one owner, failure backoff, Python cache isolation, TS skill metadata,
wire isolation, and a POSIX fake-SSH `list --host` where only the client adds
the notice. `test/package-smoke.ts` checks the installed
package's guidance and unchanged files. All use a local fixture registry; no
test contacts npm.
