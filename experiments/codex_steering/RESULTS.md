# TypeScript Codex steering experiment results

## Status

Unreleased experiment. Local checks below ran on 2026-10-12 KST on macOS
arm64, Node 24.16.0/npm 11.15.0. Current-head CI results are recorded in the
Draft PR rather than assumed from these local results. No native Codex, real provider, or existing user session was invoked
for this initial record. There is no merge, release, or general-support claim.

## Evidence categories

| Check | Current evidence |
| --- | --- |
| Separate package typecheck and fake-socket tests | PASS: strict TypeScript; 24 tests passed, 0 failed/skipped |
| macOS/Linux Node 22/24 fixture CI | Pending execution/report |
| Root npm artifact exclusion | PASS: npm pack dry-run lists 57 files, none under experiments/ |
| Actual native Codex 0.159.2 | Not run; exact-version candidate only |
| Native queue/steer × instant_interrupt ON/OFF | Not run |
| Real provider or model | Not run |
| Existing user session or live message | Not run |
| Owner-generation, restart, same-user impersonation resistance | Not established |
| Native Linux/Windows or SSH steering | Not qualified |
| Consumption, ACK, completion, running-tool cancellation | Not established |

Tests using fake sockets can establish request construction, local guards,
bounded parsing, refusal/uncertainty classification, and owned-connection cleanup.
They cannot establish native acceptance, actual active-turn handling, or
instant-input latency. Metadata-only dry-run is not an expected-turn proof.

## Remaining gates

1. Independent current-head review and completed fixture/platform CI.
2. Explicit authorization and isolated native tests before any actual steering.
3. Native ON/OFF ordering and real-provider/code-mode behavior; no latency SLA.
4. Safe owner endpoint discovery/generation, authorization, and lifecycle.
5. Submission races, interruption/disconnect after acceptance, and concurrency.
6. Any SSH/Windows design, stable installed CLI contract, packaging, and release
   require separate implementation and approval.

The Python experiment at reference commit `6ebedde` reports historical native
observations for its own harness. Those results are not copied into the TS
counts or treated as proof that this implementation works against a native
server. No automatic fallback/resubmission is permitted after an attempted
effect, including when observation is incomplete.

## Local commands and checks

- In the experiment package: `npm ci --ignore-scripts`, `npm run typecheck`,
  `npm test`, `npm audit` (zero vulnerabilities; ws 8.22.0).
- In the root package: `npm run build`, `node scripts/check-repository.mjs`,
  `npm pack --ignore-scripts --dry-run --json`; inspected all packaged paths.
- Fake tests cover private socket guards, exact request/turn matching, dry-run,
  active/direct/home/feature guards, malformed wire/UTF-8/binary/server requests,
  disconnect and post-attempt timeout, concurrent/repeated attempt fencing,
  cursor cycles, event flood, frame limits, and fixture cleanup.
- Read-only internal adapter review found no blocker for the Draft scope.
  This is not native qualification or an external model review.

The root installed runtime, lockfile, version, parity pins, and existing
workflows are unchanged. A separate fake-only experiment workflow was added.
The input byte limit includes UTF-8 bytes; interactive stdin has no elapsed-time
bound. The transport's total deadline starts after stdin completes.
