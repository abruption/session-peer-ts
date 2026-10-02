// Integration of #20/#21 repeated --host with #22 update notices: fake ssh,
// local fixture registry and temporary caches only; no network or live session.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const posix = { skip: process.platform === 'win32' && 'POSIX fake ssh' };
const hosts = ['alpha', 'beta', 'gamma'];
async function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-multihost-updates-')));
  mkdirSync(join(root, '.claude/sessions'), { recursive: true });
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ latest: '0.2.2' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok()));
    rmSync(root, { recursive: true, force: true });
  });
  const cache = join(root, 'client-cache'), receiver = join(root, 'receiver-cache');
  const file = join(cache, 'npm-update.json'), lock = join(cache, 'npm-update.lock');
  // The receiver side inherits an opted-in environment with its own cache, so any
  // wire-side notice or refresh would be visible.
  writeFileSync(join(root, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
if(args.includes('-G')){console.log('hostname x\\nuser config-user\\nport 22');process.exit(0);}
if(args.at(-1).endsWith('--version')){console.log('session-peer 0.2.1 (typescript)');process.exit(0);}
const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},'--stdio-request'],{input:fs.readFileSync(0,'utf8'),encoding:'utf8',
  env:{...process.env,SESSION_PEER_CACHE_DIR:${JSON.stringify(receiver)},SESSION_PEER_UPDATE_NOTICE:'1'}});
process.stdout.write(r.stdout);process.exit(r.status);`, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: join(root, '.claude'), ANTHROPIC_CONFIG_DIR: '',
    CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', SESSION_PEER_TAILSCALE: 'off',
    PATH: root + delimiter + process.env.PATH, SESSION_PEER_CACHE_DIR: cache, SESSION_PEER_NO_UPDATE_NOTICE: '',
    SESSION_PEER_UPDATE_REGISTRY: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, SESSION_PEER_UPDATE_NOTICE: '1' };
  const call = async (args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', part => stdout += part); child.stderr.on('data', part => stderr += part);
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const [code] = await once(child, 'close'); clearTimeout(timer);
    return { code: code as number, stdout, stderr };
  };
  const seed = (age = 0) => {
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, package: 'session-peer', source: 'npm_registry', channel: 'latest', latest: '0.2.2', checkedAt: Date.now() - age }), { mode: 0o600 });
  };
  const settled = async (count: number) => {
    for (let i = 0; i < 200 && !(requests.length >= count && existsSync(file) && !existsSync(lock)); i++) await delay(50);
    await delay(300);
  };
  const args = (format: string[]) => ['list', '--agent', 'claude', ...hosts.flatMap(item => ['--host', item]), ...format];
  return { root, receiver, requests, call, seed, settled, args, file };
}

test('repeated --host keeps the request-order array exactly; the notice is client-side and never inside elements', posix, async t => {
  const f = await fixture(t);
  f.seed();
  const off = await f.call(f.args(['--json', '--no-update-notice']));
  const on = await f.call(f.args(['--json']));
  assert.equal(on.code, 0, on.stdout); assert.equal(on.code, off.code); assert.equal(on.stderr, '');
  const value = JSON.parse(on.stdout);
  assert.ok(Array.isArray(value)); assert.deepEqual(value.map((item: Record<string, unknown>) => item.host), hosts);
  for (const item of value) assert.equal('clientUpdate' in item, false);
  assert.deepEqual(value, JSON.parse(off.stdout));
  // Text: identical stdout, one stderr notice line for the whole invocation.
  const textOff = await f.call(f.args(['--output-format', 'text', '--no-update-notice']));
  const textOn = await f.call(f.args(['--output-format', 'text']));
  assert.equal(textOn.stdout, textOff.stdout); assert.equal(textOn.code, textOff.code);
  assert.equal(textOn.stderr.match(/^Update available: /gm)?.length, 1);
  // One destination stays flat and gets the additive client field.
  const single = await f.call(['list', '--agent', 'claude', '--host', 'alpha', '--json']);
  const flat = JSON.parse(single.stdout);
  assert.equal(Array.isArray(flat), false); assert.equal(flat.host, 'alpha'); assert.equal(flat.clientUpdate.latest, '0.2.2');
  await delay(500);
  assert.deepEqual(f.requests, [], 'fresh cache: no refresh'); assert.equal(existsSync(f.receiver), false);
});

test('each invocation schedules at most one refresh regardless of host count; receivers never refresh', posix, async t => {
  const f = await fixture(t);
  const first = await f.call(f.args(['--json']));
  assert.equal(first.code, 0, first.stdout);
  for (const item of JSON.parse(first.stdout)) assert.equal('clientUpdate' in item, false);
  await f.settled(1);
  assert.equal(f.requests.length, 1, 'one refresh for three hosts');
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).latest, '0.2.2');
  f.seed(25 * 3600_000);
  await f.call(f.args(['--output-format', 'text']));
  await f.settled(2);
  assert.equal(f.requests.length, 2, 'expired cache: one more refresh for the next invocation');
  // Wire receivers ran with an opted-in environment and their own cache, but never touched it.
  assert.equal(existsSync(f.receiver), false);
  await delay(500);
  assert.equal(f.requests.length, 2, 'no receiver-side registry requests');
});
