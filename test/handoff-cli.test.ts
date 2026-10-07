import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
async function fixture(t: TestContext) {
  const path = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-hc-')));
  mkdirSync(join(path, '.claude/sessions'), { recursive: true });
  const messages: string[] = [], socket = join(path, 'sock');
  const server = createServer(s => { let data = ''; s.on('data', c => data += c); s.on('end', () => { messages.push(data); s.end(); }); });
  server.listen(socket); await once(server, 'listening');
  t.after(async () => { await new Promise<void>(ok => server.close(() => ok())); rmSync(path, { recursive: true }); });
  writeFileSync(join(path, '.claude/sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: null, messagingSocketPath: socket }));
  const file = join(path, 'message'); writeFileSync(file, 'fixture body', { mode: 0o600 });
  const env = { ...process.env, HOME: path, USERPROFILE: path, CLAUDE_CONFIG_DIR: join(path, '.claude'), CODEX_HOME: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', SESSION_PEER_TAILSCALE: 'off', SESSION_PEER_UPDATE_NOTICE: '', SESSION_PEER_HANDOFF_HOME: join(path, 'state', 'handoff') };
  async function invoke(args: string[], input = '', closeInput = true, timeout = 10000) { const child = spawn(process.execPath, [cli, ...args, '--json'], { env }); let stdout = ''; child.stdout.on('data', c => stdout += c); child.stderr.resume(); if (closeInput) child.stdin.end(input); else child.stdin.write(input); const timer = setTimeout(() => child.kill('SIGKILL'), timeout); const [code, signal] = await once(child, 'close'); clearTimeout(timer); assert.equal(signal, null); return { code, value: JSON.parse(stdout) }; }
  return { path, env, messages, file, invoke, send: ['send', '--to', String(process.pid), '--message-file', file, '--no-from', '--no-reply-to'] };
}
test('opt-out untouched; explicit init/prepare/status/dry-run/single effect fence', { skip: process.platform === 'win32' }, async t => {
 const f = await fixture(t);
 const plain = await f.invoke([...f.send, '--dry-run']); assert.equal(plain.code, 0); assert.equal(plain.value.handoff, undefined); assert.equal(plain.value.target.name, null);
 const missing = await f.invoke(['handoff','status','--correlation-id','11111111-1111-4111-8111-111111111111']); assert.equal(missing.code, 1); assert.equal(missing.value.handoffQuery.context,'ledger_missing'); assert.equal(missing.value.submitted,undefined);
 assert.equal((await f.invoke(['handoff','init'])).code,0);
 const prepare = await f.invoke(['handoff','prepare','--to',String(process.pid),'--message-file',f.file]); assert.equal(prepare.code,0); const id = prepare.value.handoff.correlationId;
 const dry = await f.invoke([...f.send,'--correlation-id',id,'--dry-run']); assert.equal(dry.code,0); assert.equal(dry.value.handoff.submission.status,'not_attempted'); assert.equal(f.messages.length,0);
 const sent = await f.invoke([...f.send,'--correlation-id',id]); assert.equal(sent.code,0); assert.equal(sent.value.status,'posted'); assert.equal(sent.value.submitted,true); assert.equal(sent.value.handoff.submission.status,'submitted'); assert.equal(sent.value.handoff.ack.status,'not_requested'); assert.equal(f.messages.length,1); assert.match(f.messages[0]!,new RegExp(id));
 const duplicate = await f.invoke([...f.send,'--correlation-id',id]); assert.equal(duplicate.code,1); assert.equal(duplicate.value.error,'handoff_already_attempted'); assert.equal(f.messages.length,1);
 const status = await f.invoke(['handoff','status','--correlation-id',id]); assert.equal(status.code,0); assert.equal(status.value.handoff.submission.status,'submitted'); assert.equal(f.messages.length,1);
});
test('unsupported required ACK refuses before effect; best-effort sends once without claiming ACK', { skip: process.platform === 'win32' }, async t => {
 const f = await fixture(t); await f.invoke(['handoff','init']);
 const refused = await f.invoke([...f.send,'--wait-for','acknowledged']); assert.equal(refused.code,1); assert.equal(refused.value.submitted,false); assert.equal(refused.value.handoff.wait.status,'unsupported'); assert.equal(f.messages.length,0);
 const best = await f.invoke([...f.send,'--request-ack']); assert.equal(best.code,0); assert.equal(best.value.submitted,true); assert.equal(best.value.handoff.ack.status,'unsupported'); assert.equal(f.messages.length,1);
 const query = await f.invoke(['handoff','wait','--correlation-id',best.value.handoff.correlationId,'--wait-for','acknowledged']); assert.equal(query.code,1); assert.equal(query.value.handoff.wait.status,'unsupported'); assert.equal(query.value.submitted,undefined); assert.equal(f.messages.length,1);
});
test('syntax/private inputs reject without minting authority or submitting', { skip: process.platform === 'win32' }, async t => {
 const f = await fixture(t); await f.invoke(['handoff','init']);
 for (const seconds of ['01','1.0','1e0','+1','61']) { const r = await f.invoke([...f.send,'--wait-timeout',seconds]); assert.equal(r.code,2); assert.equal(r.value.error,'invalid_wait_timeout'); }
 const small = await f.invoke([...f.send,'--request-ack','--wait-timeout','5']); assert.equal(small.code,1); assert.equal(small.value.submitted,false);
 const remote = await f.invoke([...f.send,'--request-ack','--host','fixture']); assert.equal(remote.code,1); assert.equal(remote.value.error,'remote_handoff_unsupported');
 const uri = await f.invoke(['send','--to','session-peer://v1/reply?agent=claude&session=fixture&transport=ssh&host=worker','--request-ack','--message','fixture','--no-from','--no-reply-to']); assert.equal(uri.code,1); assert.equal(uri.value.error,'remote_handoff_unsupported');
 const receipt = await f.invoke(['ack','--receipt','-'], ' '.repeat(4097)); assert.equal(receipt.code,2); assert.equal(receipt.value.error,'input_too_large'); assert.equal(receipt.value.submitted,undefined);
 const bomReceipt = {schemaVersion:1,kind:'receipt',ledgerEpoch:'11111111-1111-4111-8111-111111111111',correlationId:'11111111-1111-4111-8111-111111111111',targetGeneration:'fixture',receiptId:'22222222-2222-4222-8222-222222222222',capability:Buffer.alloc(32).toString('base64url')};
 const bom = await f.invoke(['ack','--receipt','-'], '\ufeff'+JSON.stringify(bomReceipt));assert.equal(bom.value.error,'invalid_handoff_json');
 assert.equal(f.messages.length,0);
});

test('init refuses a symlinked parent before creating a directory through it', { skip: process.platform === 'win32' }, async t => {
 const f = await fixture(t); const external = join(f.path, 'external'); mkdirSync(external); symlinkSync(external, join(f.path,'link'));
 const child = spawn(process.execPath, [cli,'handoff','init','--json'], {env:{...process.env,SESSION_PEER_HANDOFF_HOME:join(f.path,'link','new','handoff')}}); let stdout='';child.stdout.on('data',c=>stdout+=c);child.stderr.resume();child.stdin.end();const [code]=await once(child,'close');assert.equal(code,1);assert.equal(JSON.parse(stdout).error,'handoff_storage_untrusted');assert.equal(existsSync(join(external,'new')),false);
});

test('positive native acceptance survives a subsequent durable-record I/O failure', { skip: process.platform === 'win32' }, async t => {
 const f = await fixture(t); await f.invoke(['handoff','init']);
 const fs = await import('node:fs'), { syncBuiltinESMExports } = await import('node:module');
 const { handoffSend } = await import('../dist/handoff-operations.js');
 const { HandoffLedger } = await import('../dist/handoff-ledger.js');
 const oldDir = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = join(f.path,'.claude');
 const rename = fs.default.renameSync; let writes = 0;
 const mocked = t.mock.method(fs.default, 'renameSync', (...args: Parameters<typeof rename>) => {
   if (++writes === 3) throw Object.assign(new Error('fixture'), {code:'EIO'});
   return rename(...args);
 }); syncBuiltinESMExports();
 try {
  const r = await handoffSend({to:String(process.pid),message:'fixture body'}, {requestAck:true,ledgerPath:join(f.path,'state','handoff')});
  assert.equal(r.exitCode,0); assert.equal(r.value.ok,true); assert.equal(r.value.status,'posted'); assert.equal(r.value.submitted,true);
  assert.equal(r.value.handoffWarning,'persistence_failed'); const h = r.value.handoff as {correlationId:string;submission:{status:string}}; assert.equal(h.submission.status,'submitted'); assert.equal(f.messages.length,1);
  const retained = new HandoffLedger(join(f.path,'state','handoff')).status(h.correlationId); assert.ok('handoff' in retained); assert.equal(retained.handoff.submission.status,'unknown');
  await assert.rejects(handoffSend({to:String(process.pid),message:'fixture body'}, {correlationId:h.correlationId,ledgerPath:join(f.path,'state','handoff')}), /handoff_already_attempted/); assert.equal(f.messages.length,1);
 } finally { mocked.mock.restore(); syncBuiltinESMExports(); if(oldDir===undefined) delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=oldDir; }
});

test('opt-in reserves bounded outer-result space before any native effect', {skip:process.platform==='win32'}, async t=>{
 const f=await fixture(t);await f.invoke(['handoff','init']);
 writeFileSync(join(f.path,'.claude/sessions',`${process.pid}.json`),JSON.stringify({pid:process.pid,name:'x'.repeat(1040000),messagingSocketPath:join(f.path,'sock')}));
 const r=await f.invoke([...f.send,'--request-ack']);assert.equal(r.code,1);assert.equal(r.value.error,'handoff_result_too_large');assert.equal(r.value.submitted,false);assert.equal(f.messages.length,0);
});


test('message-file dash is literal with stdin open, while --message dash keeps stdin semantics', {skip:process.platform==='win32'}, async t=>{
 const f=await fixture(t);writeFileSync(f.file,'-');
 const file=await f.invoke(f.send,'different stdin body',false);
 assert.equal(file.code,0);assert.equal(file.value.status,'posted');assert.equal(file.value.chars,1);
 assert.equal(f.messages.length,1);assert.equal(JSON.parse(f.messages[0]!).message.content,'-');
 await f.invoke(['handoff','init']);
 const opted=await f.invoke([...f.send,'--request-ack'],'different stdin body',false);
 assert.equal(opted.code,0);assert.equal(opted.value.submitted,true);assert.equal(f.messages.length,2);
 assert.equal(JSON.parse(f.messages[1]!).message.content,'-\n\n---\nHandoff: '+JSON.stringify({schemaVersion:1,correlationId:opted.value.handoff.correlationId}));
 const stdin=await f.invoke(['send','--to',String(process.pid),'--message','-','--no-from','--no-reply-to'],'chosen stdin body');
 assert.equal(stdin.code,0);assert.equal(JSON.parse(f.messages[2]!).message.content,'chosen stdin body');
 // SSH transports carry the already selected literal body in their JSON frame;
 // a wire receiver must not interpret that body as a second stdin selector.
 const receiver=spawn(process.execPath,[cli,'--stdio-request'],{env:f.env});let stdout='';receiver.stdout.on('data',c=>stdout+=c);receiver.stderr.resume();
 const timer=setTimeout(()=>receiver.kill('SIGKILL'),10000);
 receiver.stdin.end(JSON.stringify({schemaVersion:1,args:['send','--to',String(process.pid),'--message=-','--no-from','--no-reply-to','--json']}));
 const [code,signal]=await once(receiver,'close');clearTimeout(timer);assert.equal(signal,null);assert.equal(code,0,stdout);
 assert.equal(JSON.parse(f.messages[3]!).message.content,'-');

});
