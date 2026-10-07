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

**Documentation and source version: 0.3.2.** Before using the version-pinned npm commands below, confirm that 0.3.2 is available in the npm registry or version badge. Before publication, use a reviewed source checkout or its locally built artifact. Builds and SSH endpoints must use the same reviewed version.

**Find and message running Claude Code and Codex sessions, locally or over SSH.**
A Node.js client that runs without Python. Package and command: `session-peer`.

## Demo

![Actual Codex to Claude Code request and reply with TypeScript session-peer 0.2.1](https://raw.githubusercontent.com/abruption/session-peer-ts/main/docs/assets/session-peer-ts-v0.2.1-roundtrip.gif)

Actual local request and explicit `ACK DEMO-READY` reply using npm 0.2.1. CLI/message excerpts are re-rendered, identifiers redacted and timing edited; this is not a screen recording. Submission alone is not an ACK.

After installation, list sessions and replace `CLAUDE_PID` with the exact PID you selected:

```sh
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract and reply.' --dry-run --json
```

`--dry-run` validates without submitting. To send, run the command once without
`--dry-run`. Ask for an explicit reply when you need acknowledgement.
**`posted` / `queued` means submitted, not consumed or ACKed.** `unknown`
(`submitted:null`), no reply or a target exit must not trigger automatic retries.
`consumptionConfirmed` is always false; verify a reply in the receiver’s TUI.

## Quick Start

Requires macOS, Linux or Windows, **Node 22.13+ within 22.x or 24.x**, and a
matching native prebuilt dependency (x64/arm64). Claude needs a live TUI inbox;
Codex needs its CLI and a verifiable writer (also `lsof`/`ps` on macOS/Linux).
SSH requires existing key/host trust and the **same TypeScript client version**
on both machines. See the guide for platform requirements and inactive queueing.

### Install

The [Python CLI](https://github.com/abruption/session-peer) uses the same command.
Check `type -a session-peer` on macOS/Linux or `Get-Command session-peer -All`
in PowerShell before installing. Choose the intended PATH entry; do not use
`--force` to overwrite another manager’s files.

```sh
npm view session-peer@0.3.2 version dist.integrity
npm install --global --ignore-scripts session-peer@0.3.2
session-peer --version
```

Expected: `session-peer 0.3.2 (typescript)`. For isolated installation, source
builds, Windows and removal, see the detailed guide below.

Optional `sp` shorthand ships with 0.3.0 and later (not 0.2.1 or earlier) and is
never enabled automatically. See [explicit activation and collisions](docs/shorthand.md).

### Update

Use npm for an npm-managed installation. Check the available tags and review
the target version, then install that exact version; this example updates an
older npm installation to 0.3.2. The CLI does not install updates;
`session-peer update --check` only reports them.

```sh
npm view session-peer dist-tags
npm install --global --ignore-scripts session-peer@0.3.2
session-peer --version
```

The companion skill is installed and updated separately; npm installation
does not install a skill. Review its pinned-source instructions in the guide.

<!-- Preserve links to the former detailed sections; their contents are in the guide. -->
<a id="cli-usability-in-020"></a>
<a id="what-it-does"></a>
<a id="unified-listing-in-020"></a>
<a id="requirements"></a>
<a id="build-from-source"></a>
<a id="existing-installations"></a>
<a id="use"></a>
<a id="another-machine-over-ssh"></a>
<a id="replies"></a>
<a id="what-success-means"></a>
<a id="development-and-verification"></a>
<a id="package-release"></a>
<a id="related-project"></a>
<a id="read-only-diagnostics-in-020"></a>
<a id="agent-skill-explicit-installation"></a>

## Docs

- [User guide](docs/guide.md) — CLI options, discovery, Codex homes, SSH, replies, installation variants and skill setup.
- [API reference (English)](docs/api.md).
- [Compatibility, migration and planned features](PARITY.md).
- [Release evidence and platform validation](VALIDATION.md).
- [Development and contributions](CONTRIBUTING.md).
- [Release process](RELEASING.md).

- [0.4.0 handoff design (jointly agreed, unimplemented)](PARITY.md#handoff-v1-design-candidate--69).

## License

Licensed under the [MIT License](LICENSE).

## Support and security

For usage questions and reproducible bugs, [open an issue](https://github.com/abruption/session-peer-ts/issues).
For vulnerabilities, use [private reporting](https://github.com/abruption/session-peer-ts/security/advisories/new)
or [support@abruption.dev](mailto:support@abruption.dev?subject=%5Bsession-peer-ts%5D%20Security).
Read [SECURITY.md](SECURITY.md) and redact credentials, messages and personal paths.
