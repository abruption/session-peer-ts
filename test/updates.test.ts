// Update checks and cached notices against a local fixture registry; never the real network.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { cacheDirectory, compareVersions, manager, registryUrl, upgradeCommand, validVersion } from '../dist/updates.js';

const cli = resolve('dist/cli.js');
const SENTINEL = 'REGISTRY-BODY-SENTINEL';
type Reply = { status?: number; body?: string; wait?: number };
async function fixture(t: TestContext, reply: Reply = { body: JSON.stringify({ latest: '0.2.2', preview: '0.3.0-preview.1' }) }) {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-updates-'));
  mkdirSync(join(root, '.claude/sessions'), { recursive: true });
  const requests: string[] = [];
  const state = { reply };
  const server = createServer((request: IncomingMessage, response) => {
    requests.push(request.url ?? '');
    const send = () => { response.writeHead(state.reply.status ?? 200, { 'content-type': 'application/json' }); response.end(state.reply.body ?? ''); };
    if (state.reply.wait) setTimeout(send, state.reply.wait).unref(); else send();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(ok => server.close(() => ok()));
    rmSync(root, { recursive: true, force: true });
  });
  const cache = join(root, 'cache');
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]',
    CLAUDE_CONFIG_DIR: join(root, '.claude'), ANTHROPIC_CONFIG_DIR: '', SESSION_PEER_CACHE_DIR: cache,
    SESSION_PEER_UPDATE_REGISTRY: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    SESSION_PEER_UPDATE_NOTICE: '', SESSION_PEER_NO_UPDATE_NOTICE: '' };
  // Asynchronous children keep the in-process fixture registry responsive.
  const call = async (args: string[], extra: NodeJS.ProcessEnv = {}, input = '') => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', part => stdout += part); child.stderr.on('data', part => stderr += part);
    child.stdin.end(input);
    const timer = setTimeout(() => child.kill(), 20000);
    const [code, signal] = await once(child, 'close'); clearTimeout(timer);
    assert.equal(signal, null);
    return { code: code as number, stdout, stderr, value: (() => { try { return JSON.parse(stdout); } catch { return undefined; } })() };
  };
  const file = join(cache, 'npm-update.json'), lock = join(cache, 'npm-update.lock');
  const seed = (latest: string | null, age = 0) => {
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, package: 'session-peer', source: 'npm_registry', channel: 'latest', latest, checkedAt: Date.now() - age }), { mode: 0o600 });
  };
  // Wait until a detached refresh has written the cache and released its lock.
  const settled = async (count: number) => {
    for (let i = 0; i < 200 && !(requests.length >= count && existsSync(file) && !existsSync(lock)); i++) await delay(50);
    await delay(200);
  };
  return { root, cache, env, requests, state, call, file, lock, seed, settled };
}

test('npm semver ordering covers stable, prerelease and invalid tags', () => {
  const ordered = ['0.1.0-preview.0', '0.1.0-preview.1', '0.1.0', '0.2.1', '0.2.2', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta',
    '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.2', '10.0.0', '99999999999999999999.0.0'];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1]!, ordered[i]!), -1, `${ordered[i - 1]} < ${ordered[i]}`);
    assert.equal(compareVersions(ordered[i]!, ordered[i - 1]!), 1);
  }
  assert.equal(compareVersions('0.2.1', '0.2.1'), 0);
  for (const value of ['0.2.1', '1.0.2']) assert.equal(validVersion(value, true), true);
  assert.equal(validVersion('0.3.0-rc.1'), true); assert.equal(validVersion('0.3.0-rc.1', true), false);
  for (const value of ['v1.0.2', '01.0.0', '1.0', '1.0.0.0', '1.0.0+build', '1.0.0-01', 'latest', '', null, 1, `1.0.0-${'a'.repeat(80)}`])
    assert.equal(validVersion(value), false, String(value));
  assert.throws(() => compareVersions('v1.0.2', '0.2.1'));
});

