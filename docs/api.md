# API reference

[Back to README](../README.md) · [User guide](guide.md)

The package exposes a small ESM API with TypeScript declarations. Install it
locally with `npm install --ignore-scripts session-peer@0.3.1` before importing it.
Importing the package does not execute the CLI or submit a message.

```js
import { VERSION, VERSION_LINE, reply, envelope } from 'session-peer';

console.log(VERSION);      // 0.3.1
console.log(VERSION_LINE); // session-peer 0.3.1 (typescript)
const address = 'session-peer://v1/reply?agent=claude&session=12345&transport=local';
console.log(reply(address)); // { to: '12345' }
console.log(envelope('Please review and reply.', true, address));
```

| Export | Contract |
| --- | --- |
| `VERSION` | Package version string. |
| `VERSION_LINE` | CLI version string including the TypeScript marker. |
| `reply(uri)` | Parse a supported Reply-To URI into `{ to, host?, home? }`; throw on invalid input. Parsing does not discover or authorize the destination. |
| `envelope(text, noFrom, address?, sender?)` | Trim leading/trailing newlines, optionally prepend sender metadata, and append a validated Reply-To URI. `sender` is `{ agent, id }` or `null` for none; when omitted, a valid Codex UUID from the environment is used. Returns text only. |

The example uses a placeholder PID and performs no delivery. These helpers do
not verify a live writer, establish a return route, or confirm consumption.
Only the exports above form the public package API; internal `dist` modules are
not package subpath exports. Use the [CLI guide](guide.md#use) for sending and
[CONTRIBUTING.md](../CONTRIBUTING.md) for development and test setup.


## Unreleased opt-in handoff CLI — 0.4.0 work

This source adds an explicit private POSIX sender ledger. The published 0.3.1
package does not contain these commands. Default sends retain their native
status, optional fields and exit behavior. The frozen design is tracked in #69;
this implementation does not change its exact vendored document or fixture.

Initialize once with `session-peer handoff init --json`. The optional absolute
`SESSION_PEER_HANDOFF_HOME` selects its directory; commands never auto-initialize
missing or corrupt history. `handoff prepare --to TARGET --message-file FILE
--json` reserves a fresh correlation ID without sending. Use a private regular
UTF-8 file (POSIX mode 0600), then pass the retained ID with
`send --correlation-id UUID --message-file FILE --json`. A changed destination,
original generation or message binding is rejected. An unknown supplied ID is
not accepted. Ordinary opted-in sends can automatically prepare a fresh ID.

Only opted-in results add `handoff`. The inert correlation metadata in a native
message is not authentication. Durable intent is fenced before native effect;
crash recovery, `handoff status`, `handoff wait`, `ack` and `handoff confirm`
never submit again. Retention/quota limits preserve epoch-bound fences rather
than evicting old authority. Clone/rollback protection assumes intact, retained,
non-rolled-back history. Native local/SSH retry permission remains false.

`--request-ack`, `--observe-delivery` and `--wait-for delivered|acknowledged`
select separate evidence goals. A required unsupported goal refuses before
submission; best-effort mode may submit while reporting the channel unsupported.
`--wait-timeout` is an ASCII integer 1..60 (default 30); its total operation
budget includes a 5-second cleanup reserve. Budgets 1..5 are syntactically valid
but cannot authorize an effect. A successful submission is preserved when
subsequent ledger/evidence operations fail. Best-effort sends keep their native
success exit and may add `handoffWarning: persistence_failed`; required waits
fail without erasing independently established native submission facts. No body, transcript, raw native
stderr, payload digest or receipt secret appears in handoff JSON.

Automated receipt producer/bootstrap, Windows ledger and original-sender SSH
handoff coordination remain unsupported. `ack --receipt -` and `handoff confirm
--receipt -` consume at most 4096 raw UTF-8 bytes from private stdin; no receipt
secret is accepted in argv/URI/environment. Receipt ACK means receipt only, not
ownership, completed work or permission to act. Operator confirmation is
explicitly labeled and must match retained original context. No arbitrary
message/transcript scan manufactures ACK. Ordinary generated Reply-To stays v1.


## Unreleased bounded app-server mechanics — 0.4.0 work

`dist/app-server.js` is an internal opt-in module, not a new public package
export or a change to ordinary CLI submission. `nativeQueueOnce` requires an
absolute executable, exact home/thread/original generation, bounded owner
verifier and durable `beforeEffect` callback. Exact Codex 0.160.1/macOS arm64
queue mechanics were tested in a network-denied synthetic home; other platform
or version tuples fail before an effect. The caller owns proof of original
writer/home and any resources used by its verifier.

Only initialize, initialized and one thread/queue/add are used. Queue receipt
returns IDs only. Body-returning observation APIs, transcript reading, resume,
wake and new model turns are not implemented. The native process is an owned
queue transport, not an inferred existing session owner. Possible write marks
outcome uncertain even when the subsequent response is malformed. No automatic
fallback follows a possible effect. Fixture-only metadata ports are not native
observation qualification. See [source evidence](../PARITY.md#unreleased-bounded-app-server-foundation--71).


## Unreleased local delivery observation — #72

A narrower qualified source path combines #71 queue mechanics with a warm
Codex 0.160.1 metadata store on macOS arm64. `--observe-delivery` checks once
(best effort); `--wait-for delivered` polls within the original remaining
budget. The native client ID is the reserved correlation ID. A positive native
receipt remains `status: queued`, `submitted: true`, `consumptionConfirmed:
false` even when the explicit wait fails. The separate handoff describes the
requested evidence goal. After any possible RPC write, no legacy fallback or
second submission occurs.

Before an opted-in native effect, original saved thread/home/writer evidence,
default SQLite storage, exact native version and a warm supported metadata
schema are checked. Required unsupported observation refuses before effect.
Best-effort chooses legacy queue only if qualification failed before any native
app-server attempt. The sender fences its intent durably before queue/add.
A fresh queue transport is not treated as the owner of another process's thread.

The observer never reads rollouts or calls history, queue/list, thread/resume,
turn/start or full item/turn notification APIs. SQLite itself projects only
`clientId`, thread/turn IDs and an allowlisted status. Recent row keys are bounded
to 256; cells over 256 KiB are excluded before JSON extraction. Temporary SQLite
storage is memory-only and materializes keys/bounded scalars. Body/error columns
are never returned to JavaScript. Only an already-warm original store is used;
there is no migration, warm-up/backfill, new model turn or wake. Existing WAL/SHM
must already be trusted; SQLite read-only readers can participate in transient
SHM read locks. DB/WAL bytes and sidecar creation remain unchanged in fixtures.

File/schema/inode checks and queries run in owned deadline-bounded children.
An inherited-group owner verifier compares the ORIGINAL selected fingerprint
before/after each read. Wrong client ID, schema drift, owner restart or an
ambiguous row cannot advance delivery. Unknown native turn statuses remain
unknown. Queue deletion or turn completion alone never creates injection/ACK.
Each wait keeps its own operation ID/cutoff and immutable terminal record;
concurrent later waits do not replace the originating send's result. An explicit
SIGINT-stopped wait returns exit 130 when its matching stopped record is proven,
retaining independently known submission facts and never retracting/resending.

Qualification boundaries: combined CLI route is macOS arm64/Codex 0.160.1;
portable SQL/owner fixtures run on POSIX. End-to-end tests use synthetic writer,
SSH/process metadata and native RPC fixtures, not real user TUIs. Actual live
injection/ACK and Linux/Windows native queue integration are not qualified.
Windows ledger, sender-ledger SSH coordination, automated receipt bootstrap,
restart-resumed observation, full setup/filesystem cancellation and other native
versions remain open. Required ACK remains unsupported. The 0.4.0 milestone is
not complete and no package/version publication is implied.
