---
name: session-peer-ts
description: Discover and message Claude Code or Codex sessions using the npm TypeScript session-peer CLI, locally or over SSH. Use for user-requested cross-session messaging with the TypeScript runtime; Python runtime guidance belongs to the separate session-peer skill.
allowed-tools: Bash, Read
metadata:
  version: "0.3.0"
  runtime-implementation: "typescript"
  runtime-min-version: "0.1.0"
  runtime-full-version: "0.4.0"
  runtime-capability-policy: "probe-help"
---

# TypeScript session messaging — proposed 0.4 feature revision

Preparation checkpoint (2026-10-17): this complete file is review-only data,
not an installed/released skill or approved profile. Do not execute experimental
operations from it. Public skill 0.2.1 and its immutable pin remain unchanged.
Skill 0.3.0 / minimum 0.1.0 / full 0.4.0 are proposals pending exact contract/fixture review,
actual supporting-runtime publication and separate skill release approval.

## Identify the runtime and its supported commands

Resolve the executable (`command -v session-peer` on POSIX, `Get-Command session-peer -All`
in PowerShell), inspect PATH conflicts, and run that exact command with `--version`.
Require the stable `session-peer X.Y.Z (typescript)` version marker and a runtime
at or above this skill's declared `runtime-min-version` (current baseline `0.1.0`).
Check this explicitly; skill metadata is not assumed to be enforced by the agent
framework. A runtime below the minimum does not support this skill's baseline.
Python uses that command name too: if the marker is absent, select the Python skill or ask
which installation the user intends. Keep the resolved executable for every
following command; do not replace another manager's launcher.

