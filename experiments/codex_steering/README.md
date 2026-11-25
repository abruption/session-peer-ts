# Opt-in Codex steering experiment

This is an unreleased, local TypeScript experiment for issue #141. It is not an
installed `session-peer` command and is excluded from the npm package. Ordinary
queue delivery, runtime behavior, SSH, and the Side Session experiment remain
unchanged.

## Purpose and limits

The prototype connects to an operator-selected, private Unix-domain WebSocket
of an existing Codex app-server. It submits user text using `turn/steer` with a
full thread UUID and the operator's exact `expectedTurnId`. It does not start a
server or session. The exact advertised server version candidate is **0.159.2**,
drawn from the Python experiment; that is not a qualification of native Codex
0.159.2 for this TypeScript implementation or of newer Codex versions.

Opt-in, absolute socket/home paths, and an exact home match are required. Socket
ownership/privacy and canonical home-path checks are local guards. They do not establish atomic
owner generation or exclude same-user endpoint impersonation. Loaded target,
active status, direct-input capability, and a thread-specific feature snapshot
are inspected. These snapshots can race with state changes. The actual
`expectedTurnId` guard is applied by native `turn/steer`, not by a dry-run.

`--require-instant` requires an affirmative `instant_interrupt` snapshot.
Disabled or unknown evidence is refused rather than treated as enabled. Without
that option, unknown/disabled feature evidence does not imply instant input
handling. The sender never enables a feature or overrides approvals or target
permissions.

A metadata-only dry-run performs no `turn/steer` call and does not prove that the
expected turn matches. An `accepted` result means that the native endpoint accepted
the input; it does not mean consumption, ACK, completion, or termination of
running tools. A refusal and an uncertain post-attempt outcome are distinct.
Neither causes queue fallback, retry, or resend. The prototype never calls
queue-add, `turn/start`, `turn/interrupt`, resume, fork, or wake. It does not
answer approval requests.

## Privacy and resource boundary

Supply text through private stdin, not a secret-bearing command line. Results
and diagnostics omit message text, transcript text, and raw server errors.
Bounded incoming notifications are discarded, but may themselves contain
content. `thread/read` with `includeTurns: false` can still return a preview;
this experiment does **not** promise body-free native access. It makes no ACK
collector or receipt capability and offers no generic completion wait.

RPC/frame/input bounds and cleanup cover this experiment's owned connection and
temporary test fixtures. The transport's monotonic deadline starts after CLI
stdin has completed; waiting for interactive stdin is not covered by that deadline.
They do not stop the existing owner or undo native side
effects. Timeout/disconnect after a steering call is not proof of non-delivery
and must not trigger an automatic second submission.

## Isolated usage

Use Node 22 or 24 for the separate experiment package. Never point the example
at an existing user session without an explicit, separate test authorization.
The values below are placeholders; no native test is authorized by this README.

```sh
cd experiments/codex_steering
npm ci --ignore-scripts
npm run typecheck
npm test
printf '%s' 'Change the test review focus' | node --experimental-strip-types steer.ts \
  --experimental-steering --socket /private-test/app.sock \
  --expected-home /private-test/home \
  --to 00000000-0000-4000-8000-000000000001 \
  --expected-turn-id turn-example --message - --dry-run \
  --require-instant --timeout 10
```

The experiment has its own dependencies, typecheck, and fixture tests. Root
runtime build/package tests do not qualify it. Its CI uses fake Unix sockets on
macOS/Linux; it invokes no native agent, provider, or existing user session and
uses no account credentials.

## Qualification still required

Native queue versus steer with `instant_interrupt` ON/OFF, real-provider input
handling, code-mode behavior, current native versions, owner lifecycle,
generation/authorization, and snapshot/acceptance races remain unqualified.
SSH and Windows are not implemented by this local Unix-socket prototype. Linux
fixture CI is not a native Linux steering test. Python's historical synthetic
native observations must not be presented as TypeScript test results. See
[RESULTS.md](RESULTS.md) for the exact executed scope.

References:

- [Official App Server: steer an active turn](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn)
- [Python issue #247](https://github.com/abruption/session-peer/issues/247)
- [Python Draft PR #248](https://github.com/abruption/session-peer/pull/248), reference commit `6ebedde` (historical experimental evidence, not TS qualification)