test('package-manager guidance follows the resolved CLI path and never self-updates', () => {
  const cases: [string, NodeJS.Platform, string, string | null][] = [
    ['/usr/local/lib/node_modules/session-peer/dist/updates.js', 'linux', 'npm', 'npm install --global --ignore-scripts session-peer@0.2.2'],
    ['/home/u/.nvm/versions/node/v24.16.0/lib/node_modules/session-peer/dist/updates.js', 'darwin', 'npm', 'npm install --global --ignore-scripts session-peer@0.2.2'],
    ['C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\session-peer\\dist\\updates.js', 'win32', 'npm', 'npm install --global --ignore-scripts session-peer@0.2.2'],
    ['C:\\work\\app\\node_modules\\session-peer\\dist\\updates.js', 'win32', 'npm_project', 'npm install --ignore-scripts session-peer@0.2.2'],
    ['/work/app/node_modules/session-peer/dist/updates.js', 'linux', 'npm_project', 'npm install --ignore-scripts session-peer@0.2.2'],
    ['/home/u/.local/share/pnpm/global/5/.pnpm/session-peer@0.2.1/node_modules/session-peer/dist/updates.js', 'linux', 'pnpm', 'pnpm add --global --ignore-scripts session-peer@0.2.2'],
    ['/work/app/node_modules/.pnpm/session-peer@0.2.1/node_modules/session-peer/dist/updates.js', 'linux', 'pnpm_project', 'pnpm add --ignore-scripts session-peer@0.2.2'],
    ['/home/u/.config/yarn/global/node_modules/session-peer/dist/updates.js', 'linux', 'yarn', 'yarn global add --ignore-scripts session-peer@0.2.2'],
    ['/home/u/.bun/install/global/node_modules/session-peer/dist/updates.js', 'darwin', 'bun', 'bun add --global --ignore-scripts session-peer@0.2.2'],
    ['/home/u/.npm/_npx/abc123/node_modules/session-peer/dist/updates.js', 'linux', 'npx', 'npx --yes --ignore-scripts session-peer@0.2.2 --version'],
    ['/src/session-peer-ts/dist/updates.js', 'linux', 'source', null],
  ];
  for (const [path, platform, owner, command] of cases) {
    assert.equal(manager(path, platform), owner, path);
    assert.equal(upgradeCommand(manager(path, platform), '0.2.2'), command);
  }
});

test('cache location is platform-appropriate and overridable; registry URL is constrained', () => {
  const home = process.env.HOME;
  assert.equal(cacheDirectory({ SESSION_PEER_CACHE_DIR: resolve('fixture-cache') }, 'linux'), resolve('fixture-cache'));
  assert.throws(() => cacheDirectory({ SESSION_PEER_CACHE_DIR: 'relative' }, 'linux'));
  if (process.platform !== 'win32') {
    assert.equal(cacheDirectory({ XDG_CACHE_HOME: '/xdg' }, 'linux'), '/xdg/session-peer');
    assert.equal(cacheDirectory({ XDG_CACHE_HOME: 'relative' }, 'linux'), join(home!, '.cache/session-peer'));
    assert.equal(cacheDirectory({}, 'darwin'), join(home!, 'Library/Caches/session-peer'));
    assert.equal(cacheDirectory({ LOCALAPPDATA: '/local' }, 'win32'), join('/local', 'session-peer', 'Cache'));
  }
  assert.equal(registryUrl({}).href, 'https://registry.npmjs.org/-/package/session-peer/dist-tags');
  assert.equal(registryUrl({ SESSION_PEER_UPDATE_REGISTRY: 'https://mirror.example/npm' }).href, 'https://mirror.example/npm/-/package/session-peer/dist-tags');
  assert.equal(registryUrl({ SESSION_PEER_UPDATE_REGISTRY: 'http://[::1]:4873/' }).href, 'http://[::1]:4873/-/package/session-peer/dist-tags');
  for (const value of ['http://registry.example/', 'https://user:secret@registry.example/', 'https://registry.example/?token=x', 'ftp://registry.example/', 'not a url'])
    assert.throws(() => registryUrl({ SESSION_PEER_UPDATE_REGISTRY: value }), /invalid_update_registry/);
});

