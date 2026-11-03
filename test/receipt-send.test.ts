// In-process actor and native-effect fixtures only. No live registry, inbox or agent.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { managedReceiptSend, type ReceiptSendDependencies } from '../dist/receipt-send.js';
import { ReceiptState } from '../dist/receipt-state.js';
import { HandoffBudget } from '../dist/handoff.js';
import { Refusal } from '../dist/discovery.js';
import { UnknownOutcome } from '../dist/process.js';
import type { ReceiptOperation, ReceiptRequestBody, ReceiptResponse } from '../dist/receipt-protocol.js';
import type { SendOptions } from '../dist/send.js';
const qualified = {skip:process.platform === 'win32'};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const tempRoot = process.env.TASK_TEMP ?? tmpdir();
function fixture(t: TestContext, clock?: {monotonic():number;utc():number}) {
  const root = fs.mkdtempSync(join(tempRoot,'codex-send-')); fs.chmodSync(root,0o700);
  const registry = join(root,'sessions'); fs.mkdirSync(registry,{mode:0o700});
  const record = join(registry,'123.json'); fs.writeFileSync(record,'{}',{mode:0o600});
  const s = fs.lstatSync(record), identity = [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs,s.birthtimeMs].join(':');
  const socket = join(root,'collector.sock'), stateDir = join(root,'state');
  ReceiptState.initialize(stateDir,socket); const actor = new ReceiptState(stateDir,{clock}).open();
  const provenance = {registryDirectory:registry,registryRecordPath:record,registryIdentity:hash(identity),socketPath:join(root,'inbox.sock'),routeIdentity:hash('route')};
  const order: string[] = [], bodies: string[] = []; let effects = 0, rawCapability = '', behavior: (message: string) => void = () => {};
  let fault: ((op: ReceiptOperation, response: ReceiptResponse) => ReceiptResponse) | undefined;
  const deps: ReceiptSendDependencies = {
    endpoint:()=> 'fixed-private-endpoint',
    producer:async pair => {order.push('producer'); return {evidence:{protocolVersion:1,artifactSha256:hash('installed'),challengeId:randomUUID(),receiptSchemaVersion:pair.receiptSchemaVersion,receiptScope:pair.receiptScope},revalidate(){order.push('revalidate-producer');}};},
    async exchange(_socket,context,op,body) {
      order.push(op); if (op !== 'hello') assert.equal(context,actor.collectorContextId);
      let result: unknown;
      switch(op) {
        case 'hello':result={receiptSchemas:[{agent:'claude',receiptSchemaVersion:2,receiptScope:'delegated_context'},{agent:'codex',receiptSchemaVersion:1,receiptScope:'original_generation'}],managedStoreVersion:2,clockReferenceMs:actor.clockReference(),endpointOwner:{uid:process.getuid!(),pid:process.pid}};break;
        case 'prepare':result=actor.prepare(body as ReceiptRequestBody['prepare']);break;
        case 'mint':result=actor.mint(body as ReceiptRequestBody['mint']);rawCapability=(result as {capability:string}).capability;result={capability:rawCapability};break;
        case 'fence':result={handoff:actor.fence(body as ReceiptRequestBody['fence'])};break;
        case 'submission':result={handoff:actor.submission(body as ReceiptRequestBody['submission'])};break;
        case 'wait-open':result={handoff:actor.waitOpen(body as ReceiptRequestBody['wait-open'])};break;
        case 'wait-status':result={handoff:actor.waitStatus(body as ReceiptRequestBody['wait-status'])};break;
        case 'wait-stop':result={handoff:actor.waitStop(body as ReceiptRequestBody['wait-stop'])};break;
        case 'revoke':result={handoff:actor.revoke(body as ReceiptRequestBody['revoke'])};break;
        default:throw new Error('unexpected RPC');
      }
      const response = {ipcVersion:2 as const,requestId:randomUUID(),collectorContextId:actor.collectorContextId,ok:true as const,body:result} as ReceiptResponse;
      return fault ? fault(op,response) : response;
    },
    async send(options: SendOptions) {
      const snapshot = {ok:true,submitted:!options.dryRun,dryRun:Boolean(options.dryRun),status:options.dryRun?'validated':'posted',consumptionConfirmed:false};
      let body = options.message;
      if (options.hooks) {
        assert.ok(options.hooks.privateReceiptContext === true || options.hooks.privateReceiptContext === undefined);
        const wrapped = await options.hooks.resolved({agent:'claude',target:'123',generation:null,writerIdentity:provenance.routeIdentity},snapshot,provenance);
        if (wrapped !== undefined) body=wrapped;
      }
      if (options.dryRun) return snapshot;
      await options.hooks?.beforeEffect?.(); order.push('native-effect');effects++;bodies.push(body);behavior(body);
      return snapshot;
    }
  };
  t.after(()=>{actor.close();fs.rmSync(root,{recursive:true,force:true});});
  return {deps,order,bodies,actor,provenance,record,socket,root, get effects(){return effects;},get capability(){return rawCapability;},
    behavior(value: (message:string)=>void){behavior=value;},fault(value:typeof fault){fault=value;},
    candidate(message:string){const line=message.split('\n').find(line=>line.startsWith('Receipt-Only: '));assert.ok(line); const frame=JSON.parse(line.slice(14));assert.equal(frame.collector,socket);return actor.receipt(JSON.stringify(frame.receipt));}}
}
const options = {to:'claude:123',message:'From: fixture\noriginal task'};
test('dry-run creates no bootstrap IPC, authority, producer or private wrapper',qualified,async t=>{
  const f=fixture(t),result=await managedReceiptSend({...options,dryRun:true},{collector:f.socket,requestAck:true},f.deps);
  assert.equal(f.effects,0);assert.deepEqual(f.order,[]);assert.deepEqual(result.value.receiptBootstrap,{status:'not_checked'});
});
test('prepare/mint/wait/fence precede one effect and fast candidate requires positive submission',qualified,async t=>{
  const f=fixture(t);let candidateStatus='';f.behavior(body=>{candidateStatus=f.candidate(body).status;});
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10,payload:'original task'},f.deps);
  assert.equal(candidateStatus,'awaiting_submission');assert.equal(result.exitCode,0);assert.equal(f.effects,1);
  const h=result.value.handoff as {ack:{status:string};targetGeneration:null;schemaVersion:number;wait:{status:string}};
  assert.equal(h.schemaVersion,2);assert.equal(h.targetGeneration,null);assert.equal(h.ack.status,'acknowledged');assert.equal(h.wait.status,'satisfied');
  const sequence=f.order.filter(x=>['hello','producer','prepare','mint','wait-open','fence','native-effect','submission'].includes(x));
  assert.deepEqual(sequence,['hello','producer','prepare','mint','wait-open','fence','native-effect','submission']);
  assert.ok(f.capability);assert.equal(JSON.stringify(result).includes(f.capability),false);assert.match(f.bodies[0]!,/Receipt-Only: \{"collector"/);
});
test('unknown native outcome never gains ACK from a fast candidate and never resends',qualified,async t=>{
  const f=fixture(t);f.behavior(body=>{assert.equal(f.candidate(body).status,'awaiting_submission');throw new UnknownOutcome();});
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(f.effects,1);assert.equal(result.exitCode,1);assert.equal(result.value.submitted,null);
  const h=result.value.handoff as {submission:{status:string};ack:{status:string}};assert.equal(h.submission.status,'unknown');assert.equal(h.ack.status,'unsupported');
  assert.equal(JSON.stringify(result).includes(f.capability),false);
});
test('best effort unavailable collector selects exactly one ordinary unwrapped effect before prepare',qualified,async t=>{
  const f=fixture(t);f.deps.endpoint=()=>{throw new Refusal('receipt_collector_unavailable',1);};
  const result=await managedReceiptSend(options,{collector:f.socket,requestAck:true},f.deps);
  assert.equal(result.exitCode,0);assert.equal(f.effects,1);assert.equal(f.bodies[0],options.message);assert.equal(f.order.includes('prepare'),false);assert.equal(f.capability,'');
  assert.deepEqual(result.value.receiptBootstrap,{status:'unsupported'});
});
test('required ACK rejects unsupported producer before effect or authority',qualified,async t=>{
  const f=fixture(t);f.deps.producer=async()=>{throw new Refusal('receipt_producer_mismatch',1);};
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged'},f.deps);
  assert.equal(result.exitCode,1);assert.equal(f.effects,0);assert.equal(f.order.includes('prepare'),false);assert.equal(f.capability,'');
});
test('positive native fact survives receipt persistence failure without a fabricated terminal wait',qualified,async t=>{
  const f=fixture(t);f.fault((op,response)=>{if(op==='submission')throw new Refusal('receipt_transport_unknown',1);return response;});
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(f.effects,1);assert.equal(result.value.submitted,true);assert.equal(result.value.handoffWarning,'persistence_failed');assert.equal(result.exitCode,1);
  const h=result.value.handoff as {submission:{status:string};wait:{status:string}};assert.equal(h.submission.status,'submitted');assert.equal(h.wait.status,'pending');
});
test('every status response is pinned to original delegated context',qualified,async t=>{
  const f=fixture(t);f.fault((op,response)=>{
    if(op==='wait-status'&&response.ok&&'handoff'in response.body){const h=response.body.handoff;assert.equal(h.schemaVersion,2);if(h.schemaVersion===2)return {...response,body:{handoff:{...h,receiptContext:{kind:'delegated_context',id:randomUUID()}}}};}
    return response;
  });
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,1);assert.equal(f.effects,1);assert.equal(result.value.submitted,true);assert.equal(result.value.handoffWarning,'persistence_failed');
});
test('the original wait deadline cannot change in a later owner response',qualified,async t=>{
  const f=fixture(t);let originalDeadline:number|undefined;
  f.fault((op,response)=>{
    if(op==='wait-open'&&response.ok&&'handoff'in response.body)originalDeadline=response.body.handoff.wait.deadlineAtUtcMs;
    if(op==='wait-status'&&response.ok&&'handoff'in response.body){const h=response.body.handoff;
      return {...response,body:{handoff:{...h,wait:{...h.wait,deadlineAtUtcMs:h.wait.deadlineAtUtcMs!+1000}}}};
    }return response;
  });
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,1);assert.equal(result.value.submitted,true);assert.equal(f.effects,1);
  assert.equal((result.value.handoff as {wait:{deadlineAtUtcMs:number}}).wait.deadlineAtUtcMs,originalDeadline);
  assert.equal(result.value.handoffWarning,'persistence_failed');
});
test('SIGINT stops only original pending wait once without native cancellation or resend',qualified,async t=>{
  const f=fixture(t);f.behavior(()=>{process.emit('SIGINT');});
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,130);assert.equal(f.effects,1);assert.equal(f.order.filter(op=>op==='wait-stop').length,1);
  assert.equal((result.value.handoff as {wait:{status:string}}).wait.status,'stopped');
});
test('a terminal timeout observed with SIGINT remains timeout exit 1 rather than a new stopped outcome',qualified,async t=>{
  const f=fixture(t);f.fault((op,response)=>{
    if(op==='wait-status'&&response.ok&&'handoff'in response.body){
      const h=response.body.handoff;process.emit('SIGINT');
      return {...response,body:{handoff:{...h,state:'timed_out_unknown',wait:{...h.wait,status:'timed_out_unknown'},nextActions:['reconcile']}}};
    }return response;
  });
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,1);assert.equal(f.effects,1);
  assert.equal((result.value.handoff as {wait:{status:string}}).wait.status,'timed_out_unknown');
  assert.equal(f.order.includes('wait-stop'),false);
});
test('five second original total budget refuses before bootstrap and native effect',qualified,async t=>{
  const f=fixture(t),result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',budget:new HandoffBudget(5)},f.deps);
  assert.equal(result.exitCode,1);assert.equal(f.effects,0);assert.equal(result.value.error,'insufficient_budget');assert.equal(f.order.includes('prepare'),false);
});
test('unsafe selected registry refuses required ACK even if ordinary discovery is compatible',qualified,async t=>{
  const f=fixture(t);fs.chmodSync(f.record,0o622);
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged'},f.deps);
  assert.equal(result.exitCode,1);assert.equal(f.effects,0);assert.equal(f.order.includes('prepare'),false);
});
test('unexpected post-fence error stays unknown and does not claim no native effect',qualified,async t=>{
  const f=fixture(t);f.behavior(body=>{assert.equal(f.candidate(body).status,'awaiting_submission');throw new Error('private transport cleanup failed');});
  const result=await managedReceiptSend(options,{collector:f.socket,requestAck:true},f.deps);
  assert.equal(f.effects,1);assert.equal(result.value.submitted,null);assert.equal(result.value.status,'unknown');assert.equal(result.exitCode,1);
  const h=result.value.handoff as {submission:{status:string};ack:{status:string}};assert.equal(h.submission.status,'unknown');assert.equal(h.ack.status,'unsupported');
  assert.equal(JSON.stringify(result).includes(f.capability),false);
});
test('concurrent latest wait cannot replace original pending operation after failed own query',qualified,async t=>{
  const f=fixture(t);let originalId: string|undefined,otherId: string|undefined;
  f.fault((op,response)=>{
    if(op==='wait-open'&&response.ok&&'handoff'in response.body)originalId=response.body.handoff.wait.operationId;
    if(op==='submission'&&response.ok&&'handoff'in response.body){
      const h=response.body.handoff;
      const other=f.actor.waitOpen({ledgerEpoch:h.ledgerEpoch,correlationId:h.correlationId,goal:'acknowledged',timeoutSeconds:10});
      otherId=other.wait.operationId;assert.notEqual(otherId,originalId);
      return {...response,body:{handoff:other}};
    }
    if(op==='wait-status')throw new Refusal('receipt_transport_unknown',1);
    return response;
  });
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  const h=result.value.handoff as {submission:{status:string};wait:{operationId:string;status:string}};
  assert.equal(result.value.submitted,true);assert.equal(result.value.handoffWarning,'persistence_failed');assert.equal(h.wait.operationId,originalId);assert.notEqual(h.wait.operationId,otherId);assert.equal(h.wait.status,'pending');assert.equal(h.submission.status,'submitted');assert.equal(f.effects,1);
});
test('qualified Codex receipt uses owned private queue and keeps capability out of probe argv', {skip:process.platform!=='darwin'||process.arch!=='arm64'},async t=>{
  const f=fixture(t),calls: {binary:string;args:string[]}[]=[],nativeBodies: string[]=[];
  const thread='01900000-0000-7000-8000-000000000001',generation=hash('original codex writer');let queueCalls=0;
  f.deps.run=async(binary,args)=>{calls.push({binary,args});return {code:0,stdout:args[0]==='--version'?'codex-cli 0.162.1\n':JSON.stringify({schemaVersion:1,ok:true,generation}),stderr:'',spawned:true,interrupted:false};};
  f.deps.nativeQueue=async input=>{
    queueCalls++;assert.equal(await input.verifyOwner(input.scope),true);await input.verifyStorage?.();await input.beforeEffect();input.verifyStorageSync?.();
    nativeBodies.push(input.message);assert.equal(f.candidate(input.message).status,'awaiting_submission');
    return {queueId:'private-fixture-queue',clientUserMessageId:input.clientUserMessageId};
  };
  f.deps.send=async input=>{
    assert.ok(input.hooks);assert.equal(input.hooks.codexRoute?.(),'owned_app_server');
    const context={agent:'codex' as const,target:thread,home:f.root,generation,writerIdentity:generation,binary:'/fixture/qualified-codex'};
    const snapshot={ok:true,submitted:true,status:'queued',consumptionConfirmed:false};
    const message=await input.hooks.resolved(context,snapshot);assert.equal(typeof message,'string');
    assert.ok(input.hooks.submitCodex);await input.hooks.submitCodex(context,message!,{binary:context.binary,cwd:f.root,async revalidate(owned){assert.equal(owned,true);},finalCheck(owned){assert.equal(owned,true);}});
    return snapshot;
  };
  const result=await managedReceiptSend({to:'codex:'+thread,message:'original codex task'},{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,0);assert.equal(queueCalls,1);assert.equal(nativeBodies.length,1);assert.ok(nativeBodies[0]!.includes(f.capability));
  assert.equal(JSON.stringify(calls).includes(f.capability),false);assert.equal(JSON.stringify(result).includes(f.capability),false);assert.ok(calls.every(call=>!call.args.some(arg=>arg.startsWith('--message'))));
  assert.equal((result.value.handoff as {schemaVersion:number;targetGeneration:string;ack:{status:string}}).schemaVersion,1);
  assert.equal((result.value.handoff as {targetGeneration:string}).targetGeneration,generation);
});
test('preflight fallback cannot reroute a selected name to a successor target',qualified,async t=>{
  const f=fixture(t),send=f.deps.send!;let calls=0;
  f.deps.endpoint=()=>{throw new Refusal('receipt_collector_unavailable',1);};
  f.deps.send=async input=>{
    calls++;
    if(input.hooks&&!input.hooks.privateReceiptContext){
      await input.hooks.resolved({agent:'claude',target:'124',generation:null,writerIdentity:hash('successor')},{ok:true,submitted:true,status:'posted'});
      throw new Error('fallback unexpectedly accepted replacement');
    }
    return send(input);
  };
  const result=await managedReceiptSend({...options,to:'claude:named-session'},{collector:f.socket,requestAck:true},f.deps);
  assert.equal(result.exitCode,1);assert.equal(result.value.error,'target_changed');assert.equal(calls,2);assert.equal(f.effects,0);assert.equal(f.capability,'');
});
test('fallback refuses after the original budget expires instead of renewing ordinary timeout',qualified,async t=>{
  const f=fixture(t);let mono=0;
  const budget=new HandoffBudget(10,{monotonic:()=>mono,utc:()=>100000});
  f.deps.endpoint=()=>{mono=6000;throw new Refusal('receipt_collector_unavailable',1);};
  const result=await managedReceiptSend(options,{collector:f.socket,requestAck:true,budget},f.deps);
  assert.equal(result.exitCode,1);assert.equal(result.value.error,'deadline_before_effect');assert.equal(f.effects,0);assert.equal(f.order.includes('prepare'),false);
});
test('best effort has no owner wait and never exposes a concurrent owner operation',qualified,async t=>{
  const f=fixture(t);let otherId:string|undefined;
  f.fault((op,response)=>{
    if(op==='submission'&&response.ok&&'handoff'in response.body){const h=response.body.handoff;
      const other=f.actor.waitOpen({ledgerEpoch:h.ledgerEpoch,correlationId:h.correlationId,goal:'acknowledged',timeoutSeconds:10});otherId=other.wait.operationId;
      return {...response,body:{handoff:other}};
    }return response;
  });
  const result=await managedReceiptSend(options,{collector:f.socket,requestAck:true},f.deps);
  assert.equal(result.exitCode,0);assert.equal(f.effects,1);assert.ok(otherId);
  const h=result.value.handoff as {wait:unknown;nextActions:string[]};assert.deepEqual(h.wait,{for:'none',status:'not_requested'});assert.deepEqual(h.nextActions,['reconcile']);assert.equal(JSON.stringify(result).includes(otherId!),false);
});
test('unsafe selected registry is a trust refusal for best effort and cannot trigger ordinary fallback',qualified,async t=>{
  const f=fixture(t);fs.chmodSync(f.record,0o622);
  const result=await managedReceiptSend(options,{collector:f.socket,requestAck:true},f.deps);
  assert.equal(result.exitCode,1);assert.equal(result.value.error,'receipt_registry_untrusted');assert.equal(f.effects,0);assert.equal(f.capability,'');assert.equal(f.order.includes('prepare'),false);
});
test('producer artifact mismatch is a trust refusal for best effort and never falls back',qualified,async t=>{
  const f=fixture(t);f.deps.producer=async()=>{throw new Refusal('receipt_producer_mismatch',1);};
  const result=await managedReceiptSend(options,{collector:f.socket,requestAck:true},f.deps);
  assert.equal(result.exitCode,1);assert.equal(result.value.error,'receipt_producer_mismatch');assert.equal(f.effects,0);assert.equal(f.capability,'');
});

for(const winner of ['ack','timeout'] as const) test(`terminal ${winner} wins pending-to-SIGINT stop race with original wait and native facts`,qualified,async t=>{
  let mono=1000,utc=100000;const clock={monotonic:()=>mono,utc:()=>utc};
  const f=fixture(t,clock),exchange=f.deps.exchange!;let operationId:string|undefined,stopOperation:string|undefined;
  f.behavior(()=>process.emit('SIGINT'));
  f.deps.exchange=async(socket,context,op,body,timeout)=>{
    if(op==='wait-stop'){
      stopOperation=(body as ReceiptRequestBody['wait-stop']).operationId;
      if(winner==='ack')f.candidate(f.bodies[0]!);else {mono+=5000;utc+=5000;}
    }
    const result=await exchange(socket,context,op,body,timeout);
    if(op==='wait-open'&&result.ok&&'handoff'in result.body)operationId=result.body.handoff.wait.operationId;
    return result;
  };
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',budget:new HandoffBudget(10,clock)},f.deps);
  assert.equal(result.exitCode,winner==='ack'?0:1);assert.equal(f.effects,1);assert.equal(result.value.submitted,true);assert.equal(result.value.status,'posted');
  assert.equal(result.value.handoffWarning,undefined);assert.equal(stopOperation,operationId);
  const h=result.value.handoff as {wait:{status:string;operationId:string};submission:{status:string}};
  assert.equal(h.wait.operationId,operationId);assert.equal(h.wait.status,winner==='ack'?'satisfied':'timed_out_unknown');assert.equal(h.submission.status,'submitted');
  assert.equal(f.order.filter(op=>op==='wait-stop').length,1);assert.equal(f.order.filter(op=>op==='wait-status').length,2);
});
test('six second sender retains fractional observation after prepare and mint IPC delay',qualified,async t=>{
  let mono=1000,utc=100000;const clock={monotonic:()=>mono,utc:()=>utc};
  const f=fixture(t,clock),exchange=f.deps.exchange!;let openedDeadline:number|undefined,span:number|undefined;
  f.deps.exchange=async(socket,context,op,body,timeout)=>{
    if(op==='hello'){const result=await exchange(socket,context,op,body,timeout);mono+=100;utc+=100;return result;}
    if(op==='prepare'||op==='mint'||op==='wait-open'){mono+=100;utc+=100;}
    if(op==='wait-open'){span=(body as ReceiptRequestBody['wait-open']).remainingMs;assert.equal((body as ReceiptRequestBody['wait-open']).timeoutSeconds,6);}
    const result=await exchange(socket,context,op,body,timeout);
    if(op==='wait-open'&&result.ok&&'handoff'in result.body)openedDeadline=result.body.handoff.wait.deadlineAtUtcMs;
    return result;
  };
  f.behavior(body=>f.candidate(body));
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',budget:new HandoffBudget(6,clock)},f.deps);
  assert.equal(result.exitCode,0);assert.equal(f.effects,1);assert.equal(span,5900);assert.equal(openedDeadline,100900);
});

test('catch cleanup confirms a lost stop reply before recording unknown native outcome',qualified,async t=>{
  const f=fixture(t),exchange=f.deps.exchange!;f.behavior(()=>{process.emit('SIGINT');throw new UnknownOutcome();});
  f.deps.exchange=async(...args)=>{const response=await exchange(...args);if(args[2]==='wait-stop')throw new Refusal('receipt_transport_unknown',1);return response;};
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,130);assert.equal(result.value.submitted,null);assert.equal(result.value.status,'unknown');assert.equal(result.value.handoffWarning,undefined);
  const h=result.value.handoff as {wait:{status:string};ack:{status:string}};assert.equal(h.wait.status,'stopped');assert.equal(h.ack.status,'unsupported');
  assert.equal(f.order.filter(op=>op==='wait-stop').length,1);assert.ok(f.order.indexOf('wait-stop')<f.order.indexOf('submission'));assert.equal(f.effects,1);
});
test('SIGINT after wait-open stops before revoke with zero native effects',qualified,async t=>{
  const f=fixture(t);f.fault((op,response)=>{if(op==='wait-open')process.emit('SIGINT');return response;});
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,130);assert.equal(f.effects,0);assert.equal(result.value.submitted,false);
  assert.equal((result.value.handoff as {wait:{status:string}}).wait.status,'stopped');
  assert.ok(f.order.indexOf('wait-stop')<f.order.indexOf('revoke'));assert.equal(f.order.filter(op=>op==='wait-stop').length,1);
});
test('unconfirmed pre-effect stop keeps original pending facts and exits one',qualified,async t=>{
  const f=fixture(t),exchange=f.deps.exchange!;
  f.deps.exchange=async(...args)=>{
    if(args[2]==='wait-stop'||args[2]==='wait-status'||args[2]==='revoke')throw new Refusal('receipt_transport_unknown',1);
    const result=await exchange(...args);if(args[2]==='wait-open')process.emit('SIGINT');return result;
  };
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,1);assert.equal(f.effects,0);assert.equal(result.value.error,'receipt_transport_unknown');
  assert.equal((result.value.handoff as {wait:{status:string}}).wait.status,'pending');
});

