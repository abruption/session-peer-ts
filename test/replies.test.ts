// #21: sender context, reply routes, Tailscale routing hints and the opt-in
// return-route probe. Fake ssh/tailscale executables only; no network.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reply } from '../dist/protocol.js';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { detectedHost, isSelf, localName, namesThisMachine, probeReturnRoute, replyUri, route, sender, unsafeReturnHost, type Tailnet } from '../dist/replies.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const posix = { skip: process.platform === 'win32' };
const me = userInfo().username;
const id = '22222222-2222-4222-8222-222222222222';
const node = (ID: string, name: string, online = true, ips: string[] = []) =>
  ({ ID, HostName: name, DNSName: `${name}.tail.ts.net.`, TailscaleIPs: ips, Online: online });
const statusJson = {
  BackendState: 'Running', CurrentTailnet: { MagicDNSEnabled: true },
  Self: node('s', 'origin', true, ['100.64.0.1', 'fd7a:115c:a1e0::1']),
  Peer: { w: node('w', 'worker', true, ['100.64.0.2']), o: node('o', 'sleepy', false), a: node('a', 'twin'), b: node('b', 'twin') }
};
const tailnetOf = (status: typeof statusJson, magicDNS = true): Tailnet => ({ magicDNS, self: status.Self, nodes: [status.Self, ...Object.values(status.Peer)] });

// Snapshot the environment once per test; later calls in the same test only change it.
const snapshots = new WeakSet<TestContext>();
function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  if (!snapshots.has(t)) {
    snapshots.add(t);
    const saved = { ...process.env };
    t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  }
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
function registry(t: TestContext, sessions: { pid: number; name: string; socket: string }[]) {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-replies-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/sessions'), { recursive: true });
  for (const session of sessions) writeFileSync(join(root, '.claude/sessions', `${session.pid}.json`), JSON.stringify({ pid: session.pid, name: session.name, messagingSocketPath: session.socket }));
  return root;
}

test('sender context uses bounded evidence and omits absent or ambiguous identities', posix, t => {
  const root = registry(t, [{ pid: process.pid, name: 'worker', socket: `/run/claude/${process.pid}.sock` }]);
  withEnv(t, { CLAUDE_CONFIG_DIR: join(root, '.claude'), CLAUDE_CODE_MESSAGING_SOCKET: undefined, CODEX_THREAD_ID: undefined, CODEX_SESSION_ID: undefined, CODEX_HOME: undefined });
  assert.equal(sender(), undefined);
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = `/run/claude/${process.pid}.sock`;
  assert.deepEqual(sender(), { agent: 'claude', id: 'worker' });
  // Nested Claude/Codex evidence is ambiguous: no identity, unlike Python's Claude precedence.
  process.env.CODEX_THREAD_ID = id; assert.equal(sender(), undefined);
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = '/run/claude/999999999.sock'; assert.equal(sender(), undefined);
  delete process.env.CLAUDE_CODE_MESSAGING_SOCKET;
  assert.deepEqual(sender(), { agent: 'codex', id });
  process.env.CODEX_HOME = root; assert.deepEqual(sender(), { agent: 'codex', id, codexHome: root });
  process.env.CODEX_HOME = 'relative/home'; assert.deepEqual(sender(), { agent: 'codex', id });
  process.env.CODEX_SESSION_ID = id.toUpperCase(); assert.deepEqual(sender(), { agent: 'codex', id });
  process.env.CODEX_SESSION_ID = '33333333-3333-4333-8333-333333333333'; assert.equal(sender(), undefined);
  delete process.env.CODEX_THREAD_ID; assert.deepEqual(sender(), { agent: 'codex', id: '33333333-3333-4333-8333-333333333333' });
  process.env.CODEX_SESSION_ID = 'not-a-uuid'; assert.equal(sender(), undefined);
});

test('Claude names that are not unique, printable reply targets fall back to the PID', posix, t => {
  for (const [name, other] of [['Worker', 'wORKER'], ['12345', 'x'], ['a:b', 'x'], ['line\nbreak', 'x']]) {
    const root = registry(t, [{ pid: process.pid, name: name!, socket: `/s/${process.pid}.sock` }, { pid: process.ppid, name: other!, socket: '/s/other.sock' }]);
    withEnv(t, { CLAUDE_CONFIG_DIR: join(root, '.claude'), CLAUDE_CODE_MESSAGING_SOCKET: `/s/${process.pid}.sock`, CODEX_THREAD_ID: undefined, CODEX_SESSION_ID: undefined });
    assert.deepEqual(sender(), { agent: 'claude', id: String(process.pid) }, name);
  }
  // Without a PID-bearing path, only an exact registered socket matches.
  const root = registry(t, [{ pid: process.pid, name: 'pipe-worker', socket: '\\\\.\\pipe\\claude-fixture' }]);
  withEnv(t, { CLAUDE_CONFIG_DIR: join(root, '.claude'), CLAUDE_CODE_MESSAGING_SOCKET: '\\\\.\\pipe\\claude-fixture', CODEX_THREAD_ID: undefined, CODEX_SESSION_ID: undefined });
  assert.deepEqual(sender(), { agent: 'claude', id: 'pipe-worker' });
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = '\\\\.\\pipe\\claude-other'; assert.equal(sender(), undefined);
});

