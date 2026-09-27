# session-peer (TypeScript)

[![npm version](https://img.shields.io/npm/v/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm downloads per week](https://img.shields.io/npm/dw/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm downloads per month](https://img.shields.io/npm/dm/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![CI](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml)
[![Node support](https://img.shields.io/node/v/session-peer?logo=node.js)](https://www.npmjs.com/package/session-peer)
[![MIT license](https://img.shields.io/npm/l/session-peer)](LICENSE)

<sub>npm download statistics can lag behind package publication.</sub>

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: stable-release-source; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

**Find and message running Claude Code and Codex sessions, locally or over SSH.**
This TypeScript client runs on Node.js without Python.

The published npm package and CLI command are both **`session-peer`**. This
project does not provide a Relay server or hosted service.

## Quick start

Use Node **22.13+ within 22.x or 24.x**. Check which `session-peer` your PATH
selects if the Python CLI is already installed; both packages use that command.

```sh
npm install --global --ignore-scripts session-peer@0.1.0
session-peer --version  # session-peer 0.1.0 (typescript)
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

Replace `CLAUDE_PID` with an exact PID from the listing. `--dry-run` validates
without sending; remove it only when delivery is intended. A `posted` or
`queued` result means submission, not that the receiver read or completed the
request. See [What success means](#what-success-means).

## What it does

- Discover local sessions and explicitly selected Codex homes.
- Validate a destination with `--dry-run`, then submit one message to its native
  inbox or queue. Codex requires a unique, stable live writer.
- Use the same commands over SSH to an explicitly installed remote client.
- Accept structured Reply-To URIs as destinations and provide JSON results.
- Refuse ambiguous targets and uncertain ownership; never automatically retry
  an uncertain submission.

Not implemented: Relay transport, MCP, wake/resume, inactive queueing,
Antigravity, automatic updates, implicit multi-agent discovery, or human text
output. Unsupported commands fail explicitly; this is not a general orchestrator.

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
npm install --global --ignore-scripts ./session-peer-0.1.0.tgz
session-peer --version
```

Expected: `session-peer 0.1.0 (typescript)`. Keep the `./...tgz` path to
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
npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.1.0.tgz
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
unambiguous ASCII name, case-insensitively. Use a PID for Unicode names. Codex
requires a full UUID and explicit home; `--codex-bin` selects an executable.
Output requires `--json` or `--output-format json`.

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
need a C compiler and lsof for the POSIX contract suite. CI pins the reference
and covers macOS/Linux/Windows × Node 22/24. Temporary
SQLite, Unix inbox and real lock fixtures are distinct from
the dedicated real-TUI evidence in [VALIDATION.md](VALIDATION.md). A green fixture
test is not an ACK. Package tests inspect contents, repeat-pack hashes, clean
install and uninstall. The native dependency normally has an install script;
the verified prebuilt path uses `--ignore-scripts`. SQLite read-only readers may
participate in WAL shared-memory bookkeeping; they are not snapshots.

See [CONTRIBUTING.md](CONTRIBUTING.md), [RELEASING.md](RELEASING.md) and
[SECURITY.md](SECURITY.md). Future publication remains manual and requires
separate approval. Licensed under [MIT](LICENSE).

## Package release

`session-peer@0.1.0` is the verified stable npm release. Its public registry
integrity, provenance metadata, signature audit, fresh install and uninstall
passed. The `latest` tag points to `0.1.0`; the `preview` tag remains on
`0.1.0-preview.1`. Check current tags before relying on an unversioned install:

```sh
npm view session-peer dist-tags
```

The release workflow uses Trusted Publisher OIDC staging and a maintainer's
separate 2FA approval. A staged upload is not a public release. See
[RELEASING.md](RELEASING.md) for the process.

## Related project

[Python session-peer](https://github.com/abruption/session-peer) is maintained
and released independently; its own optional features and installation guide
remain there (for example `pipx install session-peer`). Its command is also
`session-peer`, so apply the PATH guidance above. This client does not depend on
that installation or claim complete feature/flag parity.
