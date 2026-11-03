# Local authenticated receipt bootstrap — design proposal

This proposal scopes [#132](https://github.com/abruption/session-peer-ts/issues/132)
for a separately reviewed implementation. It does not enable a collector, change
the handoff wire format or qualify a platform. Its source baseline is
[`920317896fa838e2edc2d48f0f23ea126801a72b`](https://github.com/abruption/session-peer-ts/tree/920317896fa838e2edc2d48f0f23ea126801a72b).
The retained [handoff v1 contract](../../test/fixtures/handoff-v1.md) remains the
normative reference for existing v1 results. This document must not be used to
interpret an existing v1 acknowledgement differently.

## Owner decisions and review status

The owner selected these design directions:

- Include Claude delegated receipts alongside the original-generation Codex
  baseline in the common bootstrap design; do not silently defer Codex bootstrap.
- Delegate receipt-only authority through explicitly opted-in private recipient
  effect input; the recipient explicitly invokes an installed receipt handler.
  The recipient's native queue/history may retain that authority.
- Use a manually started and stopped local collector. Do not register a login
  service, start it implicitly or restart it automatically.

The owner also selected a **separately versioned delegated-receipt context for
Claude**. Such a receipt proves an explicit response from a holder of delegated
authority, not native generation, consumption or completion. Existing v1
semantics stay unchanged. The exact new schema and compatibility matrix below
remain technical proposals for review; this decision does not enable support.

## Evidence and the Claude gap

At the pinned baseline, `src/send.ts` deliberately supplies `generation:null`
for Claude. `claudeBindingIdentity()` records private registry/socket metadata
continuity; its comment explicitly denies proof of native incarnation. Process
reachability, a registry PID, a socket path and its metadata do not independently
establish an immutable original Claude native generation or model identity.

Handoff v1 requires non-null original target generation before capability mint
or required ACK support. `HandoffLedger.mintCapability()` and
`acceptReceipt()` enforce that boundary. `validateHandoff()` also requires a
non-null target generation for an acknowledged result. A collector nonce,
producer registration ID or the existing private continuity fingerprint must
not be substituted into that field merely to pass these guards. Additional
profile provenance from [#165](https://github.com/abruption/session-peer-ts/issues/165)
does not by itself supply native incarnation evidence.

The existing ledger has bounded receipt validation and operator confirmation,
but no qualified bootstrap. Its `clockId` belongs to each ledger instance.
Independent short-lived CLI invocations cannot preserve the minting instance's
monotonic authority simply by reopening the same files. The existing internal
`privateConsumerValidated` and `compatibleProducerValidated` booleans are not
proof of a deployed compatible collector or producer.

## Meaning of a receipt

A receipt is an explicit correlated acknowledgement by a holder of the
delegated receipt capability. It is not evidence of task completion, acceptance
of responsibility, model identity, a particular model reading the body, native
injection or a successful future action. Submission, observed injection and
receipt ACK remain independently reported facts.

The receiver chooses whether to invoke the receipt handler. No turn-completion
hook, transcript polling, ordinary reply, queue deletion, message prefix or
socket-write result becomes a receipt. The collector cannot send a prompt,
wake a session, answer an approval, grant model permissions or execute an
arbitrary command. The handler accepts only its versioned receipt protocol;
it is not a generic command dispatcher or a Reply-To extension.

## Common local bootstrap

The implementation proposal is local to a supported POSIX owner account.
Windows private ledger support and original-sender reverse SSH remain outside
this first bootstrap. Exact OS/native versions and admitted agent routes must
be declared and qualified before any support claim; a POSIX file mode alone
does not qualify every POSIX platform.

1. The operator explicitly initializes the retained ledger and starts the
   collector with an explicitly selected private state location. Startup checks
   ownership, file types, descriptor/path continuity, lock ownership, history
   health and resource capacity. Missing or unsafe existing history is a
   refusal; startup does not recreate it or adopt a stale endpoint.
2. The operator installs/selects the compatible receipt-only handler separately.
   The sender validates the collector protocol, private endpoint, owner and
   live collector context, plus the producer's compatible protocol. Files being
   executable or returning a version string alone do not authenticate a live
   endpoint or establish that a recipient will voluntarily use the handler.
3. A sender explicitly requests receipt delegation. Before one native effect,
   resolve and bind the original target/provenance and reserve durable intent,
   receipt and terminal-record capacity. Validate the chosen receipt semantics
   and bootstrap. Unsupported required ACK refuses before effect; unsupported
   best-effort requests retain ordinary submission facts without minting an
   unused capability.
4. The collector owns capability mint and its private monotonic lifecycle. The
   sender receives authority only through a bounded private IPC response or
   inherited private descriptor, distinct from public result output, and places
   it only into the authorized recipient effect input. The sender performs its
   original one native submission; the collector performs no native send.
5. The recipient explicitly supplies the delegated receipt to the installed
   handler through bounded private input. The handler contacts only the
   selected owner-private local endpoint. It does not discover a replacement
   collector, redirect a receipt or fall back to a generic send.
6. The collector verifies the original binding, capability and receipt identity,
   then serializes durable receipt acceptance with relevant wait transitions.
   Public results contain only the validated receipt classification and existing
   permitted context, never the capability or a raw recipient body.

Enrollment, connection and version checks are evidence about the cooperating
receipt route. They are not native process/model authentication. An endpoint
owned by the same account cannot exclude a malicious same-user actor with
copied authority; neither a private path nor a random registration ID changes
that threat boundary.

## Collector lifecycle and state ownership

The collector is independent of the sender conversation but manually managed.
The proposed common collector admits exactly two local schema/scope pairs:
Codex receipt-v1 / handoff-v1 / `original_generation`, and Claude receipt-v2 /
handoff-v2 / `delegated_context`. This is a design inclusion, not qualification
of either route on every POSIX platform. Codex keeps its actual non-null
original generation and unchanged public/private v1 schemas. Existing unmanaged
v1 ledgers and their CLI behavior remain separate and unchanged.

Explicit initialization creates a fresh, separately selected managed-state
location with a new managed-storage format version 2. Each new managed record has an immutable closed-schema scope tag
`original_generation` or `delegated_context` and its matching receipt/handoff
versions. It must not import or upgrade an existing v1 ledger, reuse its epoch
or adopt its intents. The managed
`ledger.json` uses `version:2`, so an existing v1 reader must fail rather than
interpret it as a v1 ledger; compatibility fixtures must prove this. A durable
closed-schema management marker records managed format version, ledger epoch
and endpoint selector, not a bearer capability. Marker presence is not itself
proof of a live owner. Missing/malformed marker or inconsistent store identity
refuses; no implicit initialization, migration or marker repair is allowed.

One collector instance owns that managed store's mutation lock and one live
monotonic clock context. All managed prepare, effect fencing, submission facts,
receipt mint/accept/revoke and wait transitions pass through its serialized
state machine. Existing CLI owner status/wait/confirm paths must recognize the
managed storage kind and refuse direct file access with
`receipt_managed_context_required`; they cannot construct a second ledger writer.
New context-aware CLI paths use only the finite operations below. A legacy v1
CLI that does not recognize the marker still encounters the incompatible store
version and cannot write. Offline status on managed state is unsupported in this
proposal. Collector outage does not authorize opening or repairing the files.

The collector owns wait deadlines and exposes short nonblocking wait-open,
wait-status and wait-stop operations, not an IPC request held for the full wait.
Repeated status checks never extend a deadline or make another native submission.
One state transition classifies receipt arrival and every relevant wait under
the same clock and durable transaction. No other CLI directly classifies a
managed wait using its own clock or overwrites the collector's history.

There is one active owner for a managed ledger/endpoint context. A second start
refuses rather than stealing a lock, deleting an endpoint, killing a process or
assuming a stale PID is safe. Explicit stop closes only the collector's own
connections/resources. It does not terminate a recipient or resend messages.
Stopping and crash recovery must retain effect fences and independently known
submission/receipt facts. Cleanup results must distinguish confirmed cleanup
from an unknown resource state.

After restart, restore fully committed receipt classifications and immutable
terminal waits. If monotonic continuity for unused authority or pending wait
ordering cannot be proven, do not extend TTL, recreate raw secrets or invent
an arrival time/late flag. Expire unspent authority and preserve unknown or
unsupported evidence as required by the retained contract. A new collector
context cannot revive an attempted intent's receipt authority or permit a new
native submission. No automatic reconnect or receipt retry is authorized by a
timeout after possible acceptance.

## Fast receipt before submission outcome

The sender can finish its native write before its CLI returns positive native
submission facts. For example, Claude `postSocket()` retains a drain window of
up to two seconds at the pinned baseline. A recipient can invoke its handler in
that interval. Rejecting this first receipt solely because the sender has not
yet made its `submission` IPC call would lose a legitimate acknowledgement;
the handler must not compensate by automatically resending.

The candidate therefore reserves **one authenticated pending-receipt slot per
intent before effect**, within the existing receipt/terminal capacity reservation.
Only an intent whose original `fence` is already durably committed can use it.
Receipt before that fence, wrong scope/binding/token, expired or revoked
authority, incompatible collector context and a restored/quarantined history
refuse without creating the slot. The slot is not an acknowledged result.

After full authentication, if native outcome is still unrecorded, atomically
retain only `{receiptId, receiptSchemaVersion, receiptScope, receiptContextId,
arrivalClockContextId, arrivalMonotonic, arrivalUtcMs}` bound to the intent's
existing epoch/binding/capability hash. For Codex the context ID is null and
existing original generation is verified from receipt-v1 before admission.
Do not persist the raw receipt string or capability. The response has fixed
status `awaiting_submission`, the non-secret IDs and no public ACK promotion.
There is no unbounded receipt queue: another authenticated request with the
same receipt ID returns the unchanged pending classification; a different ID
for that occupied slot refuses `receipt_candidate_conflict`. Every duplicate
still proves the original token in constant time. Neither duplicate changes
arrival diagnostics, extends TTL nor overwrites the first candidate.

A subsequent positive `submission` transition may commit receipt eligibility
and ACK atomically with wait classification only if the original live authority,
TTL, revocation, scope/binding and clock ordering still validate. Authentication
of the earlier slot is retained private evidence, not a bypass for expired or
otherwise lost authority. The collector uses its **current eligibility-commit
instant** for `receivedAtUtcMs` and deadline/late classification. Stored arrival
time is private diagnostic evidence only: a receipt arriving before cutoff but
becoming eligible after cutoff is late, and any originating timed-out/stopped
wait stays terminal. No backdating or rewriting a timeout to satisfied occurs.

`submission:"unknown"` or `"refused"` never enables ACK, even with an authentic
pending receipt, and the receipt does not establish native positive submission
facts. The slot becomes ineligible diagnostic evidence, bounded by the retained
intent's lifetime; no later result update or replay can turn that finalized
outcome into submitted. Already recorded positive submission uses the normal
single-step authenticate/commit path. One committed receipt ID remains final;
a same-ID duplicate is authenticated read-only retrieval and a conflicting ID
refuses under existing first-receipt rules. The new pending slot does not change
that public v1 ACK schema or spend/revive an expired capability.

Crash/restart before eligibility commit does not promote the pending slot: lost
clock/authority continuity expires it for new ACK acceptance. A committed ACK
restores its original assurance/classification/terminal-wait facts. Missing IPC
responses remain ambiguous; users may inspect owner status, and the receiver
may explicitly present the same receipt again for bounded authenticated pending
or committed retrieval, without any native resubmission or automatic retry.

## Capability, privacy and bounded processing

Preserve v1's 32-byte cryptographically random capability, canonical base64url
encoding, SHA-256 hash-only sender/collector persistence and constant-time
authentication, including same-receipt retrieval. Preserve its 24-hour TTL,
revocation/quarantine behavior, first valid receipt semantics and authenticated
read-only duplicate exception. Raw capability loss is not recoverable through
IDs, journal contents or a new epoch. UTC is diagnostic, not monotonic authority.

The no-secret boundary covers argv, environment, URI, public JSON, diagnostics,
errors and sender/collector raw persistence. It deliberately does not cover the
authorized recipient's native queue/history. A same-user reader may obtain
receipt-only authority from those stores. Revocation/TTL limit new acceptance;
they do not erase recipient history. Logs and test failures must not reflect
invalid frames or secret-bearing input. The observer never reads transcripts.

Preserve the existing private receipt frame limit of 4,096 raw UTF-8 bytes,
strict JSON/closed-key validation, retained-intent/journal quotas, reserved
terminal storage, per-intent wait limits and immutable wait deadlines. The new
bootstrap envelope needs separately frozen byte/depth/count limits; no larger
outer wrapper may silently exempt a secret receipt from its original bound.

### Proposed IPC version, operations and admission

These are chosen **candidate limits for technical review**, not properties of
existing releases. Bootstrap IPC is a separate namespace `ipcVersion:1`; it is
not receipt `schemaVersion` and not ledger storage `version`. Each connection
carries exactly one strict UTF-8 JSON request and one response, each LF-terminated.
No frame multiplexing, request batching, subscriptions, nested command strings,
file paths for the collector to open or generic method names are accepted.

The closed request envelope is `{ipcVersion, requestId, collectorContextId, op,
body}`. IDs are canonical UUID-v4; `collectorContextId` is null only for `hello`,
and otherwise must equal the live context from the explicitly selected endpoint.
A fresh request ID correlates one IPC exchange; it grants no retry/dedup promise.
The closed response envelope is `{ipcVersion, requestId, collectorContextId, ok,
body}` on success or `{ipcVersion, requestId, collectorContextId, ok, error}` on
failure. `error` is a fixed public code, never reflected input. No fields are
silently stripped. Unknown versions, keys, operations and invalid types refuse.

| Operation | Exact body keys and responsibility |
| --- | --- |
| `hello` | `{}`; returns exact supported receipt-schema/scope pairs, protocol/managed-store versions, endpoint-owner evidence and live collector context. Performs no registration, mint or state promotion. |
| `prepare` | `{binding, receiptSchemaVersion, receiptScope, producerEvidence}`; validates the closed tagged binding and admitted exact schema/scope pair, reserves intent/receipt/candidate capacity and creates original epoch/correlation IDs plus a Claude-only delegated context ID. Binding contains only private identity/provenance and a protected payload digest, never a raw body, command or executable. |
| `mint` | `{ledgerEpoch, correlationId, receiptContextId, producerProtocolVersion}`; only for the current, validated, unattempted prepared binding; requires the original validated installed-handler evidence and matching producer protocol, then creates one capability and returns it only through this private response. An unsupported producer cannot be made valid by this integer alone. |
| `fence` | `{ledgerEpoch, correlationId, receiptContextId, binding}`; compares original metadata and commits the one-attempt fence before the sender invokes native transport. No collector send occurs. |
| `submission` | `{ledgerEpoch, correlationId, receiptContextId, status}`; status is exactly `submitted`, `refused` or `unknown`, admitted only for the original fenced attempt. It records caller-observed native outcome, not an injection/ACK claim. Conflicting or repeated outcome updates refuse; restart cannot authorize the old sender to fill missing outcome facts. |
| `status` | `{ledgerEpoch, correlationId}`; owner-checked public snapshot only; no capability/binding/digest is returned. |
| `wait-open` | `{ledgerEpoch, correlationId, goal, timeoutSeconds}`; goal is `acknowledged`; timeout is integer 1..60, with the existing five-second cleanup reserve and insufficient-budget refusal. Creates one immutable-deadline operation. |
| `wait-status` | `{ledgerEpoch, correlationId, operationId}`; returns that operation, never silently the latest wait. Classifies elapsed deadlines through the collector state machine. |
| `wait-stop` | `{ledgerEpoch, correlationId, operationId}`; stops only a pending wait, preserving submission/ACK facts and other waits. |
| `revoke` | `{ledgerEpoch, correlationId}`; explicitly revokes that context; no authority regeneration. |
| `receipt` | `{receipt}`; validates a raw receipt frame represented as one UTF-8 string with its own 4,096-byte bound, then authenticates and atomically commits an eligible ACK, records the one pre-outcome pending candidate, or retrieves the identical pending/committed receipt. |

All bodies have closed key sets. The proposed private `binding` is a closed
tagged union:

- Codex: `{agent:"codex",destination,target,home,writerIdentity,generation,
  payloadDigest}`. `target` is the original Codex UUID, `home` the selected
  canonical absolute home, and non-null `generation`/`writerIdentity` the actual
  original qualified live writer identity supplied by the existing Codex route.
  A collector ID or current replacement writer cannot fill those values.
- Claude: `{agent:"claude",destination,target,registryDirectory,
  registryRecordPath,registryIdentity,socketPath,routeIdentity,generation:null,
  payloadDigest}`. `target` is the original decimal PID string. Registry paths
  preserve selected profile provenance; identity values are lowercase 64-hex
  private continuity digests, not native generations.

`payloadDigest` is the sender's lowercase 64-hex digest of the original **user
payload**, computed before adding the correlation or capability envelope. It is
used to prevent changing that prepared payload, not to identify the decorated
native input or authenticate code. Immediately before the one native effect,
the sender recomputes the original user-payload digest and checks equality with
the prepared binding, in addition to the final original-route revalidation and
collector fence. A mismatch refuses before effect; no replacement binding or
second prepared intent is created implicitly. The envelope is constructed only
from that retained original payload and the already bound original metadata /
private capability; a current recipient or new collector cannot replace them.
The collector never receives, opens or hashes a user body on the caller's behalf.

Persist the digest only in the retained epoch/intent-bound AES-256-GCM scheme,
with the existing private ledger key, AAD binding and corruption/size limits,
never in public results or raw journal text. A new managed store needs its own
explicitly initialized key and epoch; no existing v1 key/history is adopted.
This is distinct from the capability's hash-only authority. Paths are at most 4,096 UTF-8 bytes, destination at most 512 bytes,
and target/generation/identity values retain the existing 256-byte bound where
applicable. Controls, invalid Unicode, missing/extra keys and wrong-agent fields
refuse. The sender revalidates the original native route; the collector binds
this metadata without opening arbitrary paths or treating it as instructions.
A provenance snapshot is not native lifetime proof.

The exact admitted tuples are `(agent:"codex",receiptSchemaVersion:1,
receiptScope:"original_generation")` and `(agent:"claude",receiptSchemaVersion:2,
receiptScope:"delegated_context")`. The collector records the resulting public
handoff version (1/2 respectively) with each intent. For `mint`, `fence` and
`submission`, `receiptContextId` is **null for Codex** and the original canonical
UUID for Claude. Null never replaces Codex's original generation: that value
stays in the private binding and receipt-v1 `targetGeneration`. Claude's context
must not appear in a receipt-v1 frame. All later operations select the immutable
record by original epoch/correlation, then enforce its scope; they cannot
retag records or mix schema/provenance fields between the two branches.

The installed-handler proposal uses a sender-invoked, explicitly selected
receipt-only binary and private inherited pipe for a bounded challenge/response
before effect. The sender checks its approved installed artifact identity,
owner/private installation policy and exact producer protocol, then requires an
echo of a fresh handshake nonce and exact supported receipt-schema/scope pair.
The sender passes a closed private `producerEvidence` with fields
`{protocolVersion,artifactSha256,challengeId,receiptSchemaVersion,receiptScope}`
in `prepare` as listed in the table; the collector retains its
binding to this prepared context. The nonce is canonical UUID-v4, the artifact
digest lowercase 64-hex, and the protocol/version/scope must match the admitted
pair. This is a same-owner installed-component compatibility check, not remote
attestation or hostile-same-user code authentication. An artifact digest or a
reflected nonce alone is insufficient. Neither collector nor receipt-request
input can choose an executable; the helper is not started automatically by the
collector. The exact OS artifact/owner inspection mechanisms and handler's
closed challenge response require independent review and fixtures before
implementation acceptance. There is no `exec`, `send`, `repair`, `replace`,
`import`, `recover`, `retry`, `confirm` or arbitrary-file operation. Manual start
and stop are local owner lifecycle actions, not extra remote IPC methods. No
receiver-supplied host/path can redirect the collector's original binding.

| Resource | Proposed bound |
| --- | --- |
| Live connections / in-flight requests | 16 total, one request per connection; no application waiting queue. Excess connections close without state mutation. |
| Request / response | 16,384 / 16,384 raw UTF-8 bytes, including LF; a raw receipt string remains at most 4,096 bytes before envelope encoding. |
| JSON structure | Depth 16; 1,024 total keys plus values per envelope; duplicate decoded keys rejected before object construction. |
| Read / response / total exchange | At most 2,000 ms for request read, 2,000 ms for response collection/write and 5,000 ms total from connect/accept; each is capped by the remaining total. No deadline extension per chunk. |
| Serialized state admission | One transition at a time; if busy, fixed `receipt_collector_busy` before state mutation, without internally queued transitions. |
| Active managed wait operations | 128 per collector, additionally capped at the retained 64 waits per intent; settled/stopped waits consume retained history, not a live polling slot. |
| Retained intent / journal / detail / authority | Existing 10,000 intents, 32 MiB journal, 30-day detail and 24-hour authority bounds; capacity reserved before effect, no eviction to regain effect authority. |

No automatic retry follows busy, timeout or disconnected acceptance. A human
may request status and, where protocol permits, explicitly present the identical
receipt again for authenticated read-only retrieval. Connection/request IDs do
not turn arbitrary operations into idempotent retries. IPC time bounds do not
promise a deadline for a kernel-blocked filesystem operation: expiry can close
admission/transport while a durable commit remains uncertain. A client must
retain unknown rather than infer no effect from a missing response. Cleanup
reserves do not authorize terminating native recipient processes.

## Claude delegated context — selected direction, proposed schema

Define a new contract revision that explicitly represents an original
delegated-receipt context independently of `targetGeneration`. Claude native
generation stays unknown/null unless independently qualified. Bind a fresh
receipt context to the original resolved route, profile provenance, target,
intent and collector authority before effect. Freeze that original context;
do not rebind it using a newly discovered session after restart or ambiguity.

The new context proves only the correlation of delegated authority with that
original send, not native incarnation, injection, model identity or exclusivity
of the intended recipient's possession. Existing `token_possession` wording
may remain suitable, but its exact result placement and validation require
review. Do not relabel such a receipt `operator_confirmed`.

This requires an explicitly versioned wire/result validation decision. The exact
version number, fields, tagged scope, matching rules and compatibility matrix
are proposals to freeze in a subsequent contract review, not new protocol
constants defined here. Existing v1 acknowledged results continue to require
non-null original generation. A v1 recipient or validator must not silently
accept a new context as a v1 generation or a malformed optional extension.

### Proposed wire and result separation

For technical review, use `schemaVersion:2` as a proposed wire revision for the
Claude delegated-context path. This number is not implemented or frozen by the
current TypeScript release. Do not change the meaning of `schemaVersion:1` or
make its parser permissive. The common collector handles Codex generation-bound
receipts through unchanged receipt-v1/handoff-v1 schemas and Claude receipts
through the separately validated new revision. Neither path translates into
the other or derives native generation from a delegated context.

A proposed complete private Claude receipt frame is:

```json
{
  "schemaVersion": 2,
  "kind": "receipt",
  "receiptScope": "delegated_context",
  "ledgerEpoch": "11111111-1111-4111-8111-111111111111",
  "correlationId": "22222222-2222-4222-8222-222222222222",
  "receiptContextId": "44444444-4444-4444-8444-444444444444",
  "receiptId": "33333333-3333-4333-8333-333333333333",
  "capability": "<PRIVATE_INPUT_ONLY>"
}
```

The capability placeholder is not valid wire input. All IDs use the retained
canonical UUID-v4 syntax. The new frame has an exact closed key set, the same
strict UTF-8/JSON rules and the 4,096-byte raw receipt bound. It deliberately
has no `targetGeneration`: the private ledger binds the context to the original
Claude agent/target, destination, registry/profile provenance and route-continuity
evidence. A receiver cannot supply a new target or update that binding through
the receipt frame. Generate one unpredictable non-secret context ID per intent,
independent of both the secret capability and the collector's live context ID.
The context ID alone grants no query, receipt or replacement authority.

### Exact proposed handoff-v2 delta

Relative to `validateHandoff()` and the closed v1 `Handoff` key set, this candidate
changes only the following predicates for the admitted Claude delegated scope:

1. `handoff.schemaVersion` is exactly 2. Add one required closed object
   `receiptContext:{kind:"delegated_context",id:<canonical UUID-v4>}`. All other
   required/optional keys, enums, integer grammar and 8,192-byte handoff bound
   remain as v1 unless explicitly changed below. Collector metadata binds this
   scope to Claude; a Codex result cannot claim it by changing a tag.
2. `targetGeneration` must be null, never a fabricated nonce. The private
   binding must carry the original delegated context/provenance rather than
   allowing a receipt to replace native target identity.
3. An acknowledged ACK requires `assurance:"token_possession"`, positive original
   `submission.status:"submitted"`, `state:"acknowledged"`, safe integer collector
   time and boolean `late`. Its non-null original native-generation predicate
   is replaced **only in this v2 scope** by the required original delegated
   context. `operator_confirmed` is not admitted in v2's first proposal.
4. Remove v1's null-generation rejection only for `ack.status` pending or
   acknowledged and `wait.for:"acknowledged"` pending or satisfied. All such
   states must have the original valid receipt context; wait identity/deadline,
   terminal-state, satisfied-ACK and reason rules remain unchanged.
5. For this first Claude scope, observation is only `not_requested` or
   `unsupported`, with `injectionObserved:false` and no `clientUserMessageId` or
   `turn`. `state:"delivered"` is forbidden. A delivered wait is only unsupported
   or failed under existing reason/budget rules; it cannot be pending/satisfied.
6. `keep_waiting` substitutes a valid original receipt context for v1's non-null
   generation guard only for a pending acknowledged wait with pending ACK and
   the existing submitted/unknown submission-state requirement. Every other
   next-action and state/submission consistency predicate remains unchanged.

A complete representative public handoff-v2 object under those proposed rules is:

```json
{
  "schemaVersion": 2,
  "correlationId": "22222222-2222-4222-8222-222222222222",
  "ledgerEpoch": "11111111-1111-4111-8111-111111111111",
  "state": "acknowledged",
  "submission": {"status": "submitted"},
  "observation": {"status": "not_requested", "injectionObserved": false},
  "ack": {
    "status": "acknowledged",
    "assurance": "token_possession",
    "receivedAtUtcMs": 0,
    "late": false
  },
  "wait": {"for": "none", "status": "not_requested"},
  "targetGeneration": null,
  "receiptContext": {
    "kind": "delegated_context",
    "id": "44444444-4444-4444-8444-444444444444"
  },
  "decisionOwner": "sender_operator",
  "retry": {"allowed": false, "reason": "receiver_dedup_unavailable"},
  "nextActions": ["reconcile"]
}
```

The timestamp represents a safe-integer collector diagnostic in an example,
not a real receipt result. A separately reviewed v2 validator must enforce the
complete delta; an existing v1 validator must reject this object.

### Version namespaces and public CLI envelope

The existing generic CLI result envelope's top-level `schemaVersion:1` is a
**different namespace** from nested `handoff.schemaVersion`. This proposal keeps
that generic outer envelope unchanged and carries the explicit new nested v2
object in `handoff`. For example, a proposed owner `handoff status` result has
outer keys `{schemaVersion:1,host,command:"handoff",ok:true,handoff:<the complete
v2 object above>}`. This is not a v1 handoff disguised as success. The outer
`ok` reports operation success, never independent ACK evidence.

A consumer must understand and validate nested handoff revision 2 plus the
original request/scope before promoting an ACK. A v1-only consumer may retain
independently validated native submission facts, but must mark the new optional
handoff evidence unsupported/unverified and cannot strip `receiptContext`,
replace nested version 2 with 1 or synthesize a native generation. Its existing
strict v1 validation remains unchanged. Because this first receipt path is local,
no v2 SSH request wrapper or remote acceptance rule is introduced.

Receipt `schemaVersion:2`, handoff `schemaVersion:2`, managed storage `version:2`
and local bootstrap `ipcVersion:1` are distinct version namespaces. Compatibility
requires the exact admitted combination; equality of a number across namespaces
never establishes compatibility.

Receipt acceptance cannot set `observation.injectionObserved:true` or
`consumptionConfirmed:true`. An acknowledged current state remains conditional
on retained positive submission facts; it does not turn an unknown native
submission into submitted. The collector assigns receipt time and late status
through serialized ordering; the example timestamp is not a producer claim.

The proposed bootstrap negotiation advertises exact schema and receipt-scope
pairs through owner-private IPC. A sender requiring this Claude path must
establish the exact pair before effect; an old handler/collector, unknown
version, unsupported scope or unavailable endpoint refuses required ACK before
submission. Best-effort requests may use the already selected ordinary send
path with ACK unsupported, but must not mint/delegate a token for a receipt path
that failed negotiation. After possible effect, version mismatch, disconnect or
ambiguous acceptance is never permission to send again or downgrade the
original intent into a new v1 request.

Do not add a v1 `confirm` compatibility shortcut for this result. Whether a
future v2 manual confirmation is useful and how it is represented are separate
technical decisions; existing v1 confirmation and its generation/ordering
requirements remain unchanged. Unknown new fields/versions must not be
interpreted as a generic success or silently removed to obtain a valid v1 frame.

## Implementation and compatibility review gates

Before runtime work is accepted:

- Review and freeze the selected Claude direction's exact new-schema boundaries.
  Specify unknown versus unsupported versus invalid input, assurance,
  public fields and old/new client behavior. Preserve native facts on rejection.
- Specify private bootstrap ownership/lifetime checks and installed-handler
  compatibility evidence. No CLI boolean or environment variable alone can
  declare producer/consumer validation complete.
- Specify who owns prepare/effect fences, receipt mint, wait clocks and commits,
  and how existing owner operations coexist without unsynchronized writers.
- Specify original target/provenance validation immediately before effect,
  collector restart behavior, ambiguous response handling and resource cleanup.
- Update the shared protocol/fixtures through explicit review if v1 is extended;
  do not silently mutate the retained common contract or Python behavior.

Planned deterministic fixtures must cover wrong epoch/correlation/target/context,
missing/null/substituted generation, wrong token/receipt ID, duplicate and late
receipt, receipt/timeout races, fast receipt during native drain before positive outcome,
pending-candidate same/different-ID duplicates, pending receipt with unknown or
refused submission, cutoff between arrival and eligibility, pre-eligibility
expiry/revocation/restart, collector/producer version mismatch,
endpoint/owner replacement, profile/socket changes, stale enrollment, restart,
crash before/after commit, corrupt/restored/full history and admission limits.
Assert secret non-reflection and zero native submissions for receipt, status,
wait, confirmation and collector lifecycle operations. Distinguish an identical
already committed receipt from accepting a new receipt after expiry.

New-schema tests must demonstrate old-client rejection without state promotion,
preservation of v1 native-generation rules and no reinterpretation of historical
results. Fake IPC/clock tests, OS endpoint ownership fixtures and actual native
receipt qualification are separate evidence categories. Any live-session/model
test needs its own explicit plan and authorization. The independent privacy
investigation [#73](https://github.com/abruption/session-peer-ts/issues/73) is not
a prerequisite and cannot enable transcript-derived ACK in this design.

No implementation, platform qualification, live receipt, delivery/ACK result,
merge, release, installation or operational change is claimed by this proposal.