test('Tailscale status is a routing hint: online resolves, offline refuses, unknown stays SSH', () => {
  const status = tailnetOf(statusJson);
  assert.deepEqual(route('worker', status), { canonical: 'worker.tail.ts.net', hostName: 'worker.tail.ts.net', hostKeyAlias: 'worker' });
  assert.deepEqual(route('alice@100.64.0.2', status), { canonical: 'alice@worker.tail.ts.net', hostName: 'worker.tail.ts.net', hostKeyAlias: '100.64.0.2' });
  assert.deepEqual(route('worker.tail.ts.net', status), { canonical: 'worker.tail.ts.net' });
  assert.deepEqual(route('elsewhere.example', status), { canonical: 'elsewhere.example' });
  assert.deepEqual(route('worker', undefined), { canonical: 'worker' });
  assert.throws(() => route('sleepy', status), /tailscale_peer_offline/);
  assert.throws(() => route('twin', status), /tailscale_destination_ambiguous/);
  // Only boolean Online values are known states; anything else is ordinary SSH.
  for (const online of [undefined, null, 'true', 'false', 1, 0]) {
    const peer = { ID: 'm', HostName: 'maybe', DNSName: 'maybe.tail.ts.net.', ...(online === undefined ? {} : { Online: online }) };
    assert.deepEqual(route('maybe', { magicDNS: true, nodes: [peer] }), { canonical: 'maybe' }, String(online));
  }
  // Without MagicDNS nothing is canonicalized, but a known-offline peer is still refused.
  assert.deepEqual(route('worker', tailnetOf(statusJson, false)), { canonical: 'worker' });
  assert.throws(() => route('sleepy', tailnetOf(statusJson, false)), /tailscale_peer_offline/);
  assert.equal(detectedHost(status), 'origin.tail.ts.net');
  assert.equal(detectedHost(tailnetOf(statusJson, false)), '100.64.0.1');
  assert.equal(detectedHost({ magicDNS: false, self: { TailscaleIPs: ['10.0.0.1', '100.128.0.1'] }, nodes: [] }), undefined);
  assert.equal(detectedHost(undefined), undefined);
});

test('same-machine routes require both this user and a local name', () => {
  const status = tailnetOf(statusJson);
  for (const destination of [`${me}@localhost`, `${me}@127.0.0.1`, `${me}@${hostname().toLowerCase()}`, `${me}@origin`, `${me}@origin.tail.ts.net`, `${me}@100.64.0.1`])
    assert.equal(isSelf(destination, status), true, destination);
  for (const destination of ['localhost', 'origin', `not-${me}@localhost`, `not-${me}@origin`, `${me}@worker`, `${me}@elsewhere`])
    assert.equal(isSelf(destination, status), false, destination);
  assert.equal(isSelf(`${me}@origin`, undefined), false);
});

test('generated reply URIs round-trip through the structured parser', () => {
  const local = replyUri({ agent: 'claude', id: 'api worker' });
  assert.equal(local, 'session-peer://v1/reply?agent=claude&session=api+worker&transport=local');
  assert.deepEqual(reply(local), { to: 'api worker' });
  const ssh = replyUri({ agent: 'codex', id, codexHome: '/srv/codex' }, 'alice@origin.tail.ts.net');
  assert.deepEqual(reply(ssh), { to: `codex:${id}`, host: 'alice@origin.tail.ts.net', home: '/srv/codex' });
  assert.throws(() => replyUri({ agent: 'claude', id: 'x' }, '-oProxyCommand=id'), /invalid/);
  assert.throws(() => replyUri({ agent: 'codex', id: 'not-a-uuid' }), /invalid_reply_uri/);
});

