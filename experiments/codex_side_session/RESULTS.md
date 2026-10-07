# TS Side Session experiment results — 2026-09-30

**Transport feasibility: PASS — one real side request and an exact side ACK.**
**General-use safety and complete #81 acceptance: NOT PASS.**

## Independent TS execution

- Repository base: `0eb5e1380ed29061da206eac835f8ad719be6694` (npm CLI 0.2.1).
- macOS arm64; Node 24.16.0; Codex CLI/server 0.159.2; experimental `ws` 8.22.0.
  The dedicated TUI selected its default GPT-6.1-Sol/high; no model override.
- A fresh dedicated app-server exposed a private owned Unix endpoint; the native
  TUI connected to that exact server with read-only/on-request policy. Existing
  session policies were not changed. The TS adapter used real WebSocket-over-Unix,
  with an explicit Unix connector that handles socket paths containing spaces.
- `initialize.userAgent` reported `session_peer_ts_side_experiment/0.159.2 ...`
  instead of `codex-tui/0.159.2 ...`. The version gate accepts those two exact
  tested prefixes for 0.159.2. CLI version and native TUI header independently
  confirmed 0.159.2; the prototype does not accept arbitrary versions.
- A setup request yielded `ACK TS81-PARENT-READY-20260930` in the parent TUI.
  Parent baseline was exactly one turn and idle.
- The real native `/btw` command displayed **Side from main thread**. The same
  server's loaded inventory gained one ephemeral, idle, direct-input-capable
  thread. No `thread/fork` substitute or artificial side target was used.
- Exact-target TS dry-run returned validated with `submitted:false`. The adapter
  then called `turn/start` once, returning accepted / `submitted:true` /
  `consumptionConfirmed:false`. No fallback, retry or policy/model override.
- The dedicated **side** rendered TUI showed both the request and the independently
  generated response **`ACK TS81-SIDE-ROUNDTRIP-20260930`** (4 seconds of work).
  This was read from the rendered screen, not inferred from the submission result.
- Parent before/after: one turn, idle, identical serialized-turn SHA-256
  `62c56a46a3b9aa86c30d1c0610ddbd57327181c586b10e3b2b8c7f33dbae9a70`.
  The side request and response did not enter the parent's transcript.

Only this dedicated test's parent was read with turns to compare hashes; no raw
transcript was exported. The adapter reads target metadata with `includeTurns:false`
and discards notifications. This does not implement general ACK waiting or reply
routing into an unrelated working conversation.

## Controls and findings

| Check | Evidence / result |
| --- | --- |
| Real native `/btw`, metadata, dry-run and one-shot side ACK | Live Mac PASS |
| Parent transcript unchanged | Live Mac hash/turn-count PASS |
| Persistent parent selected by adapter | Live refused: `ephemeral_target_required` before input |
| Native `thread/queue/add` against exact side ID | Live RPC rejection `-32600`; no queued fallback |
| UI dismissed with Ctrl+C | Live returned to the parent TUI |
| Dry-run after UI dismissal | **Still validated** while retained loaded/idle; no subsequent input |
| Unloaded/busy/mismatched/unknown-capability target | Contract test refusal, no turn/start |
| Transport timeout/protocol/internal error after submission attempt | Contract test unknown, no replay |
| Actual Unix WebSocket/symlink/private-directory handling | Fixture PASS |
| Unexpected server approval request | Fixture connection refused/closed; never answered |

The UI-lifetime finding independently reproduces the Python experiment's blocker.
The `turn/start` steering risk is grounded in pinned native handler source, not an
adversarial concurrency result. `ephemeral` is not a `/btw` discriminator. The
exclusive-test flag acknowledges the prerequisite but cannot enforce it. Owner
registration/generation plus safe native admission must be designed before any
normal opt-in support is claimed. Issue #81 remains open.

## Verification and cleanup

- Strict TypeScript checking and 20 scoped contract/real-Unix-WebSocket fixtures
  passed locally. These fixtures do not count as live Linux/Windows evidence.
- Experimental dependencies installed with scripts disabled; npm audit found
  zero vulnerabilities. No root dependency or lockfile change.
- Existing repository/package checks and PR CI are recorded on the Draft PR.
  Root package file allowlist excludes all experimental code/manifests/results.
- The dedicated native TUI and server terminals were closed; Orca confirmed PTY
  shutdown and retired those terminal surfaces. No matching endpoint server
  process remained. No handles remained on its physical socket; only the test's
  socket and rendezvous symlink were removed.
- The one newly created parent test record was deleted through its owning server
  after checking exact ID/cwd, one turn and the unchanged hash. Unrelated records,
  processes, worktrees, daemon files, credentials and operating settings were
  preserved. The implementation worktree remains for Draft review.

Unverified: Linux/Windows live sessions, SSH, existing Orca private servers,
concurrent input/steering, multi-client approvals, general ACK wait and automatic
Reply-To. Canonical CLI, native queues, SSH/Relay, release settings and npm
publication are outside this prototype.

References: [App Server](https://learn.chatgpt.com/docs/app-server),
[Python experiment at its reviewed head](https://github.com/abruption/session-peer/blob/a0dea84396181426082e7467f113db111ab49b68/experiments/codex_side_session/RESULTS.md),
[pinned native turn handler](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/codex-rs/app-server/src/request_processors/turn_processor.rs#L652),
[native ephemeral queue refusal](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/codex-rs/app-server/src/request_processors/thread_queue_processor.rs#L259).
