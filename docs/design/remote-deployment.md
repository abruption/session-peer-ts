# ADR: Python-free remote deployment and version compatibility

[Back to the guide](../guide.md) · [Parity matrix](../../PARITY.md) · Issue [#23](https://github.com/abruption/session-peer-ts/issues/23)

| Field | Value |
| --- | --- |
| Status | **Proposed** (design only; nothing in this document is implemented) |
| Date | 2026-10-02 |
| Applies to | `session-peer` 0.2.1 source and later; SSH transport (`--host`) only |
| Decision owner | Repository maintainer |
| Supersedes | Nothing. The exact-version preflight stays in force until the follow-ups below are implemented and verified |

## Contents

- [Context](#context)
- [Constraints](#constraints)
- [Options](#options)
- [Decision](#decision)
- [Compatibility contract](#compatibility-contract)
- [Errors](#errors)
- [Operator workflow](#operator-workflow)
- [Non-goals](#non-goals)
- [Validation](#validation)
- [Follow-ups](#follow-ups)
- [Review checklist](#review-checklist)

## Context

The Python reference (1.0.2) streams its standalone source to `python3 -` over
SSH, so a destination needs only a usable Python and a POSIX shell. Its
`install.sh --host` additionally pushes the program to
`$HOME/.local/share/session-peer` and links `$HOME/.local/bin/session-peer`.

The TypeScript client deliberately does not do that. In 0.2.1 through 0.3.1 the local client
runs `ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10`
and, before any message leaves the machine:

1. runs `<remote-bin> --version` with no message (15 s timeout);
2. requires stdout to equal exactly the client's own version line, for example
   `session-peer 0.3.1 (typescript)` (`VERSION_LINE` in `src/protocol.ts`),
   otherwise refuses with a fixed code from `sshPreflightFailure` in `src/cli.ts`;
3. sends a `schemaVersion: 1` JSON request on stdin to
   `<remote-bin> --stdio-request` and verifies the `schemaVersion: 1` response
   shape, command, exit code and send status before reporting success.

0.3.0 ([#20](https://github.com/abruption/session-peer-ts/issues/20))
adds ordered repeated `--host`, an allowlisted `--ssh-opt`, a single-hop
`--ssh-jump` for POSIX clients, and IPv6 literals. Each destination still gets
the same message-free, exact-version `--version` preflight before its one
request, so the deployment gap described here is unchanged.

The destination therefore needs an **explicitly installed TS CLI of the same
version**, a **supported Node** (22.13+ within 22.x, or 24.x; enforced by the
CLI itself) and a loadable **native lock binary** from `fs-ext-extra-prebuilt`
2.2.14. The native module is loaded lazily (`await import` in `probeLock`,
`src/writer.ts`), so `--version`, `list`, `doctor` and Claude sends work without
it, but Codex sends cannot prove the writer lock and refuse with
`active_writer_unverified`.

This boundary is intentional and safe, but it leaves operators without a
documented way to provision a destination, to diagnose a missing runtime, or to
upgrade one side at a time. Relaxing the exact-version check without a
replacement contract would let the local verifier accept response shapes it
does not understand, which is how `submitted:null`/`unknown` outcomes would be
misreported.

## Constraints

### Native dependency coverage

`fs-ext-extra-prebuilt@2.2.14` (registry integrity
`sha512-V8yXXh7t…pf9pJ48w==`, SLSA provenance and one registry signature) ships
all of its binaries **inside its own tarball** under `binaries/`. Its `install`
script only falls back to `node-gyp`; this project always installs with
`--ignore-scripts`, so the bundled binary is the only path.

| Platform | Architectures | Node ABI files | Notes |
| --- | --- | --- | --- |
| darwin | x64, arm64 | node 20–25 (one per major) | |
| linux | x64, arm64 | node 20–25 | glibc build; highest symbol version `GLIBC_2.28`. No musl (Alpine) file |
| win32 | x64, arm64 | node 20–25 | |

The loader picks `fs-ext-<platform>-<arch>-node-<major>.0.0.node`, falling back
to the highest major **below** the running one. The binaries are NAN addons,
not Node-API, so that fallback is not ABI-safe for a newer major. The CLI
already refuses Node outside 22.13–22.x/24.x before loading anything, which is
what keeps the fallback unreachable. Not covered: 32-bit and other CPU
architectures, musl libc, glibc older than 2.28 and FreeBSD. Linux arm64,
Windows arm64 and macOS x64 files are packaged but not exercised by CI.

### Node and the npm launcher

`npm` creates `node_modules/.bin/session-peer` as a `#!/usr/bin/env node`
symlink (POSIX) or a `.cmd`/`.ps1` launcher (Windows). Both select whatever
`node` is first on the **non-interactive SSH** `PATH`. That is frequently not
the operator's interactive Node: version managers such as nvm are usually not
initialized for `ssh host command`, and one recorded destination selected Node
26 on its default PATH ([VALIDATION.md](../../VALIDATION.md#real-tui-and-ssh-checks)).

### Ownership

The name `session-peer` is shared with the Python implementation (pipx,
`install.sh`, `$HOME/.local/bin/session-peer`). The guides already forbid
`--force` and overwriting another manager's files.

### Offline destinations

Python works offline because the source travels over SSH. An npm registry
install needs network access to `registry.npmjs.org` (or a mirror) from the
destination, plus the transitive `nan` package.

## Options

| Criterion | (a) npm install on each destination | (b) Operator-invoked isolated artifact provisioning | (c) Portable remote bundle |
| --- | --- | --- | --- |
| Shape | Operator runs `npm install --global --ignore-scripts session-peer@X` on the destination | Operator verifies the release tarball and its locked dependency tarballs locally, uploads them over the existing SSH trust, installs into a private versioned prefix with `--offline --ignore-scripts`, adds a wrapper with an absolute Node path | New release artifact: a single bundled `cli.js` plus per OS/arch native lock binaries (or a Node single-executable application that embeds Node) |
| New distribution artifact | No | No (reuses the published tarball and the locked dependency tarballs) | Yes, per OS/arch(/libc/Node major); must be built, signed and verified separately from npm |
| Native/OS/arch/ABI | Same as the package; bundled prebuilds selected at runtime | Same as the package; checked before activation by a native load probe | Must reproduce the platform matrix and ABI selection; SEA additionally needs per-platform Node binaries and macOS/Windows code signing |
| Node requirement | Destination Node on PATH | Destination Node at an absolute path recorded in the wrapper | Bundle: destination Node. SEA: none, at a much larger artifact size |
| Offline | No (registry or mirror needed) | Yes (tarballs travel over SSH; verified install with an empty cache) | Yes |
| Integrity | npm registry integrity and provenance, verified by the destination's npm, but the operator does not see or pin the hash unless done separately | Local check of registry `dist.integrity`, recorded SHA-256 and SLSA provenance before upload; remote SHA-256 re-check after upload; `package-lock.json` integrity in the prefix | Needs a new provenance and signature chain; npm provenance does not cover a derived bundle |
| Ownership | Global prefix collides with other `session-peer` executables on PATH | Private, versioned directory; never on PATH; ownership marker | Private directory possible, but a new installer must be written and trusted |
| Rollback | Reinstall an older version globally | Keep the previous version directory; switch `--remote-bin` | Keep previous bundle |
| Windows | Works with an isolated prefix (recorded live, [VALIDATION.md](../../VALIDATION.md#native-windows-candidate--2026-09-27-kst)) | Same mechanism as the recorded Windows isolated prefix | Unverified |
| Engineering cost | Documentation only | Documentation now; an optional helper later | High: new build matrix, signing, size, new security review |

### Assessment

- **(a)** stays supported for operators who already manage Node and a registry
  connection, but it gives no offline path, does not pin integrity on the
  operator side, and invites PATH conflicts with the Python CLI.
- **(c)** solves offline and Node absence most completely, but only by creating
  a second, unsigned distribution channel that npm provenance does not cover,
  multiplied by every OS/arch/libc/Node-major cell. The current prebuilt
  matrix already lives in a single dependency tarball, so a separate bundle
  buys little for its cost. Rejected for now; revisit only if destinations
  without any supported Node become a real requirement.
- **(b)** uses exactly the artifacts the release process already verifies
  (`scripts/release.mjs` records SHA-256 and SHA-512 integrity, and checks
  provenance and registry signatures), works offline, keeps every executable in
  a directory this workflow owns, and has already been exercised manually on
  live Windows and macOS destinations. Package smoke tests in CI already
  install the packed tarball into an isolated prefix and load the native module
  on macOS, Linux and Windows.

## Decision

Adopt **(b) operator-invoked isolated artifact provisioning** as the supported
deployment path, keep **(a)** as an equivalent but unpinned alternative, and do
not build **(c)**.

Concretely:

1. Provisioning is a separate, explicit operator action, never a side effect of
   `list`, `send` or `doctor`.
2. Each destination gets one private, immutable directory per **install
   identity** (package version and SHA-256, locked dependency integrity,
   platform, arch, libc, Node major/ABI and Node path), never on `PATH`. The
   directory holds the installed package, its locked dependencies, an ownership
   marker and a self-locating wrapper that runs the recorded absolute Node path.
   Callers select it with an absolute `--remote-bin`.
3. Integrity is checked at three points:
   - before upload: the recorded SHA-256, registry integrity, signatures, and
     provenance naming the release's exact source commit, whose lockfile pins
     the dependencies;
   - after upload: the SHA-256 is recomputed on the destination;
   - at install: `--offline` against the locked integrity values.
4. Before activation, the staged install is probed for the exact version banner
   and a native lock load. Activation is a directory rename under a cooperative
   lock: it never nests and never replaces a non-empty target. The exact
   guarantee scope is stated below. The activated directory is verified again
   before any caller switches to it.
5. The exact-version preflight remains the only acceptance rule until the
   [compatibility contract](#compatibility-contract) is implemented and
   verified; the workflow does not depend on that contract.

The workflow is documented below as a manual procedure. A `session-peer deploy`
helper is a follow-up, not part of this decision.

## Compatibility contract

Package SemVer describes the npm artifact. It must not be the wire contract: a
documentation-only patch release should not break SSH, and a refactor must not
silently change response verification. The proposed contract separates three
things.

### 1. Wire protocol version

`wire` is a positive integer that names the request/response framing and the
verification rules in `remote()`:

| Wire | Request | Response the client verifies |
| --- | --- | --- |
| 1 (current) | stdin JSON `{schemaVersion:1, args:string[]}` to `--stdio-request`; message in `--message=`, plus `--no-from --no-reply-to` for send | `schemaVersion:1`; `command` echoes the request; boolean `ok`; string `host`; exit code 0/1/2 with `ok === (code === 0)`; doctor `diagnosticCompleted`, `ready`, `implementation:"typescript"`, `agents` object; send `consumptionConfirmed:false`, `submitted`/`status` pairs (`validated`/`posted`/`queued`, `refused`, `unknown`) |

Any change to these rules, to the 4,100,000-byte stdin bound, or to the meaning
of an existing field increments `wire`. Adding an optional response field does
not.

### 2. Capabilities

Capabilities are additive string flags for behavior a command depends on, for
example `list`, `send.claude`, `send.codex`, `doctor`, `codexHome.inactiveOptIn`,
`nativeLock`. A capability is never removed without incrementing `wire`.

### 3. Capability preflight

A new, side-effect-free flag `<remote-bin> --capabilities` prints one JSON line
and sends nothing:

```json
{"schemaVersion":1,"implementation":"typescript","version":"0.3.1",
 "wire":{"min":1,"max":1},
 "capabilities":["list","doctor","send.claude","send.codex","codexHome.inactiveOptIn"],
 "runtime":{"node":"24.16.0","modules":"137","platform":"linux","arch":"x64"},
 "nativeLock":"loaded"}
```

`nativeLock` is `loaded`, `missing` (no matching prebuild) or `failed` (other
load error). It is determined by importing the module without opening a file.
The output contains no paths, hostnames, user names or agent state.

### Negotiation rules

1. The client always runs `--version` first, exactly as today. An exact match is
   accepted without version negotiation. Every released client (0.2.x and
   earlier, which can never learn new rules) therefore stays interoperable with
   a correctly provisioned remote.

   Round trips:
   - `list`, `doctor` and Claude sends need one preflight round trip.
   - Once F2/F3 ship, a Codex send adds a second, message-free
     `--capabilities` round trip, even on an exact match, to check
     `nativeLock` before dispatch. Releases without F2/F3 keep a single round
     trip.
   - A version mismatch with negotiation enabled also uses `--capabilities`
     (rule 2).
   - Preflight never takes more than two message-free round trips.
2. Only when the banner is a `typescript` banner of a different version **and**
   negotiation is enabled does the client run `--capabilities`. A remote that
   answers with a refusal (all releases up to 0.2.x answer
   `unsupported_command`) is a legacy remote and is refused with
   `remote_version_mismatch`, exactly as today.
3. The client accepts only if the implementation is `typescript`, the
   wire ranges overlap (the highest common value is used), every capability the
   requested command and options need is present, and `nativeLock` is `loaded`
   when the command needs the Codex writer lock.
4. Response verification is selected by the negotiated wire version, never by
   the local package version.
5. Results gain an optional `remoteVersion` (the verified remote banner version)
   and `wire` field, for parity with Python's remote metadata.

### Retention of exact-version refusal

Until follow-ups [F2 and F3](#follow-ups) are merged **and** live POSIX and
Windows destinations with mismatched versions are recorded in VALIDATION.md,
the shipped behavior remains: any banner other than the exact local
`VERSION_LINE` is `remote_version_mismatch` and nothing is sent. Negotiation
first ships disabled and observational (it may report what it would have
accepted, but it does not change acceptance). Enabling it by default is a
separate, reviewed change with its own release note.

## Errors

All preflight errors keep today's guarantees: they occur before any message is
dispatched, report `submitted:false`, `status:"refused"`,
`retryAllowed:false`, exit code 1, and never echo SSH stderr or remote output.
Proposed codes are new; neither 0.2.1 nor current source emits them.

| Condition | 0.2.1 result | Proposed code | Operator message (text output and docs) |
| --- | --- | --- | --- |
| No `ssh` locally | `ssh_unavailable` | unchanged | Install OpenSSH on this machine; session-peer does not bundle an SSH client. |
| Remote executable not found | `remote_cli_missing` | unchanged | No session-peer at the remote path. Provision this version with the operator workflow and pass its absolute wrapper with `--remote-bin`. |
| Node missing on the destination (`env: node: No such file or directory`, `node: not found`, `'node' is not recognized`) | `remote_cli_missing` (indistinguishable) | `remote_runtime_missing` | The remote launcher could not find Node. Use the provisioned wrapper, which records an absolute Node 22.13+/24 path. |
| Destination Node outside 22.13–22.x/24.x (remote prints its own `unsupported_node_version` refusal JSON, exit 2) | `ssh_preflight_failed` | `remote_node_unsupported` (with `remoteNode` major when parseable) | The remote Node version is unsupported. Point the wrapper at Node 22.13+ or 24. |
| Destination OS not darwin/linux/win32 | `ssh_preflight_failed` | `remote_platform_unsupported` | This destination's OS is not supported by the TypeScript client. |
| Non-TypeScript banner (for example Python `session-peer 1.0.2`) | `remote_version_mismatch` | `remote_implementation_mismatch` | The remote session-peer is a different implementation. Leave it in place and provision the TypeScript client in its own directory. |
| TypeScript banner, different version, negotiation disabled or legacy remote | `remote_version_mismatch` | unchanged (add sanitized `remoteVersion`) | Install the same version on both ends, or upgrade the older side. |
| Wire ranges do not overlap | n/a | `remote_protocol_incompatible` | The two versions share no wire protocol. Upgrade the older side. |
| Required capability absent | n/a | `remote_capability_missing` (with `capability`) | The remote version cannot perform this command or option. |
| Native lock module cannot load (no prebuild for OS/arch/Node major, musl, old glibc) | Preflight passes; a Codex send later refuses `active_writer_unverified` | Preflight: `remote_native_lock_unavailable`. Local and remote `doctor`: a `nativeLock` check with `native_lock_unavailable` | No compatible native lock binary for this OS, CPU and Node. Use x64/arm64 with glibc 2.28+ and Node 22/24. |
| Wrapper's running Node differs from the install identity (realpath, major, ABI, platform, arch) | Not detected within 22.13–22.x/24.x | Remote: `install_runtime_mismatch`; client: `remote_install_runtime_mismatch` (both proposed, F6) | The remote Node changed since this install was provisioned. Provision a new install for the current Node. |

`remote_runtime_missing` and `remote_node_unsupported` reuse the existing
classifier style: a fixed pattern on a failed preflight, or parsing the remote
CLI's own refusal JSON from stdout. Neither leaks the matched text.

## Operator workflow

All steps run on the operator's machine. Each remote step is one `ssh`
invocation with `BatchMode=yes` and `StrictHostKeyChecking=yes` over trust the
operator already has; no step accepts a new host key, prompts for a password or
uses Python. Every remote file operation below runs with the recorded Node
(`identity.node`, an absolute realpath; Node is already required by the CLI) or
with a named OS primitive. The workflow never relies on `node` or `npm` being on
the SSH session's PATH. Generic `mv`,
`mv -n` and PowerShell `Move-Item` are not used, because each moves the source
*into* an existing destination directory.

### Install identity

The native lock binary is selected per platform, CPU, libc and Node ABI. The
wrapper also records an absolute Node path. Therefore the package version alone
is not the identity of an installation. Each install directory is named
`<version>-<id16>`, where `<id16>` is the first 16 hex digits of the SHA-256 of
this canonical identity (JSON with the keys in this order):

| Key | Source |
| --- | --- |
| `package`, `version` | Release being installed |
| `sha256` | SHA-256 of the verified `session-peer` tarball |
| `lockIntegrity` | SHA-512 integrity of each dependency tarball, from the release commit's `package-lock.json` |
| `platform`, `arch` | `process.platform`, `process.arch` of the recorded Node |
| `libc` | Linux only: `glibc` or `musl` (from `process.report`) |
| `nodeMajor`, `modules` | Major version and `process.versions.modules` (ABI) of the recorded Node |
| `node` | `realpath` of the recorded Node executable |

The full identity and its hash are stored in `.session-peer-owner.json`.
Installed directories are **immutable**. Any change to an identity field
creates a new directory beside the old one; nothing is edited in place. This
applies to a new release, a different tarball, a different Node path, Node
major or ABI, and a moved or upgraded Node.

**Runtime drift after activation.** An in-place Node replacement at the same
path changes the runtime without changing the directory name.

- **Current limitation (0.2.1):** nothing detects a change within the supported
  range. A same-path 22→24 change is accepted by the CLI's own
  `unsupported_node_version` check, which covers only majors outside
  22.13–22.x/24.x. The native loader then picks the binary for the new major,
  so the install keeps working while its recorded identity is stale. Only a
  change to an unsupported major (for example 26) is refused today.
- **Proposed (F6, unimplemented):** the wrapper runs a small launcher,
  `launch.mjs`, written into the install. Before importing
  `node_modules/session-peer/dist/cli.js`, it compares `realpath(process.execPath)`,
  the Node major, `process.versions.modules`, platform and arch with the
  marker's `identity`. On any difference it prints the CLI's refusal JSON with
  the **proposed** code `install_runtime_mismatch` and exits 2. The SSH client
  would map that code to the **proposed** `remote_install_runtime_mismatch`.
  The operator then provisions a new identity; nothing is repaired in place.
  Patch upgrades that keep major, ABI and realpath keep the identity.

### Layout and root trust

| Platform | Root (never on PATH) | Install directory |
| --- | --- | --- |
| POSIX | `${XDG_DATA_HOME:-$HOME/.local/share}/session-peer-ts` | `<root>/<version>-<id16>/` |
| Windows | `%LOCALAPPDATA%\session-peer-ts` | `<root>\<version>-<id16>\` |

Each install directory contains:

- `node_modules/` and the `package.json`/`package-lock.json` written by npm;
- the wrapper (`session-peer` on POSIX, `session-peer.cmd` on Windows);
- `.session-peer-manifest.json` (described below);
- `.session-peer-owner.json`. This complete example shows every field; hashes
  are abbreviated:

```json
{"manager":"session-peer-ts operator workflow","markerVersion":1,
 "runId":"<128-bit random hex, generated on the operator side>",
 "identityHash":"<64 hex>",
 "identity":{"package":"session-peer","version":"0.2.1",
  "sha256":"6bf3c99d12260ce2e9421909b27326f1663ce6945aa798bc90ca1e17da675e43",
  "lockIntegrity":{"fs-ext-extra-prebuilt":"sha512-V8yX…","nan":"sha512-GlGk…"},
  "platform":"linux","arch":"x64","libc":"glibc","nodeMajor":24,"modules":"137",
  "node":"/absolute/path/to/node"},
 "manifestSha256":"<64 hex of .session-peer-manifest.json>",
 "provenance":{"sourceCommit":"a9c42334da8f7faf83f0b9bb1fe52f1c695dfe8d",
  "registryIntegrity":"sha512-bPjriJZf…5nw0Mg==",
  "npm":{"cli":"/absolute/path/to/npm-cli.js","version":"11.x.y"}},
 "stagedAt":"<UTC ISO 8601>"}
```

`identity` determines the directory name. `runId`, `manifestSha256`,
`provenance` and `stagedAt` describe this particular install and are not part
of the identity hash.

The wrapper locates the install **relative to its own path**, so the same file
works in staging and after activation. It never embeds the final directory.
Below, `<node>` is always `identity.node`, the absolute realpath recorded in
step 2:

- POSIX: `here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 127`
  followed by `exec '<node>' "$here/node_modules/session-peer/dist/cli.js" "$@"`.
- Windows: `"<node>" "%~dp0node_modules\session-peer\dist\cli.js" %*`.

With the proposed identity check, the wrapper targets `"$here/launch.mjs"` (or
`%~dp0launch.mjs`) instead. Only the Node path is fixed, because it is part of
the identity.

`.session-peer-manifest.json` lists the SHA-256 of every regular file in the
install, except the manifest and the marker; the marker stores the manifest's
SHA-256. The `identityHash` check proves only that the marker is consistent
with the directory name. Content checks recompute the manifest. Both files are
writable by the same user, so this detects corruption, partial installs and
accidental edits. It is not a security boundary against a same-user attacker,
who could rewrite both.

Before any write, and again before activation, the root must pass trust checks.
On failure, refuse and change nothing.

- **POSIX:** check the root and each component from `$HOME` down with `lstat`.
  No component may be a symlink. Each must be owned by the SSH user, and none
  may be group- or world-writable. The root and each install directory are mode
  `0700`.
- **Windows:** the root and install directories must not be reparse points
  (symlinks or junctions). The owner must be the SSH user. The DACL may grant
  write access only to that user, `SYSTEM` and `Administrators`, which matches
  the inherited `%LOCALAPPDATA%` default. Refuse if `Everyone`, `Users` or
  `Authenticated Users` can write.

The root name differs from Python's `$HOME/.local/share/session-peer` on
purpose. The workflow never writes `$HOME/.local/bin`, a global npm prefix, a
PATH entry, a shell profile or a service.

### Steps

1. **Select and verify locally, pinned to the release commit.** Take the
   release's exact source SHA from the release record in VALIDATION.md (0.2.1:
   `a9c42334…`). Fetch `session-peer@X` with `npm pack --ignore-scripts`. Require
   all of the following, and stop on any mismatch:
   - the tarball's SHA-256 equals the recorded SHA-256;
   - its SHA-512 equals `npm view session-peer@X dist.integrity`;
   - the registry SLSA provenance names that same commit and
     `.github/workflows/publish.yml`;
   - `npm audit signatures` passes in a scratch install.

   Read the dependency versions and integrity from `package-lock.json` **at that
   commit** (`git show <sha>:package-lock.json`), not from a working checkout or
   current main. Fetch those exact dependency tarballs and require their SHA-512
   to match.
2. **Inspect the destination read-only.** Check:
   - root trust, as above;
   - the absolute Node path and its `realpath`, version, ABI, platform, arch and
     libc, which together compute the identity;
   - the npm bundled with that Node: its `npm-cli.js` realpath
     (`<node-prefix>/lib/node_modules/npm/bin/npm-cli.js` on POSIX,
     `<node-dir>\node_modules\npm\bin\npm-cli.js` on Windows) and
     `<node> <npm-cli.js> --version`, both recorded in the marker as install
     provenance. If it is absent, refuse; the workflow does not upload npm;
   - any existing `session-peer` on PATH (`command -v`/`type -a`, or
     `Get-Command session-peer -All`);
   - the state of `<root>/<version>-<id16>`.

   Record other implementations, but never modify them.
3. **Upload** the tarballs into a new `<root>/<version>-<id16>.staging-<random>`
   directory, created exclusively (`mkdir` that fails if the path exists, mode
   `0700` on POSIX, the private DACL above on Windows). Windows creation
   must fail on an existing path (for example, `CreateDirectoryW` with
   `ERROR_ALREADY_EXISTS` treated as refusal); `.NET Directory.CreateDirectory`
   alone is not exclusive. Apply the same rule to the activation lock.
   Recompute SHA-256 remotely (`sha256sum`/`shasum -a 256`, or
   `Get-FileHash -Algorithm SHA256`). Stop on mismatch.
4. **Install offline:**
   `<node> <npm-cli.js> install --prefix <staging> --offline --ignore-scripts --no-audit --no-fund <package tarball and every dependency tarball pinned by the exact release lockfile>`
   with an empty, staging-local cache. Run it with `PATH` set to
   `dirname(<node>)` followed by the system directories, so that any child
   resolving `node` gets the identity Node. `--ignore-scripts` means no package
   scripts run. Compare the `integrity` values in
   `<staging>/package-lock.json` with step 1.
5. **Write the wrapper, the manifest and the marker into staging**, in that
   order, so a marker exists only for a complete tree.
6. **Probe staging.** Run `<staging>/session-peer --version` (exact banner) and a
   native lock probe that resolves `fs-ext-extra-prebuilt` from
   `<staging>/node_modules` and takes and releases `flock`/`LockFileEx` on a file
   inside staging. Until F2 ships, this is a short script equivalent to
   `test/package-smoke.ts`; afterwards it is `<staging>/session-peer
   --capabilities` reporting `nativeLock:"loaded"`. The probe runs the new code
   only, whatever exists at the final path.
7. **Activate** according to the target state (table below), while holding the
   [activation lock](#activation-lock-and-guarantee-scope). The only
   activation operation is a directory rename within `<root>`:
   - **POSIX:** `fs.renameSync(staging, target)` from `<node>`, which is
     `rename(2)`. Run it only after `lstat(target)` returned `ENOENT`.
     `rename(2)` never nests. It fails with `ENOTEMPTY`/`EEXIST` for a non-empty
     directory and with `ENOTDIR` for a file or symlink, changing nothing.
     **It does replace an empty directory.** On GNU systems, `mv -T` has the
     same rename semantics, but it is not available on macOS and is not used.
   - **Windows:** `[System.IO.Directory]::Move(staging, target)`, which is
     documented to throw `IOException` when the target exists and never nests.
     Do not use `Move-Item`, which nests into an existing directory, or
     `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`.
8. **Verify after activation.** Check all of the following:
   - `lstat(target)` is a real directory (no symlink or reparse point) owned by
     the user;
   - the staging path no longer exists;
   - the marker's `identityHash` equals the computed identity and the name;
   - the recomputed manifest equals the one the marker references;
   - `<target>/session-peer --version` prints the exact banner;
   - the native probe passes against `<target>`.

   Then verify from the operator machine with
   `session-peer doctor --host H --remote-bin <target>/session-peer --json` and a
   `send ... --dry-run`. Never send a live message as a deployment check.
   The order is fixed: **publish the receipt, then release the lock, then
   switch callers (step 9)**.
9. **Switch callers.** Only after the receipt is published and the lock is
   released does the operator change any local `--remote-bin` configuration to
   the new target. Until then, existing callers keep using the previous
   install unchanged.

### Activation lock and guarantee scope

- **Where the run lives:** a provisioning run is an **operator-side**
  process (the operator's shell session, or the F6 helper) with a lifetime on
  the operator host. Each remote step is a separate, short-lived SSH command
  that exits. A remote PID or process start time therefore identifies no
  running owner and is never used to judge a lock.
- **Lock:** `<root>/.activate.lock` is created with `mkdir`, which fails with
  `EEXIST` if the path exists. The same remote command then writes
  `owner.json` exclusively (fails if it exists) with:
  - `runId`;
  - an opaque operator label (a random ID the operator side generates once and
    keeps locally; never a hostname or user name);
  - the creation time.

  The operator side keeps a local run journal with the same `runId`, the
  destination alias and its progress through the steps. The lock is held from
  the pre-activation `lstat` through step 8 and the receipt below, or through
  rollback.
- **Contention:** if the lock exists, refuse; never wait-and-steal.
- **Stale lock:** staleness is never decided automatically or on the
  destination. A lock is released only by:
  - the run that owns it (matching `runId` in that operator's journal); or
  - an explicit operator break-lock command, after the operator confirms on
    the owning operator host that the run has ended.

  A lock without `owner.json`, with an unreadable `owner.json`, or whose owning
  operator run cannot be confirmed is **never** judged stale. It stays until
  an operator breaks it explicitly.
- **Operator override boundary:** breaking a lock that has no confirmable
  owner requires both an explicit operator command naming the lock and a
  statement that the run has ended. The override only removes the lock. It
  never deletes or rolls back an install; that is done by the recovery below,
  under a new lock.
- **`.receipts` trust:** before any write to or delete from
  `<root>/.receipts`, `lstat` it (and the receipt file). It must pass the
  same root trust checks: a real directory, not a symlink or reparse point,
  owned by the user, POSIX mode `0700` or the Windows DACL rule. Receipt
  files must be regular files. Otherwise refuse. Nothing is ever written
  outside `<root>` through a link or junction.
- **Completion receipt:** after every step 8 check passes, the run writes
  `<root>/.receipts/<install-name>.json` exclusively. The receipt copies the
  marker's `runId` (the run that activated the install), its `identityHash`
  and its `manifestSha256` exactly, and adds the verification time. The
  operator journal records the same receipt. If a later run writes the
  receipt, that run's own ID is recorded only in its operator journal, never
  in the receipt.
- **Receipt matching:** a receipt *matches* an install only if its `runId`,
  `identityHash` and `manifestSha256` all equal the marker's and the
  recomputed manifest's values. Receipts that are corrupt (unparsable),
  mismatched (any field differs) or orphaned (no install directory with that
  name) are refused. They are never deleted blindly. They may be quarantined
  or removed only by an explicit operator cleanup that holds the activation
  lock (exclusive write), after the trust checks, and after ownership is
  confirmed through the marker or the operator journal.
- **What a missing receipt means:** verification of that install is
  insufficient. It does not prove the run never finished; the run may have
  died after step 8 but before writing the receipt.
- **Breaking a lock whose owner is confirmed ended:** the operator confirms
  that the run ended, then releases that old lock. It never recovers anything
  under the old lock. A target whose marker carries the old `runId` and has a
  matching receipt is complete. Without a matching receipt, the target is
  handled by the recovery below, which takes a fresh lock.
- **Recovering an owned target without a matching receipt:** this is an
  explicit operator action by a new run. The run first acquires a fresh
  activation lock with its own `runId`; if the lock already exists
  (`EEXIST`), it refuses. This applies whether or not a prior lock existed.
  The basis for the recovery is the target's existing marker, which must be
  valid and owned by this workflow, plus the trust checks. It is not an
  assumption that the target was absent before some step 7. The recovery
  refuses unless:
  - the target passes the trust checks;
  - its marker is valid and owned;
  - there is no matching receipt.

  The run then chooses between two outcomes:
  - **re-verify:** run all step 8 checks again, then write a receipt that
    copies the marker's `runId`, `identityHash` and `manifestSha256`. The
    recovery run's own ID goes only into its operator journal.
  - **roll back:** allowed only if the current operator journal positively
    confirms that no local caller is configured for the target. A missing
    receipt is not evidence of that. If the journal cannot confirm it, refuse
    rollback; only re-verify is permitted. A rollback renames the target to a
    `.failed-<random>` name with the no-replace operation, then deletes it.
- **What is guaranteed:**
  - concurrent runs of *this workflow* are serialized;
  - an existing non-empty directory, file or symlink is never replaced or
    nested into;
  - foreign and empty targets seen before the rename are refused;
  - Windows `Directory.Move` is natively no-replace.
- **What is not guaranteed on POSIX:** a same-user process that ignores the
  lock can create an *empty* directory at the target between `lstat` and
  `rename(2)`. That directory would be replaced silently and could not be
  detected afterwards. Other users cannot do this, because the root is `0700`
  and owned by the user, and nothing is lost except an empty directory.
  Closing this window needs `renameat2(RENAME_NOREPLACE)` (Linux) or
  `renamex_np(RENAME_EXCL)` (macOS). Node does not expose either, so it would
  require a native helper; this is out of scope.

### Activation outcome by target state

| State of `<root>/<version>-<id16>` before step 7 | Outcome |
| --- | --- |
| Absent | Rename, then step 8. On failure in step 8, roll back (below). |
| Owned by this workflow, same `identityHash`, a matching completion receipt, and step 8 checks (including the manifest) pass on the existing directory | Report "already provisioned" and reuse the existing receipt (no new receipt). Delete only this run's staging; no change. |
| Owned, same `identityHash`, but **no matching receipt** | Verification is insufficient. Refuse. The operator runs the explicit recovery (re-verify or roll back) under the lock, then reruns. |
| Receipt present but corrupt or mismatched, or a `.receipts` path failing trust checks | Refuse. Explicit, ownership-confirmed cleanup only; never a blind delete. |
| Owned, same `identityHash`, but step 8 checks fail (manifest mismatch, partial or corrupted) | Refuse with "existing install failed verification". Delete only this run's staging. The operator removes the old directory explicitly (marker-guarded, see retention) and reruns. Never repair in place. |
| Owned, but `identityHash` does not match the name | Refuse as an inconsistent marker; change nothing but this run's staging. |
| Different version, tarball or runtime identity | Cannot collide: the name differs, so it installs beside the existing directories. |
| Foreign: no marker, an unparsable marker, another `manager`, a symlink or reparse point, a file, or another owner | Refuse; never modify; delete only this run's staging. |
| Empty directory (an aborted manual attempt) | Treated as foreign. Refuse rather than let `rename(2)` replace it. |
| Leftover `*.staging-*` from an aborted run | Never a candidate target or install. Removed only by explicit cleanup, only if it is inside `<root>`, passes the trust checks and is not this run's staging. |

### Ownership rules

- Only paths under `<root>` whose `.session-peer-owner.json` names this
  workflow may be changed or removed. A directory without a valid marker is
  foreign; refuse.
- Never create, replace or delete a `session-peer` on PATH, the Python install
  directory, pipx venvs or a global npm prefix. Never use `npm --force`.
- A destination that already has a working global (a) install is left alone;
  (b) installs beside it.

### Cleanup and rollback

- **Failure before activation (steps 1–6):** remove only this run's staging
  directory. Nothing else changed.
- **Failure during or after activation (steps 7–8, same run, no receipt
  yet):** within the run that performed step 7, the target was absent before
  the rename, so the directory now at the target is exactly this run's
  staging. A later run recovering such a target relies on the owned marker
  and trust checks instead (see recovery above). Rename it back to a `.failed-<random>` name with the same no-replace
  operation, then delete it. Previous installs and caller configuration were
  never touched, because step 9 did not run.
- **Rollback after switching callers:** previous install directories are kept,
  at least the newest prior one per runtime. Rolling back means pointing
  `--remote-bin` at that directory again. While exact versions are enforced,
  the local client must be rolled back to the same version too.
- **Retention:** remove an old install only on explicit operator request, only
  if its marker is valid and owned, it passes the trust checks, and no local
  caller is configured to use it. Removal is a recursive delete of that one
  directory plus its receipt in `<root>/.receipts/`, and nothing else.

## Non-goals

- No implicit remote installation, upgrade or repair during `list`, `send` or
  `doctor`. Preflight failures stay refusals.
- No Python runtime fallback and no reuse of the Python source-streaming path.
- No host-key relaxation: no `StrictHostKeyChecking=no`/`accept-new`, no
  `known_hosts` edits, no password prompts, and no new authentication via
  control sockets.
- No overwriting another manager's `session-peer` executable or files (pipx,
  `install.sh`, a global npm prefix, Homebrew or a manual install).
- No new distribution artifact (single-file bundle or SEA), no `node-gyp` builds
  on destinations, no musl or 32-bit support.
- No changes to SSH connection handling. Multi-host commands, `--ssh-opt` and
  `--ssh-jump` are delivered separately by
  [#20](https://github.com/abruption/session-peer-ts/issues/20); provisioning
  runs per destination and adds no SSH options. Service management is out of
  scope.
- No remote update. The source `update --check` reads npm dist-tags for the
  local installation only. It does not provision or update a destination,
  and this workflow does not change that.

## Validation

### Validated locally (macOS arm64, Node 24.16.0, npm 11.15.0; 2026-10-02)

No network destination was contacted. Registry reads (`npm pack`, `npm view`)
were the only network use. Commands ran in a private 700 scratch directory.

| Check | Command (abridged) | Result |
| --- | --- | --- |
| Published artifact integrity | `npm pack session-peer@0.2.1 --ignore-scripts`; `shasum -a 256`; `npm view session-peer@0.2.1 dist.integrity` | SHA-256 `6bf3c99d…5e43` and integrity `sha512-bPjriJZf…5nw0Mg==` both equal the [0.2.1 release record](../../VALIDATION.md#public-021--2026-09-29-kst) |
| Dependency integrity | `npm pack fs-ext-extra-prebuilt@2.2.14 nan@2.29.0`; local SHA-512 | Equal to `package-lock.json` |
| Offline isolated install | `npm install --prefix <root>/<name>.staging-<pid> --offline --cache <empty> --ignore-scripts --no-audit --no-fund` with the three tarballs | Installed 3 packages; prefix lockfile integrity values equal step 1 |
| Release pin | `git show a9c42334…:package-lock.json`; registry SLSA provenance payload | Dependency integrity equals the release commit's lockfile; provenance names commit `a9c42334…` and `.github/workflows/publish.yml` |
| Install identity | Identity JSON computed with the recorded Node (darwin, arm64, Node 24, ABI 137, Node realpath) | Directory `0.2.1-<id16>`; marker holds the full identity and hash |
| Staging probe | Self-locating POSIX wrapper in `<root>/<name>.staging-<pid>`; `env -i PATH=/usr/bin:/bin <staging>/session-peer --version`; native probe resolved from staging, with **no final directory present** | Exact banner, exit 0; native lock ok. The probe exercised staging, not a final path |
| Activation | `lstat(target)` is `ENOENT`, then `fs.renameSync(staging, target)` | Renamed; the target is a real directory; staging is gone |
| Post-activation | `<target>/session-peer --version`, native probe on `<target>`, marker hash check; `doctor --host … --remote-bin <target>/session-peer` through the `ssh` stand-in | Exact banner; native ok; hash matches; `ok:true`, `diagnosticCompleted:true` |
| Second run onto the activated directory | `fs.renameSync(copy, target)` | `ENOTEMPTY`; target unchanged and not nested |
| Move semantics (macOS 27, BSD `mv`) | `mv a b` and `mv -n a b` with an existing `b/`; `fs.renameSync` onto non-empty, empty, file, symlink and absent targets | Both `mv` forms nest `a` into `b/a`. `renameSync`: `ENOTEMPTY`, **replaces empty**, `ENOTDIR`, `ENOTDIR`, ok |
| npm through the recorded Node | `env -i PATH=<dirname(node)>:/usr/bin:/bin <node> <npm-cli.js realpath> install --prefix <staging> --offline …` with an empty cache | npm 11.15.0; installed all three packages |
| Proposed identity launcher (prototype, not shipped) | Self-locating wrapper → `launch.mjs` compares the marker identity with the running Node; then the marker is edited to `nodeMajor:22`, `modules:"127"` | Matching identity: exact banner, exit 0. Edited identity: `install_runtime_mismatch` refusal JSON, exit 2 |
| Activation lock | `fs.mkdirSync(<root>/.activate.lock)` twice | First acquired; second `EEXIST` |
| Installed CLI | `list --json`, `doctor --json` with an empty HOME | `ok:true`, Claude `ok`, Codex `not_installed`; doctor `diagnosticCompleted:true`, `implementation:"typescript"` |
| Native lock | `flockSync(fd,'exnb')`/`'un'` from the prefix | Loaded the darwin-arm64 node-24 binary (ABI 137) |
| SSH preflight through a local `ssh` stand-in (drops options, runs the remote command locally) | `list --host dest.example --remote-bin <wrapper> --json` | `ok:true`, `host`/`sshHost` set |
| Same, dry-run send to an absent PID | `send ... --to 999999 --dry-run` | `no_reachable_target`, `submitted:false` (remote refusal propagated) |
| Python-like banner | remote prints `session-peer 1.0.2` | `remote_version_mismatch` |
| Missing executable | `--remote-bin` to a nonexistent path | `remote_cli_missing` |
| Node missing on remote PATH | `#!/usr/bin/env node` launcher with no Node on PATH | `remote_cli_missing`, confirming the gap behind `remote_runtime_missing` |
| Unsupported remote Node (simulated: launcher prints the CLI's `unsupported_node_version` refusal, exit 2) | as above | `ssh_preflight_failed`, confirming the gap behind `remote_node_unsupported` |
| Missing prebuild (simulated: this platform's binaries removed from a copy) | `--version`; dynamic `import('fs-ext-extra-prebuilt')` | `--version` still passes; import fails with "No prebuilt binary found for darwin-arm64". This is the gap behind `remote_native_lock_unavailable` |

The fake `ssh` exercises the client's argument construction, preflight
classification and response verification, not OpenSSH, authentication or a
real remote shell. The "no Node on PATH" results cover **only the wrapper and
launcher invocation**. In the earlier install rows, npm ran from the operator's
PATH. Only the later `npm-cli.js` row ran npm through the recorded Node with a
minimal PATH. All rows above ran on one local macOS host. **These local
stubs are not a substitute for the isolated POSIX and Windows destinations
that issue #23 requires.**

### Live POSIX destination (F5, Linux cell)

On 2026-10-02 the workflow was run by hand on a user-provided Debian 13
x86_64 host (glibc 2.41), with Node 24.21.0 and 22.23.3 and no Node on PATH.
All work was confined to a new, dedicated test directory that was removed
afterwards; the host itself is not disposable. Host egress could not be
disabled, so offline install flags were used and nothing was downloaded on
the host. The run covered steps 1–9 and selected activation-table, lock,
receipt, rollback, retention and runtime-swap states. For the states tested,
the activation, verification, native-lock and lock outcomes matched the rules
this document had **at that time** (fifth commit of the PR), with an
operator-check order deviation noted below. This includes the documented
gaps:

- the empty-directory replacement by `rename(2)`;
- an undetected same-path Node major swap.

The details and the deviations from this workflow are in
[VALIDATION.md](../../VALIDATION.md#remote-deployment-workflow-posix-cell-23-f5--2026-10-02-kst).
Rules added afterwards remain **unvalidated, on Linux too**:
- the fresh-lock recovery of an unreceipted target;
- receipts that copy the marker's `runId`;
- `.receipts` trust checks;
- corrupt, mismatched and orphan receipt handling;
- the journal-confirmed rollback condition;
- activation-table rows that were not tested (an inconsistent marker, owned
  with failing verification, a corrupt receipt).

The earlier break-lock rollback result is kept as recorded under the rule of
that date. Agreement is partial even for the rules of that time: only install
A followed the step 8 order (operator checks, then receipt, then lock
release). For installs B and S the harness wrote the receipt and released the
lock before the operator checks, and S had no dry-run. Their step 8 evidence
is therefore partial; see VALIDATION.md.

One finding applies to this document: "already provisioned" is decided only
for the name computed from the *current* runtime in step 2. An existing
directory whose recorded Node has since changed is not re-examined until the
proposed identity launcher (F6) exists.

### Existing evidence (not re-run here)

- CI `contract` (macOS and Ubuntu, Node 22/24) and `windows-native` (Windows
  x64, Node 22/24) run `npm run test:package`, which packs the tarball,
  installs it into an isolated `--prefix` with `--ignore-scripts`, runs the
  installed CLI (`.cmd` on Windows) and loads the native lock module. This is
  the per-platform basis for steps 4–6 on Linux x64 and Windows x64.
- Windows CI drives real PowerShell and the `.cmd` launcher through an isolated
  fake SSH endpoint.
- [VALIDATION.md](../../VALIDATION.md#real-tui-and-ssh-checks): a live Windows
  x64 isolated prefix under the user's Temp (Node 24.16.0) passed SSH preflight
  with an explicit `.cmd` `--remote-bin`; a macOS destination used a
  task-owned wrapper to select Node 24 instead of PATH Node 26; a Linux
  destination with Node 24.16.0 passed real SSH version negotiation. These
  were manual 0.1.x-era runs, not this workflow end to end.

### Windows destination checkpoint — 2026-10-07

A user-authorized Windows 10 x64 destination was exercised with published
0.3.1, Node 24.16.0 and PowerShell 5.1 under an administrator account, in a
new dedicated test prefix. Offline installation, self-locating wrapper,
native lock, activation and operator SSH doctor/nonexistent-target dry-run
checks passed. Operator checks preceded receipt publication and lock release.
See [the dated evidence and limits](../../VALIDATION.md#windows-ssh-destination-f5--2026-10-07-kst).
This was a private operator test harness, not a shipped deploy helper; neither
the host nor the account was disposable. It does not qualify Windows-client
`--ssh-jump`.

### Not validated

- Other Windows account/runtime/architecture combinations and other POSIX
  destinations. The historical Linux x86_64/glibc cell was run once; the
  Windows checkpoint above has its own dated scope and remaining cells.
- POSIX root trust checks, `rename(2)` and `libc` detection on anything other
  than the one Debian x86_64 glibc destination.
- Exercised once on the Linux x86_64 host only (with a test harness, not F6),
  under its dated rules: failed-activation rollback, marker- and receipt-guarded
  retention, lock contention, explicit break-lock with and without a receipt,
  an unowned lock, and the per-file manifest. Selected corresponding Windows
  fixture cases passed at the 2026-10-07 checkpoint; the result table in
  VALIDATION.md distinguishes native/local fixtures from operator SSH.
- Not exercised on Linux under the current rules: explicit recovery of an
  unreceipted target under a fresh lock, corrupt/mismatched/orphan receipt
  handling, `.receipts` trust checks and operator override for unconfirmable
  lock owners. Those Windows fixture cells passed at the dated checkpoint.
  General concurrent/adversarial race qualification remains open. The
  identity launcher was only compared logically (Linux) and prototyped
  (macOS).
- The POSIX empty-directory race window. It is documented as unguaranteed and
  was not exercised.
- Linux arm64, Windows arm64 and macOS x64 native loads; glibc below 2.28 and
  musl (expected to fail).
- Node 22 destinations under this workflow on Windows, arm64 or macOS (Linux
  x86_64 Node 22.23.3 was exercised).
- The compatibility contract and the proposed error codes: they are
  unimplemented.

Because of these gaps, issue #23's last criterion ("validate the selected
workflow with isolated POSIX and Windows destinations") is **not** met. The
POSIX (Linux x86_64) cell of F5 is recorded. **The Windows cell is unmet.**
Local stubs do not count toward either cell.

## Follow-ups

Proposed issues; none has been filed.

**F1. docs(ssh): document the operator provisioning workflow in the four guides**
- EN/KO/JA/zh-CN guides describe steps 1–9 with POSIX and PowerShell commands.
- States the ownership marker, never-on-PATH root and rollback rules.
- No code change; `node scripts/check-repository.mjs` passes.

**F2. feat(cli): add side-effect-free `--capabilities` and a native lock check**
- `--capabilities` prints the JSON above, never sends, opens no lock file and
  prints no paths; unsupported Node/platform still produce their refusal JSON.
- `doctor` (local and SSH) adds a `nativeLock` check with
  `native_lock_unavailable`.
- Tests cover loaded/missing/failed using a prefix without matching binaries,
  on POSIX and Windows CI.
- Does not change SSH acceptance.

**F3. feat(ssh): classify remote runtime, Node, platform, implementation and native failures**
- Adds `remote_runtime_missing`, `remote_node_unsupported`,
  `remote_platform_unsupported`, `remote_implementation_mismatch` and
  `remote_native_lock_unavailable`. The last comes from the second,
  message-free `--capabilities` round trip, made only after an exact banner
  match and only for commands that need the lock (Codex send).
- No stderr or remote stdout is echoed; `submitted:false`; fixed exit code 1.
- PARITY and guides list the codes; fake-SSH tests for POSIX and PowerShell.

**F4. feat(ssh): observational wire/capability negotiation behind a disabled default**
- Implements the negotiation rules; exact-version remains the acceptance rule.
- Reports `remoteVersion` and `wire` on verified results.
- Legacy (0.2.x) remotes are refused exactly as today.
- Enabling acceptance by default requires a separate PR after F5 records live
  mismatched-version evidence.

**F5. test(ssh): live isolated POSIX and Windows provisioning record**
- One POSIX and one Windows x64 destination provisioned by the workflow with
  existing host trust; recorded in VALIDATION.md with OS, arch, Node, hashes.
- Covers:
  - offline install, root trust checks, staging probe and no-replace activation;
  - every target state in the activation table, including empty and foreign
    directories;
  - post-activation verification, `doctor --host` and `send --dry-run`;
  - rollback of a failed activation and rollback to the previous directory;
  - marker-guarded cleanup;
  - a Node path or ABI change producing a new identity;
  - with F6, a same-path runtime change refused as `install_runtime_mismatch`;
  - activation-lock contention, a lock without `owner.json`, and explicit
    break-lock with and without a completion receipt.
- Confirms another manager's `session-peer` remained byte-identical.

**F6. feat(cli): `session-peer deploy --host` helper with install integrity**
- Implements steps 1–9 as an explicit command with `--dry-run` showing every
  remote action; refuses foreign directories; never runs during list/send.
- Keeps the operator-side run journal and writes the completion receipt.
- Writes the identity-checking `launch.mjs` (the proposed
  `install_runtime_mismatch` code, mapped by the client to
  `remote_install_runtime_mismatch`), the per-file manifest and the
  `mkdir` activation lock with operator-only stale-lock breaking.
- Runs npm only as `<node> <npm-cli.js>` with the identity Node first on PATH.
- Separate security review before merge.

## Review checklist

- The negotiation rules keep every released client and remote interoperable or
  refused, never silently accepted.
- No step weakens host-key checking or writes outside `<root>`.
- Activation never uses `mv`/`Move-Item`. The POSIX empty-directory replacement
  window is stated as unguaranteed against same-user processes that ignore the
  lock.
- The marker check is not presented as tamper detection; the manifest detects
  corruption, not same-user attacks.
- Install identity covers everything the native binary and wrapper depend on.
- The native coverage table matches the shipped `fs-ext-extra-prebuilt`
  version whenever that dependency changes.
- Integrity values quoted here are for 0.2.1 and change with every release;
  the workflow reads them from the release record rather than from this file.
