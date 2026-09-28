// Diagnostics inspect bounded metadata only. Never probe/connect to an inbox,
// acquire a writer lock, execute an agent binary, or write configuration.
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { canonical, listingCandidates } from './discovery.js';
import { windowsProcessStart } from './windows.js';

type Check = { status: string; code: string; [key: string]: unknown };
const failure = (error: unknown, missing: string, unknown: string): Check => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' ? { status: 'missing', code: missing } :
    code === 'EACCES' || code === 'EPERM' ? { status: 'permission_denied', code: 'permission_denied' } :
    { status: 'unknown', code: unknown };
};
export const capabilities = {
  list: true, send: true, doctor: true, wake: false, wait: false, ack: false,
  consumptionConfirmation: false, transports: ['local', 'ssh'], agents: ['claude', 'codex']
};
function tool(name: string): Check {
  const names = process.platform === 'win32' && !/\.(?:exe|cmd|bat)$/i.test(name) ? [name + '.exe', name + '.cmd', name] : [name];
  const paths = isAbsolute(name) ? [name] : name.includes('/') || name.includes('\\') ? [] :
    (process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(path => names.map(base => join(path, base)));
  let diagnostic: Check = { status: 'missing', code: 'executable_unavailable', executed: false };
  for (const path of paths) {
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return { status: 'available', code: 'executable_found', path, executed: false };
    } catch (error) {
      const found = failure(error, 'executable_unavailable', 'executable_inspection_unknown');
      if (found.status !== 'missing') diagnostic = { ...found, executed: false };
    }
  }
  return diagnostic;
}
async function codexHome(file: string): Promise<Check> {
  try {
    if (!statSync(file).isFile()) return { status: 'unsupported', code: 'state_db_not_regular' };
    accessSync(file, constants.R_OK);
  } catch (error) { return failure(error, 'state_db_missing', 'state_db_unreadable'); }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000');
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => (row as Record<string, unknown>).name));
      const missingColumns = ['id', 'title', 'cwd', 'updated_at', 'archived', 'rollout_path'].filter(name => !columns.has(name));
      if (missingColumns.length) return { status: 'unsupported', code: 'unsupported_threads_schema', missingColumns };
      const count = (db.prepare('SELECT COUNT(*) AS count FROM threads').get() as Record<string, unknown>).count;
      return { status: 'available', code: 'state_db_readable', sessionCount: count };
    } finally { db.close(); }
  } catch (error) { return failure(error, 'state_db_missing', 'state_db_unreadable'); }
}
export async function diagnoseCodex(home?: string, binary?: string): Promise<Record<string, unknown>> {
  const inventory = listingCandidates(home);
  const homes = [];
  for (const item of inventory.homes) homes.push({ ...item, ...await codexHome(item.stateDb) });
  const agentTool = tool(binary ?? 'codex');
  const complete = inventory.errors.length === 0 && homes.every(item => item.status === 'available' || (!item.required && item.status === 'missing'));
  const ready = complete && homes.some(item => item.status === 'available') && agentTool.status === 'available';
  return { ready, status: ready ? 'available' : 'unavailable', tool: agentTool, homes,
    errors: inventory.errors, verification: 'read_only_metadata', writerVerified: false,
    sendAuthorized: false };
}
export function diagnoseClaude(): Record<string, unknown> {
  const directory = join(process.env.CLAUDE_CONFIG_DIR || process.env.ANTHROPIC_CONFIG_DIR || join(homedir(), '.claude'), 'sessions');
  const result = { sessionsDir: directory, records: 0, invalidRecords: 0, aliveSessions: 0,
    availableInboxes: 0, staleRecords: 0, unknownInspections: 0, permissionFailures: 0 };
  let entries: string[];
  try {
    if (!statSync(directory).isDirectory()) return { ...result, ready: false, status: 'unsupported', code: 'sessions_path_not_directory' };
    entries = readdirSync(directory).sort();
  } catch (error) { return { ...result, ready: false, ...failure(error, 'sessions_dir_missing', 'sessions_dir_unreadable') }; }
  for (const entry of entries) {
    if (!/^[0-9]+\.json$/.test(entry)) continue;
    let record: Record<string, unknown>;
    try {
      const path = join(directory, entry), info = statSync(path);
      if (!info.isFile() || info.size > 65536) { result.invalidRecords++; continue; }
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) { result.invalidRecords++; continue; }
      record = value as Record<string, unknown>;
    } catch (error) {
      if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) result.permissionFailures++;
      else result.invalidRecords++;
      continue;
    }
    const pid = record.pid;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1 || pid > 2147483647) { result.invalidRecords++; continue; }
    result.records++;
    if (pid !== Number(entry.slice(0, -5))) { result.staleRecords++; continue; }
    let live = false;
    if (process.platform === 'win32') {
      const ticks = windowsProcessStart(pid);
      if (ticks === undefined || typeof record.startedAt !== 'number' || !Number.isSafeInteger(record.startedAt) || record.startedAt <= 0) { result.unknownInspections++; continue; }
      live = Number((ticks - 116444736000000000n) / 10000n) <= record.startedAt + 2000;
    } else {
      try { process.kill(pid, 0); live = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { result.unknownInspections++; continue; }
      }
    }
    if (!live) { result.staleRecords++; continue; }
    result.aliveSessions++;
    const socket = typeof record.messagingSocketPath === 'string' ? record.messagingSocketPath : '';
    if (process.platform === 'win32') {
      // A named pipe advertisement is not proof that the pipe exists or accepts connections.
      if (/^\\\\\.\\pipe\\[^\r\n]+$/i.test(socket)) result.availableInboxes++;
    } else if (socket) {
      try { if (statSync(socket).isSocket()) result.availableInboxes++; }
      catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          result.unknownInspections++;
          if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) result.permissionFailures++;
        }
      }
    }
  }
  const ready = result.availableInboxes > 0 && result.permissionFailures === 0 && result.unknownInspections === 0;
  const code = result.permissionFailures ? 'permission_denied' : result.unknownInspections ? 'inspection_unknown' :
    result.availableInboxes ? 'inbox_advertised' : result.aliveSessions ? 'inbox_unavailable' : 'no_live_sessions';
  return { ...result, ready, status: ready ? 'available' : 'unavailable', code,
    verification: process.platform === 'win32' ? 'process_and_pipe_advertisement' : 'process_and_filesystem',
    inboxConnected: false, sendAuthorized: false };
}
export async function doctor(agent?: 'claude' | 'codex', home?: string, binary?: string): Promise<Record<string, unknown>> {
  const agents: Record<string, Record<string, unknown>> = {};
  if (!agent || agent === 'claude') agents.claude = diagnoseClaude();
  if (!agent || agent === 'codex') agents.codex = await diagnoseCodex(home, binary);
  return { ok: true, ready: Object.values(agents).every(item => item.ready === true), agents,
    implementation: 'typescript', skills: inspectSkills(home), capabilities, diagnosticCompleted: true, consumptionConfirmed: false };
}

