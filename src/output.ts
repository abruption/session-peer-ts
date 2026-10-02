export type OutputFormat = 'json' | 'text';
// Escape terminal controls plus bidi/zero-width format characters in
// user-controlled names/paths; preserve other Unicode.
const safe = (value: unknown): string => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g,
  char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
export function renderOutput(value: Record<string, unknown> | Record<string, unknown>[], format: OutputFormat): string {
  if (format === 'json') return JSON.stringify(value);
  if (Array.isArray(value)) return value.map(item => `Host: ${safe(item.host)}\n${renderOutput(item, format)}`).join('\n\n');
  const lines: string[] = [];
  if (value.command === 'list') {
    const sessions = Array.isArray(value.sessions) ? value.sessions as Record<string, unknown>[] : [];
    for (const row of sessions) lines.push(`${safe(row.agent)}:${safe(row.pid ?? row.id)}  ${safe(row.name)}${row.codexHome ? `  home=${safe(row.codexHome)}` : ''}`);
    if (!sessions.length) lines.push('No sessions found.');
    if (value.discovery && typeof value.discovery === 'object') {
      for (const [agent, diagnostic] of Object.entries(value.discovery)) lines.push(`Discovery ${safe(agent)}: ${safe(JSON.stringify(diagnostic))}`);
    }
    if (Array.isArray(value.errors)) for (const error of value.errors) lines.push(`Discovery error: ${safe(JSON.stringify(error))}`);
  } else if (value.command === 'doctor') {
    lines.push('Read-only diagnostics; readiness does not authorize submission.');
    lines.push(`Ready: ${value.ready === true ? 'yes' : 'no'}`);
    lines.push(`Agents: ${safe(JSON.stringify(value.agents ?? {}))}`);
    lines.push(`Capabilities: ${safe(JSON.stringify(value.capabilities ?? {}))}`);
    const route = value.returnRoute as Record<string, unknown> | undefined;
    lines.push(route ? `Return route: ${safe(route.status)} via ${safe(route.transport)} (${safe(route.reason)})` : 'Return route: not checked (use --check-return-route)');
  } else if (value.ok === true) {
    const target = value.target as Record<string, unknown> | undefined;
    lines.push(`${safe(value.status)}: ${safe(target?.agent)}:${safe(target?.pid ?? target?.id)}`);
    if (value.codexHome) lines.push(`Codex home: ${safe(value.codexHome)}`);
    if (value.queueId) lines.push(`Queue ID: ${safe(value.queueId)}`);
    lines.push(value.submitted === false ? 'Dry run: nothing submitted.' : 'Submitted; consumption/ACK is not confirmed.');
  }
  if (value.ok === false) {
    lines.push(`Error: ${safe(value.error ?? 'operation_failed')}`);
    if (value.command === 'send') lines.push(value.submitted === null ? 'Submission outcome unknown. Do not retry automatically.' : 'Nothing submitted.');
  }
  return lines.join('\n');
}
