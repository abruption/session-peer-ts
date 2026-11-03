// Explicit owner command fixtures only. No real agent, native queue, transcript,
// model, SSH, global installation or automatic service is involved.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net, { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { receiptCommand } from '../dist/receipt-command.js';
import { receiptExchange, type Collector } from '../dist/receipt-collector.js';
import { RECEIPT_PAIRS } from '../dist/receipt-protocol.js';
import { VERSION } from '../dist/protocol.js';

const posix = { skip: process.platform === 'win32' };
const noInput = async () => { throw new Error('this command must not read stdin'); };
const wire = (value: unknown) => JSON.stringify(value)+'\n';
const digest = createHash('sha256').update('COMMAND_PRIVATE_PAYLOAD').digest('hex');
const binding = () => ({ agent: 'claude' as const, destination: 'fixture-local', target: '123', generation: null,
  registryDirectory: '/fixture/sessions', registryRecordPath: '/fixture/sessions/123.json', registryIdentity: 'a'.repeat(64),
  socketPath: '/fixture/inbox.sock', routeIdentity: 'b'.repeat(64), payloadDigest: digest });
function publicBody(value: any): any { assert.equal(value.ok,true,value.error); return value.body; }
async function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(),'codex-command-'))); fs.chmodSync(root,0o700);
  const state=join(root,'state'), socket=join(state,'s'); let collector: Collector | undefined;
  t.after(async()=>{ if(collector)assert.equal((await collector.close()).cleanup,'confirmed');fs.rmSync(root,{recursive:true,force:true}); });
  const initialized=await receiptCommand(['receipt','init','--state-dir',state,'--json'],noInput);
  assert.equal(initialized.exitCode,0);assert.equal(initialized.value.collector,socket);
  const served=await receiptCommand(['receipt','serve','--state-dir',state,'--json'],noInput);
  collector=served.collector;assert.ok(collector);assert.equal(served.value.status,'ready');
  const controller=collector;
  const rpc=async(op:any,body:any)=>receiptExchange(socket,op==='hello'?null:controller.contextId,op,body);
  const args=(op:string,epoch:string,id:string)=>['receipt',op,'--collector',socket,'--ledger-epoch',epoch,'--correlation-id',id,'--json'];
  async function pending() {
    const prepared=publicBody(await rpc('prepare',{binding:binding(),receiptSchemaVersion:2,receiptScope:'delegated_context',producerEvidence:{
      protocolVersion:1,artifactSha256:'c'.repeat(64),challengeId:randomUUID(),receiptSchemaVersion:2,receiptScope:'delegated_context'}}));
    const handle={ledgerEpoch:prepared.ledgerEpoch,correlationId:prepared.correlationId,receiptContextId:prepared.receiptContextId};
    const minted=publicBody(await rpc('mint',{...handle,producerProtocolVersion:1}));
    await rpc('fence',{...handle,binding:binding()});await rpc('submission',{...handle,status:'submitted'});
    const receipt=wire({schemaVersion:2,kind:'receipt',receiptScope:'delegated_context',...handle,receiptId:randomUUID(),capability:minted.capability});
    return {handle,receipt,capability:minted.capability};
  }
  return {root,state,socket,collector:controller,rpc,args,pending,history:()=>fs.readFileSync(join(state,'ledger.json'))};
}
function observeWaitOpen(t: TestContext): Promise<void> {
  const original=net.createServer;let resolveOpen!:()=>void;
  const opened=new Promise<void>(ok=>{resolveOpen=ok;});
  t.mock.method(net,'createServer',((...args:any[])=>{
    const listener=args.pop();
    return (original as any)(...args,(socket:Socket)=>{
      listener(socket);const input:Buffer[]=[];socket.on('data',part=>input.push(part));
      // Installed after the real EOF handler: state is committed before this
      // observation. It does not alter clocks, admission, transport or state.
      socket.once('end',()=>{const value=JSON.parse(Buffer.concat(input).toString('utf8'));if(value.op==='wait-open')queueMicrotask(resolveOpen);});
    });
  }) as typeof net.createServer);syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});return opened;
}

test('producer probe is private-input-only, raw, exact and does not claim route qualification',async()=>{
  const challenge={producerProtocolVersion:1,challengeId:randomUUID(),receiptSchemaVersion:2,receiptScope:'delegated_context'};
  let reads=0;
  const result=await receiptCommand(['receipt','probe','--json'],async(limit,privateMode,timeoutMs)=>{
    reads++;assert.equal(limit,4096);assert.equal(privateMode,true);assert.equal(timeoutMs,2000);return wire(challenge);
  });
  assert.equal(reads,1);assert.equal(result.raw,true);assert.equal(result.exitCode,0);
  assert.deepEqual(result.value,{...challenge,implementation:'typescript',runtimeVersion:VERSION});
  await assert.rejects(receiptCommand(['receipt','probe','--json'],async()=>wire({...challenge,capability:'PRIVATE_PROBE_SENTINEL'})),error=>!String(error).includes('PRIVATE_PROBE_SENTINEL'));
});