// Inspect only named skill entrypoints; interpret frontmatter, never instructions or references.
export function inspectSkills(home?: string): Check[] {
  const paths = new Set([join(homedir(), '.agents/skills/session-peer-ts/SKILL.md'),
    join(home || process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills/session-peer-ts/SKILL.md')]);
  return [...paths].map(path => {
    try {
      path = canonical(path);
      if (!statSync(path).isFile() || statSync(path).size > 65536) return { path, status: 'unknown', code: 'skill_metadata_unreadable' };
      const text = readFileSync(path, 'utf8');
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
      if (!front) return { path, status: 'unknown', code: 'skill_metadata_missing' };
      const field = (key: string) => {
        const values = front.split(/\r?\n/).map(line => /^ *([a-z-]+): *(.*?) *$/.exec(line))
          .filter(match => match?.[1] === key).map(match => match![2]!.replace(/^(["'])(.*)\1$/, '$2'));
        return values.length === 1 ? values[0] : undefined;
      };
      const implementation = field('runtime-implementation'), minimum = field('runtime-min-version');
      const policy = field('runtime-capability-policy');
      const compatible = implementation === 'typescript' && minimum === '0.1.0' && policy === 'probe-help' && field('version') === '0.1.0' && field('runtime-full-version') === '0.1.0';
      return { path, status: compatible ? 'compatible' : 'incompatible', code: compatible ? 'skill_contract_compatible' : 'skill_contract_mismatch', verification: 'metadata_only' };
    } catch (error) { return { path, ...failure(error, 'skill_missing', 'skill_metadata_unreadable') }; }
  });
}
