# session-peer (TypeScript)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: preview-candidate; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

Send messages to running **Claude Code and Codex sessions**, locally or on
another machine over SSH. This TypeScript client runs on Node.js without Python.

**Preview release candidate; publication requires separate approval.** Package name:
`session-peer`. CLI command: **`session-peer`**. This project does not provide
a Relay server or hosted service.

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

## Install

Do **not** run registry `npm install -g session-peer` or `npx session-peer`
until an official npm release verifies ownership and provenance. Today, build
a reviewed source checkout and optionally install its local tarball:

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# Optional global install: first check which session-peer your PATH selects.
npm install --global --ignore-scripts ./session-peer-0.1.0-preview.1.tgz
session-peer --version
```

Expected: `session-peer 0.1.0-preview.1 (typescript)`. Keep the `./...tgz` path;
it selects the locally built artifact, not an unverified registry package.
After a separately approved npm release, the package will remain `session-peer`
while the command remains `session-peer`; follow that release's version/dist-tag.

### Existing installations

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
npm install --prefix "$env:TEMP\session-peer-ts-preview" --ignore-scripts .\session-peer-0.1.0-preview.1.tgz
& "$env:TEMP\session-peer-ts-preview\node_modules\.bin\session-peer.cmd" --version
# Later: npm uninstall --prefix "$env:TEMP\session-peer-ts-preview" session-peer
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
is not removed or replaced by this preview.

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
[SECURITY.md](SECURITY.md). Publication requires separate approval; no automatic
npm publish is enabled. Licensed under [MIT](LICENSE).

## npm release installation

Only after the official release and registry integrity/provenance verification,
install the exact preview below. It is not the stable `latest` channel. Before
publication, keep using the local tarball instructions above.

```sh
npm install --global --ignore-scripts session-peer@0.1.0-preview.1
session-peer --version
```

The manual workflow initially uses a short-lived bootstrap token. Later versions
use Trusted Publisher OIDC staging and require a maintainer's 2FA approval;
a staged upload is not a public release. See [RELEASING.md](RELEASING.md).

## Related project

[Python session-peer](https://github.com/abruption/session-peer) is maintained
and released independently; its own optional features and installation guide
remain there (for example `pipx install session-peer`). Its command is also
`session-peer`, so apply the PATH guidance above. This client does not depend on
that installation or claim complete feature/flag parity.
