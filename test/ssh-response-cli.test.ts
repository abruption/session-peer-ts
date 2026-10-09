// No native queue/socket is called. Fake SSH responses model evidence only;
// request logs prove that the client dispatches at most once per destination.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_LINE } from '../dist/protocol.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const id = '11111111-1111-4111-8111-111111111111';
const posix = { skip: process.platform === 'win32' };
type FixtureResponse = { text?: string; bytes?: number[]; code: number; hang?: boolean; overflow?: boolean };
function fixture(t: TestContext) {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-ssh-response-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'home'));
  const config = join(dir, 'responses.json'), log = join(dir, 'calls.jsonl'); writeFileSync(log, '');
  // Values are JSON/env inputs to fixed code, never interpolated executable code.
  writeFileSync(join(dir, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
if(args.includes('-G')){console.log('user fixture-user');process.exit(0);}
if(args.at(-1).endsWith('--version')){console.log(process.env.FIXTURE_VERSION);process.exit(0);}
const input=fs.readFileSync(0,'utf8'),host=args[args.indexOf('--')+1];
fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({host,input,args})+'\\n');
const responses=JSON.parse(fs.readFileSync(process.env.FIXTURE_RESPONSES,'utf8')),r=responses[host];
process.stderr.write(Buffer.from([255]));
process.stdout.write(r.bytes?Buffer.from(r.bytes):r.text||'');
if(r.overflow)setTimeout(()=>process.stdout.write(' '.repeat(1048576)),20);
if(r.hang)setInterval(()=>{},1000);else process.exitCode=r.code;
`, { mode: 0o700 });
  // Shorten only the production request deadline in this test child. All
  // actual collection/kill/cleanup code still runs; no production knob added.
  const loader = join(dir, 'deadline.mjs');
  writeFileSync(loader, 'const original=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms===90000?500:ms,...args);');
  const env = { ...process.env, HOME: join(dir, 'home'), USERPROFILE: join(dir, 'home'), CLAUDE_CONFIG_DIR: join(dir, 'home/.claude'),
    CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', PATH: dir + delimiter + process.env.PATH,
    FIXTURE_VERSION: VERSION_LINE, FIXTURE_LOG: log, FIXTURE_RESPONSES: config };
  async function invoke(responses: Record<string, FixtureResponse>, args: string[], text = false) {
    writeFileSync(config, JSON.stringify(responses)); const previous = readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
    const child = spawn(process.execPath, ['--import', loader, cli, ...args, ...(text ? ['--output-format', 'text'] : ['--json']), '--no-update-notice'], { env });
    let stdout = '', stderr = ''; child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; }); child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    t.after(() => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const [code, signal] = await once(child, 'close'); clearTimeout(timer); assert.equal(signal, null, stderr);
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).slice(previous).map(line => JSON.parse(line));
    return { code, value: text ? undefined : JSON.parse(stdout), stdout, stderr, calls };
  }
  return { invoke };
}
const claude = { schemaVersion: 1, host: 'remote-fixture', command: 'send', ok: true, status: 'posted', submitted: true,
  consumptionConfirmed: false, target: { pid: 123, name: null } };
const codex = { ...claude, status: 'queued', target: { id }, queueId: 'queue-17', codexHome: '/fixture/home' };
const args = (to: string, hosts = ['fixture']) => ['send', ...hosts.flatMap(h => ['--host', h]), '--to', to, '--message', 'DEMO-FIXTURE', '--no-from', '--no-reply-to'];

test('CLI preserves complete Claude/Codex outcomes after exit255 and real collection timeout, one request only', posix, async t => {
  const f = fixture(t);
  for (const [value, to] of [[claude, '123'], [codex, `codex:${id}`]] as const) {
    for (const mode of ['exit0', 'exit255', 'timeout']) {
      const r = await f.invoke({ fixture: { text: JSON.stringify(value), code: mode === 'exit0' ? 0 : 255, hang: mode === 'timeout' } }, args(to));
      assert.equal(r.code, mode === 'exit0' ? 0 : 1); assert.equal(r.value.ok, true); assert.equal(r.value.submitted, true);
      assert.equal(r.value.status, value.status); assert.deepEqual(r.value.target, value.target); assert.equal(r.value.consumptionConfirmed, false);
      assert.equal(r.value.queueId, 'queueId' in value ? value.queueId : undefined); assert.equal(r.calls.length, 1);
      if (mode === 'exit0') assert.equal(r.value.sshTransport, undefined);
      else { assert.equal(r.value.retryAllowed, false); assert.equal(r.value.sshTransport.status, mode === 'timeout' ? 'timed_out' : 'failed'); }
      assert.equal(r.stderr, ''); assert.equal(r.stdout.includes('�'), false);
    }
  }
  const text = await f.invoke({ fixture: { text: JSON.stringify(codex), code: 255 } }, args(`codex:${id}`), true);
  assert.equal(text.code, 1); assert.match(text.stdout, /Queue ID: queue-17/); assert.match(text.stdout, /Do not resend automatically/);
  assert.doesNotMatch(text.stdout, /Nothing submitted/); assert.equal(text.calls.length, 1);
});

test('CLI unknown matrix: incomplete/empty/malformed/polluted/invalid UTF-8 vs exit0/255/timeout never retries', posix, async t => {
  const f = fixture(t);
  const encoded = JSON.stringify(codex);
  for (const text of ['', encoded.slice(0, -1), encoded + '\nnoise', encoded.replace('"ok":true', '"ok":true,"ok":true')]) {
    for (const mode of ['exit0', 'exit255', 'timeout']) {
      const r = await f.invoke({ fixture: { text, code: mode === 'exit0' ? 0 : 255, hang: mode === 'timeout' } }, args(`codex:${id}`));
      assert.equal(r.code, 1); assert.equal(r.value.error, 'outcome_unknown'); assert.equal(r.value.submitted, null);
      assert.equal(r.value.queueId, undefined); assert.equal(r.value.retryAllowed, false); assert.equal(r.calls.length, 1);
    }
  }
  for (const response of [{ bytes: [...Buffer.concat([Buffer.from('{"x":"'), Buffer.from([255]), Buffer.from('"}')])], code: 255 },
    { text: encoded, overflow: true, code: 255 }]) {
    const r = await f.invoke({ fixture: response }, args(`codex:${id}`));
    assert.equal(r.value.error, 'outcome_unknown'); assert.equal(r.value.submitted, null); assert.equal(r.calls.length, 1);
  }
});

test('CLI mixed-host results preserve order, refusals, successful facts and malformed isolation', posix, async t => {
  const f = fixture(t), refused = { schemaVersion: 1, host: 'remote', command: 'send', ok: false, status: 'refused', submitted: false,
    consumptionConfirmed: false, error: 'no_reachable_target' };
  const responses = { good: { text: JSON.stringify(codex), code: 0 }, lost: { text: JSON.stringify(codex), code: 255 },
    partial: { text: JSON.stringify(codex).slice(0, -1), code: 255 }, refused: { text: JSON.stringify(refused), code: 255 } };
  const r = await f.invoke(responses, args(`codex:${id}`, Object.keys(responses)));
  assert.equal(r.code, 1); assert.deepEqual(r.value.map((v: {sshHost: string}) => v.sshHost), Object.keys(responses));
  assert.deepEqual(r.value.map((v: {submitted: unknown}) => v.submitted), [true, true, null, false]);
  assert.deepEqual(r.value.map((v: {status: string}) => v.status), ['queued', 'queued', 'unknown', 'refused']);
  assert.deepEqual(r.calls.map(call => call.host), Object.keys(responses));
  for (const call of r.calls) { assert.equal(JSON.parse(call.input).args.filter((x: string) => x === 'send').length, 1); assert.equal(call.args.join(' ').includes('DEMO-FIXTURE'), false); }
});

test('CLI wrong Claude PID/name and wrong command/target evidence stay unknown', posix, async t => {
  const f = fixture(t);
  for (const [value, to] of [[{ ...claude, target: { pid: 456, name: null } }, '123'],
    [{ ...claude, target: { pid: 123, name: 'wrong' } }, 'requested'], [{ ...codex, command: 'list' }, `codex:${id}`]]) {
    const r = await f.invoke({ fixture: { text: JSON.stringify(value), code: 255 } }, args(to as string));
    assert.equal(r.value.error, 'outcome_unknown'); assert.equal(r.value.submitted, null); assert.equal(r.calls.length, 1);
  }
  const dry = { ...claude, status: 'validated', submitted: false, dryRun: true };
  const validated = await f.invoke({ fixture: { text: JSON.stringify(dry), code: 255 } }, [...args('123'), '--dry-run']);
  assert.equal(validated.value.status, 'validated'); assert.equal(validated.value.submitted, false); assert.equal(validated.calls.length, 1);
});
