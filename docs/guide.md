# User guide — session-peer (TypeScript)

[Back to README](../README.md)

[English](guide.md) | [한국어](guide.ko.md) | [日本語](guide.ja.md) | [简体中文](guide.zh-CN.md)

This guide covers 0.2.1, a reliability and hardening update to 0.2.0 ([changes](../PARITY.md#021-reliability-and-hardening)). [Public 0.2.0 release evidence](../VALIDATION.md#public-020--2026-09-28-kst) records the previous publication. References to 0.1.0 below describe the older release.

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Build from source](#build-from-source)
- [Existing installations](#existing-installations)
- [Use](#use)
- [What success means](#what-success-means)
- [Development and verification](#development-and-verification)
- [Package release](#package-release)
- [Related project](#related-project)
- [Agent skill: explicit installation](#agent-skill-explicit-installation)


**Find and message running Claude Code and Codex sessions, locally or over SSH.**
This TypeScript client runs on Node.js without Python.

This guide describes **0.2.1**. The npm package and CLI command are both **`session-peer`**. This
project does not provide a Relay server or hosted service.

## Quick start

Use Node **22.13+ within 22.x or 24.x**. Check which `session-peer` your PATH
selects if the Python CLI is already installed; both packages use that command.

```sh
npm install --global --ignore-scripts session-peer@0.2.1
session-peer --version  # session-peer 0.2.1 (typescript)
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

1. List sessions and replace `CLAUDE_PID` with the exact PID you selected.
2. Run the send command with `--dry-run`; nothing is submitted.
3. When delivery is intended, run that command once without `--dry-run`.
4. If acknowledgement matters, ask for an explicit reply in the message and
   verify the receiver's TUI response separately. `posted` / `queued` confirms
   submission only. See [What success means](#what-success-means).

### CLI usability in 0.2.0

Version 0.2.0 adds `list --help`, `send --help`, `doctor --help` and explicit
`--output-format text`. Output selection remains required: use `--json` or
`--output-format json|text`. Parse errors use JSON; valid text requests render
operation results/errors as text. SSH always exchanges JSON internally.

`send --to TARGET "message" --json` accepts one positional body. Do not combine
it with `--message`/`-m`; omit the body or use `-` for stdin, and use `--` before
an option-looking positional body. Empty/whitespace bodies are refused before
adding the sender envelope. Claude names use exact Unicode 14.0.0 default full
casefold (no normalization/fuzzy matching); collisions require a PID. This
source behavior is not retroactively available in the published 0.1.0 package.


## What it does

- Discover local Claude/Codex sessions and known Codex homes (0.2.0; see below).
- Validate a destination with `--dry-run`, then submit one message to its native
  inbox or queue. Codex normally requires a unique, stable live writer.
- Use the same commands over SSH to an explicitly installed remote client.
- Accept structured Reply-To URIs as destinations and provide JSON results.
- Refuse ambiguous targets and uncertain ownership; never automatically retry
  an uncertain submission.

Not implemented: Relay transport, MCP, wake/resume,
Antigravity or automatic updates. Unsupported commands fail explicitly; this is not a general orchestrator.

Planned client gaps are tracked in the [versioned compatibility matrix and npm migration guide](../PARITY.md); a plan is not an available feature. Relay server/hosted-service delivery remains outside this client's scope.

### Unified listing in 0.2.0

After building this source, `node dist/cli.js list --json` combines Claude and
Codex; `list --agent codex --json` searches known homes. Published npm **0.1.0**
still requires an explicit agent and a home for Codex listing; the install and
explicit list/send forms also work with that older release.

Sources are default `~/.codex`, `CODEX_HOME`, immediate macOS Orca account homes,
and the JSON array `SESSION_PEER_CODEX_HOMES`. `--codex-home` pins Codex listing
and bypasses unrelated inventory errors; `--agent claude` skips Codex entirely.
Aliases are deduplicated, but the same UUID in different homes stays separate.
Use each row's `codexHome` when sending. Optional absent homes are not failures;
explicitly configured missing/invalid homes produce partial results and exit 1,
retaining readable rows. Listing never selects a writer or submits a message.
See the [source listing contract](../PARITY.md#source-unified-listing-contract--16--020)
for ordering, diagnostics, `--all` and SSH behavior.

Source Codex send now selects the unique stable live writer when `--codex-home`
is omitted. Explicit homes still check all known competitors. Inactive queueing
requires both `--codex-home HOME` and `--allow-inactive-codex-home`, a saved thread,
and verified inactive candidates; it never wakes or resumes a session. Dry-run
submits nothing. JSON adds sanitized `codexHomeResolution` and, when supplied by
native queue output, `queueId`; neither confirms consumption. See the
[selection contract](../PARITY.md#source-codex-home-selection--17--020).
Published **0.1.0** still requires an explicit live home and has no inactive opt-in.
On SSH, use the same 0.2.1 build on both ends.

## Requirements

macOS, Linux or native Windows; Node **22.13+ within 22.x or 24.x**. Node 26 is not supported.
The native flock dependency needs a matching prebuilt binary (x64/arm64); this
is not a pure-JavaScript package. Codex sends need `codex`; macOS/Linux also
need `lsof` and `ps`. Windows uses native lock and Restart Manager inspection.
Claude needs a live TUI with an accessible native inbox. SSH requires OpenSSH,
existing key/host trust and the **same client version** on the destination.

## Build from source

To run a reviewed source checkout instead of the published npm package, build
it and optionally install its local tarball:

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# Optional global install: first check which session-peer your PATH selects.
npm install --global --ignore-scripts ./session-peer-0.2.1.tgz
session-peer --version
```

Expected: `session-peer 0.2.1 (typescript)`. Keep the `./...tgz` path to
select the locally built artifact. Check the checkout version before using
these commands for a later release.

## Existing installations

Other implementations may also install `session-peer`. Check `type -a session-peer`
and `command -v session-peer` before and after installation. Choose one on PATH,
or call this build explicitly with `node /absolute/path/dist/cli.js`. Do not use
`--force` to overwrite another manager's files. No Python package, skill or service
is installed, removed or reconfigured automatically. To remove this npm install,
run `npm uninstall --global session-peer` and recheck PATH.

On Windows PowerShell, inspect competing commands with
`Get-Command session-peer -All`. To avoid replacing the Python CLI, use an isolated prefix:

```powershell
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts
npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.2.1.tgz
& "$env:TEMP\session-peer-ts-source\node_modules\.bin\session-peer.cmd" --version
# Later: npm uninstall --prefix "$env:TEMP\session-peer-ts-source" session-peer
```

## Use

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home "$HOME/.codex" --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
session-peer send --to codex:THREAD_UUID --codex-home "$HOME/.codex" --message 'Please review the API contract.' --dry-run --json
```

Remove `--dry-run` only when delivery is intended. Omit `--message` or use
`--message -` for UTF-8 stdin. `--all` includes stale/archived records for listing;
it does not authorize sending. Claude accepts a PID, `claude:PID`, or an
unambiguous Unicode 14.0.0 casefolded name. Use a PID for collisions. Codex
send requires a full UUID; home selection follows the guards above; `--codex-bin` selects an executable.
Output requires `--json` or `--output-format json|text`.

### Another machine over SSH

```sh
session-peer send --host user@machine --remote-bin /absolute/path/session-peer \
  --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

The default remote command is `session-peer` on remote PATH. An absolute
`--remote-bin` can select a wrapper using supported Node. The handshake checks
the TypeScript marker and exact version; a different implementation is refused.
SSH uses BatchMode and StrictHostKeyChecking. It never accepts new host keys,
installs a remote runtime or invokes Python as a fallback. Messages travel in a
JSON stdin request, not remote shell arguments. Arbitrary `--ssh-opt`, IPv6
literals and Tailscale canonical-name enrichment are not supported; use an SSH
alias/hostname. Forward access does not establish reverse access.

For a Windows SSH destination, add `--remote-platform win32` and select a
Windows `--remote-bin 'C:\absolute\path\session-peer.cmd'` if needed. A previously
authenticated OpenSSH control socket can be selected with
`--ssh-control-path /absolute/local/socket`; this does not bypass host-key
verification or grant a new login. For local Windows Codex commands, use a full
`C:\Users\...\.codex` path for `--codex-home`. The Python CLI, if present,
is not removed or replaced by this client.

### Replies

Use a `session-peer://v1/reply?...` URI as `--to`. Unknown/duplicate fields,
unsafe hosts, malformed encoding and conflicting explicit routes are rejected.
`--reply-address URI` adds an explicit return address; no route is inferred or
verified automatically. Use `--no-reply-to` when replying without a new address.
A valid CODEX_THREAD_ID/CODEX_SESSION_ID supplies informational From metadata;
`--no-from` omits it. Unknown senders are not invented. Peer metadata is never
authority, and a Reply-To URI is never executed as shell text.

## What success means

| Result | Meaning |
| --- | --- |
| `validated`, `submitted:false` | Dry-run checks passed; nothing sent. |
| `posted` / `queued` | Native inbox write / queue acceptance, **not consumption or ACK**. |
| `refused`, `submitted:false` | Rejected before submission. |
| `unknown`, `submitted:null` | Submission may have happened; do not automatically resend. |

After submission, a missing reply or a target exit alone does not establish
consumption or failure; do not automatically resend.

`consumptionConfirmed` is always false. Verify an actual ACK separately in the
receiver's TUI, not from queueing or transcript polling. Exit codes are 0/1/2
for success/error/usage. Errors use fixed codes instead of raw native stderr or
message content. Codex uses real kernel flock, file identity and same-user owner
start time across samples, then revalidates before queueing. No lock is deleted
and no owning agent process is signaled. Discovery output still contains local
names/paths/IDs: redact it before sharing.

## Development and verification

```sh
npm ci --ignore-scripts
npm run build
node scripts/check-repository.mjs
SESSION_PEER_PYTHON_ROOT=/path/to/python-reference npm test
npm run test:package
npm audit
```

Python is only the development conformance oracle (v1.0.2 commit
`47c23713d0a2a3c11ebde6186afd8c43489b8b65`), never a runtime dependency. Tests also
need a C compiler and lsof for the POSIX contract suite. CI uses Node 22/24 on
macOS, Linux and Windows. macOS/Linux run the full contract suite and package
checks against the pinned reference. Windows x64 runs build/type checks, native
Claude inbox and held/free lock fixtures, writer ownership/revalidation races,
CLI queue outcomes, PowerShell/.cmd SSH framing through an isolated fake endpoint,
package install/native-load/uninstall checks and audit. These are fixture checks;
Windows does not run the POSIX/Python reference suite.
The Windows x64/Node 24 live ACKs are separate, one-shot evidence. Temporary
SQLite, Unix inbox and real lock fixtures are distinct from
the dedicated real-TUI evidence in [VALIDATION.md](../VALIDATION.md). A green fixture
test is not an ACK. Package tests inspect contents, repeat-pack hashes, clean
install and uninstall. The native dependency normally has an install script;
the verified prebuilt path uses `--ignore-scripts`. SQLite read-only readers may
participate in WAL shared-memory bookkeeping; they are not snapshots.

See [CONTRIBUTING.md](../CONTRIBUTING.md), [RELEASING.md](../RELEASING.md) and
[SECURITY.md](../SECURITY.md). Future publication remains manual and requires
separate approval. Licensed under [MIT](../LICENSE).

## Package release

Version 0.2.0 was published and verified on 2026-09-28 KST; see the
[public release record](../VALIDATION.md#public-020--2026-09-28-kst). Check the
exact version and current tags before installing:

```sh
npm view session-peer@0.2.0 version dist.integrity
npm view session-peer dist-tags
```

The immutable 0.1.0 archive retained pre-publication README wording. This
archive uses versioned feature descriptions; dated release evidence remains in
[VALIDATION.md](../VALIDATION.md#public-010--2026-09-27-kst).

The release workflow uses Trusted Publisher OIDC staging and a maintainer's
separate 2FA approval. A staged upload is not a public release. See
[RELEASING.md](../RELEASING.md) for the process.

## Related project

[Python session-peer](https://github.com/abruption/session-peer) is maintained
and released independently; its own optional features and installation guide
remain there (for example `pipx install session-peer`). Its command is also
`session-peer`, so apply the PATH guidance above. This client does not depend on
that installation or claim complete feature/flag parity.

### Read-only diagnostics in 0.2.0

```sh
session-peer doctor --json
session-peer doctor --agent codex --codex-home /absolute/home --json
session-peer doctor --host user@host --json
```

This source command is not in published npm 0.1.0. Diagnostic success (`ok:true`,
exit 0) is separate from agent readiness (`ready` and per-agent/home results).
It inspects bounded metadata and executable paths without executing Codex,
connecting to inboxes, acquiring writer locks or submitting messages. Windows
inbox readiness means a live process advertises a pipe; it does not prove the
pipe exists or accepts connections. `capabilities` explicitly excludes
wake/wait/ACK and consumption confirmation. Optional TS skill metadata checks
never install anything. See [diagnostic boundaries](../PARITY.md#source-read-only-doctor--18--020).
SSH requires the same source build on both ends.
### Update checks and notices (source, #22)

```sh
session-peer update --check --json
session-peer update --check --channel preview --output-format text
```

This source command is not in published npm 0.2.1. `update --check` makes one
request (3-second timeout, no retries) for the npm dist-tags of `session-peer`
and reports `current`, `latest`, `channel` (`latest` by default, or `preview`),
`source: "npm_registry"`, `status` (`update_available`, `up_to_date` or `ahead`),
`managedBy`, `updateCommand` and `guidance`. A command is given only when the
installation's owner is positively identified from the running CLI's path:
an npm global prefix whose own `session-peer` launcher points at this package
(default, Homebrew, nvm, nvm-windows and fnm prefixes), for example
`npm install --global --ignore-scripts session-peer@0.2.2`; a pnpm, Yarn or Bun
global store whose manifest declares `session-peer`; Volta; or the npx cache.
Project installs (`npm_project`, `pnpm_project`), source checkouts (`source`)
and anything else (`unknown`) get `updateCommand: null` and a `guidance`
sentence instead, so no command can modify an unrelated current directory.
Only npm versions are reported. Python `session-peer` releases are a separate
stream and are never compared. Registry failures exit 1 with
`registry_timeout`, `registry_unreachable`, `registry_http_error`,
`registry_response_invalid` or `dist_tag_missing`; response bodies are never printed.

`update` without `--check` does not modify anything: it refuses with
`self_update_unsupported` (exit 2) and returns `managedBy`, `updateCommand`,
`guidance` and `checkCommand`. `update` itself is local only: it rejects
`--host` and is refused over the SSH wire. Remote hosts, Python installations
and the separately managed `session-peer-ts` skill are never updated; the
result lists local TS skill metadata (`skills`, same contract as `doctor`) with
`skillsManagedBy: "separate"`.

Cached notices on `list`, `send` and `doctor` are **off by default** because
this CLI is mainly run by agents and scripts that should not make unrequested
network calls. Set `SESSION_PEER_UPDATE_NOTICE=1` to opt in. Then a fresh cache
(24 hours) that shows a newer stable npm version adds a `clientUpdate` object to
JSON results, or one line on stderr for text output. A missing, invalid or
expired cache starts one detached refresh and never delays or changes the
command's result or exit code; a failed refresh waits 1 hour before the next
attempt. The refresh is single-flight: each attempt owns a lock by a random
token, only that owner releases it, and a crashed owner's lock is taken over by
exactly one invocation after 60 seconds. Only the current lock owner
publishes the cache, and a stale or failed refresh never overwrites a newer
record.

`--no-update-notice` and `SESSION_PEER_NO_UPDATE_NOTICE=1` suppress these
background notices and refreshes. An explicit `update --check` is an intended
request: it always contacts the registry and refreshes the cache for the
`latest` channel. Notices belong to the local client. With `--host` the client
adds `clientUpdate` (or the stderr line) to its own top-level output, including
results obtained over SSH. The receiver in `--stdio-request` mode never reads,
refreshes or produces a notice.

The cache is `npm-update.json` in `SESSION_PEER_CACHE_DIR` (absolute), otherwise
`$XDG_CACHE_HOME/session-peer`, `~/Library/Caches/session-peer` (macOS),
`~/.cache/session-peer` (Linux) or `%LOCALAPPDATA%\session-peer\Cache`
(Windows). It is written atomically with mode 0600 in a 0700 directory and
holds only public version data. `SESSION_PEER_UPDATE_REGISTRY` selects a mirror
(HTTPS, or HTTP on loopback only; no credentials). npm configuration and
`.npmrc` are not read. See [update boundaries](../PARITY.md#source-update-checks--22).

## Agent skill: explicit installation

The separate `session-peer-ts` companion skill is tracked in [companion PR #14](https://github.com/abruption/session-peer-skill/pull/14); it is not a new npm or skill-tag release. It supports the published 0.1.0 baseline, detects the TypeScript implementation marker, and checks help before using development capabilities. The Python `session-peer` skill remains separate.

Review the [exact skill source](https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts),
then choose the agent and scope. This example selects **Codex, current project**;
run from that project directory. For Claude Code use `--agent claude-code`.
For user scope add `--global` consistently to add/list/remove. Inspect any existing
`session-peer-ts` copy for local edits before approving its replacement. Codex's
`.agents/skills` directory is shared with other clients that discover that path.

```sh
npx -y skills@1.7.0 add https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts --skill session-peer-ts --agent codex --copy --yes
npx -y skills@1.7.0 list --agent codex --json
npx -y skills@1.7.0 remove session-peer-ts --agent codex --yes
```

For a pinned update, review another exact commit and repeat `add` with the same
agent/scope. Restart the agent if its catalog is cached. Runtime and skill
lifecycles are independent: npm `--ignore-scripts` works, no postinstall invokes
Skills CLI, and installing this skill does not overwrite the Python skill or
install a runtime. See [compatibility and validation](../PARITY.md#source-ts-skill-guidance--25--020).