test('update --check reports npm dist-tags, writes a private atomic cache and leaves skills untouched', async t => {
  const f = await fixture(t);
  // A TS companion skill is reported by its own metadata contract; a Python skill is never inferred.
  const skill = join(f.root, '.agents/skills/session-peer-ts/SKILL.md');
  mkdirSync(join(skill, '..'), { recursive: true });
  writeFileSync(skill, '---\nname: session-peer-ts\nmetadata:\n  version: "0.1.0"\n  runtime-implementation: "typescript"\n  runtime-min-version: "0.1.0"\n  runtime-full-version: "0.1.0"\n  runtime-capability-policy: "probe-help"\n---\nBody\n');
  const python = join(f.root, '.agents/skills/session-peer/SKILL.md');
  mkdirSync(join(python, '..'), { recursive: true });
  writeFileSync(python, '---\nname: session-peer\nmetadata:\n  version: "9.9.9"\n  runtime-min-version: "1.0.2"\n---\n');
  const before = [readFileSync(skill), readFileSync(python)];
  const r = await f.call(['update', '--check', '--json']);
  assert.equal(r.code, 0, r.stdout); assert.equal(r.stderr, '');
  assert.deepEqual(f.requests, ['/-/package/session-peer/dist-tags']);
  const v = r.value;
  assert.equal(v.command, 'update'); assert.equal(v.ok, true); assert.equal(v.package, 'session-peer');
  assert.equal(v.current, '0.2.1'); assert.equal(v.latest, '0.2.2'); assert.equal(v.channel, 'latest'); assert.equal(v.distTag, 'latest');
  assert.equal(v.source, 'npm_registry'); assert.equal(v.status, 'update_available'); assert.equal(v.outdated, true); assert.equal(v.updated, false);
  assert.equal(v.referenceVersion, '1.0.2');
  // The test runs from a checkout; installed-path guidance is covered above and in package-smoke.
  assert.equal(v.managedBy, 'source'); assert.equal(v.updateCommand, null);
  assert.equal(v.skillsManagedBy, 'separate');
  assert.deepEqual(v.skills.map((item: Record<string, unknown>) => item.code), ['skill_contract_compatible', 'skill_missing']);
  assert.equal(JSON.stringify(v).includes(join('skills', 'session-peer', 'SKILL.md')), false);
  assert.deepEqual([readFileSync(skill), readFileSync(python)], before);
  const cached = JSON.parse(readFileSync(f.file, 'utf8'));
  assert.deepEqual(Object.keys(cached).sort(), ['channel', 'checkedAt', 'latest', 'package', 'schemaVersion', 'source']);
  assert.equal(cached.latest, '0.2.2');
  assert.deepEqual(readdirSync(f.cache), ['npm-update.json']);
  if (process.platform !== 'win32') {
    assert.equal(statSync(f.cache).mode & 0o777, 0o700); assert.equal(statSync(f.file).mode & 0o777, 0o600);
  }
  const text = await f.call(['update', '--check', '--output-format', 'text']);
  assert.equal(text.code, 0); assert.match(text.stdout, /0\.2\.1 \(typescript\): 0\.2\.2 available on npm dist-tag latest/);
  assert.match(text.stdout, /source checkout/); assert.equal(text.stderr, '');
  f.state.reply = { body: JSON.stringify({ latest: '0.2.1' }) };
  const current = await f.call(['update', '--check', '--json']);
  assert.equal(current.value.status, 'up_to_date'); assert.equal(current.value.outdated, false); assert.equal(current.value.updateCommand, null);
});

test('preview channel accepts prereleases, compares separately and does not replace the stable cache', async t => {
  const f = await fixture(t);
  f.seed('0.2.1');
  const before = readFileSync(f.file, 'utf8');
  const ahead = await f.call(['update', '--check', '--channel', 'preview', '--json']);
  assert.equal(ahead.code, 0); assert.equal(ahead.value.latest, '0.3.0-preview.1'); assert.equal(ahead.value.channel, 'preview');
  assert.equal(ahead.value.status, 'update_available'); assert.equal(ahead.value.outdated, true);
  f.state.reply = { body: JSON.stringify({ latest: '0.2.1', preview: '0.1.0-preview.1' }) };
  const older = await f.call(['update', '--check', '--channel=preview', '--json']);
  assert.equal(older.value.status, 'ahead'); assert.equal(older.value.outdated, false); assert.equal(older.value.updateCommand, null);
  assert.equal(readFileSync(f.file, 'utf8'), before);
  f.state.reply = { body: JSON.stringify({ latest: '0.2.1' }) };
  const missing = await f.call(['update', '--check', '--channel', 'preview', '--json']);
  assert.equal(missing.code, 1); assert.equal(missing.value.error, 'dist_tag_missing');
});

