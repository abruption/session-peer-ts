// #20: ordered multi-host SSH, allowlisted --ssh-opt, IPv6 destinations and
// sshUser metadata. Fake ssh executables only; no network or live session.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { host } from '../dist/protocol.js';
import { sshOptions } from '../dist/ssh.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const posix = { skip: process.platform === 'win32' };
type Call = { args: string[]; input: string };
// Logs every invocation. `-G` answers user metadata; FAKE_DOWN destinations fail
// the version preflight; FAKE_LOSS destinations lose the request response.
function fixture(t: TestContext) {
  const path = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-ssh-hosts-')));
  mkdirSync(join(path, '.claude/sessions'), { recursive: true });
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const log = join(path, 'ssh-calls');
  writeFileSync(join(path, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const args=process.argv.slice(2),input=args.includes('-G')?'':fs.readFileSync(0,'utf8');
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,input})+'\\n');
const dest=args[args.indexOf('--')+1],list=k=>(process.env[k]||'').split(',');
if(args.includes('-G')){if(process.env.FAKE_G==='fail')process.exit(255);console.log('hostname x\\nuser config-user\\nport 22');process.exit(0);}
if(list('FAKE_DOWN').includes(dest)){console.error('ssh: connect to host: Connection refused SECRET-SENTINEL');process.exit(255);}
if(args.at(-1).endsWith('--version')){console.log('session-peer 0.2.1 (typescript)');process.exit(0);}
if(list('FAKE_LOSS').includes(dest))process.exit(255);
const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},'--stdio-request'],{input,encoding:'utf8',env:process.env});
process.stdout.write(r.stdout);process.exit(r.status);`, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: path, USERPROFILE: path, CLAUDE_CONFIG_DIR: join(path, '.claude'),
    CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', PATH: path + delimiter + process.env.PATH };
  const calls = (): Call[] => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  async function invoke(args: string[], extra: NodeJS.ProcessEnv = {}, format = ['--json']) {
    const child = spawn(process.execPath, [cli, ...args, ...format], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; child.stdout.on('data', x => { stdout += x; }); child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const [code] = await once(child, 'close'); clearTimeout(timer);
    return { code: code as number, stdout, value: format.length && format[0] === '--json' ? JSON.parse(stdout) : undefined };
  }
  return { path, env, calls, invoke };
}
async function inbox(t: TestContext, path: string) {
  const messages: { message: { content: string } }[] = [];
  const socket = join(path, 'sock');
  const server = createServer(s => {
    let data = ''; s.on('data', chunk => { data += chunk; });
    s.on('end', () => { messages.push(JSON.parse(data)); s.end(); });
  });
  server.listen(socket); await once(server, 'listening');
  t.after(() => new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())));
  writeFileSync(join(path, '.claude/sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'fixture', messagingSocketPath: socket }));
  return messages;
}
const destination = (call: Call) => call.args[call.args.indexOf('--') + 1];
const kind = (call: Call) => call.args.includes('-G') ? 'G' : call.args.at(-1)!.endsWith('--version') ? 'version' : 'request';
const envelope = (item: Record<string, unknown>) => ['schemaVersion', 'ok', 'host', 'command'].every(key => key in item);

test('host() accepts IPv6 literals as OpenSSH destinations and refuses unsafe forms', () => {
  assert.equal(host('2001:db8::1'), '2001:db8::1');
  assert.equal(host('[2001:db8::1]'), '2001:db8::1');
  assert.equal(host('user@[2001:db8::1]'), 'user@2001:db8::1');
  assert.equal(host('user@::ffff:192.0.2.1'), 'user@::ffff:192.0.2.1');
  assert.equal(host('user@host.example'), 'user@host.example');
  assert.equal(host('192.0.2.1'), '192.0.2.1');
  for (const value of ['fe80::1%en0', '[fe80::1%25en0]', '[192.0.2.1]', '2001:db8::1::1', '[2001:db8::1', '2001:db8::1]',
    ':', '[]', '.hidden', '-oProxyCommand=x', 'user@-x', '@host', 'a@b@c', 'host:22', 'host name', 'h%h', `${'a'.repeat(256)}`]) {
    assert.throws(() => host(value), /invalid_ssh_host/, value);
  }
});

test('--ssh-opt is an allowlist re-emitted in canonical argv', () => {
  assert.deepEqual(sshOptions([]), { args: [] });
  assert.deepEqual(sshOptions(['-p', '2222', '-i', '/keys/id ed25519', '-oIdentitiesOnly=yes', '-6']),
    { args: ['-p', '2222', '-i', '/keys/id ed25519', '-o', 'IdentitiesOnly=yes', '-6'] });
  assert.deepEqual(sshOptions(['-oPort=22', '-o', 'User=alice', '-iC:\\Users\\A B\\.ssh\\id']),
    { args: ['-p', '22', '-l', 'alice', '-i', 'C:\\Users\\A B\\.ssh\\id'], user: 'alice' });
  assert.deepEqual(sshOptions(['-o', 'identityfile=~/.ssh/id', '-l', 'bob', '-p65535']),
    { args: ['-p', '65535', '-l', 'bob', '-i', '~/.ssh/id'], user: 'bob' });
  const unsupported = [['-oProxyCommand=sh -c id'], ['-o', 'ProxyCommand=id'], ['-oproxycommand=id'], ['-o', 'Proxy Command=id'],
    ['-oProxyCommand id'], ['-oLocalCommand=id'], ['-oPermitLocalCommand=yes'], ['-oKnownHostsCommand=id'], ['-oMatch=exec id'],
    ['-o', 'Match exec id'], ['-oPKCS11Provider=/x.so'], ['-oSecurityKeyProvider=/x.so'], ['-oInclude=/tmp/x'], ['-F', '/tmp/x'],
    ['-F/tmp/x'], ['-oRemoteCommand=id'], ['-oProxyUseFdpass=yes'], ['-oBatchMode=no'], ['-oStrictHostKeyChecking=no'],
    ['-oUserKnownHostsFile=/dev/null'], ['-oControlPath=/tmp/s'], ['-oConnectTimeout=1'], ['-J', 'jump'], ['-Jjump'],
    ['-oProxyJump=jump'], ['-S', '/tmp/s'], ['-W', 'h:22'], ['-L', '1:h:2'], ['-R', '1:h:2'], ['-D', '1080'], ['-M'], ['-N'],
    ['-f'], ['-v'], ['-A'], ['-X'], ['-t'], ['-46'], ['-I', '/x.so'], ['--'], ['p'], ['2222'], ['']];
  for (const tokens of unsupported) assert.throws(() => sshOptions(tokens), /unsupported_ssh_option/, JSON.stringify(tokens));
  const invalid = [['-p'], ['-p', '0'], ['-p', '65536'], ['-p', '022'], ['-p', '-p'], ['-p', '%p'], ['-p', '22 '], ['-oPort=22 -oProxyCommand=x'],
    ['-l', 'bad user'], ['-l', '%r'], ['-l', '-oProxyCommand=x'], ['-i', '%d/key'], ['-i', '${HOME}/key'], ['-i', '-F/x'],
    ['-i', 'a\nb'], ['-oIdentitiesOnly=maybe'], ['-p', '1', '-p', '2'], ['-p', '1', '-oPort=1'], ['-4', '-6'], ['-l', 'a', '-oUser=a'], ['-o']];
  for (const tokens of invalid) assert.throws(() => sshOptions(tokens), /invalid_ssh_option/, JSON.stringify(tokens));
});

test('every route and option is validated before any ssh process starts', posix, async t => {
  const f = fixture(t);
  const pair = ['--host', 'alpha', '--host', 'beta'];
  const cases: [string[], string][] = [
    [['list', '--host', 'alpha', '--host', '-oProxyCommand=touch'], 'invalid_ssh_host'],
    [['list', '--host', 'alpha', '--host', 'fe80::1%en0'], 'invalid_ssh_host'],
    [['list', ...pair, '--ssh-opt=-oProxyCommand=touch'], 'unsupported_ssh_option'],
    [['list', ...pair, '--ssh-opt', '-o', '--ssh-opt', 'LocalCommand=touch'], 'unsupported_ssh_option'],
    [['list', ...pair, '--ssh-opt=-F', '--ssh-opt=/dev/null'], 'unsupported_ssh_option'],
    [['list', ...pair, '--ssh-opt=-J', '--ssh-opt=jump'], 'unsupported_ssh_option'],
    [['list', ...pair, '--ssh-opt=-oStrictHostKeyChecking=no'], 'unsupported_ssh_option'],
    [['list', ...pair, '--ssh-opt=-p'], 'invalid_ssh_option'],
    [['list', ...pair, '--ssh-opt=-i', '--ssh-opt=%d/key'], 'invalid_ssh_option'],
    [['list', '--host', 'alpha', '--host', 'ALPHA'], 'duplicate_ssh_host'],
    [['list', '--host', '[2001:db8::1]', '--host', '2001:DB8:0::1'], 'duplicate_ssh_host'],
    [['list', '--host', 'u@alpha', '--host', 'beta', '--ssh-opt=-l', '--ssh-opt=v'], 'conflicting_ssh_user'],
    [['list', ...pair, '--ssh-control-path', join(f.path, 'missing')], 'inapplicable_option'],
    [['list', ...pair, '--remote-bin', 'relative/bin'], 'invalid_remote_bin'],
    [['send', ...pair, '--to', 'fixture', '--message', ''], 'invalid_message'],
    [['send', ...pair, '--to', 'session-peer://v1/reply?agent=claude&session=w&transport=ssh&host=alpha', '--message', 'x'], 'reply_route_conflict'],
  ];
  for (const [args, error] of cases) {
    const result = await f.invoke(args);
    assert.equal(result.code, 2, args.join(' '));
    assert.ok(Array.isArray(result.value), args.join(' '));
    assert.deepEqual(result.value.map((item: { host: string }) => item.host), args.filter((_, i) => args[i - 1] === '--host'));
    for (const item of result.value) {
      assert.ok(envelope(item)); assert.equal(item.ok, false); assert.equal(item.error, error, args.join(' '));
      assert.equal(item.submitted, false); assert.equal(item.retryAllowed, false);
    }
  }
  const flat = await f.invoke(['list', '--ssh-opt=-p', '--ssh-opt=22']);
  assert.equal(flat.value.error, 'inapplicable_option'); assert.equal(Array.isArray(flat.value), false);
  assert.deepEqual(f.calls(), []);
});

test('repeated --host runs in order with per-host results and partial-failure exit', posix, async t => {
  const f = fixture(t);
  const listed = await f.invoke(['list', '--agent', 'claude', '--host', 'alpha', '--host', 'u@beta', '--host', '[2001:db8::1]'], { FAKE_DOWN: 'u@beta' });
  assert.equal(listed.code, 1);
  assert.deepEqual(listed.value.map((item: { host: string }) => item.host), ['alpha', 'u@beta', '[2001:db8::1]']);
  const [alpha, beta, ipv6] = listed.value;
  for (const item of listed.value) { assert.ok(envelope(item)); assert.equal(item.command, 'list'); }
  assert.equal(alpha.ok, true); assert.deepEqual(alpha.sessions, []); assert.equal(alpha.sshHost, 'alpha');
  assert.equal(alpha.sshUser, 'config-user'); assert.equal(alpha.sshUserSource, 'ssh_config_or_local_default');
  assert.equal(beta.ok, false); assert.equal(beta.error, 'ssh_unreachable'); assert.equal(beta.submitted, false);
  assert.equal(beta.sshUser, 'u'); assert.equal(beta.sshUserSource, 'explicit');
  assert.equal(ipv6.ok, true); assert.equal(ipv6.sshHost, '2001:db8::1');
  assert.equal(JSON.stringify(listed.value).includes('SECRET-SENTINEL'), false);
  assert.deepEqual(f.calls().map(call => `${kind(call)} ${destination(call)}`), [
    'G alpha', 'version alpha', 'request alpha', 'version u@beta', 'G 2001:db8::1', 'version 2001:db8::1', 'request 2001:db8::1']);
  const all = await f.invoke(['doctor', '--agent', 'claude', '--host', 'alpha', '--host', 'beta']);
  assert.equal(all.code, 0); assert.deepEqual(all.value.map((item: { ok: boolean }) => item.ok), [true, true]);
  assert.deepEqual(all.value.map((item: { command: string }) => item.command), ['doctor', 'doctor']);
  const text = await f.invoke(['list', '--agent', 'claude', '--host', 'alpha', '--host', 'beta'], { FAKE_DOWN: 'beta' }, ['--output-format', 'text']);
  assert.equal(text.code, 1);
  assert.equal(text.stdout, 'Host: alpha\nNo sessions found.\nDiscovery claude: {"status":"ok"}\n\nHost: beta\nNo sessions found.\nError: ssh_unreachable\n');
  const single = await f.invoke(['list', '--agent', 'claude', '--host', 'alpha'], { FAKE_G: 'fail' });
  assert.equal(Array.isArray(single.value), false); assert.equal(single.value.host, 'alpha');
  assert.equal(single.value.sshUser, null); assert.equal(single.value.sshUserSource, 'unknown');
});

test('multi-host send: one attempt per destination, unknown stays unknown, body never in argv', posix, async t => {
  const f = fixture(t), messages = await inbox(t, f.path);
  const body = 'SECRET-SENTINEL $(touch pwned) `id` \'quote\' 한글 🚀';
  const sent = await f.invoke(['send', '--host', 'alpha', '--host', 'beta', '--host', 'gamma', '--host', 'delta', '--to', String(process.pid),
    '--message', body, '--no-from'], { FAKE_LOSS: 'beta', FAKE_DOWN: 'gamma' });
  assert.equal(sent.code, 1);
  const [alpha, beta, gamma, delta] = sent.value;
  assert.equal(alpha.status, 'posted'); assert.equal(alpha.submitted, true); assert.equal(alpha.consumptionConfirmed, false);
  assert.equal(beta.ok, false); assert.equal(beta.status, 'unknown'); assert.equal(beta.submitted, null); assert.equal(beta.retryAllowed, false);
  assert.equal(gamma.status, 'refused'); assert.equal(gamma.error, 'ssh_unreachable'); assert.equal(gamma.submitted, false);
  // A failure is reported for that host only; later destinations still get their single attempt.
  assert.equal(delta.status, 'posted');
  assert.deepEqual(messages.map(m => m.message.content), [body, body]);
  const calls = f.calls();
  assert.deepEqual(calls.map(call => `${kind(call)} ${destination(call)}`), ['G alpha', 'version alpha', 'request alpha',
    'G beta', 'version beta', 'request beta', 'G gamma', 'version gamma', 'G delta', 'version delta', 'request delta']);
  for (const call of calls) {
    assert.equal(call.args.some(arg => arg.includes('SECRET-SENTINEL') || arg.includes('pwned')), false);
    if (kind(call) === 'request') assert.ok(JSON.parse(call.input).args.includes(`--message=${body}`));
    else assert.equal(call.input, '');
  }
  const dry = await f.invoke(['send', '--host', 'alpha', '--host', 'beta', '--to', String(process.pid), '--message', 'dry', '--dry-run']);
  assert.equal(dry.code, 0); assert.deepEqual(dry.value.map((item: { status: string }) => item.status), ['validated', 'validated']);
  assert.equal(messages.length, 2);
});

test('allowlisted options follow the fixed hardening options on POSIX and Windows remote paths', posix, async t => {
  const f = fixture(t);
  const options = ['--ssh-opt=-p', '--ssh-opt=2222', '--ssh-opt', '-i', '--ssh-opt', join(f.path, 'id key'), '--ssh-opt=-oIdentitiesOnly=yes', '--ssh-opt=-6'];
  const user = ['-p', '2222', '-i', join(f.path, 'id key'), '-o', 'IdentitiesOnly=yes', '-6'];
  const fixed = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10'];
  const posixResult = await f.invoke(['list', '--agent', 'claude', '--host', 'user@[2001:db8::1]', '--host', 'alpha', '--remote-bin', '/opt/sp bin/session-peer', ...options]);
  assert.equal(posixResult.code, 0);
  assert.deepEqual(posixResult.value.map((item: { sshUserSource: string }) => item.sshUserSource), ['explicit', 'ssh_config_or_local_default']);
  const [first, , g, second] = f.calls();
  assert.deepEqual(first!.args, [...fixed, ...user, '--', 'user@2001:db8::1', "'/opt/sp bin/session-peer' --version"]);
  assert.deepEqual(g!.args, ['-G', ...user, '--', 'alpha']);
  assert.deepEqual(second!.args, [...fixed, ...user, '--', 'alpha', "'/opt/sp bin/session-peer' --version"]);
  const before = f.calls().length;
  const windows = await f.invoke(['list', '--host', 'alpha', '--host', 'beta', '--remote-platform', 'win32',
    '--remote-bin', 'C:\\Program Files\\sp\\session-peer.cmd', '--ssh-opt=-l', '--ssh-opt=win-user'], { FAKE_DOWN: 'alpha,beta' });
  assert.equal(windows.code, 1);
  for (const item of windows.value) { assert.equal(item.error, 'ssh_unreachable'); assert.equal(item.sshUser, 'win-user'); assert.equal(item.sshUserSource, 'explicit'); }
  const preflights = f.calls().slice(before);
  assert.deepEqual(preflights.map(destination), ['alpha', 'beta']);
  for (const call of preflights) {
    assert.deepEqual(call.args.slice(0, -1), [...fixed, '-l', 'win-user', '--', destination(call)]);
    const encoded = call.args.at(-1)!.match(/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/)![1]!;
    assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), "& 'C:\\Program Files\\sp\\session-peer.cmd' --version");
  }
});
