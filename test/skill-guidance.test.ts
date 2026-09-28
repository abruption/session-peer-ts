// Companion session-peer-ts skill examples, using isolated state and zero sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
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
    const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', input: 'fixture message', timeout: 15000 });
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
  assert.match(help.stdout, /--allow-inactive-codex-home/);
  const optedIn = invoke([...args, '--allow-inactive-codex-home']);
  assert.equal(optedIn.status, 0, optedIn.stdout); const result = JSON.parse(optedIn.stdout);
  assert.equal(result.submitted, false); assert.equal(result.status, 'validated');
  assert.equal(result.codexHome, realpathSync(home)); assert.equal(result.codexHomeResolution.reason, 'explicit_inactive_opt_in');
  assert.deepEqual(readFileSync(path), before); assert.deepEqual(readdirSync(home), ['state_5.sqlite']);
});