test('invalid, failed and slow registry responses refuse without printing bodies or writing the cache', async t => {
  const f = await fixture(t);
  const cases: [Reply, string][] = [
    [{ body: JSON.stringify({ latest: '0.3.0-rc.1', note: SENTINEL }) }, 'registry_response_invalid'],
    [{ body: JSON.stringify({ latest: 'v9.9.9', note: SENTINEL }) }, 'registry_response_invalid'],
    [{ body: JSON.stringify({ latest: 9, note: SENTINEL }) }, 'registry_response_invalid'],
    [{ body: `[${JSON.stringify(SENTINEL)}]` }, 'registry_response_invalid'],
    [{ body: `${SENTINEL} not json` }, 'registry_response_invalid'],
    [{ body: JSON.stringify({ latest: '0.2.2', padding: SENTINEL.repeat(4000) }) }, 'registry_response_invalid'],
    [{ status: 500, body: SENTINEL }, 'registry_http_error'],
    [{ status: 302, body: SENTINEL }, 'registry_unreachable'],
  ];
  for (const [reply, error] of cases) {
    f.state.reply = reply;
    const r = await f.call(['update', '--check', '--json']);
    assert.equal(r.code, 1, error); assert.equal(r.value.ok, false); assert.equal(r.value.error, error);
    assert.equal(r.stdout.includes(SENTINEL) || r.stderr.includes(SENTINEL), false);
    const text = await f.call(['update', '--check', '--output-format=text']);
    assert.match(text.stdout, new RegExp(`Error: ${error}`)); assert.equal(text.stdout.includes(SENTINEL), false);
  }
  f.state.reply = { body: JSON.stringify({ latest: '0.2.2' }), wait: 8000 };
  const started = Date.now();
  const slow = await f.call(['update', '--check', '--json']);
  assert.equal(slow.value.error, 'registry_timeout'); assert.ok(Date.now() - started < 7000, 'bounded timeout');
  const offline = await f.call(['update', '--check', '--json'], { SESSION_PEER_UPDATE_REGISTRY: 'http://127.0.0.1:9/' });
  // Windows may report a refused loopback connection only after its SYN retries.
  assert.equal(offline.code, 1); assert.match(offline.value.error, /^registry_(?:unreachable|timeout)$/);
  const invalid = await f.call(['update', '--check', '--json'], { SESSION_PEER_UPDATE_REGISTRY: 'http://registry.example/' });
  assert.equal(invalid.code, 2); assert.equal(invalid.value.error, 'invalid_update_registry');
  assert.equal(existsSync(f.file), false);
});

test('update without --check refuses with ownership guidance and no network; options are bounded', async t => {
  const f = await fixture(t);
  const r = await f.call(['update', '--json']);
  assert.equal(r.code, 2); assert.equal(r.value.ok, false); assert.equal(r.value.error, 'self_update_unsupported');
  assert.equal(r.value.updated, false); assert.equal(r.value.submitted, false); assert.equal(r.value.retryAllowed, false);
  assert.equal(r.value.managedBy, 'source'); assert.equal(r.value.updateCommand, null);
  assert.equal(r.value.checkCommand, 'session-peer update --check --json');
  const preview = await f.call(['update', '--channel', 'preview', '--json']);
  assert.equal(preview.value.checkCommand, 'session-peer update --check --channel preview --json');
  const text = await f.call(['update', '--output-format', 'text']);
  assert.equal(text.code, 2); assert.match(text.stdout, /Error: self_update_unsupported/); assert.match(text.stdout, /source checkout/);
  const help = await f.call(['update', '--help']);
  assert.equal(help.code, 0); assert.match(help.stdout, /^Usage: session-peer update --check/); assert.match((await f.call(['--help'])).stdout, /^  update --check\s/m);
  for (const [args, error] of [
    [['update', '--check'], 'json_output_required'],
    [['update', '--check', '--json', '--host', 'example'], 'inapplicable_option'],
    [['update', '--check', '--json', '--all'], 'inapplicable_option'],
    [['update', '--check', '--json', '--agent', 'codex'], 'inapplicable_option'],
    [['update', '--check', '--json', 'positional'], 'invalid_positional_message'],
    [['update', '--check', '--json', '--channel', 'beta'], 'unsupported_update_channel'],
    [['update', '--check', '--check', '--json'], 'invalid_option'],
    [['list', '--json', '--check'], 'inapplicable_option'],
    [['doctor', '--json', '--channel', 'latest'], 'inapplicable_option'],
    [['send', '--to', 'fixture', '--json', '--check', 'hi'], 'inapplicable_option'],
  ] as [string[], string][]) {
    const refused = await f.call(args);
    assert.equal(refused.code, 2, args.join(' ')); assert.equal(refused.value.error, error, args.join(' '));
  }
  const wire = await f.call(['--stdio-request'], {}, JSON.stringify({ schemaVersion: 1, args: ['update', '--check', '--json'] }));
  assert.equal(wire.code, 2); assert.equal(wire.value.error, 'remote_update_unsupported');
  assert.deepEqual(f.requests, []); assert.equal(existsSync(f.cache), false);
});