// CLI fixtures. Fake ssh logs every non -G call. A final `exit 0` argument is the
// reverse probe (FAKE_PROBE); anything else proxies to this CLI as a distinct
// "remote" without Tailscale. Fake tailscale prints FAKE_TS or fails.
function fixture(t: TestContext) {
  const path = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-replies-cli-')));
  mkdirSync(join(path, '.claude/sessions'), { recursive: true });
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const log = join(path, 'ssh-calls'), tsLog = join(path, 'tailscale-calls');
  writeFileSync(join(path, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
if(args.includes('-G')){if(process.env.FAKE_G==='fail')process.exit(255);console.log('user config-user'+(process.env.FAKE_HKA?'\\nhostkeyalias '+process.env.FAKE_HKA:''));process.exit(0);}
const input=fs.readFileSync(0,'utf8');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,input})+'\\n');
const dest=args[args.indexOf('--')+1];
if(args.at(-1)==='exit 0'){const mode=process.env.FAKE_PROBE;
  if(mode==='ok')process.exit(0);
  if(mode==='hang'){setTimeout(()=>{},60000);return;}
  if(mode==='auth'){console.error('Permission denied (publickey). SECRET-SENTINEL');process.exit(255);}
  if(mode==='hostkey'){console.error('Host key verification failed. SECRET-SENTINEL');process.exit(255);}
  if(mode==='timeout'){console.error('ssh: connect to host origin port 22: Operation timed out SECRET-SENTINEL');process.exit(255);}
  console.error('SECRET-SENTINEL');process.exit(1);}
if((process.env.FAKE_DOWN||'').split(',').includes(dest)){console.error('Connection refused');process.exit(255);}
if(args.at(-1).endsWith('--version')){console.log('session-peer 0.2.1 (typescript)');process.exit(0);}
const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},'--stdio-request'],{input,encoding:'utf8',env:{...process.env,SESSION_PEER_TAILSCALE:'off'}});
process.stdout.write(r.stdout);process.exit(r.status);`, { mode: 0o700 });
  writeFileSync(join(path, 'tailscale'), `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(tsLog)},'1');
if(!process.env.FAKE_TS)process.exit(1);process.stdout.write(process.env.FAKE_TS);`, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: path, USERPROFILE: path, CLAUDE_CONFIG_DIR: join(path, '.claude'),
    CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', PATH: path + delimiter + process.env.PATH };
  const calls = (): { args: string[]; input: string }[] => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const tailscaleCalls = () => existsSync(tsLog) ? readFileSync(tsLog, 'utf8').length : 0;
  async function invoke(args: string[], extra: NodeJS.ProcessEnv = {}, format = ['--json']) {
    const child = spawn(process.execPath, [cli, ...args, ...format], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; child.stdout.on('data', x => { stdout += x; }); child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const [code] = await once(child, 'close'); clearTimeout(timer);
    return { code: code as number, stdout, value: format[0] === '--json' ? JSON.parse(stdout) : undefined };
  }
  return { path, env, calls, tailscaleCalls, invoke };
}
// A live Claude inbox registered as this test process; it is also the sender.
async function inbox(t: TestContext, path: string, name = 'fixture') {
  const messages: string[] = [], socket = join(path, `${process.pid}.sock`);
  const server = createServer(s => {
    let data = ''; s.on('data', chunk => { data += chunk; });
    s.on('end', () => { messages.push(JSON.parse(data).message.content); s.end(); });
  });
  server.listen(socket); await once(server, 'listening');
  t.after(() => new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())));
  writeFileSync(join(path, '.claude/sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name, messagingSocketPath: socket }));
  return { messages, socket };
}
const ts = JSON.stringify(statusJson);

test('local send adds verified From and Reply-To only for a detected sender', posix, async t => {
  const f = fixture(t), { messages, socket } = await inbox(t, f.path), as = { CLAUDE_CODE_MESSAGING_SOCKET: socket };
  const base = ['send', '--to', 'fixture', '--message', 'hello $(touch pwned)'];
  const local = 'session-peer://v1/reply?agent=claude&session=fixture&transport=local';
  const sent = await f.invoke(base, as);
  assert.equal(sent.value.status, 'posted');
  assert.deepEqual(sent.value.replyRoute, { uri: local, transport: 'local', status: 'verified', reason: 'same_machine_route' });
  assert.equal(messages.at(-1), `From: claude:fixture\n\nhello $(touch pwned)\n\n---\nReply-To: ${local}`);
  assert.equal(existsSync(join(f.path, 'pwned')), false);
  assert.equal((await f.invoke([...base, '--no-from'], as)).value.status, 'posted');
  assert.equal(messages.at(-1), `hello $(touch pwned)\n\n---\nReply-To: ${local}`);
  const fromOnly = await f.invoke([...base, '--no-reply-to'], as);
  assert.equal('replyRoute' in fromOnly.value, false); assert.equal(messages.at(-1), 'From: claude:fixture\n\nhello $(touch pwned)');
  // Absent or ambiguous sender evidence: no identity and no generated route.
  for (const extra of [{}, { ...as, CODEX_THREAD_ID: id }]) {
    const plain = await f.invoke(base, extra);
    assert.equal('replyRoute' in plain.value, false); assert.equal(messages.at(-1), 'hello $(touch pwned)');
  }
  // --reply-to beats SESSION_PEER_REPLY_HOST, which beats CC_PEER_REPLY_HOST; a remote host stays unverified.
  for (const [extra, args, expected] of [
    [{ SESSION_PEER_REPLY_HOST: 'env-host', CC_PEER_REPLY_HOST: 'legacy-host' }, ['--reply-to', 'bob@flag-host'], 'bob@flag-host'],
    [{ SESSION_PEER_REPLY_HOST: 'env-host', CC_PEER_REPLY_HOST: 'legacy-host' }, [], `${me}@env-host`],
    [{ CC_PEER_REPLY_HOST: 'legacy-host' }, [], `${me}@legacy-host`],
  ] as const) {
    const routed = await f.invoke([...base, ...args], { ...as, ...extra });
    const uri = `session-peer://v1/reply?agent=claude&session=fixture&transport=ssh&host=${encodeURIComponent(expected)}`;
    assert.deepEqual(routed.value.replyRoute, { uri, transport: 'ssh', status: 'unverified', reason: 'reverse_ssh_not_checked' });
    assert.ok(messages.at(-1)!.endsWith(`Reply-To: ${uri}`));
  }
  // This user on this machine is a local route, never an SSH one.
  const self = await f.invoke([...base, '--reply-to', `${me}@localhost`], as);
  assert.equal(self.value.replyRoute.transport, 'local');
  for (const [args, error] of [[['--reply-to', 'x', '--no-reply-to'], 'conflicting_reply_options'], [['--reply-to', 'x', '--reply-address', local], 'conflicting_reply_options'],
    [['--reply-to', '-oProxyCommand=id'], 'invalid_reply_host'], [['--reply-to', 'a b'], 'invalid_reply_host'], [['--check-return-route'], 'inapplicable_option']] as const) {
    const refused = await f.invoke([...base, ...args], as);
    assert.equal(refused.value.error, error); assert.equal(refused.value.submitted, false);
  }
  const badEnv = await f.invoke(base, { ...as, SESSION_PEER_REPLY_HOST: 'bad host' });
  assert.equal(badEnv.value.error, 'invalid_reply_host');
  assert.equal(messages.length, 9); assert.deepEqual(f.calls(), []); assert.equal(f.tailscaleCalls(), 0);
});