for(const loseStatus of [false,true])test(`positive native acceptance survives lost stop reply ${loseStatus?'without':'with'} terminal confirmation`,qualified,async t=>{
  const f=fixture(t),exchange=f.deps.exchange!;let reads=0;f.behavior(()=>process.emit('SIGINT'));
  f.deps.exchange=async(...args)=>{
    if(args[2]==='wait-status'&&++reads===2&&loseStatus)throw new Refusal('receipt_transport_unknown',1);
    const result=await exchange(...args);if(args[2]==='wait-stop')throw new Refusal('receipt_transport_unknown',1);return result;
  };
  const result=await managedReceiptSend(options,{collector:f.socket,waitFor:'acknowledged',seconds:10},f.deps);
  assert.equal(result.exitCode,loseStatus?1:130);assert.equal(result.value.submitted,true);assert.equal(result.value.status,'posted');assert.equal(f.effects,1);assert.equal(reads,2);
  assert.equal((result.value.handoff as {wait:{status:string}}).wait.status,loseStatus?'pending':'stopped');
  if(loseStatus)assert.equal(result.value.error,'stop_unconfirmed');
  assert.equal(f.order.filter(op=>op==='wait-stop').length,1);assert.equal(f.order.filter(op=>op==='wait-open').length,1);
});
