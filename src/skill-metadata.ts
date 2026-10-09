// A local, bounded string-map inspection. No instructions, references, tools or
// network are executed. Body bytes are read, but never interpreted as commands.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type BigIntStats } from 'node:fs';
import { TextDecoder } from 'node:util';
import { canonical } from './discovery.js';
import { VERSION } from './protocol.js';

export type SkillCheck = { status: string; code: string; verification?: 'metadata_only' };
const unknown = (code = 'skill_metadata_missing'): SkillCheck => ({ status: 'unknown', code });
const verdict = (compatible: boolean): SkillCheck => ({ status: compatible ? 'compatible' : 'incompatible',
  code: compatible ? 'skill_contract_compatible' : 'skill_contract_mismatch', verification: 'metadata_only' });
export const SKILL_METADATA_LIMIT = 65536;
const keys = ['version', 'runtime-implementation', 'runtime-min-version', 'runtime-full-version', 'runtime-capability-policy'] as const;
// Finite source proposal for #118; 0.3.3 successor support requires companion
// exact review before merge/release. This source still identifies as 0.3.2.
const matrix: Record<string, readonly string[]> = { '0.3.2': ['0.1.0'], '0.3.3': ['0.1.0', '0.2.0'] };
const profiles: Record<string, readonly string[]> = {
  '0.1.0': ['0.1.0', 'typescript', '0.1.0', '0.1.0', 'probe-help'],
  '0.2.0': ['0.2.0', 'typescript', '0.1.0', '0.3.2', 'probe-help']
};
// Deliberately not general YAML: plain ASCII tokens or unescaped quoted strings,
// followed by an optional comment. YAML tags, aliases, maps and sequences fail.
function scalar(value: string): string | undefined {
  const match = /^(?:"([^"\\\r\n]*)"|'([^'\\\r\n]*)'|([A-Za-z0-9][A-Za-z0-9._/-]*))(?:[ ]+(?:#.*)?)?$/.exec(value);
  const result = match ? match[1] ?? match[2] ?? match[3] : undefined;
  return result?.length ? result : undefined;
}
export function validateSkillMetadata(text: string, runtime: unknown = VERSION): SkillCheck {
  if (text.length > SKILL_METADATA_LIMIT || Buffer.byteLength(text, 'utf8') > SKILL_METADATA_LIMIT) return unknown('skill_metadata_unreadable');
  if (typeof runtime !== 'string' || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(runtime)) return unknown();
  // BOM and controls are rejected explicitly; whole-file fatal UTF-8 happens in
  // the reader. LF/CRLF and body tabs are supported; lone CR is not.
  // Map indentation and value separators use spaces rather than tabs.
  if (text.startsWith('\uFEFF') || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)/.test(text)) return unknown();
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (!front) return unknown();
  const lines = front.split(/\r?\n/), names: string[] = [], sections: number[] = [];
  let rootOwner: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^[ ]*(?:#.*)?$/.test(line)) continue;
    if (line.startsWith(' ')) {
      // Comments/blank lines do not end a root scalar. Only metadata and
      // ignored unrelated fields can own indented content; name cannot.
      if (rootOwner === undefined || rootOwner === 'name') return unknown();
      continue;
    }
    const root = /^([a-z][a-z0-9-]*):/.exec(line);
    if (!root) return unknown();
    rootOwner = root[1]!;
    if (/^name:/.test(line)) {
      if (!/^name:[ ]+/.test(line)) return unknown();
      const name = scalar(line.slice(5).trimStart());
      if (name === undefined) return unknown();
      names.push(name);
    }
    if (/^metadata:/.test(line)) {
      if (!/^metadata:(?:[ ]+(?:#.*)?)?$/.test(line)) return unknown();
      sections.push(i);
    }
  }
  if (names.length !== 1 || sections.length !== 1) return unknown();
  const fields = new Map<string, string>();
  for (let i = sections[0]! + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^[ ]*(?:#.*)?$/.test(line)) continue;
    if (!line.startsWith(' ')) break;
    const match = /^  ([a-z][a-z0-9-]*):[ ]+(.*)$/.exec(line);
    if (!match || fields.has(match[1]!)) return unknown();
    const value = scalar(match[2]!);
    if (value === undefined) return unknown();
    fields.set(match[1]!, value);
  }
  if (keys.some(key => !fields.has(key))) return unknown();
  const values = keys.map(key => fields.get(key)!);
  const profile = Object.hasOwn(profiles, values[0]!) ? profiles[values[0]!] : undefined;
  return verdict(names[0] === 'session-peer-ts' && !!profile && profile.every((value, i) => value === values[i]) &&
    !!matrix[runtime]?.includes(values[0]!));
}
function stable(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export function inspectSkill(original: string): SkillCheck & { path: string } {
  let path = original, established = false;
  try {
    path = canonical(original); // Preserve separately managed symlink installations.
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.size > BigInt(SKILL_METADATA_LIMIT)) return { path, ...unknown('skill_metadata_unreadable') };
    established = true;
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const fd = openSync(path, flags);
    try {
      const opened = fstatSync(fd, { bigint: true });
      if (!opened.isFile() || !stable(before, opened)) return { path, ...unknown('skill_metadata_unreadable') };
      const bytes = Buffer.alloc(SKILL_METADATA_LIMIT + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, length);
        if (!count) break;
        length += count;
      }
      const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
      if (length > SKILL_METADATA_LIMIT || BigInt(length) !== before.size || !after.isFile() || !current.isFile() ||
          !stable(before, after) || !stable(before, current) || canonical(original) !== path) return { path, ...unknown('skill_metadata_unreadable') };
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
      catch { return { path, ...unknown('skill_metadata_unreadable') }; }
      return { path, ...validateSkillMetadata(text) };
    } finally { closeSync(fd); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { path, ...(!established && (code === 'ENOENT' || code === 'ENOTDIR') ? { status: 'missing', code: 'skill_missing' } :
      code === 'EACCES' || code === 'EPERM' ? { status: 'permission_denied', code: 'permission_denied' } : unknown('skill_metadata_unreadable')) };
  }
}