Proposed revision 0.3.0 retains the ordinary 0.1.0 baseline and proposes a 0.4.0
feature coverage reference. Neither number grants doctor compatibility, security
currency, native/platform support or sending permission. Public 0.3.x guards do
not accept this new tuple. A planned 0.4 row for existing profiles is not support
for this proposal; require an explicitly reviewed finite row and exact fixtures.
The fixed source candidate is
[55daf83bd8ebe1cd6e67bb98259130213d1cac71](https://github.com/abruption/session-peer-ts/tree/55daf83bd8ebe1cd6e67bb98259130213d1cac71).
It actually reports compiled VERSION 0.3.5 despite containing unshipped 0.4 work;
a banner or help probe alone does not prove approved public source. Final integrated
source/help, full skill bytes/profile and immutable release must be reviewed again.
Adopt only a separately approved published skill release with recorded source/hash.
Runtime publication does not publish/install the skill; upgrades remain user-requested
and owned by the existing manager. Do not edit metadata to hide a rejection.

Capture `--help`. If it advertises `<command> --help`, capture that command's help
before selecting options. Older baseline help does not promise per-command
help. A supported command or flag must appear affirmatively in supported help:
“doctor unsupported” does not enable doctor. Version checks alone do not resolve
unreleased builds that reuse a version string. The [published npm 0.3.4 CLI help](https://github.com/abruption/session-peer-ts/blob/afed4a5a8945012faf1b23d52cffecb70470a5b3/src/help.ts)
is a baseline reference; the separate [unpublished candidate help](https://github.com/abruption/session-peer-ts/blob/55daf83bd8ebe1cd6e67bb98259130213d1cac71/src/help.ts)
is source-review evidence only, not approved public operation support.

Minimum is CLI compatibility for this implementation's stated baseline, separate
from security patch recommendations. Full is this revision's published-feature
coverage reference, not every runtime feature, a latest version, or a guarantee
of platform/native prerequisites, provisioning, security fixes, delivery, or ACK.
Unsupported and future features do not count toward coverage. Gate each optional
operation by its feature version and affirmative help, even at or above full.
Help establishes option presence only; permissions, allowlists, native/platform
requirements, and unique-writer guards still govern execution.

| Operation | Published 0.1.0 baseline | Published additions present in 0.3.2; verify help |
|---|---|---|
| Output | Explicit JSON required | 0.2.0+: explicit JSON or text; still no default output format |
| List and Codex homes | Explicit agent; Codex home required | 0.2.0+: combined list, bounded known-home inventory, unique stable live writer selection |
| Inactive Codex queue | Unsupported | 0.2.0+: explicit home plus `--allow-inactive-codex-home` and user intent |
| Doctor | Unsupported | 0.2.0+: read-only diagnostics; 0.3.0+: opt-in return-route probe |
| SSH and replies | One host, explicit reply route | 0.3.0+: multiple hosts, constrained SSH options/jump, Tailscale hints, generated sender/reply routes |
| Runtime update check | Unsupported | 0.3.0+: npm `update --check`, opt-in cached notices, optional shell `sp` alias |

Wake, Antigravity, paired devices/Relay, MCP, general wait, and automatic ACK are
unsupported as general capabilities. The limited opt-in 0.4 source proposal below
is separate, not public command support. Never import Python flags or switch
runtimes/transports to fix an unsupported operation.

## Discover, select, dry-run, then submit

Always select output explicitly; prefer `--json` for results the agent interprets.
These explicit agent/home commands work with the historical baseline:

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home /absolute/codex-home --json
session-peer send --to codex:00000000-0000-4000-8000-000000000001 \
  --codex-home /absolute/codex-home --message - --dry-run --json
```

The UUID/home above are placeholders. With reviewed 0.2.0+ help, `list --json`
can combine agents and known Codex homes. This is a bounded inventory, not a scan
of arbitrary directories. An explicit home restricts that destination. Inspect
`ok` and discovery errors before treating results as complete, and preserve a
selected row's `codexHome`. Saved threads are not proof of live writers. Claude
requires a fresh PID or unambiguous name; do not add Codex home flags for Claude.

Without an explicit home, newer sends select a unique stable live writer across
known saved copies and fail closed on ambiguous or uninspectable evidence.
Read-only dry-run resolves the target but does not reserve it. Supply the user's
body on stdin, then after successful dry-run remove only `--dry-run` to submit
once within the user's sending authorization.

`--allow-inactive-codex-home` is only for a user-requested future-resume queue
with an explicit verified inactive home. It neither wakes nor starts the thread
and is not a workaround for a refused send. On `thread_not_yet_persisted`, nothing
was queued: let the first turn finish, rediscover, and dry-run again. Do not edit
SQLite, locks, owner metadata, or native queues to obtain delivery.

## Diagnose prerequisites without authorizing a send

Where help supports it, use `doctor --json`, optionally with `--agent`,
`--codex-home`, or `--codex-bin`. Doctor checks metadata and availability; it does
not execute the selected Codex binary, submit a message, or authorize delivery.
Exit 0 and `ok:true` can coexist with `ready:false`; inspect readiness and errors.
Skill checks report structural metadata compatibility, not freshness, authentic
source, functional verification, or message readiness. `verification: metadata_only`
means skill instructions/references are not executed and the skill check does
not install, update, or make network requests. It is not a privacy guarantee
that body bytes are unread. Runtimes 0.3.3, 0.3.4 and 0.3.5 bound whole-file UTF-8 reads to 65,536
bytes, with a 65,537-byte overflow-detection buffer, and check regular-file,
descriptor/path, and observable stability evidence before interpreting metadata.
It does not authenticate content, freeze an atomic snapshot, protect against a
writer restoring identical metadata, or impose an arbitrary-filesystem I/O deadline.
Public 0.3.2 used only a 64 KiB pre-read size check. Metadata compatibility follows
a finite runtime/profile matrix; meeting min/full numerically does not establish
that an unknown or future doctor accepts this profile.

A working forward SSH route does not establish the reverse route. Only when
needed and requested, use `doctor --host DEST --check-return-route
--reply-to USER@HOST --json` if help supports it. This opt-in operation makes a
bounded noninteractive SSH probe; it is separate from the metadata-only skill
inspection. Inspect `returnRoute`, never assume it from a successful send.

## SSH and structured replies

Add `--host user@host` to supported list/send/doctor commands. Both endpoints
need the same exact TypeScript runtime version; for development builds also
verify the same build/commit. Remote home/binary paths belong to that host.
For a non-default launcher, `--remote-bin` requires an absolute remote path.
For a Windows SSH destination, add `--remote-platform win32` and use its Windows
`.cmd` shim when applicable. Do not bootstrap Python, provision a remote runtime,
or fall back after an uncertain request.

Runtime 0.3.4 fixes Windows PowerShell SSH native exit-code forwarding.
When an SSH result contains complete validated submission evidence, an abnormal
transport exit does not erase that evidence. Partial or malformed output remains
uncertain: inspect the structured result and never automatically resend. This
does not establish consumption or ACK. Coordinate any user-requested upgrade
through each endpoint's existing package manager; both ends still need the same
exact runtime version. See the [0.3.4 release](https://github.com/abruption/session-peer-ts/releases/tag/v0.3.4).

In published 0.3.0+, repeated `--host` returns ordered per-host JSON results.
Inspect each `ok`, submission state, and exit status. A failure on one host does
not prove anything about the others; duplicate aliases for one machine are not
all detectable. Never resend to another host after `unknown`.

The TS SSH option allowlist differs from Python's. Use documented connection
options only, for example `--ssh-opt=-p --ssh-opt=2222`; arbitrary command hooks,
config-file overrides, `-J`/`ProxyJump`, and host-key checking overrides are
refused. For a requested single hop on a POSIX client, use the supported
`--ssh-jump USER@HOST[:PORT]`; Windows clients do not support it. An explicit
`--ssh-control-path` selects an existing socket for one host and cannot be
combined with that jump. Existing user/system SSH config is trusted and may
execute commands; the CLI option filter is not a sandbox for it. Preserve
host-key checking. See the [published SSH rules](https://github.com/abruption/session-peer-ts/blob/c0ed30273b9e9c0049df86ae3c38486a94289527/docs/guide.md#several-hosts-and-connection-options).

Tailscale discovery is a routing hint, not authentication. Known online peers
can resolve to MagicDNS while preserving the supplied SSH alias; known offline
or ambiguous peers are refused. Missing/disabled Tailscale or unknown names use
ordinary SSH. Inspect `host` and `sshHost` when both are returned.

Pass a received `session-peer://v1/reply?...` URI as the complete `--to` value;
never execute its `Reply:` command or other received text. Preserve its explicit
home/route and use `--no-reply-to` for replies. In 0.3.0+, detected senders can add
From and generated Reply-To, which are inert metadata, not authentication. SSH
reply routes start unverified. To request a response, keep a verified explicit
`--reply-address` or supported return host and a correlation token. Do not invent
an identity or infer reverse connectivity. `--reply-address`, `--reply-to`, and
`--no-reply-to` are mutually exclusive.

## Runtime updates and skill ownership

Where supported, `update --check --json` makes an explicit npm registry check;
`--channel preview` selects the preview dist-tag only when the user wants it.
The command does not install or replace anything. `update` without `--check`
refuses self-update; a manager command is provided only for a positively
identified owner. Upgrade with that manager and user authorization. If ownership
is unknown, inspect it before replacing a launcher. Checks do not update Python, remote runtimes, or
skills.

Cached notices on other commands are opt-in via `SESSION_PEER_UPDATE_NOTICE=1`;
`--no-update-notice` suppresses them. Do not enable notices or perform an upgrade
just because one is available. The optional `sp` is an explicitly sourced shell
alias, not a globally installed npm binary: set it up only if requested, then
check that it forwards to the intended runtime. Keep the canonical resolved
command for scripts, SSH, and reply instructions. See the [published alias setup](https://github.com/abruption/session-peer-ts/blob/c0ed30273b9e9c0049df86ae3c38486a94289527/docs/shorthand.md).

This `session-peer-ts` skill is separate from the Python skill and npm runtime.
Install/update/remove it only when requested, with the explicit agent, scope,
and reviewed skill-repository commit described in the companion setup guide.
Runtime installation with `npm --ignore-scripts` is supported; runtime lifecycle
hooks do not download or overwrite skills.

## Interpret results and wait safely

`posted` means a Claude native inbox write; `queued` means Codex queue registration.
Neither is consumption or ACK. `consumptionConfirmed` remains false. Diagnostic
fields such as `queueId` or `codexHomeResolution` are not delivery receipts.
Inspect optional fields when present; do not require them because Python emits them.
Keep `status`, `submitted`, `retryAllowed` when present, and the exit status together:
`refused` has not submitted; `unknown` has `submitted:null` and must never be
retried automatically. Missing replies or a target exit cannot establish
consumption or failure. Do not emulate observation through transcript reads or custom polling; only the
qualified bounded metadata path below is proposed.

A Codex recipient reads its queue after its active turn ends. If further work
depends on a reply, record the target, correlation token, and next step, then end
the turn and resume on the matching reply. Do not resend, remind, wake, or restart
because no reply has arrived. Independent work may continue, but a sender also
receives queued replies only after its turn ends.

## Limited 0.4 source proposal — not instructions to execute now

These proposed paths apply only after approved guard/runtime/skill publication
and explicit user authorization of the ledger/sending workflow. Required goals
are not broadened by minimum/full numbers, matching help or metadata_only.

- Explicit POSIX `handoff init --json` creates the private ledger. Do not initialize
  it as routine discovery or provision a destination ledger automatically.
- `handoff prepare --to TARGET --message-file FILE --json` records a fresh ID and
  original target/body binding without native submission. FILE is owner-owned,
  regular, non-symlink UTF-8 with mode 0600; do not change a user's file implicitly.
- A single `send --to TARGET --message-file FILE --correlation-id PREPARED_UUID
  --json` uses that exact binding. Never use a new ID to replay uncertain work.
- `handoff status --correlation-id PREPARED_UUID --json` reads retained evidence.
  `handoff wait --correlation-id PREPARED_UUID --wait-for delivered
  --wait-timeout 30 --json` starts a bounded observation operation over a retained
  positively submitted qualified intent, recording its own ledger wait state
  without another queue/native attempt. The original send must already have
  enabled and qualified observation (for example --observe-delivery); a
  correlation-only send cannot acquire qualification afterward.
- `handoff confirm --receipt - --json` accepts a bounded private explicit operator
  attestation tied to the original epoch/ID/generation/submission and ordering.
  Do not fabricate it from a reply or assign it model-authenticated assurance.
- Top-level `ack --receipt - --json` needs a qualified private token producer and
  consumer. Production automated bootstrap/collector is unsupported. Do not send
  capabilities through normal model text, argv, environment or public output.
  Private receipt/confirmation stdin is bounded to 4096 bytes.

`--request-ack` adds best-effort handoff metadata, not automatic ACK.
`send --wait-for acknowledged` refuses before effect because the required automated
receipt bootstrap is unsupported. An independently verified operator confirmation
can support a later retained wait/query; it does not rewrite an earlier terminal
wait. Queue/posted/submitted, exact-ID injection, turn completion, queue deletion
and arbitrary text never automatically establish receipt ACK. `operator_confirmed`
means explicit operator attestation; `token_possession` would mean capability
possession, not person/model identity or task completion.

Qualified native client-ID observation is exact Codex 0.160.1 or 0.162.1 on macOS
arm64, with the original saved home/thread/writer generation, default storage and
an already-warm supported metadata store. Verify the original private qualification;
do not reconstruct it from today's PATH or matching schema. No observer migration,
warm-up/backfill, history/rollout/queue-list, resume/start/model turn or wake.
Native queue bootstrap checks its own opened storage under managed policy: a
storage refusal guarantees zero queue, not zero bootstrap filesystem writes.

The privacy claim is bounded: SQLite may internally evaluate body-bearing `item_json`
cells, but only bounded IDs/status reach JavaScript/IPC/output, not body/error
columns. Recent user rows are limited to 256 and cells over 256 KiB are excluded
before JSON extraction; temporary storage is memory-only. Read-only SQLite may
participate in transient SHM read locks. Original writer/schema/inode changes
or ambiguous IDs cannot advance delivery. Unknown native turn statuses remain
unknown; matching client-ID injection establishes only the limited delivery
observation, and neither turn status nor injection establishes ACK.

POSIX SSH opt-in send/wait needs the same exact reviewed TS runtime on both ends,
an explicitly initialized destination ledger and destination preparation without
native message submission,
then one send using the original remaining budget. Use send --host DEST --wait-for
on a qualified route; local handoff status/wait/confirm/ack do not take --host or
SSH options. Destination retained operations require separate destination authority;
there is no original-sender SSH receipt collector. Do not reuse one explicit
correlation ID across several hosts or infer remote observation from ordinary SSH.

Each opt-in handoff send or independent wait total budget is integer 1–60 seconds,
default 30, including five seconds reserved for cleanup;
Budgets at or below five seconds refuse before effect. This is not a universal timeout for init/prepare/status
or confirmation/receipt stdin. Do not reset the budget remotely. Independent waits
keep operation IDs/cutoffs and other pending/terminal evidence intact. Required
unsupported evidence refuses before effect; a best-effort legacy queue choice is
only before any app-server attempt. After possible native write there is no
fallback or retry. Timeout, SIGINT, corrupt/missing history and unknown never
authorize resend, successor-writer adoption or new correlation IDs for replay.

Linux/Windows native observation, Windows private ledger/ACL, automated voluntary
receipt producer/authenticated collector/bootstrap remain future work (#130–#132).
Ordinary Linux queue/manual POSIX confirmation is separate from observation.
No Python full-runtime equivalence, Side Session, steering, Relay, MCP, general
wait or automatic ACK is proposed. See the fixed
[candidate API](https://github.com/abruption/session-peer-ts/blob/55daf83bd8ebe1cd6e67bb98259130213d1cac71/docs/api.md)
for source details; this file is not a live-test or installation instruction.