test('Tailscale routing keeps the alias, resolves online peers and refuses offline peers before SSH', posix, async t => {
  const f = fixture(t), on = { SESSION_PEER_TAILSCALE: '', FAKE_TS: ts };
  const listed = await f.invoke(['list', '--agent', 'claude', '--host', 'worker', '--host', 'sleepy', '--host', 'elsewhere', '--ssh-opt=-p', '--ssh-opt=2222'], on);
  assert.equal(listed.code, 1); assert.equal(f.tailscaleCalls(), 1);
  const [worker, sleepy, elsewhere] = listed.value;
  assert.equal(worker.ok, true); assert.equal(worker.host, 'worker.tail.ts.net'); assert.equal(worker.sshHost, 'worker');
  assert.equal(sleepy.ok, false); assert.equal(sleepy.error, 'tailscale_peer_offline'); assert.equal(sleepy.submitted, false); assert.equal(sleepy.host, 'sleepy');
  assert.equal(elsewhere.ok, true); assert.equal(elsewhere.host, 'elsewhere');
  const calls = f.calls();
  assert.deepEqual(calls.map(call => call.args[call.args.indexOf('--') + 1]), ['worker', 'worker', 'elsewhere', 'elsewhere']);
  assert.deepEqual(calls[0]!.args.slice(0, -1), ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    '-o', 'HostName=worker.tail.ts.net', '-o', 'HostKeyAlias=worker', '-p', '2222', '--', 'worker']);
  assert.equal(calls[2]!.args.some(arg => arg.startsWith('HostName=')), false);
  const single = await f.invoke(['list', '--agent', 'claude', '--host', 'sleepy'], on);
  assert.equal(single.value.error, 'tailscale_peer_offline'); assert.equal(single.code, 1);
  // Missing, stopped or failing Tailscale is ordinary SSH.
  for (const extra of [{ SESSION_PEER_TAILSCALE: '', FAKE_TS: '' }, { SESSION_PEER_TAILSCALE: '', FAKE_TS: JSON.stringify({ ...statusJson, BackendState: 'Stopped' }) }, { SESSION_PEER_TAILSCALE: 'off', FAKE_TS: ts }]) {
    const before = f.calls().length;
    const plain = await f.invoke(['list', '--agent', 'claude', '--host', 'sleepy'], extra);
    assert.equal(plain.value.ok, true); assert.equal(plain.value.host, 'sleepy');
    assert.equal(f.calls().slice(before).some(call => call.args.some(arg => arg.startsWith('HostName='))), false);
  }
  assert.equal(f.tailscaleCalls(), 4);
  // A HostKeyAlias pinned in ssh_config (seen through the same ssh -G) is kept;
  // an unreadable configuration is never overridden either. HostName is still canonical.
  for (const [extra, expected] of [[{ FAKE_HKA: 'pinned-worker-key' }, false], [{ FAKE_G: 'fail' }, false], [{}, true]] as const) {
    for (const destination of ['worker', 'audit@worker']) {
      const before = f.calls().length;
      const result = await f.invoke(['list', '--agent', 'claude', '--host', destination], { ...on, ...extra });
      assert.equal(result.value.ok, true);
      for (const call of f.calls().slice(before)) {
        assert.ok(call.args.includes('HostName=worker.tail.ts.net'));
        assert.equal(call.args.includes('HostKeyAlias=worker'), expected, `${destination} ${JSON.stringify(extra)}`);
        assert.equal(call.args.some(arg => arg.startsWith('HostKeyAlias=') && arg !== 'HostKeyAlias=worker'), false);
      }
    }
  }
});

