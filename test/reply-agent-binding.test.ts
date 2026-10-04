// #98: a declared Claude reply route must never select the Codex transport.
// Only isolated fake executables and a fixture Unix inbox; no live agents or SSH.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { reply } from '../dist/protocol.js';
import { replyUri } from '../dist/replies.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const id = '11111111-1111-4111-8111-111111111111';
function uri(agent: string, session: string, transport = 'local') {
  return `session-peer://v1/reply?agent=${agent}&session=${encodeURIComponent(session)}&transport=${transport}${transport === 'ssh' ? '&host=fixture-host' : ''}`;
}

test('Claude reply routes refuse reserved dispatch prefixes after decoding', () => {
  for (const target of [`codex:${id}`, 'codex:not-a-uuid', 'codex:', uri('codex', id), 'session-peer:invalid']) {
    for (const transport of ['local', 'ssh']) {
      assert.throws(() => reply(uri('claude', target, transport)), /invalid_reply_uri/);
    }
    assert.throws(() => replyUri({ agent: 'claude', id: target }), /invalid_reply_uri/);
  }
  // URL decoding happens once; mixed case and encoded punctuation remain literal.
  for (const name of ['worker', 'api worker', '한글', 'Codex:literal', 'codex%3Aliteral', 'session-peer%3Aliteral', 'worker+one']) {
    assert.deepEqual(reply(uri('claude', name)), { to: name });
    assert.deepEqual(reply(replyUri({ agent: 'claude', id: name })), { to: name });
  }
  assert.deepEqual(reply(uri('codex', id)), { to: `codex:${id}` });
  assert.deepEqual(reply(uri('codex', id, 'ssh')), { to: `codex:${id}`, host: 'fixture-host' });
});

function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-reply-binding-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/sessions'), { recursive: true });
  const codexLog = join(root, 'codex-calls'), sshLog = join(root, 'ssh-calls');
  writeFileSync(join(root, 'codex'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(codexLog)},'1');process.exit(99);`, { mode: 0o700 });
  writeFileSync(join(root, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
fs.appendFileSync(${JSON.stringify(sshLog)},'1');
if(process.argv.includes('-G')){console.log('user fixture-user');process.exit(0);}
if(process.argv.at(-1).endsWith('--version')){console.log('session-peer 0.3.1 (typescript)');process.exit(0);}
const input=fs.readFileSync(0,'utf8');
const result=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},'--stdio-request'],{input,encoding:'utf8',env:process.env});
process.stdout.write(result.stdout);process.exit(result.status);`, { mode: 0o700 });
  const env = { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: join(root, '.claude'),
    CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '',
    SESSION_PEER_TAILSCALE: 'off', PATH: root + delimiter + process.env.PATH };
  async function execute(args: string[], input?: string) {
    const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(input);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const [code, signal] = await once(child, 'close'); clearTimeout(timer);
    assert.equal(signal, null, stderr);
    return { code, value: JSON.parse(stdout) };
  }
  const invoke = (address: string) => execute(['send', '--to', address, '--message', 'fixture', '--no-from', '--no-reply-to', '--json']);
  const wire = (args: string[]) => execute(['--stdio-request'], JSON.stringify({ schemaVersion: 1, args }));
  return { root, invoke, wire, codexCalls: () => existsSync(codexLog) ? readFileSync(codexLog, 'utf8').length : 0,
    sshCalls: () => existsSync(sshLog) ? readFileSync(sshLog, 'utf8').length : 0 };
}

test('CLI rejects agent confusion before local Codex selection or any SSH dispatch', async t => {
  const f = fixture(t);
  for (const transport of ['local', 'ssh']) for (const target of [`codex:${id}`, 'codex:invalid']) {
    const result = await f.invoke(uri('claude', target, transport));
    assert.notEqual(result.code, 0);
    assert.equal(result.value.status, 'refused');
    assert.equal(result.value.error, 'invalid_reply_uri');
    assert.equal(result.value.submitted, false);
    assert.equal(result.value.retryAllowed, false);
    assert.equal(f.codexCalls(), 0);
    assert.equal(f.sshCalls(), 0);
  }
});