test('cached notices are off by default, opt-in additive, stderr-only in text and opt-out wins', async t => {
  const f = await fixture(t);
  f.seed('0.2.2');
  const plain = await f.call(['list', '--json']);
  assert.equal(plain.code, 0); assert.equal('clientUpdate' in plain.value, false); assert.equal(plain.stderr, '');
  const on = { SESSION_PEER_UPDATE_NOTICE: '1' };
  const json = await f.call(['list', '--json'], on);
  assert.equal(json.code, 0); assert.equal(json.stderr, '');
  const { clientUpdate, ...rest } = json.value;
  assert.deepEqual(rest, plain.value);
  assert.deepEqual(Object.keys(clientUpdate).sort(), ['channel', 'checkedAt', 'command', 'current', 'latest', 'managedBy', 'schemaVersion', 'source', 'status']);
  assert.equal(clientUpdate.status, 'available'); assert.equal(clientUpdate.current, '0.2.1'); assert.equal(clientUpdate.latest, '0.2.2');
  assert.equal(clientUpdate.source, 'npm_registry_cache'); assert.match(clientUpdate.checkedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const textOff = await f.call(['list', '--output-format', 'text']);
  const textOn = await f.call(['list', '--output-format', 'text'], { SESSION_PEER_UPDATE_NOTICE: 'yes' });
  assert.equal(textOn.stdout, textOff.stdout); assert.equal(textOn.code, textOff.code);
  assert.match(textOn.stderr, /^Update available: session-peer 0\.2\.1 -> 0\.2\.2 \(npm dist-tag latest\)\. Update this source checkout and rebuild\.\n$/);
  const doctor = await f.call(['doctor', '--json'], on);
  assert.equal(doctor.value.clientUpdate.latest, '0.2.2'); assert.equal(doctor.value.capabilities.updateCheck, true); assert.equal(doctor.value.capabilities.selfUpdate, false);
  const refusal = await f.call(['send', '--to', 'codex:bad', '--json', 'hi'], on);
  assert.equal(refusal.code, 2); assert.equal('clientUpdate' in refusal.value, false);
  for (const [args, extra] of [[['list', '--json', '--no-update-notice'], on], [['list', '--json'], { ...on, SESSION_PEER_NO_UPDATE_NOTICE: 'TRUE' }],
    [['list', '--output-format', 'text', '--no-update-notice'], on]] as [string[], NodeJS.ProcessEnv][]) {
    const r = await f.call(args, extra);
    assert.equal(r.code, 0); assert.equal(r.stderr, ''); assert.equal(r.value?.clientUpdate, undefined);
  }
  f.seed('0.2.1');
  assert.equal('clientUpdate' in (await f.call(['list', '--json'], on)).value, false);
  // Python's own update.json in the same directory is a different release stream.
  writeFileSync(join(f.cache, 'update.json'), JSON.stringify({ schemaVersion: 1, latest: '9.9.9', checkedAt: Math.floor(Date.now() / 1000) }));
  assert.equal('clientUpdate' in (await f.call(['list', '--json'], on)).value, false);
  assert.deepEqual(f.requests, []);
});

test('missing, expired and invalid caches refresh once in the background without changing results', async t => {
  const f = await fixture(t);
  const on = { SESSION_PEER_UPDATE_NOTICE: '1' };
  const baseline = await f.call(['list', '--json']);
  const first = await f.call(['list', '--json'], on);
  assert.deepEqual(first.value, baseline.value); assert.equal(first.code, baseline.code); assert.equal(first.stderr, '');
  await f.settled(1);
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).latest, '0.2.2');
  if (process.platform !== 'win32') assert.equal(statSync(f.file).mode & 0o777, 0o600);
  assert.equal((await f.call(['list', '--json'], on)).value.clientUpdate.latest, '0.2.2');
  assert.equal(f.requests.length, 1, 'fresh cache does not refresh');
  f.seed('0.2.2', 25 * 3600_000);
  assert.equal('clientUpdate' in (await f.call(['list', '--json'], on)).value, false, 'expired cache is not shown');
  await f.settled(2); assert.equal(f.requests.length, 2);
  for (const content of ['not json', JSON.stringify({ schemaVersion: 1, package: 'session-peer', source: 'npm_registry', channel: 'latest', latest: '0.3.0-rc.1', checkedAt: Date.now() }),
    JSON.stringify({ schemaVersion: 1, package: 'session-peer', source: 'npm_registry', channel: 'latest', latest: '0.2.2', checkedAt: Date.now() + 3600_000 }), 'x'.repeat(5000)]) {
    const count: number = f.requests.length;
    writeFileSync(f.file, content);
    const r = await f.call(['list', '--json'], on);
    assert.equal(r.code, 0); assert.equal('clientUpdate' in r.value, false);
    await f.settled(count + 1); assert.equal(f.requests.length, count + 1);
    assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).latest, '0.2.2');
  }
});