test('remote send carries the detected SSH return route; self reply URIs normalize to local', posix, async t => {
  const f = fixture(t), { messages } = await inbox(t, f.path), on = { SESSION_PEER_TAILSCALE: '', FAKE_TS: ts };
  const sent = await f.invoke(['send', '--host', 'worker', '--to', 'fixture', '--message', 'remote hello'], { ...on, CODEX_THREAD_ID: id });
  const uri = `session-peer://v1/reply?agent=codex&session=${id}&transport=ssh&host=${encodeURIComponent(`${me}@origin.tail.ts.net`)}`;
  assert.equal(sent.value.status, 'posted'); assert.equal(sent.value.host, 'worker.tail.ts.net');
  assert.deepEqual(sent.value.replyRoute, { uri, transport: 'ssh', status: 'unverified', reason: 'reverse_ssh_not_checked' });
  assert.equal(messages.at(-1), `From: codex:${id}\n\nremote hello\n\n---\nReply-To: ${uri}`);
  assert.equal(f.tailscaleCalls(), 1);
  // Remote destination: the message travels in stdin JSON, never in argv.
  for (const call of f.calls()) assert.equal(call.args.some(arg => arg.includes('remote hello') || arg.includes('Reply-To')), false);
  // A remote send never advertises a loopback return host: it would name the receiver.
  for (const [args, extra] of [[['--reply-to', `${me}@localhost`], {}], [['--reply-to', '127.0.0.1'], {}], [[], { SESSION_PEER_REPLY_HOST: 'localhost' }],
    [['--reply-to', '127.1'], {}], [['--reply-to', '2130706433'], {}], [['--reply-to', '0'], {}], [['--reply-to', 'bob@[::ffff:127.0.0.1]'], {}]] as const) {
    const before = f.calls().length;
    const refused = await f.invoke(['send', '--host', 'worker', '--to', 'fixture', '--message', 'x', ...args], { ...on, CODEX_THREAD_ID: id, ...extra });
    assert.equal(refused.value.error, 'invalid_reply_host'); assert.equal(refused.value.submitted, false);
    assert.equal(f.calls().length, before);
  }
  const calls = f.calls().length;
  const target = (destination: string) => `session-peer://v1/reply?agent=claude&session=fixture&transport=ssh&host=${encodeURIComponent(destination)}`;
  const self = await f.invoke(['send', '--to', target(`${me}@origin`), '--message', 'self', '--no-reply-to'], on);
  assert.equal(self.value.status, 'posted'); assert.equal(messages.at(-1), 'self');
  assert.deepEqual(self.value.addressResolution, { uri: target(`${me}@origin`), transport: 'local', normalizedFrom: 'ssh_self' });
  assert.equal(f.calls().length, calls);
  // A different or unspecified user, or an explicit --host, stays an SSH route.
  // A --ssh-jump implies SSH, so it also keeps a self URI on SSH (through the hop).
  // Non-canonical numerics and IPv4-compatible IPv6 cannot be proven to be this machine either.
  for (const [destination, extra] of [[`not-${me}@origin`, []], ['origin', []], [`${me}@origin`, ['--host', `${me}@origin`]], [`${me}@origin`, ['--ssh-jump', 'hop@jump']],
    [`${me}@0177.0.0.1`, []], [`${me}@127.1`, []], [`${me}@2130706433`, []], [`${me}@6425673729`, []], [`${me}@::7f00:1`, []], [`${me}@::127.0.0.1`, []]] as const) {
    const before = f.calls().length;
    const remote = await f.invoke(['send', '--to', target(destination), ...extra, '--message', 'stays ssh', '--no-reply-to'], { ...on, FAKE_DOWN: destination });
    assert.equal(remote.value.error, 'ssh_unreachable', destination); assert.equal(remote.value.addressResolution.transport, 'ssh');
    assert.equal('normalizedFrom' in remote.value.addressResolution, false);
    if (extra[0] === '--ssh-jump') assert.equal(remote.value.sshJump, 'hop@jump');
    assert.equal(f.calls().length, before + 1);
  }
  // Malformed and conflicting URIs are refused before any SSH or delivery.
  const before = f.calls().length;
  for (const [to, extra] of [[target('worker'), ['--host', 'other']], [target('worker'), ['--host', 'worker', '--host', 'other']],
    ['session-peer://v1/reply?agent=claude&session=x&transport=ssh', []], ['session-peer://v1/reply?agent=claude&session=x&transport=local&transport=ssh', []],
    [`session-peer://v1/reply?agent=codex&session=${id}&transport=local&codexHome=%2Fa`, ['--codex-home', '/b']],
    ['session-peer://v1/reply?agent=claude&session=x&transport=ssh&host=a%3Bid', []]] as const) {
    const refused = await f.invoke(['send', '--to', to, ...extra, '--message', 'x'], on);
    assert.match(refused.stdout, /"(reply_route_conflict|invalid_reply_uri|invalid_ssh_host)"/, to);
  }
  assert.equal(f.calls().length, before); assert.equal(messages.length, 2);
});

