<a id="ordinary-ssh-response-validation--033-release-candidate"></a>

# Ordinary SSH response validation — 0.3.3

This describes the source correction for [#116](https://github.com/abruption/session-peer-ts/issues/116) and [#115](https://github.com/abruption/session-peer-ts/issues/115). It is not a claim that the immutable npm 0.3.2 artifact contains it. Both endpoints still require the same TypeScript client version. The Python 1.0.2 development oracle and the separate 0.4.0 handoff proposals are unchanged.

## Bounded protocol

- Request stdout is collected as raw bytes, with a **1,048,576-byte** limit including whitespace and line endings. An overflow invalidates the entire response; a retained valid prefix is not accepted.
- UTF-8 decoding is fatal, including sequences split across process chunks. An actual UTF-8 U+FFFD character is legal; invalid bytes are not repaired into one.
- The frame contains exactly one top-level JSON object, surrounded only by JSON space, tab, CR and LF. BOM, banners, trailing material, multiple frames and non-JSON constants are rejected.
- A pre-parse scanner rejects duplicate decoded keys in every object, including escaped-equivalent keys. Containers have a maximum depth of **64**, and values plus object keys have a combined budget of **65,536 nodes**. The scanner's recursion and allocations are bounded by these limits and the byte limit; it does not evaluate input. Legacy JSON number spellings are not replaced with the separate handoff proposal's integer grammar.
- Diagnostic stderr is independent of protocol stdout: at most **4,096 raw bytes** are retained and replacement decoded. Excess is drained, and raw diagnostics are never printed in the result. Malformed stderr alone does not invalidate a complete stdout response.
- Version preflight and other non-protocol tool consumers keep their text interfaces and existing timeouts. The SSH request deadline remains 90 seconds. POSIX cleanup kills only the owned process group; escaped descendants and Windows descendant cleanup retain their documented limits.

## Native facts and transport completion

The same parser and command/request validator apply to normal and abnormal transport completion. Send responses must match the requested agent, Codex UUID or Claude PID/casefolded name, dry-run/status/submitted facts, and `consumptionConfirmed:false`. Claude `name:null`, an omitted target agent, and an omitted Codex queue ID remain supported. A present queue ID must match the native bounded identifier grammar. Returned Codex home and selected-home metadata must agree, the selected/explicit mode must match the request, and an inactive opt-in reason requires the caller's opt-in. If a canonical returned home differs from the explicit input, the receiver must echo its parsed `requestedCodexHome`; the caller validates and removes this wire-only scalar. Legacy same-path results do not need the scalar. Home aliases and canonicalization belong to the destination, not the caller's local filesystem. This check does not authenticate the remote native process or prove an independent mapping of a remote path alias.

| Transport / frame | Local result |
| --- | --- |
| Verified ordinary exit 0/1/2 | Preserve native fields and the existing exit/`ok` consistency contract. |
| Complete independently validated response followed by SSH 255, shutdown or collection timeout | Preserve native `ok`, `status`, `submitted`, target and optional queue ID; return **exit 1** and an additive `sshTransport` diagnostic. |
| Missing, partial, malformed, polluted, overflowed or mismatched response after a possible send effect | `outcome_unknown`, `submitted:null`, `retryAllowed:false`, exit 1. |
| Unverified dry-run or non-send response | `remote_response_unverified`, exit 1; no native submission is performed by those commands. |

`sshTransport` is client-owned and contains `status` (`failed` or `timed_out`), `reason` (`ssh_exit_nonzero`, `ssh_timeout` or `ssh_process_error`) and the observed `exitCode` (integer or null). A peer cannot supply this client diagnosis. It is omitted for ordinary verified exits. An abnormal transport send adds `retryAllowed:false` and never resubmits, falls back or fails over.

Consequently **native `ok:true` can coexist with local exit 1**. Consumers must inspect native submission facts and the transport diagnostic rather than assume a nonzero exit means nothing was submitted. Text output keeps the native result and adds the transport warning. Definite remote refusal facts are retained when a complete verified response establishes them. Missing native fields are not synthesized as false or null.

Ordered fanout preserves each destination's result and has exit 1 if any destination has a nonzero local exit. `posted`/`queued` and `submitted:true` remain submission evidence only: no injection, receipt ACK, task completion or retry authority is established.

## Validation boundaries

The fixtures use synthetic response objects and owned fake processes/SSH endpoints, not live agent delivery. They cover complete versus partial output, exit 0/255, actual process collection timeout, invalid diagnostic bytes, byte/depth/node limits, escaped duplicate keys, nullable Claude names, request mismatches, ordered mixed-host results and one request per host. A test-only import shortens the production request timer in the POSIX CLI fixture; production has no new timeout setting. The portable parser/process tests run in the Windows suite; the native Windows fixture exercises a complete Codex response followed by SSH 255 through encoded PowerShell. CI results and exact commits are recorded in the PR, not inferred from fixture names.

At dependency [PR #127](https://github.com/abruption/session-peer-ts/pull/127) head `8c882fa`, 13 portable parser/process fixtures passed. POSIX fake SSH exercised complete/partial frames with exits 0/255 and a real shortened collection timeout, plus ordered fanout and one attempt per host. The encoded PowerShell Windows fixture retained a complete `queued` native stand-in result (`ok:true`, `submitted:true`) after SSH 255 and invalid diagnostic stderr, while returning local exit 1 with `sshTransport`; it made exactly one queue stand-in call. [CI run 37863835806](https://github.com/abruption/session-peer-ts/actions/runs/37863835806) passed 12/12 checks including macOS/Ubuntu Node 22/24 and Windows native Node 22/24; [CodeQL run 37863832399](https://github.com/abruption/session-peer-ts/actions/runs/37863832399) also passed. This qualifies that dependency head's bounded fixtures, not a future merged main release SHA. It adds no actual agent ACK, real SSH-host, delivery/crash or fleet verification. Final combined candidate checks and exact artifact evidence belong in [VALIDATION.md](../../VALIDATION.md).