test('concurrent invocations perform one bounded refresh; locks and failures back off', async t => {
  const f = await fixture(t, { body: JSON.stringify({ latest: '0.2.2' }), wait: 1000 });
  const on = { SESSION_PEER_UPDATE_NOTICE: '1' };
  const results = await Promise.all(Array.from({ length: 8 }, () => f.call(['list', '--json'], on)));
  for (const r of results) { assert.equal(r.code, 0); assert.equal('clientUpdate' in r.value, false); }
  await f.settled(1); await delay(500);
  assert.equal(f.requests.length, 1, 'single flight');
  // A live lock suppresses refresh; a stale lock is replaced.
  rmSync(f.file); writeFileSync(f.lock, 'other');
  await f.call(['list', '--json'], on); await delay(1500);
  assert.equal(f.requests.length, 1); assert.equal(existsSync(f.file), false);
  const old = new Date(Date.now() - 120_000); utimesSync(f.lock, old, old);
  await f.call(['list', '--json'], on);
  await f.settled(2); assert.equal(f.requests.length, 2);
  // Offline/failed refresh records a backoff without a version and never alters output.
  f.state.reply = { status: 503, body: SENTINEL };
  f.seed('0.2.2', 25 * 3600_000);
  const offline = await f.call(['list', '--json'], on);
  assert.equal(offline.code, 0); assert.equal(offline.stdout.includes(SENTINEL), false);
  await f.settled(3); assert.equal(f.requests.length, 3);
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).latest, null);
  await f.call(['list', '--json'], on); await delay(1000);
  assert.equal(f.requests.length, 3, 'failure backoff');
  const offlineCache = join(f.root, 'offline');
  const unreachable = await f.call(['list', '--json'], { ...on, SESSION_PEER_UPDATE_REGISTRY: 'http://127.0.0.1:9/', SESSION_PEER_CACHE_DIR: offlineCache });
  assert.equal(unreachable.code, 0); assert.equal(unreachable.stderr, '');
  for (let i = 0; i < 200 && !(existsSync(join(offlineCache, 'npm-update.json')) && !existsSync(join(offlineCache, 'npm-update.lock'))); i++) await delay(50);
  assert.equal(JSON.parse(readFileSync(join(offlineCache, 'npm-update.json'), 'utf8')).latest, null);
});

test('remote wire requests never read, refresh or report client notices', async t => {
  const f = await fixture(t);
  const on = { SESSION_PEER_UPDATE_NOTICE: '1' };
  const wire = await f.call(['--stdio-request'], on, JSON.stringify({ schemaVersion: 1, args: ['list', '--json'] }));
  assert.equal(wire.code, 0); assert.equal('clientUpdate' in wire.value, false);
  f.seed('0.2.2');
  const seeded = await f.call(['--stdio-request'], on, JSON.stringify({ schemaVersion: 1, args: ['doctor', '--json'] }));
  assert.equal('clientUpdate' in seeded.value, false);
  await delay(1000);
  assert.deepEqual(f.requests, []); assert.deepEqual(readdirSync(f.cache), ['npm-update.json']);
});
