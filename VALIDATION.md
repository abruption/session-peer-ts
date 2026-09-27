# Validation record — 2026-09-27 KST

This is preview evidence, not an npm release or a claim of complete Python parity.
Python reference: v1.0.2, commit `47c23713d0a2a3c11ebde6186afd8c43489b8b65`.

## 0.1.0-preview.1 candidate

After #7–#10 were merged, the versioned candidate passed the local macOS
arm64 Node 22 contract suite (23 passed, two Windows-only tests skipped),
TypeScript test type-check, package/declaration smoke test, four-README
repository checks and `npm audit` (zero vulnerabilities). The package smoke
test repeated packing with the same SHA-256 and verified isolated install and
uninstall. The new candidate was not sent to a live agent and was not published
by these checks. Windows Node 22/24 and macOS/Linux Node 22/24 must also pass
on the candidate PR and exact merged `main` commit before publication.

## Automated checks

- 14 tests pass locally on macOS arm64 / Node 22.14.0.
- Real fixture SQLite DBs, Unix inbox sockets and separate C processes holding
  actual advisory locks; Python is the discovery oracle, not the implementation.
- Refused inactive/ambiguous/wrong-owner cases; one native fixture queue call;
  native nonzero after spawn and SSH response loss remain unknown with no retry.
- Package file allowlist, same-build repeat SHA-256, clean prefix installation,
  empty-PATH discovery and uninstall pass. npm audit reports 0 vulnerabilities.
- CI defines macOS/Linux × Node 22/24; see the repository Actions results for
  those runs rather than treating this local check as their substitute.

## Real TUI and SSH checks

### Native Windows candidate — 2026-09-27 KST

An isolated prefix under the Windows user's Temp directory was installed from
this branch's local tarball. The existing Python CLI was not removed or
overwritten. Node 24.16.0 and npm 11.13.0 were present. Windows native
`list` found the live Claude inbox; Codex dry-run verified the saved thread,
kernel lock, single same-user `codex.exe` opener and stable start time. Mac
mini → Windows SSH preflight used an explicit Windows platform, remote `.cmd`
path and an already authenticated OpenSSH control socket; no host-key bypass
or new login was introduced.

One message per target was submitted from this candidate through Windows SSH.
The CLI returned Claude `posted` and Codex `queued`, with
`consumptionConfirmed:false`. The user separately confirmed exact response
lines in both Windows native TUIs:

- Claude: `ACK TS-WIN4-CLAUDE-20260927-A`
- Codex: `ACK TS-WIN4-CODEX-20260927-B`

These ACKs are user-observed responses, not direct terminal-pane capture by
the test runner. No retry was made. This is one-shot evidence, not a soak or
all-architecture qualification. Windows x64 was tested; Windows arm64 and
Node 22 remain untested in this live check. Python remains installed.

Dedicated, newly created Claude/Codex test TUIs only. The user approved trusting
the two otherwise empty test folders. Agent permissions were not changed.
Each route passed discovery and no-delivery dry-run before exactly one send.
ACKs below were observed as separate **assistant response lines in the owned
live tmux panes**, not copied from submitted prompts, queues or transcript files.

| Route | Native target | Submission | Actual response |
| --- | --- | --- | --- |
| Mac mini local | Claude Code 2.1.281 | posted | `ACK TS186-LOCAL-CLAUDE-8fc721d0` |
| Mac mini local | Codex CLI 0.157.1 | queued | `ACK TS186-LOCAL-CODEX-cb042ac9` |
| Mac mini → MacBook SSH | Claude Code 2.1.281 | posted | `ACK TS186-SSH-CLAUDE-f0275ade` |
| Mac mini → MacBook SSH, structured Reply-To URI as destination | Codex CLI 0.157.1 | queued | `ACK TS186-SSH-CODEX-a771e96c` |

Local Node: 22.14.0. Remote MacBook: 24.20.0, selected by a task-owned wrapper
because its normal PATH selected unsupported Node 26. KR Linux Node 24.16.0
also passed real SSH version negotiation and empty Claude discovery. KR native
agent delivery was not tested. No service was restarted or global CLI replaced.

The CLI itself still reports `consumptionConfirmed:false`; external ACK review
does not change that contract. This is a one-shot functional test, not a soak.
Local self-SSH was denied by the existing SSH authentication configuration; no
credentials or host-key bypass were introduced. Reverse SSH was not asserted.

## Historical runtime build checked on both Macs

Compiled module SHA-256 values matched between the local build and the isolated
MacBook installation used for the SSH ACK tests:

```text
0b708f1211330ff489b6a405e0ebb71d2b3b392acdb19c216dba18e7b23016c7  cli.js
1d8c41dfc174d950e2196c64f93b324f09befa388a5b303439c390a526ffda48  discovery.js
c3187c99c46364730e46e35ef23d8f3a37e541593b2a6f9c3945dce979e7e99c  process.js
b716fed8fe6c8c04047f8485a6e3f982d6e64e5638df570b3b8c2a128f88c81e  protocol.js
dd946024a61ce8721c273d47e911494c0c8facd62facd9b791a451b90cb702bf  send.js
c441567e83c64c7d5735708936e9a42b68dd9ea0cdf0ef95538da7919d550496  writer.js
```

These hashes and real-TUI ACKs precede the public command rename to
`session-peer` (the npm package was then named `session-peer-ts`). The rename changes the
CLI version banner to `session-peer 0.1.0-preview.0 (typescript)` and the default
SSH executable to `session-peer`; it does not change native delivery logic.
Fresh package-install and SSH fixture tests cover the renamed entry point and
reject a different implementation on remote PATH before sending. The earlier
ACKs are not represented as a new live test of the renamed build.

The npm package name was subsequently changed to `session-peer` before a
successful publication; the GitHub repository remains `session-peer-ts`.
Package identity, tarball naming and publication confirmations are covered by
package/release fixtures, not claimed as new live ACK evidence.

## Not covered / not released

Windows arm64, IPv6 literals, Relay/MCP/wake, full Python
CLI parity, automatic reverse-route detection, npm registry publishing and
provenance are outside this historical evidence. Publication preparation now
removes the private flag, but actual publishing still needs separate approval
and the gates in RELEASING.md. Native dependency prebuild availability must be tested
on each architecture claimed by a future release.
