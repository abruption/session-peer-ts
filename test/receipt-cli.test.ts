// End-to-end CLI/FD/UDS fixtures. The inbox is a test socket, never a native agent.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { ReceiptState } from '../dist/receipt-state.js';
import { startReceiptCollector, receiptExchange } from '../dist/receipt-collector.js';
import { renderOutput } from '../dist/output.js';

const posix = { skip: process.platform === 'win32' }, cli = resolve('dist/cli.js');
function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-rc-'))); fs.chmodSync(root, 0o700);
  const config = join(root, 'claude'), sessions = join(config, 'sessions'); fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const env = { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: config, ANTHROPIC_CONFIG_DIR: '',
    CODEX_HOME: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', SESSION_PEER_CODEX_HOMES: '[]',
    SESSION_PEER_HANDOFF_HOME: join(root, 'unused-legacy'), SESSION_PEER_TAILSCALE: 'off', SESSION_PEER_NO_UPDATE_NOTICE: '1', NODE_OPTIONS: '' };
  const closers: (() => void | Promise<void>)[] = [];
  t.after(async () => { for (const close of closers.reverse()) await close(); fs.rmSync(root, { recursive: true, force: true }); });
  function invoke(args: string[], input?: string) {
    const child = spawn(process.execPath, [cli, ...args], { env, cwd: root, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '', size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 40000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 1048576) child.kill('SIGKILL'); else stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += String(chunk).slice(0,4096-stderr.length); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    const done = once(child, 'close').then(([code,signal]) => {
      clearTimeout(timer); assert.equal(signal, null, stderr); return { code, stdout, stderr, value: JSON.parse(stdout) };
    });
    return { child, done };
  }
  return { root, sessions, env, invoke, cleanup: (close: () => void | Promise<void>) => closers.push(close) };
}
const opts = (t: string) => ['send','--to',t,'--message','original receipt fixture','--no-from','--no-reply-to','--json'];
test('real CLI sends one private delegation and accepts a handler receipt before native submission returns', posix, async t => {
  const f = fixture(t), state = join(f.root,'state'), collectorPath = join(state,'s'), inbox = join(f.root,'i');
  ReceiptState.initialize(state, collectorPath); const collector = await startReceiptCollector(state,collectorPath);
  let count = 0, delegated: any, handler: any;
  const server = createServer({allowHalfOpen:true}, socket => {
    count++; let bytes = '';
    socket.on('data', chunk => { bytes += chunk; });
    socket.on('end', () => {
      void (async () => {
        const packet = JSON.parse(bytes), text = packet.message.content as string;
        const line = text.split('\n').find(value => value.startsWith('Receipt-Only: '));
        assert.ok(line, 'the opt-in sender must supply inert private delegation data');
        delegated = JSON.parse(line.slice('Receipt-Only: '.length));
        const raw = JSON.stringify(delegated.receipt);
        const called = f.invoke(['receipt','respond','--collector',collectorPath,'--receipt','-','--json'], raw);
        assert.equal(called.child.spawnargs.some(arg => arg.includes(delegated.receipt.capability)), false);
        handler = await called.done;
        assert.equal(handler.code,0,handler.stderr);
        assert.equal(handler.value.status,'awaiting_submission');
        assert.equal(handler.stdout.includes(delegated.receipt.capability),false);
        socket.end();
      })().catch(() => { socket.destroy(); t.diagnostic('fixture receipt handler failed without reflecting private input'); });
    });
  });
  server.listen(inbox); await once(server,'listening');
  f.cleanup(async () => { await new Promise<void>(ok=>server.close(()=>ok())); assert.equal((await collector.close()).cleanup,'confirmed'); });
  fs.writeFileSync(join(f.sessions,`${process.pid}.json`),JSON.stringify({pid:process.pid,name:'receipt-fixture',messagingSocketPath:inbox}),{mode:0o600});
  const result = await f.invoke([...opts(String(process.pid)),'--receipt-collector',collectorPath,'--request-ack','--wait-for','acknowledged','--wait-timeout','30']).done;
  assert.equal(result.code,0,result.stderr + result.stdout); assert.equal(count,1);
  assert.equal(result.value.status,'posted'); assert.equal(result.value.submitted,true); assert.equal(result.value.consumptionConfirmed,false);
  assert.equal(result.value.handoff.schemaVersion,2); assert.equal(result.value.handoff.targetGeneration,null);
  assert.equal(result.value.handoff.ack.status,'acknowledged'); assert.equal(result.value.handoff.ack.assurance,'token_possession');
  assert.equal(result.value.handoff.wait.status,'satisfied'); assert.equal(result.stdout.includes(delegated.receipt.capability),false);
  assert.equal(fs.existsSync(join(f.root,'unused-legacy')),false);
  const again = await f.invoke(['receipt','respond','--collector',collectorPath,'--receipt','-','--json'],JSON.stringify(delegated.receipt)).done;
  assert.equal(again.code,0); assert.equal(again.value.handoff.ack.receivedAtUtcMs,result.value.handoff.ack.receivedAtUtcMs);
  assert.equal(count,1,'receipt retrieval cannot create another inbox input');
});
test('managed dry-run and required unavailable bootstrap never connect to an inbox or create legacy state', posix, async t => {
  const f = fixture(t), inbox = join(f.root,'i'), missing = join(f.root,'missing'); let connections = 0;
  const server = createServer(socket=>{connections++;socket.destroy();});server.listen(inbox);await once(server,'listening');
  f.cleanup(()=>new Promise<void>(ok=>server.close(()=>ok())));
  fs.writeFileSync(join(f.sessions,`${process.pid}.json`),JSON.stringify({pid:process.pid,name:'fixture',messagingSocketPath:inbox}),{mode:0o600});
  const dry = await f.invoke([...opts(String(process.pid)),'--receipt-collector',missing,'--dry-run']).done;
  assert.equal(dry.code,0,dry.stdout);assert.equal(dry.value.submitted,false);
  const blocked = await f.invoke([...opts(String(process.pid)),'--receipt-collector',missing,'--wait-for','acknowledged']).done;
  assert.notEqual(blocked.code,0);assert.notEqual(blocked.value.submitted,true);
  assert.equal(connections,0);assert.equal(fs.existsSync(join(f.root,'unused-legacy')),false);
});
test('legacy CLI refuses managed contexts before creating an old lock or changing history', posix, async t => {
  const f = fixture(t), state = join(f.root,'state');ReceiptState.initialize(state,join(state,'s'));
  f.env.SESSION_PEER_HANDOFF_HOME=state;
  const before=fs.readFileSync(join(state,'ledger.json'));
  for(const args of [['handoff','init','--json'],['handoff','status','--correlation-id','11111111-1111-4111-8111-111111111111','--json']]){
    const result=await f.invoke(args).done;assert.notEqual(result.code,0);assert.equal(result.value.error,'receipt_managed_context_required');
  }
  assert.deepEqual(fs.readFileSync(join(state,'ledger.json')),before);assert.equal(fs.existsSync(join(state,'ledger.lock')),false);
});
test('manual foreground collector starts explicitly, handles private IPC and cleans only its own listener on SIGINT',posix,async t=>{
  const f=fixture(t),state=join(f.root,'serve'),socket=join(state,'s');
  const initialized=await f.invoke(['receipt','init','--state-dir',state,'--json']).done;assert.equal(initialized.code,0,initialized.stdout);
  const child=spawn(process.execPath,[cli,'receipt','serve','--state-dir',state,'--json'],{env:f.env,cwd:f.root,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';let ready=false;
  const closed=once(child,'close');
  f.cleanup(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await closed;}});
  const result=await new Promise<any>((ok,fail)=>{
    const timer=setTimeout(()=>fail(new Error('fixture collector readiness timeout')),10000);
    child.stderr.on('data',part=>{if(stderr.length<4096)stderr+=String(part).slice(0,4096-stderr.length);});
    child.stdout.on('data',part=>{stdout+=part;if(!ready&&stdout.includes('\n')){ready=true;clearTimeout(timer);try{ok(JSON.parse(stdout.split('\n')[0]!));}catch{fail(new Error('invalid fixture readiness'));}}});
    void closed.then(()=>{if(!ready){clearTimeout(timer);fail(new Error('fixture collector exited before readiness'));}});
  });
  assert.equal(result.status,'ready');assert.equal(result.collector,socket);
  const hello=await receiptExchange(socket,null,'hello',{});assert.equal(hello.ok,true);
  if(hello.ok&&'endpointOwner'in hello.body)assert.equal(hello.body.endpointOwner.pid,child.pid);
  child.kill('SIGINT');const[code,signal]=await closed;assert.equal(signal,null);assert.equal(code,130,stderr);
  assert.equal(fs.existsSync(socket),false);assert.equal(fs.existsSync(join(state,'ledger.json')),true);
  assert.equal(stdout.trim().split('\n').length,1,'foreground lifetime does not emit another success result');
});
test('private CLI input timeout is bounded without reflecting unfinished receipt data',async t=>{
  const f=fixture(t),child=spawn(process.execPath,[cli,'receipt','probe','--json'],{env:f.env,cwd:f.root,stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',part=>{output+=part;});child.stderr.resume();child.stdin.on('error',()=>{});
  child.stdin.write('{"unfinished_private_input":"PRIVATE_STDIN_SENTINEL"');
  const timer=setTimeout(()=>child.kill('SIGKILL'),8000);const[code,signal]=await once(child,'close');clearTimeout(timer);
  assert.equal(signal,null);assert.notEqual(code,0);assert.equal(output.includes('PRIVATE_STDIN_SENTINEL'),false);
  assert.equal(JSON.parse(output).ok,false);
});
test('delegated text output does not call receipt evidence native identity or model consumption',()=>{
  const text=renderOutput({command:'send',ok:true,status:'posted',submitted:true,handoff:{schemaVersion:2,correlationId:'fixture',state:'acknowledged',ack:{status:'acknowledged',assurance:'token_possession'}}},'text');
  assert.match(text,/model consumption and completion are not confirmed/);assert.match(text,/native generation and model identity are not established/);
  assert.doesNotMatch(text,/consumption\/ACK is not confirmed/);
});
