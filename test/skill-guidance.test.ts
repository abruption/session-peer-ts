// Companion session-peer-ts skill examples, using isolated state and zero sends.
import { createHash } from 'node:crypto';
import { inspectSkill, validateSkillMetadata } from '../dist/skill-metadata.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
test('four language guides install the same published TS skill source', () => {
  const pin = '0f494cabd05901c03161dc91792dcf89f8e96631';
  const source = `https://github.com/abruption/session-peer-skill/tree/${pin}/session-peer-ts`;
  for (const suffix of ['', '.ko', '.ja', '.zh-CN']) {
    const guide = readFileSync(new URL(`../docs/guide${suffix}.md`, import.meta.url), 'utf8');
    assert.ok(guide.includes(`](${source})`), suffix);
    assert.ok(guide.includes(`npx -y skills@1.7.0 add ${source} --skill session-peer-ts --agent codex --copy --yes`), suffix);
    assert.ok(guide.includes('releases/tag/session-peer-ts-v0.2.1'), suffix);
    assert.ok(guide.includes('verification:metadata_only'), suffix);
    assert.equal(guide.includes('081cc3c1d16a394bd92824333f4bc61c36951799'), false, suffix);
  }
  for (const path of ['PARITY.md', 'docs/design/typescript-skill-compatibility.md']) {
    const doc = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(doc.includes(pin), path);
    assert.ok(doc.includes('8c3520f95e0d6807303be96bfa06df69887ddaf76be05f1905505d0a956820c3'), path);
  }
});
test('published skill 0.2.1 complete bytes match the recorded release and finite guard', () => {
  const url = new URL('./fixtures/ts-skill-0.2.1-published.md', import.meta.url);
  const bytes = readFileSync(url);
  assert.equal(bytes.length, 13996);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '8c3520f95e0d6807303be96bfa06df69887ddaf76be05f1905505d0a956820c3');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const expected = { status: 'compatible', code: 'skill_contract_compatible', verification: 'metadata_only' };
  assert.deepEqual(validateSkillMetadata(text), expected);
  assert.deepEqual(validateSkillMetadata(text, undefined), expected);
  assert.deepEqual(validateSkillMetadata(text, '0.3.5'), expected);
  assert.deepEqual(validateSkillMetadata(text, '0.3.6'), expected);
  assert.deepEqual(validateSkillMetadata(text, '0.4.0'), expected);
  assert.deepEqual(validateSkillMetadata(text, '0.5.0'), expected);
  assert.deepEqual(validateSkillMetadata(text, '0.5.1'), expected);
  const path = fileURLToPath(url);
  assert.deepEqual(inspectSkill(path), { ...expected, path });
  for (const runtime of ['0.3.2', '0.3.3', '0.3.4', '0.3.7', '0.4.1', '0.5.2', '0.6.0']) {
    assert.deepEqual(validateSkillMetadata(text, runtime), {
      status: 'incompatible', code: 'skill_contract_mismatch', verification: 'metadata_only'
    });
  }
});
test('TS skill baseline list and guarded Codex dry-run examples never submit', t => {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-skill-example-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'chosen-home'); mkdirSync(home);
  const path = join(home, 'state_5.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE threads (id TEXT,title TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,rollout_path TEXT)');
  const id = '00000000-0000-4000-8000-000000000001';
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(id, 'skill fixture', root, 1, 0, 'unused'); db.close();
  const before = readFileSync(path);
  const env = { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]',
    CLAUDE_CONFIG_DIR: join(root, '.claude'), ANTHROPIC_CONFIG_DIR: '' };
  function invoke(args: string[]) {
    const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', input: args.includes('--message') && args[args.indexOf('--message') + 1] === '-' ? 'fixture message' : undefined, timeout: 15000 });
    assert.ifError(result.error); assert.equal(result.signal, null);
    return result;
  }
  const version = invoke(['--version']);
  assert.equal(version.status, 0); assert.match(version.stdout.trim(), /^session-peer \d+\.\d+\.\d+ \(typescript\)$/);
  const help = invoke(['--help']); assert.equal(help.status, 0);
  const claude = invoke(['list', '--agent', 'claude', '--json']);
  assert.equal(claude.status, 0); assert.deepEqual(JSON.parse(claude.stdout).sessions, []);
  const listing = invoke(['list', '--agent', 'codex', '--codex-home', home, '--json']);
  assert.equal(listing.status, 0); const row = JSON.parse(listing.stdout).sessions[0];
  assert.equal(row.id, id); assert.equal(row.codexHome, realpathSync(home));
  const args = ['send', '--to', `codex:${id}`, '--codex-home', row.codexHome, '--codex-bin', process.execPath,
    '--message', '-', '--dry-run', '--json'];
  const refused = invoke(args); const refusal = JSON.parse(refused.stdout);
  assert.notEqual(refused.status, 0); assert.equal(refusal.status, 'refused'); assert.equal(refusal.submitted, false);
  assert.equal(refusal.error, 'inactive_writer');
  assert.equal(refusal.retryAllowed, false); assert.equal('retrySafe' in refusal, false);
  assert.match(help.stdout, /<command> --help/);
  const sendHelp = invoke(['send', '--help']); assert.equal(sendHelp.status, 0);
  assert.match(sendHelp.stdout, /^  --allow-inactive-codex-home\s/m);
  assert.match(help.stdout, /^  doctor\s/m);
  const doctorHelp = invoke(['doctor', '--help']); assert.equal(doctorHelp.status, 0);
  assert.match(doctorHelp.stdout, /^Usage: session-peer doctor /);
  const optedIn = invoke([...args, '--allow-inactive-codex-home']);
  const result = JSON.parse(optedIn.stdout);
  if (process.platform === 'win32') {
    assert.equal(optedIn.status, 1, optedIn.stdout);
    assert.equal(result.status, 'refused');
    assert.equal(result.error, 'codex_storage_platform_unqualified');
    assert.equal(result.retryAllowed, false);
  } else {
    assert.equal(optedIn.status, 0, optedIn.stdout);
    assert.equal(result.status, 'validated');
    assert.equal(result.codexHome, realpathSync(home));
  }
  assert.equal(result.submitted, false);
  assert.equal(result.codexHomeResolution.reason, 'explicit_inactive_opt_in');
  assert.deepEqual(readFileSync(path), before); assert.deepEqual(readdirSync(home), ['state_5.sqlite']);
});
