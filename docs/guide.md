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
JSON stdin request, not remote shell arguments. Forward access does not
establish reverse access. Source after 0.2.1 uses Tailscale only as a routing
hint; see [Replies](#replies).

For a Windows SSH destination, add `--remote-platform win32` and select a
Windows `--remote-bin 'C:\absolute\path\session-peer.cmd'` if needed. A previously
authenticated OpenSSH control socket can be selected with
`--ssh-control-path /absolute/local/socket` with exactly one `--host`; this
does not bypass host-key verification or grant a new login. For local Windows Codex commands, use a full
`C:\Users\...\.codex` path for `--codex-home`. The Python CLI, if present,
is not removed or replaced by this client.

### Several hosts and connection options

Source after 0.2.1 (unreleased) accepts repeated `--host` and a constrained
`--ssh-opt`:

```sh
session-peer list --host alpha --host user@[2001:db8::1] \
  --ssh-opt=-p --ssh-opt=2222 --ssh-opt=-i --ssh-opt="$HOME/.ssh/id_ed25519" --json
```

- One `--host` returns one object, as before. Repeated `--host` returns a JSON
  array in the same order; every element has `schemaVersion`, `ok`, `host` and
  `command`. If any host fails, the exit code is 1. Text output prints one
  `Host: <host>` block per destination.
- All hosts and options are validated before any `ssh` process starts. One bad
  value refuses the whole command with `submitted:false`. Every `--host VALUE`
  or `--host=VALUE` before `--` is collected first, so with two or more of them
  any refusal, including an unknown option or a missing value, is an array with
  one element per host. With fewer, it is one flat object.
- The same destination twice is `duplicate_ssh_host`. This check compares the
  destination text only (user, case-insensitive host name, canonical IPv6). Two
  aliases or addresses for the same machine are not detected.
- `--ssh-jump USER@HOST[:PORT]` (once, POSIX clients) routes every `ssh` call
  for every `--host` through one jump host. The user is required, IPv6 needs
  brackets (`hop@[2001:db8::1]:22`), and `%`, `$`, quotes, spaces and other
  shell characters are refused (`invalid_ssh_jump`). Instead of `-J`, the CLI
  builds a fixed `ProxyCommand`. The hop runs `ssh` with `BatchMode=yes`,
  `StrictHostKeyChecking=yes`, `UpdateHostKeys=no`, `ConnectTimeout=10`,
  `ConnectionAttempts=1`, `ProxyCommand=none`, `ProxyJump=none`,
  `ControlPath=none`, `ForwardAgent=no`, `ClearAllForwardings=yes` and
  `PermitLocalCommand=no`, then `-W [target]:port`. The outer `ssh` also gets
  `ControlMaster=no`, `ControlPath=none` and `ProxyUseFdpass=no`, so a
  configured control master cannot bypass the hop. `ProxyCommand` runs through
  your login shell (`$SHELL`). It was verified with sh, bash and zsh; other
  login shells (for example fish or csh) are unverified. The hop needs its own
  known_hosts entry. `--ssh-opt` values, including `-4`/`-6`, apply to the
  target only and are not passed to the hop; the
  hop otherwise uses your ssh config for that host. Only one hop is supported.
  `--ssh-jump` conflicts with `--ssh-control-path` (`conflicting_ssh_jump`) and
  is refused on Windows clients (`ssh_jump_unsupported_platform`) until
  Win32-OpenSSH's `ProxyCommand` handling is verified. Results add `sshJump`.
- Timeouts are bounded. On POSIX each `ssh` starts detached: in a new session
  and process group with no controlling terminal. Cleanup covers that group
  only; a descendant that leaves it with `setsid()` is out of scope, and there
  is no PID scanning. At
  a timeout or output overflow the whole group is killed, including a jump
  `ProxyCommand` or any other descendant still holding the output pipes, and the
  call returns shortly after. Ctrl-C, SIGTERM or SIGHUP to the CLI also kills the
  group before the CLI exits. On Windows only the direct child is killed, so
  descendants may linger, but the call still returns at the deadline. A preflight
  timeout is a refusal (`ssh_preflight_timeout`); a request timeout is `unknown`
  and is never retried.
- Each destination gets one preflight and at most one request, in order. A
  refused or `unknown` host does not stop the next host and is never retried or
  resent elsewhere. Check each element before acting on it.
- `--ssh-opt` accepts only `-p PORT`, `-l USER`, `-i IDENTITY_FILE`,
  `-o Port=…`, `-o User=…`, `-o IdentityFile=…`, `-o IdentitiesOnly=yes|no`,
  `-4` and `-6`. Everything else, including `ProxyCommand`, `LocalCommand`,
  `-F`, `Include`, `-J`/`ProxyJump` and any `BatchMode`/`StrictHostKeyChecking`
  change, is refused (`unsupported_ssh_option`). Use `--ssh-jump` instead of
  `-J`: OpenSSH's own `-J` hop does not receive the command-line `BatchMode` or
  `StrictHostKeyChecking`.
- IPv6 literals may be bare (`2001:db8::1`) or bracketed (`[2001:db8::1]`,
  `user@[2001:db8::1]`); zone IDs are refused.
- Results add `sshUser` and `sshUserSource`: `explicit` for `USER@HOST` or
  `-l USER`, `ssh_config_or_local_default` from `ssh -G`, or `unknown` with
  `sshUser:null`. `-l` together with `USER@HOST` is refused. Without an explicit
  user, a local `ssh -G` runs once per host, limited to 5 s. It does not
  connect, but as ssh(1) and ssh_config(5) describe, it evaluates your ssh
  configuration, including `Match exec` commands, just as a normal `ssh` would.
- Two trust boundaries apply. The allowlist governs only the options this CLI
  passes on the command line. Your own `~/.ssh/config` (and the system config)
  is trusted user configuration: its `ProxyCommand`, `ProxyJump`, `Match exec`
  and similar settings run for every `ssh` this CLI starts, exactly as they do
  for your own `ssh` commands.

A proposed design for provisioning destinations without Python (a private,
versioned install directory, integrity checks, ownership and rollback rules)
and for a protocol compatibility contract separate from package versions is in
[Remote deployment ADR](design/remote-deployment.md). It is not implemented; the exact
same-version requirement above still applies.

### Replies

Use a `session-peer://v1/reply?...` URI as `--to`. Unknown/duplicate fields,
unsafe hosts, malformed encoding and conflicting explicit routes are rejected.
Peer metadata is never authority, and a Reply-To URI is never executed as shell
text. A received Reply-To is data for the reader; no reply is observed or
confirmed automatically.

Source after 0.2.1 (unreleased) adds sender context and generated routes:

- **Sender.** Inside Claude Code, `CLAUDE_CODE_MESSAGING_SOCKET` must match
  exactly one live registered session; its unique printable name (otherwise its
  PID) becomes `From: claude:NAME`. Inside Codex, a valid `CODEX_THREAD_ID` (or
  `CODEX_SESSION_ID`) gives `From: codex:UUID`. Conflicting, nested or invalid
  evidence gives no identity, and then no generated Reply-To. `--no-from` omits
  From only.
- **Generated Reply-To.** With a sender and no `--no-reply-to`, a local send gets
  a `transport=local` URI. An SSH send, or `--reply-to`, gets a
  `transport=ssh` URI whose host comes from `--reply-to HOST`, then
  `SESSION_PEER_REPLY_HOST`, then `CC_PEER_REPLY_HOST`, then this machine's
  tailnet name or address. A host without a user gets the current user. If no
  host is found, no SSH route is added. `--reply-address URI` stays an explicit
  alternative. `--reply-to`, `--reply-address` and `--no-reply-to` are mutually
  exclusive. Every URI is checked by the same parser as `--to`.
- **JSON.** `replyRoute` reports the generated route: local routes are
  `verified` (`same_machine_route`), SSH routes `unverified`
  (`reverse_ssh_not_checked`). When `--to` is a URI, `addressResolution`
  records its transport, and `normalizedFrom: "ssh_self"` when it was delivered
  locally.
- **Same machine.** An SSH reply URI is delivered locally only when its host
  includes this OS user and names this machine in an exact form (`localhost`,
  canonical `127.x.y.z`, `::1`, `::ffff:127.x.y.z`, the host name or the
  Tailscale self node; never a non-canonical numeric such as `127.1` or
  `0177.0.0.1`, nor an IPv4-compatible address such as `::7f00:1`), and no `--host` or SSH option (including `--ssh-jump`) was given. A
  different or missing user stays SSH.
- **Tailscale.** `tailscale status --json` (3 s bound) is a routing hint only.
  A peer whose `Online` is the boolean `true` (with MagicDNS on) keeps your SSH
  alias as the destination and adds `HostName=<MagicDNS name>`. It also adds
  `HostKeyAlias=<original name>`, unless the same `ssh -G` that reads the user
  shows a `HostKeyAlias` already set in your ssh config (that one is kept), or
  that lookup fails (nothing is overridden). The result `host` is then the
  MagicDNS name, and `sshHost` is the alias you gave. A peer whose `Online` is
  the boolean `false`, even with MagicDNS off, or an ambiguous name, is refused
  before SSH (`tailscale_peer_offline`, `tailscale_destination_ambiguous`). Any
  other `Online` value, MagicDNS off, an unknown name, a stopped or missing
  Tailscale, or `SESSION_PEER_TAILSCALE=off` means ordinary SSH.
- **Return route.** `doctor --check-return-route [--reply-to USER@HOST]` runs
  `ssh … USER@HOST 'exit 0'` from the diagnosed machine (the `--host`
  destination, or this one). It uses batch mode, no password or
  keyboard-interactive prompts, strict host keys, no host-key updates, no
  control socket and a 5 s connect timeout. The 8 s deadline applies to that
  final `ssh` command only; the Tailscale status (3 s) and `ssh -G` (5 s)
  lookups before it have their own limits. `exit 0` is a no-op in POSIX shells,
  cmd.exe and PowerShell, so the return host may be any OpenSSH server with one
  of those default shells (only POSIX return hosts have fixture coverage).
  `returnRoute` is `verified` or `failed` with a reason
  (`return_host_unavailable`, `return_host_is_receiver`,
  `ssh_executable_missing`, `authentication_failed`, `host_key_failed`,
  `timeout`, `transport_failed`, `remote_command_failed`). Locally, this user
  on this machine is a local route without SSH. With `--host`, a loopback
  return host that might name a machine is refused before SSH, without DNS:
  `localhost`, `*.localhost`, canonical 127.0.0.0/8 and 0.0.0.0/8, `::1`,
  `::`, their `::ffff:` mapped forms, IPv4-compatible IPv6 (`::a.b.c.d`), and
  every non-canonical numeric (leading zeros, fewer than four parts, hex or
  octal parts, single integers, overflow such as `127.1`, `0177.0.0.1`,
  `2130706433` or `4294967296`), because resolvers disagree on those. It is
  refused
  (`invalid_return_route`), because the destination would read it as itself.
  On the destination, a return host that is a known name of the destination
  itself (for any user) or an unprovable numeric form fails as
  `return_host_is_receiver` and is never reported as a verified local route.
  "Known name" means only an exact match with the OS host name or the Tailscale
  self names and addresses; other DNS or LAN aliases of a machine are not
  detected. Likewise a remote send never advertises a loopback or non-canonical
  numeric reply host (`invalid_reply_host`). It is never run automatically, never retried, and forward
  reachability never implies it. Like every `ssh` this CLI starts, the probe
  and its `ssh -G` user lookup use your trusted ssh configuration on the
  probing machine, including `ProxyCommand` and `Match exec` (see the trust
  boundaries above). The command-line allowlist does not apply to that file.

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
attempt. Cache writes are single-flight and fail closed: every write, from a
background refresh or an explicit check, happens only while holding
`npm-update.lock`, and only over an older record. Nothing ever takes over or
removes a lock it did not create. If a refresh crashes, or an I/O error keeps it
from releasing the lock, the lock stays behind: background refreshes stop, and
`update --check` reports `cache: "skipped_stale_lock"`. Delete `npm-update.lock` by hand when no
session-peer process is running.

`--no-update-notice` and `SESSION_PEER_NO_UPDATE_NOTICE=1` suppress these
background notices and refreshes. An explicit `update --check` is an intended
request: it always contacts the registry and, for the `latest` channel, writes
the cache when the lock is free (`cache` reports `written`, `skipped_locked`,
`skipped_stale_lock`, `skipped_newer` or `failed`). Notices belong to the local client. With `--host` the client
adds `clientUpdate` (or the stderr line) to its own top-level output, including
results obtained over SSH. When repeated `--host` produces a JSON array, the
array and its elements keep their exact shape and no `clientUpdate` is added;
text output still gets the single stderr line. Each invocation refreshes at most
once, regardless of the number of hosts. A single-host result that failed
(for example a refused SSH preflight) can still carry the advisory, but parse
errors and local refusals never do, and the advisory never changes status, exit
code or retry decisions. A `clientUpdate` sent back by a remote host is
discarded. The receiver in `--stdio-request` mode never reads,
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

## Optional sp shorthand

Optional `sp` shorthand is a source feature planned for 0.3.0, not included in
public npm 0.2.1. See [explicit activation and collisions](shorthand.md).
