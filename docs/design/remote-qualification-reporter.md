# Repository-only static qualification reporter

Status: implementation proposal for [#158](https://github.com/abruption/session-peer-ts/issues/158).
The owner requested this limited code extension on 2026-10-21 after reviewing
[the checklist](remote-qualification-checklist.md). It supersedes only the
checklist-only deferral of a reporter; it does not revive #155 or adopt F1–F6.

## Purpose and invocation

From a repository checkout with the existing supported Node runtime:

```sh
node scripts/remote-qualification.mjs < assessment.json
node scripts/remote-qualification.mjs --help
```

The script uses Node built-ins and requires no build. It is not installed by
npm, exported by the runtime SDK or integrated into `session-peer` commands.
These review documents and the script are not added to the npm archive.
Its source is [scripts/remote-qualification.mjs](../../scripts/remote-qualification.mjs).

It records only declared context, selected local package JSON name/version
fields and optional selected-file SHA-256 measurements/comparisons. Metadata
copied from a remote host is still just a local file: the reporter does not
verify its remote origin or attribution to an installed/running program.

## Input

One complete UTF-8 JSON document is read from stdin. For example, after
replacing paths and labels with the operator's explicit selections:

```json
{
  "context": {
    "installation": "/selected/installation",
    "manager": "npm",
    "destination": "operator-selected label",
    "account": "operator-selected account"
  },
  "packageJson": "/selected/installation/node_modules/session-peer/package.json",
  "expectedVersion": "0.5.0",
  "files": []
}
```

- Top-level keys are exactly `context`, `packageJson`, `expectedVersion` and
  optional `files`. Unknown keys and invalid shapes are rejected before file reads.
- Context requires nonempty `installation` (at most 2,048 characters) and
  `manager` (128); optional `destination` and `account` are limited to 256 each.
  These are operator declarations, not authenticated ownership or host identity.
- `packageJson` is a nonempty path string (2,048 characters maximum).
  `expectedVersion` is nonempty text of at most 128 characters. Comparison is
  exact text; this is not SemVer-range, implementation or runtime compatibility.
- `files` has at most 16 entries, each with `path` (same length bound) and an
  optional `baseline`. No globbing, PATH discovery or recursive inventory occurs.
- A usable baseline has only `sha256` (64 hexadecimal digits), `source` (nonempty,
  at most 512 characters) and `observedAt` (nonempty, at most 128). Source/time
  labels are recorded as unverified operator attestation, not authenticated
  history or clock validation. The comparison proves no interval-wide preservation.
- No baseline means the comparison is `not_checked`; malformed/incomplete
  baseline evidence makes that comparison `unknown`. Unknown object keys are
  input errors. Invalid evidence does not promote null hashes or old pass results.
- JSON grammar is parsed by `JSON.parse`; duplicate decoded object keys,
  including escaped spellings, are rejected. Metadata with duplicate keys also
  yields unknown field observations, even when duplicates are in ignored fields.

Input is limited to 64 KiB of raw UTF-8, plus at most one byte to detect overflow.
Invalid input, oversized input or invalid UTF-8 emits a fixed generic error and
exit 2, without echoing input, filesystem exception details or stack traces.

## Report and states

Valid input emits one JSON report and exits 0 even if checks fail or are unknown.
**Exit 0 means processed, never ready, qualified or authorized.** The report's
`reportVersion: 1` identifies this repository-only format, not the runtime wire
schema or a stable SDK. There is no aggregate pass, qualification token or action.

The report has scope `local_static_assessment`, `assessmentOnly: true`, supplied
context labelled `operator_attestation`, per-predicate `checks` and `completedAt`.
Each check has an id, predicate, `state`, evidence kind, source, recording time
`observedAt` and bounded relevant values/reason. Times are the reporting machine's
clock when predicates are recorded; they are not atomic observation instants,
trusted chronology or a reusable freshness window.

- `selection` passes only the predicate that installation/manager were declared.
- `package.name` compares the selected JSON's parsed name with `session-peer`;
  `package.version` compares its parsed version text with `expectedVersion`.
  Missing/non-string fields, invalid JSON/UTF-8 or unavailable evidence are unknown.
  Only these fields are exposed; other metadata contents are not printed.
- Each selected file has a digest observation and a separate baseline comparison.
  A usable current digest and baseline can pass/fail the comparison; absent,
  unusable or conflicting observations remain unknown/unsupported as appropriate.
  Matching digests do not authenticate code, establish ownership/current use,
  bind a remote installation or prove preservation between measurements.
- Runtime execution, diagnostics, native qualification, ownership and caller use
  remain `not_checked`, even when every static comparison passes.

The checklist's predicate-local states apply. An unsupported inspection method
is not a platform compatibility result. One failed/unknown entry does not discard
healthy sibling results. Reports contain selected paths/context and belong in
operator-controlled notes; do not provide credentials as context or metadata.

## File reader and effect limits

The initial reader supports local POSIX paths only. Windows or unavailable safe
open flags reports `unsupported`; this does not add Windows/native qualification.
Relative paths, final symlinks, directories, FIFOs and devices are unsupported.
The program does not follow a discovered tool or execute a selected file.
Parent directory symlinks are not excluded and no canonical ownership is claimed.

A selected regular file is opened read-only with `O_NOFOLLOW | O_NONBLOCK`.
Descriptor type/identity and observable path/descriptor size/timestamps are checked
before and after reading. Each file has a 1 MiB raw-byte limit plus one overflow
byte; chunks are at most 64 KiB. Closing every owned descriptor is attempted in `finally`, including on
read/error paths; a close error makes the observation unknown, without claiming
that cleanup was confirmed. Growth, replacement, read/close errors and observable
instability cannot produce a verified measurement. Inherited stdin is not an
owned descriptor and is not explicitly closed by the reader.

These are byte bounds, not a kernel-I/O deadline, atomic snapshot, protection
against an undetectable same-user rewrite or code authentication. The program
intentionally writes only stdout; it creates no state/cache/journal files.
Ordinary OS read effects, such as access-time changes, are not promised absent.
It executes no discovered program, diagnostic, subprocess, SSH or registry request.
Installation, activation, caller switching, deletion, rollback, retention, receipt
cleanup, lock breaking, retries and recovery authority remain outside the tool.

## Verification and review boundary

Isolated tests cover per-predicate states, invalid/duplicate inputs, metadata
limits, baseline uncertainty, special/path cases, observable file races, read and
allocation bounds, descriptor cleanup, safe imports and CLI error/nonexecution
behavior. Mock POSIX evidence is separate from native platform qualification.
There are no live-host or agent tests in this implementation request.

The expanded contract and implementation undergo fresh noninteractive Opus 5.5
review before PR handoff. Human merge review is required; no release, publication,
installation-manager change or closure of the original #23 criteria is implied.
