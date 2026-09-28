// Offline, reproducible generator; obtain the pinned file from the URL below.
// node scripts/generate-casefold.mjs /path/to/CaseFolding.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const source = 'https://www.unicode.org/Public/14.0.0/ucd/CaseFolding.txt';
const digest = 'a566cd48687b2cd897e02501118b2413c14ae86d318f9abbbba97feb84189f0f';
assert.equal(process.argv.length, 3, 'Pass the pinned CaseFolding.txt path');
const bytes = readFileSync(process.argv[2]);
assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, 'Unicode source hash mismatch');
const entries = [];
for (const line of bytes.toString('utf8').split('\n')) {
  const fields = line.split('#')[0].split(';').map(s => s.trim());
  if (!['C', 'F'].includes(fields[1])) continue;
  entries.push([Number.parseInt(fields[0], 16), String.fromCodePoint(...fields[2].split(/\s+/).map(s => Number.parseInt(s, 16)))]);
}
const literal = JSON.stringify(entries).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
writeFileSync(new URL('../src/casefold.ts', import.meta.url), `// Generated from Unicode 14.0.0 CaseFolding.txt (C + F; default, non-Turkic).
// ${source}
// SHA-256: ${digest}
// Unicode data license: UNICODE-LICENSE.txt. No normalization or locale rules.
export const CASEFOLD_UNICODE_VERSION = '14.0.0';
const folds = new Map<number, string>(${literal});
export function casefold(value: string): string {
  return [...value].map(char => folds.get(char.codePointAt(0)!) ?? char).join('');
}
`);
