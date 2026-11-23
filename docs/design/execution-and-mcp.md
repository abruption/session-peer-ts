# Internal execution and optional MCP

Scope: [#24](https://github.com/abruption/session-peer-ts/issues/24) and
[#26](https://github.com/abruption/session-peer-ts/issues/26).

## Execution contract

Keep a side-effect-free internal import for ordinary list, send and doctor.
Represent agent selection, local/SSH destinations and the request context
explicitly. Keep the existing discovery, writer selection/revalidation,
storage guards, SSH preflight and response validation beneath that boundary.
An ordered SSH request preserves independent per-host results and never
retries a destination. The import must not start the CLI, register process
signal handlers or execute an adapter. Registration describes the available
capabilities and grants no access.

The executable retains argv parsing, stdin, sender metadata, output
formatting and exit-code handling. Parsed host attribution is per invocation.
Single-host results stay flat, multi-host results stay ordered, and remote
update notices never reach the caller. CLI-owned subprocess signal forwarding
is enabled by the executable, not by importing the execution module. Handoff, receipts, update notices and the
existing SSH stdio envelope must preserve their current contracts. Internal
execution modules are not package-root exports. Test injection is limited to
in-process fixtures; there is no runtime plugin loading.

## Optional stdio MCP

Provide a separate opt-in Node MCP package and a repository Codex plugin
manifest with installation instructions. The MCP SDK is pinned in the
optional package; the ordinary npm client does not depend on or load it. The
MCP package requires the exact matching core npm version and invokes its
installed CLI worker through Node. There is no new public core subpath API.
The server starts only explicitly and uses stdio. Its tool surface is
`list_sessions` and `send_message`; send is annotated as non-idempotent.

Use a bounded, closed operator policy at an explicitly selected local file
path. Omit the policy flag for local Claude listing only. An explicitly
selected policy file that is missing, unreadable or malformed refuses startup.
Codex is enabled only by policy, never by an inherited home variable. A supplied policy grants list and send independently to each named
destination and allowed agent. The client supplies only the destination ID
and typed tool arguments; transports, SSH hosts and Codex homes come from
the policy. A policy enabling Codex must pin an absolute home using the
destination's path rules. Keep host approval, known_hosts and the operator's
SSH configuration intact. Installing the plugin changes no approvals.

Classify a direct target before execution. A Reply-To URI is accepted only
as the tool's target, never as outgoing reply metadata. Require the parsed
transport, the core-normalized host, the agent and the literal home to match
the policy. A Codex URI must specify its pinned home and a Claude URI has none.
Do not resolve aliases or apply case folding to the policy match. Compare destination
identity before lowering to the core operation, with no implicit self-route
selection from the URI. Deny sending unless the destination and agent both
permit it, including send dry-run. Select one destination per call. Keep
message text on the worker's private stdin. The core retains its existing
native adapter behavior, including Codex queue arguments. Suppress inherited
agent identity, automatic return routes and update notices in the worker. Do not accept native binary
paths, SSH options, recipient policy overrides, wake or handoff inputs from a
tool caller.

Keep core JSON facts in structuredContent and produce a corresponding text
view. Preserve healthy discovery rows and report partial failure. Bound request
and result sizes and concurrent work. Use one owned CLI worker per operation
through the guarded execution path, with operation timeout and cancellation.
Cancellation before launch has no submission effect. A worker launch followed
by interruption without a complete, validated outcome is unknown for an
effectful send. List and send dry-run never imply unknown submission. When
listing without an agent, query only agents allowed by policy and keep
successful rows if another eligible lookup fails. Never retry or infer that
a native queue acceptance was consumed or acknowledged. Send a cooperative cancellation request to the owned child before forcing
it to exit. POSIX CLI signal forwarding cleans its separately owned groups.
On Windows only known direct child handles are in scope. A remote process may
outlive the local connection. Report cleanup limits without suggesting that
an interrupted effect was rolled back. Keep message text and raw worker errors out of protocol
diagnostics.

## Verification before PR creation

Use fixtures and isolated package installs on Mac mini, MacBook Pro, KR Linux,
US Linux and quintet-desktop. Record OS/architecture, Node versions, commit and
archive hashes, and distinguish real stdio handshakes from fake native adapter
and SSH endpoints. Exercise authorization, refusal, partial results, interruption,
one-attempt submission, packaging and applicable existing platform contracts.
A fixture does not establish new operation support on any platform. Do not
change global installations, profiles, host policies or existing agent sessions.