test('closed command options reject authority in argv and never fall back to stdin or offline state',async()=>{
  let reads=0;const read=async()=>{reads++;return '';};
  const cases=[['receipt','probe'],['receipt','probe','--json','--json'],['receipt','probe','--collector','/fixture/s','--json'],
    ['receipt','recover','--json'],['receipt','respond','--collector','/fixture/s','--receipt','PRIVATE_ARGV_TOKEN','--json'],
    ['receipt','status','--state-dir','/fixture/private-state','--json'],['receipt','respond','--collector','/fixture/s','--receipt','-','--host','remote','--json'],
    ['receipt','init','--state-dir','relative','--json'],['receipt','wait','--collector','/fixture/s','--ledger-epoch',randomUUID(),'--correlation-id',randomUUID(),'--wait-timeout','1.5','--json']];
  for(const args of cases)await assert.rejects(receiptCommand(args,read),error=>!String(error).includes('PRIVATE_ARGV_TOKEN'));
  assert.equal(reads,0);
});

test('initialization is explicit and never adopts an old store or follows an alias',posix,async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP??tmpdir(),'codex-command-old-')));fs.chmodSync(root,0o700);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const old=join(root,'old');fs.mkdirSync(old,{mode:0o700});fs.writeFileSync(join(old,'ledger.json'),'old unmanaged fixture',{mode:0o600});
  await assert.rejects(receiptCommand(['receipt','init','--state-dir',old,'--json'],noInput));
  assert.deepEqual(fs.readdirSync(old),['ledger.json']);assert.equal(fs.readFileSync(join(old,'ledger.json'),'utf8'),'old unmanaged fixture');
  const alias=join(root,'alias');fs.symlinkSync(old,alias,'dir');
  await assert.rejects(receiptCommand(['receipt','init','--state-dir',alias,'--json'],noInput));
  assert.deepEqual(fs.readdirSync(old),['ledger.json']);
  const absent=join(root,'absent');await assert.rejects(receiptCommand(['receipt','serve','--state-dir',absent,'--json'],noInput));
  assert.equal(fs.existsSync(absent),false,'serve must not implicitly initialize storage');
});

test('explicit respond records one correlated receipt without exposing raw authority or original payload',posix,async t=>{
  const f=await fixture(t), intent=await f.pending();let reads=0;
  const result=await receiptCommand(['receipt','respond','--collector',f.socket,'--receipt','-','--json'],async(limit,privateMode,timeoutMs)=>{
    reads++;assert.equal(limit,4096);assert.equal(privateMode,true);assert.equal(timeoutMs,2000);return intent.receipt;
  });
  assert.equal(result.exitCode,0);assert.equal(result.value.status,'acknowledged');assert.equal((result.value.handoff as any).targetGeneration,null);
  const text=JSON.stringify(result.value);for(const secret of [intent.capability,digest,'COMMAND_PRIVATE_PAYLOAD','/fixture/sessions'])assert.equal(text.includes(secret),false);
  const before=f.history();
  const duplicate=await receiptCommand(['receipt','respond','--collector',f.socket,'--receipt','-','--json'],async()=>intent.receipt);
  assert.equal(duplicate.value.status,'acknowledged');assert.deepEqual(f.history(),before);assert.equal(reads,1);
  const status=await receiptCommand(f.args('status',intent.handle.ledgerEpoch,intent.handle.correlationId),noInput);
  assert.equal((status.value.handoff as any).ack.status,'acknowledged');assert.equal(status.exitCode,0);
});

test('revocation and insufficient wait budget are explicit owner operations with no native submission',posix,async t=>{
  const f=await fixture(t), intent=await f.pending();
  const short=await receiptCommand([...f.args('wait',intent.handle.ledgerEpoch,intent.handle.correlationId),'--wait-timeout','1'],noInput);
  assert.equal(short.exitCode,1);assert.equal((short.value.handoff as any).wait.reason,'insufficient_budget');
  const revoked=await receiptCommand(f.args('revoke',intent.handle.ledgerEpoch,intent.handle.correlationId),noInput);
  assert.equal(revoked.exitCode,0);assert.notEqual((revoked.value.handoff as any).ack.status,'acknowledged');
  await assert.rejects(receiptCommand(['receipt','respond','--collector',f.socket,'--receipt','-','--json'],async()=>intent.receipt),error=>!String(error).includes(intent.capability));
});

