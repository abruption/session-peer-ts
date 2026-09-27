# Python compatibility and npm migration

Reviewed 2026-09-28 KST for the **0.1.1 validation/documentation milestone**.
Runtime baseline: TypeScript **0.1.0**, commit
[`0edc4f8`](https://github.com/abruption/session-peer-ts/tree/0edc4f8ae05256698f591b7402e89cd3d5858eef/src),
and Python **1.0.2**, commit
[`47c2371`](https://github.com/abruption/session-peer/tree/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core).
The milestone adds documentation and tests without adding runtime features.
This is a versioned comparison, not a promise of complete compatibility.
`referenceVersion: "1.0.2"` identifies the comparison baseline; it does not
certify equivalent behavior. See [VALIDATION.md](VALIDATION.md) for dated evidence.

## Feature and command matrix

**Implemented** means the stated bounded behavior exists. **Partial** means a
related command exists with the differences shown. **Planned** means no usable
TS equivalent yet. **Deliberately different** identifies a maintained boundary,
not a missing implementation. Issue links describe work, not available features.

| Surface | Python 1.0.2 | TypeScript 0.1.0 | Status / follow-up |
| --- | --- | --- | --- |
| Claude discovery and inbox submission | Local POSIX socket / Windows named pipe; PID or name; discovery rechecked before submission | Same transport families and recheck; Windows process start identity and authenticated pipe checks | Implemented; native fixtures are not live ACKs |
| `list` selection | Unified agent list; optional agent; bounded multiple Codex homes; partial discovery diagnostics | Requires `--agent claude` or `--agent codex`; only **Codex** list requires a single explicit `--codex-home`; Claude list rejects that option | Partial; [#16](https://github.com/abruption/session-peer-ts/issues/16), 0.2.0 |
| Codex active queue | Saved UUID, unique live writer, real lock/owner checks, pre-submit revalidation | Same protections; full UUID and explicit home required; known-home inventory still checks competing writers | Implemented active path; home selection partial, [#17](https://github.com/abruption/session-peer-ts/issues/17), 0.2.0 |
| Implicit home / inactive queue | Select unique live home; explicit inactive opt-in under separate guards | No implicit selection or inactive opt-in; refuses inactive/ambiguous state | Planned #17; can proceed alongside #16 using a shared home-source/diagnostic contract |
| `doctor` | Readiness diagnostics; return-route check is opt-in | Unsupported command | Planned [#18](https://github.com/abruption/session-peer-ts/issues/18), 0.2.0 |
| CLI input, help and names | Human text or JSON; positional or named/stdin message; Unicode casefold matching | JSON required; named `--message`/`-m` or stdin only; minimal top-level help; ASCII case-insensitive names, Unicode names require PID | Partial; [#19](https://github.com/abruption/session-peer-ts/issues/19), 0.2.0. The old help banner still says “preview”; it is not registry status |
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

| Setting / surface | Current TS behavior / migration consequence |
| --- | --- |
| `CLAUDE_CONFIG_DIR`, `ANTHROPIC_CONFIG_DIR` | Claude config precedence: first nonempty value in that order, otherwise `~/.claude`. No Codex home is required for Claude listing. |
| `CODEX_HOME`, default `~/.codex`, macOS Orca account homes | Included in bounded writer safety inventory; they do **not** substitute for explicit Codex CLI `--codex-home`. No recursive disk scan. |
| `SESSION_PEER_CODEX_HOMES` | JSON array of absolute or `~/` paths for writer inventory; malformed/unreadable inventory refuses send. It does not enable multi-home `list`. |
| `CODEX_THREAD_ID`, `CODEX_SESSION_ID` | Valid UUID enables default From metadata; `--no-from` disables it. Claude/Antigravity caller detection is not implemented. |
| Reply/update/Relay settings from Python | No blanket compatibility. Only the flags and environment reads in the TS baseline above are implemented. Do not infer a route or permission from an environment variable or From header. |
| Runtime and native dependency | TS needs Node 22.13+ within 22.x or Node 24.x, plus a matching native lock binary. Python is not a TS runtime fallback. |
| CLI ownership | Both distributions install `session-peer`; npm does not remove Python/uv/pipx/venv installations. Select one path deliberately and update it through its owning manager. |
| Skills | Install separately and explicitly; no package `postinstall` downloads a skill or invokes another package manager. |

## JSON result compatibility

Do not parse human messages or assume an optional key exists. Python's
`schemaVersion: 1` and TS's `schemaVersion: 1` are not identical field contracts.
TS normal envelopes have `schemaVersion`, `host`, `command`, `ok`, `version`,
`referenceVersion`; caught failures omit the two version fields. Exit codes are
0 (success), 1 (operation error), 2 (usage/refusal as classified by the command).

| Field / path | Python 1.0.2 | TS 0.1.0 |
| --- | --- | --- |
| `list.sessions`, `discovery` | Unified/per-agent and per-home diagnostics; partial results can remain with `ok:false` | Selected-agent results; failed Codex home returns `ok:false`, empty sessions and home diagnostics; no multi-home partial aggregation |
| `send.status`, `submitted` | Submission/wake/transport-specific details; do not assume a uniform error shape | `validated:false`, `posted:true` (Claude), `queued:true` (Codex); caught refusal is `refused:false`, unknown is `unknown:null` |
| `consumptionConfirmed` | False for native submission; queueing is not consumption | Always false on send results, including refusal/unknown |
| `target`, `chars`, `dryRun`, `codexHome` | Target and home details depend on agent; Codex target includes `id`/`name`, with separate `agent` | Success/dry-run target has `agent` plus `id` or `pid`/`name`; `chars` counts enveloped code points; `codexHome` only on Codex success/dry-run |
| `queueId` | Present if native queue stdout supplies an ID | Absent; successful queue output is not parsed for an ID |
| `codexHomeResolution` | Resolution diagnostics on Codex success and some refusals | Absent; internal writer evidence is not exported. #17 must add explicit acceptance tests for any new shape |
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
TUI separately. Future #17/#20 changes must test success, refused, partial and
unknown output, including absent/null/false distinctions.

Output sources: TS CLI/send above; Python
[commands](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/commands.py),
[Codex queue/wake](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/codex.py),
[SSH errors](https://github.com/abruption/session-peer/blob/47c23713d0a2a3c11ebde6186afd8c43489b8b65/session_peer_core/ssh.py).

## Transport, size and failure boundaries

| Boundary | Python 1.0.2 | TS 0.1.0 |
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
   or UTF-8 stdin; update parsers using the JSON table above.
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
6. **Keep unsupported workflows on an explicit Python path.** Doctor, updates,
   MCP, wake, Antigravity and paired devices need their existing implementation
   until their issues are delivered. Updating npm does not update Python, skills,
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
