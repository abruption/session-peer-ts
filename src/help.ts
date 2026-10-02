import { VERSION } from './protocol.js';
export function help(command?: string): string {
  const common = `Output (required for operations; no default):
  --json | --output-format json|text   JSON stays one machine-readable object
Transport:
  --host HOST                        SSH destination (no nested transports)
  --remote-bin ABSOLUTE_PATH          Remote session-peer executable
  --remote-platform posix|win32       Remote shell platform
  --ssh-control-path SOCKET           Existing SSH control socket
  --no-update-notice                  Suppress the opt-in cached update notice
  -h, --help                         Show command help`;
  if (command === 'list') return `Usage: session-peer list [options]
List reachable Claude and saved Codex sessions. Listing is not send authorization.
  --agent claude|codex                Filter one agent (default: both)
  --codex-home HOME                   Pin Codex listing to one home
  --all                              Include stale Claude/archived Codex rows
${common}`;
  if (command === 'doctor') return `Usage: session-peer doctor [options]
Read-only metadata/capability diagnostics; does not send, wake or authorize a send.
Successful diagnostics exit 0 even when ready=false. Check readiness separately.
  --agent claude|codex                Filter one agent (default: both)
  --codex-home HOME                   Pin Codex metadata inspection
  --codex-bin PATH                    Inspect executable availability; never execute it
${common}`;
  if (command === 'update') return `Usage: session-peer update --check [options]
Check the npm registry for a newer session-peer. Never installs or replaces files.
Without --check, refuses (self_update_unsupported) and names the owning manager's command.
  --check                            Read the npm dist-tag (one request, 3 s timeout)
  --channel latest|preview            npm dist-tag to compare (default: latest)
Output (required; no default):
  --json | --output-format json|text   JSON stays one machine-readable object
  -h, --help                         Show command help
Skills, Python installations and remote hosts are updated separately.
Notices on other commands are opt-in: SESSION_PEER_UPDATE_NOTICE=1.`;
  if (command === 'send') return `Usage: session-peer send --to TARGET [MESSAGE | --message TEXT | -m TEXT] [options]
TARGET: Claude name/PID, claude:NAME/PID, codex:UUID, or session-peer reply URI.
Omit the body or use - for UTF-8 stdin. Only one body source is permitted.
Unicode names use exact Unicode 14.0.0 default casefold; collisions require PID.
  --dry-run                          Validate without submission
  --codex-home HOME                   Explicit Codex home; otherwise select unique live writer
  --codex-bin PATH                    Native Codex executable
  --allow-inactive-codex-home         Queue only with explicit verified inactive home
  --no-from                          Omit sender envelope
  --no-reply-to                       Do not add a reply route
  --reply-address URI                 Explicit reply route (conflicts with --no-reply-to)
Queued/posted is not ACK. Unknown outcomes must not be retried automatically.
${common}`;
  return `session-peer ${VERSION} (TypeScript)
Usage: session-peer <command> [options]
  list                               List Claude/Codex sessions
  send                               Submit one guarded message
  doctor                             Inspect read-only metadata and capabilities
  update --check                     Check npm for a newer version (no self-update)
  --version                          Print exact runtime version
  --help, -h                         Show help; <command> --help for details
${common}
No Relay server, MCP, wake, wait or automatic ACK support.`;
}