test('wait observes only its original operation and collector context until a voluntary receipt arrives',posix,async t=>{
  const opened=observeWaitOpen(t), f=await fixture(t), intent=await f.pending();
  const active=receiptCommand(f.args('wait',intent.handle.ledgerEpoch,intent.handle.correlationId),noInput);
  await opened;
  const original=JSON.parse(f.history().toString('utf8')).data.records[intent.handle.correlationId].waits[0].public;
  await f.rpc('receipt',{receipt:intent.receipt});
  const result=await active,handoff=result.value.handoff as any;
  assert.equal(result.exitCode,0);assert.equal(handoff.wait.status,'satisfied');assert.equal(handoff.wait.operationId,original.operationId);
  assert.equal(handoff.wait.deadlineAtUtcMs,original.deadlineAtUtcMs);
  const waits=JSON.parse(f.history().toString('utf8')).data.records[intent.handle.correlationId].waits;
  assert.equal(waits.length,1,'polls must not open renewed operations');
});

test('SIGINT stops the same pending wait once and exits 130 without cancelling native work',posix,async t=>{
  const opened=observeWaitOpen(t), f=await fixture(t), intent=await f.pending();
  const script=join(f.root,'wait.mjs'),module=pathToFileURL(resolve('dist/receipt-command.js')).href;
  fs.writeFileSync(script,`import {receiptCommand} from ${JSON.stringify(module)};\nconst result=await receiptCommand(${JSON.stringify(f.args('wait',intent.handle.ledgerEpoch,intent.handle.correlationId))},async()=>{throw Error('unexpected stdin')});\nprocess.stdout.write(JSON.stringify(result)+'\\n',()=>{process.exitCode=result.exitCode;});\n`,{mode:0o600});
  const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});let output='',stderr='';
  child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>stderr+=x);
  const closed=once(child,'close');const hard=setTimeout(()=>child.kill('SIGKILL'),10000);
  t.after(async()=>{clearTimeout(hard);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'close');}});
  await opened;child.kill('SIGINT');const [code,signal]=await closed;clearTimeout(hard);
  assert.equal(signal,null,stderr);assert.equal(code,130,stderr);
  const result=JSON.parse(output);assert.equal(result.exitCode,130);assert.equal(result.value.handoff.wait.status,'stopped');
  const waits=JSON.parse(f.history().toString('utf8')).data.records[intent.handle.correlationId].waits;
  assert.equal(waits.length,1);assert.equal(waits[0].public.operationId,result.value.handoff.wait.operationId);
  assert.equal(waits[0].public.reason,'stopped_by_operator');assert.equal(result.value.handoff.submission.status,'submitted');
});

test('a lost receipt response stays unknown without retry or secret reflection',posix,async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP??tmpdir(),'codex-command-loss-')));fs.chmodSync(root,0o700);
  const socket=join(root,'s'),context=randomUUID(),connections=new Set<Socket>();let calls=0;
  const server=createServer({allowHalfOpen:true},client=>{
    connections.add(client);client.on('error',()=>{});client.once('close',()=>connections.delete(client));const bytes:Buffer[]=[];
    client.on('data',part=>bytes.push(part));client.once('end',()=>{
      const request=JSON.parse(Buffer.concat(bytes).toString('utf8'));calls++;
      if(request.op==='hello')client.end(wire({ipcVersion:2,requestId:request.requestId,collectorContextId:context,ok:true,
        body:{receiptSchemas:RECEIPT_PAIRS,managedStoreVersion:2,clockReferenceMs:0,endpointOwner:{uid:process.getuid!(),pid:process.pid}}}));
      else client.destroy();
    });
  });server.listen(socket);await once(server,'listening');fs.chmodSync(socket,0o600);
  t.after(async()=>{for(const client of connections)client.destroy();await new Promise<void>(ok=>server.close(()=>ok()));fs.rmSync(root,{recursive:true,force:true});});
  const capability=Buffer.alloc(32,9).toString('base64url'),receipt=wire({schemaVersion:2,kind:'receipt',receiptScope:'delegated_context',
    ledgerEpoch:randomUUID(),correlationId:randomUUID(),receiptContextId:randomUUID(),receiptId:randomUUID(),capability});
  const result=await receiptCommand(['receipt','respond','--collector',socket,'--receipt','-','--json'],async()=>receipt);
  assert.equal(result.exitCode,1);assert.equal(result.value.status,'unknown');assert.equal(result.value.retryAllowed,false);
  assert.equal(Object.hasOwn(result.value,'submitted'),false);assert.equal(JSON.stringify(result).includes(capability),false);assert.equal(calls,2,'one hello and one receipt, never retry');
});