test('doctor --check-return-route is an explicit bounded probe; forward success never implies reverse', posix, async t => {
  const f = fixture(t);
  for (const [args, error] of [[['doctor', '--reply-to', 'a@b'], 'inapplicable_option'], [['list', '--check-return-route'], 'inapplicable_option'],
    [['doctor', '--return-route-host', 'a@b'], 'unsupported_option'], [['doctor', '--check-return-route', '--reply-to', '-oProxyCommand=id'], 'invalid_reply_host']] as const) {
    assert.equal((await f.invoke([...args])).value.error, error, args.join(' '));
  }
  const none = await f.invoke(['doctor', '--agent', 'claude']);
  assert.equal('returnRoute' in none.value, false);
  const unavailable = await f.invoke(['doctor', '--agent', 'claude', '--check-return-route']);
  assert.deepEqual(unavailable.value.returnRoute, { status: 'failed', transport: 'ssh', host: null, reason: 'return_host_unavailable' });
  const self = await f.invoke(['doctor', '--agent', 'claude', '--check-return-route', '--reply-to', `${me}@localhost`]);
  assert.equal(self.value.returnRoute.status, 'verified'); assert.equal(self.value.returnRoute.transport, 'local');
  assert.deepEqual(f.calls(), []);
  for (const [mode, status, reason] of [['ok', 'verified', 'ssh_command_succeeded'], ['auth', 'failed', 'authentication_failed'],
    ['hostkey', 'failed', 'host_key_failed'], ['timeout', 'failed', 'timeout'], ['other', 'failed', 'remote_command_failed']]) {
    const probed = await f.invoke(['doctor', '--agent', 'claude', '--check-return-route', '--reply-to', 'bob@origin'], { FAKE_PROBE: mode });
    assert.equal(probed.code, 0); assert.equal(probed.value.ok, true);
    assert.deepEqual(probed.value.returnRoute, { status, transport: 'ssh', host: 'bob@origin', reason, sshUser: 'bob', sshUserSource: 'explicit' });
    assert.equal(probed.stdout.includes('SECRET-SENTINEL'), false);
  }
  // A probe that never answers is killed at the 8 s bound and reported as a timeout, without retry.
  const started = Date.now(), hung = await f.invoke(['doctor', '--agent', 'claude', '--check-return-route', '--reply-to', 'bob@origin'], { FAKE_PROBE: 'hang' });
  assert.equal(hung.value.returnRoute.reason, 'timeout'); assert.ok(Date.now() - started < 20000);
  assert.equal(f.calls().filter(call => call.args.at(-1) === 'exit 0').length, 6);
  const probe = f.calls().at(-1)!;
  assert.deepEqual(probe.args, ['-T', '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'NumberOfPasswordPrompts=0', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=1', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '--', 'bob@origin', 'exit 0']);
  // Over SSH the destination probes back; the request carries only the return host.
  const before = f.calls().length;
  const remote = await f.invoke(['doctor', '--agent', 'claude', '--host', 'worker', '--host', 'peer', '--check-return-route', '--reply-to', 'bob@origin'], { FAKE_PROBE: 'auth' });
  assert.equal(remote.code, 0);
  for (const item of remote.value) {
    assert.equal(item.ok, true);
    assert.deepEqual(item.returnRoute, { status: 'failed', transport: 'ssh', host: 'bob@origin', reason: 'authentication_failed', sshUser: 'bob', sshUserSource: 'explicit' });
  }
  const sequence = f.calls().slice(before);
  assert.deepEqual(sequence.map(call => call.args[call.args.indexOf('--') + 1]), ['worker', 'worker', 'bob@origin', 'peer', 'peer', 'bob@origin']);
  assert.deepEqual(JSON.parse(sequence[1]!.input).args.slice(-2), ['--return-route-host', 'bob@origin']);
  // A loopback return host would name the receiver, so it is refused before any SSH.
  const quiet = f.calls().length;
  for (const target of [`${me}@localhost`, 'bob@127.0.0.1', 'bob@[::1]', ...['127.1', '2130706433', '0', '[::ffff:127.0.0.1]', '0x7f.1', '0177.0.0.1', '017700000001', '[::ffff:7f00:1]', '[::]', '0.0.0.0', '6425673729', '4294967296', '18446744075840258049', '[::7f00:1]', '[::127.0.0.1]'].map(name => `bob@${name}`)]) {
    const refused = await f.invoke(['doctor', '--agent', 'claude', '--host', 'worker', '--check-return-route', '--reply-to', target]);
    assert.equal(refused.value.error, 'invalid_return_route', target); assert.equal(refused.code, 2);
  }
  assert.equal(f.calls().length, quiet);
  // A receiver never treats a name for itself as the origin: no local "verified" route, no probe.
  const own = `${me}@${hostname().toLowerCase()}`;
  const receiver = await f.invoke(['doctor', '--agent', 'claude', '--host', 'worker', '--check-return-route', '--reply-to', own], { FAKE_PROBE: 'ok' });
  assert.deepEqual(receiver.value.returnRoute, { status: 'failed', transport: 'ssh', host: own, reason: 'return_host_is_receiver' });
  assert.equal(f.calls().slice(quiet).some(call => call.args.at(-1) === 'exit 0'), false);
  const wire = spawn(process.execPath, [cli, '--stdio-request'], { env: f.env, stdio: ['pipe', 'pipe', 'ignore'] });
  let wired = ''; wire.stdout.on('data', x => { wired += x; });
  wire.stdin.end(JSON.stringify({ schemaVersion: 1, args: ['doctor', '--json', '--agent', 'claude', '--return-route-host', 'bob@localhost'] }));
  await once(wire, 'close');
  assert.equal(JSON.parse(wired).returnRoute.reason, 'return_host_is_receiver');
  // Numeric loopback forms forwarded straight over the wire fail on the receiver too, without a probe.
  for (const name of ['127.1', '2130706433', '0', '[::ffff:127.0.0.1]', '0x7f.1', '0177.0.0.1', '017700000001', '[::ffff:7f00:1]', '[::]', '0.0.0.0', '6425673729', '4294967296', '18446744075840258049', '[::7f00:1]', '[::127.0.0.1]']) {
    const child = spawn(process.execPath, [cli, '--stdio-request'], { env: { ...f.env, FAKE_PROBE: 'ok' }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; child.stdout.on('data', x => { out += x; });
    child.stdin.end(JSON.stringify({ schemaVersion: 1, args: ['doctor', '--json', '--agent', 'claude', '--return-route-host', `bob@${name}`] }));
    await once(child, 'close');
    assert.deepEqual(JSON.parse(out).returnRoute, { status: 'failed', transport: 'ssh', host: `bob@${name.replace(/^\[|\]$/g, '')}`, reason: 'return_host_is_receiver' }, name);
  }
  assert.equal(f.calls().slice(quiet).some(call => call.args.at(-1) === 'exit 0'), false);
  // Policy: a private (RFC 1918) return host is an ordinary remote host, probed, not refused.
  const privateHost = await f.invoke(['doctor', '--agent', 'claude', '--host', 'worker', '--check-return-route', '--reply-to', 'bob@10.0.0.5'], { FAKE_PROBE: 'ok' });
  assert.deepEqual(privateHost.value.returnRoute, { status: 'verified', transport: 'ssh', host: 'bob@10.0.0.5', reason: 'ssh_command_succeeded', sshUser: 'bob', sshUserSource: 'explicit' });
  const missing = await f.invoke(['doctor', '--agent', 'claude', '--host', 'worker', '--check-return-route']);
  assert.deepEqual(missing.value.returnRoute, { status: 'failed', transport: 'ssh', host: null, reason: 'return_host_unavailable' });
  assert.equal(JSON.parse(f.calls().at(-1)!.input).args.includes('--return-route-host'), false);
  const text = await f.invoke(['doctor', '--agent', 'claude', '--check-return-route', '--reply-to', 'bob@origin'], { FAKE_PROBE: 'ok' }, ['--output-format', 'text']);
  assert.match(text.stdout, /Return route: verified via ssh \(ssh_command_succeeded\)/);
});

test('the test preload keeps CLI children away from the real tailnet and caller identity', () => {
  assert.equal(process.env.SESSION_PEER_TAILSCALE, 'off');
  for (const key of ['CLAUDE_CODE_MESSAGING_SOCKET', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'SESSION_PEER_REPLY_HOST', 'CC_PEER_REPLY_HOST']) assert.equal(process.env[key], undefined, key);
});

test('return-host refusal fails closed; local normalization accepts only canonical loopback', async t => {
  // Conservative refusal: loopback/unspecified in canonical or mapped form, IPv4-compatible
  // IPv6 and every non-canonical numeric (resolvers disagree on these), all without DNS.
  for (const name of ['localhost', 'a.localhost', '127.0.0.1', '127.5.6.7', '0.0.0.0', '0.1.2.3', '127.1', '2130706433', '0', '0x7f.1', '0177.0.0.1',
    '017700000001', '6425673729', '4294967296', '18446744075840258049', '010.0.0.1', '1.2.3', '127', '1.2.3.4.5', '0x', '08',
    '::1', '[::1]', '::', '[::ffff:127.0.0.1]', '::ffff:7f00:1', '::7f00:1', '::127.0.0.1', '::a00:1']) assert.equal(unsafeReturnHost(`bob@${name}`), true, name);
  for (const name of ['10.0.0.1', '100.64.0.1', '128.0.0.1', '2001:db8::1', '::ffff:10.0.0.1', 'worker', 'localhost.example', '1password'])
    assert.equal(unsafeReturnHost(`bob@${name}`), false, name);
  // Strict local delivery: exact localhost, canonical 127.x.y.z, ::1 and canonical mapped loopback only.
  for (const name of ['localhost', '127.0.0.1', '127.5.6.7', '::1', '[::1]', '[::ffff:127.0.0.1]', '::ffff:7f00:1']) assert.equal(localName(`bob@${name}`), true, name);
  for (const name of ['a.localhost', '0.0.0.0', '::', '127.1', '2130706433', '0177.0.0.1', '0x7f.0.0.1', '6425673729', '4294967296', '18446744075840258049',
    '::7f00:1', '::127.0.0.1', '10.0.0.1']) assert.equal(localName(`bob@${name}`), false, name);
  for (const name of ['0177.0.0.1', '127.1', '2130706433', '6425673729', '::7f00:1', '::127.0.0.1']) assert.equal(isSelf(`${me}@${name}`), false, name);
  assert.equal(isSelf(`${me}@127.0.0.1`), true); assert.equal(isSelf(`${me}@[::ffff:127.0.0.1]`), true);
  // An unusable login name must not make a receiver's own host name look remote.
  t.mock.method(os, 'userInfo', () => ({ username: 'Fixture User', uid: -1, gid: -1, shell: null, homedir: '/' }));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const own = `bob@${hostname().toLowerCase()}`;
  assert.equal(namesThisMachine(own), true); assert.equal(isSelf(own), false);
  assert.deepEqual(await probeReturnRoute(own, undefined, true), { status: 'failed', transport: 'ssh', host: own, reason: 'return_host_is_receiver' });
  assert.deepEqual(await probeReturnRoute('bob@2130706433', undefined, true), { status: 'failed', transport: 'ssh', host: 'bob@2130706433', reason: 'return_host_is_receiver' });
});

test('an unusable login name (for example with a space) never qualifies or normalizes a route', posix, async t => {
  const f = fixture(t); await inbox(t, f.path);
  const mock = join(f.path, 'user.mjs');
  writeFileSync(mock, "import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module';\n" +
    "os.userInfo = () => ({ username: 'Fixture User', uid: -1, gid: -1, shell: null, homedir: '/' }); syncBuiltinESMExports();\n");
  const as = { CODEX_THREAD_ID: id, NODE_OPTIONS: `--import ${pathToFileURL(mock).href}` };
  const base = ['send', '--to', 'fixture', '--message', 'x', '--dry-run'];
  const remote = await f.invoke([...base, '--reply-to', 'remote-host'], as);
  assert.deepEqual(remote.value.replyRoute, { uri: `session-peer://v1/reply?agent=codex&session=${id}&transport=ssh&host=remote-host`,
    transport: 'ssh', status: 'unverified', reason: 'reverse_ssh_not_checked' });
  // Without a usable local user nothing proves "this user on this machine", so even localhost stays SSH.
  const self = await f.invoke([...base, '--reply-to', 'localhost'], as);
  assert.equal(self.value.replyRoute.transport, 'ssh');
  assert.deepEqual(f.calls(), []);
});