test('nested Reply-To URIs cannot change a declared Claude route after SSH forwarding', async t => {
  const f = fixture(t);
  const inner = uri('codex', id);
  const nested = uri('claude', inner);
  for (const session of [inner, nested, 'session-peer:invalid']) {
    for (const transport of ['ssh', 'local']) {
      const result = await f.invoke(uri('claude', session, transport));
      assert.notEqual(result.code, 0);
      assert.equal(result.value.error, 'invalid_reply_uri');
      assert.equal(result.value.status, 'refused'); assert.equal(result.value.submitted, false);
      assert.equal(result.value.retryAllowed, false);
      assert.equal(f.sshCalls(), 0); assert.equal(f.codexCalls(), 0);
    }
  }
});

test('wire receivers refuse unresolved Reply-To URIs before a queue invocation', async t => {
  const f = fixture(t), home = join(f.root, 'saved-home');
  mkdirSync(home);
  const db = new DatabaseSync(join(home, 'state_5.sqlite'));
  try {
    db.exec('CREATE TABLE threads(id TEXT)');
    db.prepare('INSERT INTO threads VALUES (?)').run(id);
  } finally { db.close(); }
  const address = uri('codex', id) + '&codexHome=' + encodeURIComponent(home);
  const args = ['send', '--to', address, '--codex-bin', join(f.root, 'codex'), '--allow-inactive-codex-home',
    '--message', 'fixture', '--no-from', '--no-reply-to', '--json'];
  // A saved inactive thread and callable fixture rule out a missing-thread refusal.
  const result = await f.wire(args);
  t.diagnostic(JSON.stringify({ error: result.value.error, queueCalls: f.codexCalls(), sshCalls: f.sshCalls() }));
  assert.notEqual(result.code, 0); assert.equal(result.value.error, 'nested_transport_forbidden');
  assert.equal(result.value.submitted, false); assert.equal(result.value.retryAllowed, false);
  assert.equal(f.codexCalls(), 0); assert.equal(f.sshCalls(), 0);
});

test('declared Codex reply routes still reach local and POSIX fake SSH Codex selection', async t => {
  const f = fixture(t);
  const transports = process.platform === 'win32' ? ['local'] : ['local', 'ssh'];
  for (const transport of transports) {
    const result = await f.invoke(uri('codex', id, transport));
    assert.notEqual(result.code, 0);
    // The isolated homes have no saved thread; routing still selects Codex.
    assert.equal(result.value.error, 'thread_not_saved_in_known_homes');
    assert.equal(result.value.submitted, false);
    assert.equal(f.codexCalls(), 0);
    assert.equal(f.sshCalls() > 0, transport === 'ssh');
  }
});

test('local and fake SSH Claude reply URIs retain ordinary encoded names', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), messages: unknown[] = [], socket = join(f.root, 'inbox.sock');
  const server = createServer(connection => {
    let input = '';
    connection.on('data', chunk => { input += chunk; });
    connection.on('end', () => { messages.push(JSON.parse(input)); connection.end(); });
  });
  server.listen(socket); await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  for (const name of ['worker', 'api worker', '한글', 'worker+one']) {
    writeFileSync(join(f.root, '.claude/sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name, messagingSocketPath: socket }));
    for (const transport of ['local', 'ssh']) {
      const before = messages.length;
      const result = await f.invoke(uri('claude', name, transport));
      assert.equal(result.code, 0, JSON.stringify(result));
      assert.equal(result.value.status, 'posted');
      assert.equal(result.value.target.agent, 'claude');
      assert.equal(result.value.target.name, name);
      assert.equal(result.value.consumptionConfirmed, false);
      assert.equal(messages.length, before + 1);
    }
  }
  assert.equal(f.codexCalls(), 0);
  assert.ok(f.sshCalls() > 0);
});