test('later owner failure retains the verified original wait instead of fabricating a terminal result',posix,async t=>{
  const opened=observeWaitOpen(t),f=await fixture(t),intent=await f.pending();
  const active=receiptCommand(f.args('wait',intent.handle.ledgerEpoch,intent.handle.correlationId),noInput);
  await opened;
  const original=JSON.parse(f.history().toString('utf8')).data.records[intent.handle.correlationId].waits[0].public;
  fs.chmodSync(join(f.state,'ledger.json'),0o644);
  const result=await active,handoff=result.value.handoff as any;
  assert.equal(result.exitCode,1);assert.equal(result.value.ok,false);assert.equal(result.value.status,'unknown');
  assert.equal(result.value.error,'receipt_storage_untrusted');assert.equal(result.value.retryAllowed,false);
  assert.equal(handoff.wait.status,'pending');assert.equal(handoff.wait.operationId,original.operationId);
  assert.equal(handoff.wait.deadlineAtUtcMs,original.deadlineAtUtcMs);assert.equal(handoff.submission.status,'submitted');
  assert.equal(Object.hasOwn(result.value,'submitted'),false);assert.equal(JSON.stringify(result.value).includes(intent.capability),false);
});

test('Windows managed commands refuse before private input or owner-state access',async t=>{
 const original=Object.getOwnPropertyDescriptor(process,'platform')!;
 Object.defineProperty(process,'platform',{value:'win32'});
 t.after(()=>Object.defineProperty(process,'platform',original));
 let reads=0;const reader=async()=>{reads++;throw new Error('private input must not be requested');};
 const id='11111111-1111-4111-8111-111111111111';
 for(const args of [
  ['receipt','init','--state-dir','/fixture/managed','--json'],
  ['receipt','serve','--state-dir','/fixture/managed','--json'],
  ['receipt','respond','--collector','/fixture/s','--receipt','-','--json'],
  ...['status','wait','revoke'].map(op=>['receipt',op,'--collector','/fixture/s','--ledger-epoch',id,'--correlation-id',id,'--json'])
 ])await assert.rejects(receiptCommand(args,reader),{code:'receipt_storage_unsupported'});
 assert.equal(reads,0);
});

for(const failedTerminalRead of [false,true])test(`unconfirmed command stop ${failedTerminalRead?'terminal query':'reply'} preserves pending evidence and exits one`,posix,async t=>{
  const f=await fixture(t),intent=await f.pending(),socket=join(f.root,'proxy');
  const original=publicBody(await f.rpc('status',{ledgerEpoch:intent.handle.ledgerEpoch,correlationId:intent.handle.correlationId})).handoff;
  const pending={...original,wait:{for:'acknowledged',status:'pending',operationId:randomUUID(),deadlineAtUtcMs:Date.now()+25000},nextActions:['keep_waiting','reconcile','stop_waiting']};
  const calls:string[]=[];const server=createServer({allowHalfOpen:true},client=>{
    const parts:Buffer[]=[];client.on('data',part=>parts.push(part));client.on('error',()=>{});client.once('end',()=>{
      const request=JSON.parse(Buffer.concat(parts).toString('utf8'));calls.push(request.op);
      const response={ipcVersion:2,requestId:request.requestId,collectorContextId:f.collector.contextId,ok:true};
      if(request.op==='hello')client.end(wire({...response,body:{receiptSchemas:RECEIPT_PAIRS,managedStoreVersion:2,clockReferenceMs:0,endpointOwner:{uid:process.getuid!(),pid:process.pid}}}));
      else if(request.op==='wait-open'){client.end(wire({...response,body:{handoff:pending}}));process.emit('SIGINT');}
      else if(request.op==='wait-stop'&&failedTerminalRead)client.end(wire({...response,ok:false,error:'receipt_wait_terminal'}));
      else client.destroy();
    });
  });server.listen(socket);await once(server,'listening');fs.chmodSync(socket,0o600);
  t.after(()=>new Promise<void>(ok=>server.close(()=>ok())));
  const args=f.args('wait',intent.handle.ledgerEpoch,intent.handle.correlationId).map(value=>value===f.socket?socket:value);
  const result=await receiptCommand(args,noInput);
  assert.equal(result.exitCode,1);assert.equal((result.value.handoff as any).wait.status,'pending');assert.equal((result.value.handoff as any).wait.operationId,pending.wait.operationId);
  assert.equal(calls.filter(op=>op==='wait-stop').length,1);assert.equal(calls.filter(op=>op==='wait-open').length,1);
  assert.equal(calls.filter(op=>op==='wait-status').length,failedTerminalRead?1:0);
});
