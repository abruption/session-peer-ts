# API reference

This reference describes source/package version **0.5.0**. Check registry availability and review the selected release before installation. Dated release evidence is recorded in [VALIDATION.md](../VALIDATION.md); before publication use a reviewed source artifact.

[Back to README](../README.md) · [User guide](guide.md)

The package exposes a small ESM API with TypeScript declarations. Install it
locally with `npm install --ignore-scripts session-peer@0.5.0` before importing it.
Importing the package does not execute the CLI or submit a message.

```js
import { VERSION, VERSION_LINE, reply, envelope } from 'session-peer';

console.log(VERSION);      // 0.5.0
console.log(VERSION_LINE); // session-peer 0.5.0 (typescript)
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


The ordinary SSH response correction is documented separately as the [0.3.3 ordinary SSH response correction](design/ordinary-ssh-responses.md); its internal parser is not a package-root export.

<a id="unreleased-opt-in-handoff-cli--040-work"></a>

## Opt-in handoff CLI — 0.4.0

0.4.0 includes an explicit private POSIX sender ledger. Default sends retain
their native status, optional fields and exit behavior. The frozen design is tracked in #69;
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

Keep `ledger.key` with the private ledger: the journal stores an authenticated
encrypted message-binding digest, using that separate mode-0600 key. The raw
digest is not stored in the journal. Missing, changed or untrusted keys and old
plaintext journals fail closed; commands do not regenerate a key or migrate
history automatically. This does not protect against a same-user reader who
can obtain both files. Lost history never authorizes resubmission.

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
receipt collectors remain unsupported. `ack --receipt -` and `handoff confirm
--receipt -` consume at most 4096 raw UTF-8 bytes from private stdin; no receipt
secret is accepted in argv/URI/environment. Receipt ACK means receipt only, not
ownership, completed work or permission to act. Operator confirmation is
explicitly labeled and must match retained original context. No arbitrary
message/transcript scan manufactures ACK. Ordinary generated Reply-To stays v1.


<a id="unreleased-destination-side-ssh-handoff"></a>

### Destination-side SSH handoff

POSIX opt-in `send --host HOST` performs an exact-version preflight and a
no-effect preparation before one destination-side send. Both ends must contain
the same reviewed 0.5.0 implementation. This workflow was introduced in
0.4.0; a 0.3.x banner does not establish the capability. Initialize the destination's private ledger explicitly; no command
auto-installs a handler or initializes missing history. The origin does not
create a local receipt collector. Reconcile with `handoff status`/`wait` on the
destination that owns the retained intent, without another send.

Preparation fixes the canonical destination target/home, original generation,
epoch and correlation ID. A supplied ID must already be unattempted/prepared
there. Fanout uses a distinct ID per destination, is limited to 32 destinations,
and rejects one caller-supplied ID for multiple hosts. An incomplete preparation
refuses before effect. After a possible effect, partial/malformed/oversized
responses remain unknown and are never replayed. Complete request-matched native
facts survive SSH 255/timeout; malformed optional handoff cannot create ACK or
erase separately valid submission facts. Ordinary opt-out discards unsolicited
handoff/query/warning fields.

The origin retains its original monotonic deadline. Each private request carries
only remaining duration, repeated in a private numeric argv selector. The
destination establishes its input timeout and owned-process cleanup watchdog
before reading the frame, requires the two durations to match, and charges
normal Node bootstrap/frame-read time to the same budget. An indefinitely blocked
static import before handler startup is outside this in-process watchdog; the
origin still has its own hard transport deadline. Transit delay is
not measurable across independent monotonic clocks: this is not a synchronized
cross-host cutoff guarantee. The source deadline is never renewed, and 5 seconds
of cleanup reserve remain inside each per-destination budget. Fake-SSH fixtures
exercise the actual destination handler and a recording socket, including the
watchdog's group cleanup; they do not constitute an actual network SSH or remote
native-agent qualification.

Each fanout destination starts its own total budget; sequential fanout can take
up to the sum of those budgets (at most 32 × 60 seconds), rather than one shared
invocation deadline. No setup, preparation or wait renews a destination's
deadline. Transport loss can return unknown before a delayed destination effect
has finished; it is not evidence of non-delivery and never authorizes a retry.

Original-sender ACK collector/bootstrap and Windows SSH handoff remain
unsupported. Required acknowledged wait refuses before submission; best-effort
request-ack reports unsupported. Destination-native observation retains the
same exact Codex version/platform/home/generation gates as local observation.


<a id="unreleased-bounded-app-server-mechanics--040-work"></a>

## Bounded app-server mechanics — 0.4.0

`dist/app-server.js` is an internal opt-in module, not a new public package
export or a change to ordinary CLI submission. `nativeQueueOnce` requires an
absolute executable, exact home/thread/original generation, bounded owner
verifier and durable `beforeEffect` callback. Exact Codex 0.160.1 and 0.162.1
queue mechanics were tested on macOS arm64 in network-denied synthetic homes;
other platform or version tuples fail before an effect. There is no minor-range
or latest-version inference. The caller owns proof of original
writer/home and any resources used by its verifier.

Only initialize, initialized and one thread/queue/add are used. Queue receipt
returns IDs only. Body-returning observation APIs, transcript reading, resume,
wake and new model turns are not implemented. The native process is an owned
queue transport, not an inferred existing session owner. Possible write marks
outcome uncertain even when the subsequent response is malformed. No automatic
fallback follows a possible effect. Fixture-only metadata ports are not native
observation qualification. See [source evidence](../PARITY.md#unreleased-bounded-app-server-foundation--71).

The 0.162.1 qualification uses source `092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`
and generated schema hashes, with all 84 native notifications opted out before
the effect (0.160.1 retains its exact 83-method list). A saved synthetic thread
remained unloaded before and after one queue request; its own echoed input and
queue/thread/client IDs were checked. A separate native API fixture verified
owned SQLite descriptor binding and durable-guard refusal with zero queue rows.
Neither fixture proves a live writer's generation, actual delivery, receipt ACK
or a body-free native observer. Linux and Windows native mechanics remain
unqualified. The initial qualification harness had echo-shape and temporary-home
mapping failures; each subsequent probe used a distinct home/thread/client ID,
and no attempted submission was replayed. Details are retained in the
`test/fixtures/app-server-schema-evidence.json` source fixture.


The queue-only SDK pins both environment and CLI SQLite home, then verifies
opened state/queue DB paths on its OWN native app-server PID before authorizing
the effect. Config precedes the environment and exact managed requirements can
supersede the CLI in the qualified versions, so initialize's home echo alone is insufficient.
Missing/mismatched descriptor proof refuses without queue/fallback. Direct
native binaries are qualified; launcher wrappers without this PID/storage proof
remain unsupported. Native bootstrap may create state/cache files according to
managed policy before binding refusal; zero queue is the guarantee, not zero
bootstrap filesystem activity. Observers still open only read-only warm stores.


<a id="unreleased-local-delivery-observation--72"></a>

## Local delivery observation — #72

A narrower qualified source path combines #71 queue mechanics with a warm
Codex 0.160.1 or 0.162.1 metadata store on macOS arm64. `--observe-delivery` checks once
(best effort); `--wait-for delivered` polls within the original remaining
budget. The native client ID is the reserved correlation ID. A positive native
receipt remains `status: queued`, `submitted: true`, `consumptionConfirmed:
false` even when the explicit wait fails. The separate handoff describes the
requested evidence goal. After any possible RPC write, no legacy fallback or
second submission occurs.

Selection is by the exact host platform/architecture and native version.
The 0.5.0 source records a Linux arm64 Codex 0.162.1 candidate (pinned musl
executable, procfs storage binding, `/proc/locks` writer-owner check) but does
not activate it. Linux and any other unlisted platform/version have no
profile, so required delivery refuses before effect and best-effort uses the
ordinary queue.

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
are never returned to JavaScript. SQLite internally evaluates body-bearing
`item_json` cells to project metadata; this is not a guarantee that message-body
bytes are never accessed inside the SQLite engine. Only an already-warm original store is used;
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

`handoff wait --correlation-id UUID --wait-for delivered` starts a new operation
over a retained, positively submitted intent. Native observation is read-only;
the operation persists private wait/terminal records. It preserves the original
home/thread/writer generation and private, exact version/source/platform
qualification. Missing qualification is unsupported; today's PATH or matching
schema never reconstructs it. A new wait has its own cutoff and never rewrites
an old terminal wait. Other processes' pending waits remain untouched and each
owner classifies its own deadline. No native executable, queue request, transcript
API or model turn is started by status/wait. Ledger contention is retried only
inside the existing total budget. A persistence failure returns the last verified
operation and known submission facts with `handoff_persistence_failed`; it does
not claim that a terminal record was written.

Qualification boundaries: the combined native CLI route is macOS arm64/Codex
0.160.1 or 0.162.1, each with an exact pinned source profile. Dedicated new
0.162.1 TUI sessions demonstrated one native queue attempt and exact client-ID
injection in the original thread/home using bounded metadata projections.
Synthetic tests separately cover independent-process resume, timeout, SIGINT,
concurrent waits, owner change and persistence failure. Neither completion nor
visible response establishes machine ACK. A separate voluntary matching reply
was explicitly recorded with `handoff confirm --receipt -` before any wait:
`operator_confirmed`, retained ACK and a later acknowledged wait succeeded.
A prior test that started a delivered wait before confirmation correctly refused
unprovable cross-process ordering; its intent was not resubmitted. This is manual
operator attestation, not automatic token-possession receipt collection. Dedicated Claude Code 2.1.296 tests
confirmed correlated socket delivery and best-effort ACK remaining unsupported;
a required unsupported ACK refused before posting.

The qualified native app-server queue/observation route is unsupported on
Linux/Windows. Ordinary Codex queue submission and explicit operator confirmation
on supported POSIX ledgers are separate capabilities, demonstrated by the KR/US
checks in VALIDATION. Windows private ledger and automated receipt
collector/bootstrap remain unsupported. Other native versions are not
inferred from a minor range. The original-sender SSH collector is not provided.
These source checks do not by themselves establish package publication or
a completed milestone. Exact evidence and limits are in [VALIDATION](../VALIDATION.md).





<a id="040-candidate-scope"></a>

## 0.4.0 implementation scope

The 0.5.0 source preserves this supported handoff scope; its Linux and Windows
groundwork does not enable additional platform or ACK support.

The 0.4.0 implementation includes the qualified macOS arm64 observer and explicit
`operator_confirmed` receipts on supported POSIX ledgers. Other platforms do not
inherit that qualification. Linux observation [#130](https://github.com/abruption/session-peer-ts/issues/130),
Windows observation/private storage [#131](https://github.com/abruption/session-peer-ts/issues/131) and
voluntary receipt producer/authenticated collector bootstrap [#132](https://github.com/abruption/session-peer-ts/issues/132)
are future extensions. An automatic collector would still require an explicit
receiver receipt; it must never infer ACK from messages or turn completion.
Unsupported required goals refuse before effect; no post-attempt fallback or resend.
