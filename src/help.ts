import { VERSION } from './protocol.js';
export function help(command?: string): string {
  const common = `Output (required for operations; no default):
  --json | --output-format json|text   JSON stays one machine-readable object
Transport:
  --host [USER@]HOST                 SSH destination; repeat for ordered per-host results
                                     (IPv6: 2001:db8::1 or [2001:db8::1]; no nested transports)
  --ssh-opt OPT                      Allowlisted ssh option, repeatable: -p PORT, -l USER,
                                     -i IDENTITY_FILE, -o Port|User|IdentityFile|IdentitiesOnly=VALUE,
                                     -4, -6. Other options (ProxyJump, ProxyCommand, -F...) are refused
  --ssh-jump USER@HOST[:PORT]         One hardened jump host for every --host (POSIX clients;
                                     fixed ProxyCommand with BatchMode/StrictHostKeyChecking)
  --remote-bin ABSOLUTE_PATH          Remote session-peer executable
  --remote-platform posix|win32       Remote shell platform
  --ssh-control-path SOCKET           Existing SSH control socket (one --host only)
  --no-update-notice                  Accepted compatibility flag
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
  --version                          Print exact runtime version
  --help, -h                         Show help; <command> --help for details
${common}
No Relay server, MCP, wake, wait or automatic ACK support.`;
}
