# Native Codex Side Session experiment (#81)

**Dedicated single-producer tests only. General use remains blocked.** This
TypeScript prototype lives outside the installed `session-peer` CLI. The root
package's file allowlist excludes `experiments/`; root dependencies, CLI,
queues, SSH/Relay and publishing configuration are unchanged.

It connects over WebSocket to a private owned Unix endpoint of the **existing
owning** Codex app-server. It never launches a server, resumes/forks a thread,
falls back to a parent, reconnects or retries an unknown submission. Server
version is restricted to the tested 0.159.2 response. The experiment has its
own private npm manifest/lockfile (`ws` 8.22.0); it is not a new public package.

## Running the experiment

Tested with Node 24.16.0 on macOS arm64. Use a reviewed private endpoint for a
server/TUI dedicated to this experiment, configured read-only/on-request.
Do not point this prototype at a working session or an arbitrary Orca server.

```sh
npm ci --prefix experiments/codex_side_session --ignore-scripts
npm run typecheck --prefix experiments/codex_side_session
npm test --prefix experiments/codex_side_session

node --experimental-strip-types experiments/codex_side_session/side_session.ts \
  --experimental-side-session --socket /private-test/app.sock list
node --experimental-strip-types experiments/codex_side_session/side_session.ts \
  --experimental-side-session --socket /private-test/app.sock send \
  --to codex:00000000-0000-4000-8000-000000000001 \
  --exclusive-test-session --dry-run --message 'test input'
```

Those paths and UUIDs are examples. Establish the side's origin separately
through the actual native `/btw` TUI. The list command reports loaded ephemeral
threads as **unclassified**; ephemeral alone does not prove `/btw` provenance
or a parent relationship. The send command requires an exact UUID plus loaded,
ephemeral, idle and direct-input-capable checks. `--message -` reads bounded
UTF-8 stdin. Frames are limited to 1 MiB, input to 64 KiB, inventory to 32 pages
of 100 entries, and notifications to 100 per request. Approval/server requests
are refused, never answered; notifications are discarded without transcript
retention. Results omit provider error text and private endpoint paths.

On this Mac, set `TASK_TEMP` to a task-owned private directory on the current
project volume before tests; the fixtures otherwise use the OS temp directory.
The actual unit/transport tests are manual experiment checks, not integrated
into the root CLI test suite. Existing PR CI checks root/package compatibility.

## Unmet safety gates

1. **Idle preflight is not an atomic idle-only submission.** In the pinned
   [native handler](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/codex-rs/app-server/src/request_processors/turn_processor.rs#L652),
   `turn/start` calls `start_or_steer_turn`. Another producer can win the race
   after inspection. `--exclusive-test-session` is an explicit prerequisite
   acknowledgement, not a lock against native clients. No concurrent-input
   adversarial test was performed.
2. **Loaded does not mean UI-open.** The actual TS experiment closed the `/btw`
   UI with Ctrl+C but the side remained loaded, ephemeral and idle. The same
   dry-run still returned validated. No further input was sent. General support
   requires cooperating-owner active registration/generation and suitable
   native admission semantics.

`accepted` / `submitted:true` remains distinct from consumption and ACK. The
live test observed an exact ACK in its dedicated rendered TUI separately. This
adapter has no general ACK wait or automatic Reply-To return route. Linux,
Windows, SSH, shared server access and multi-client approval handling remain
unverified. A new server cannot access another server's in-memory side thread.

See [RESULTS.md](RESULTS.md) and the [Python reference experiment](https://github.com/abruption/session-peer/pull/246).
The issue stays open and the PR stays Draft while general-use gates are unmet.
