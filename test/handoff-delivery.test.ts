import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync,watch} from 'node:fs';
import {join,delimiter,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {validateHandoff} from '../dist/handoff.js';
import {HandoffLedger,payloadDigest} from '../dist/handoff-ledger.js';
import {handoffSend} from '../dist/handoff-operations.js';
const qualified={skip:process.platform!=='darwin'||process.arch!=='arm64'};
const thread='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cli=resolve('dist/cli.js');
const schema=`CREATE TABLE thread_turns(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id));
CREATE TABLE thread_items(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,item_id TEXT NOT NULL,rollout_ordinal INTEGER NOT NULL,item_json TEXT NOT NULL,item_type TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id,item_id));
CREATE INDEX idx_thread_items_user_messages ON thread_items(thread_id,rollout_ordinal) WHERE item_type='userMessage';
CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER NOT NULL,next_rollout_ordinal INTEGER NOT NULL);`;
async function fixture(t:TestContext,mode='inject',version='0.160.1',warm=true){
 const root=realpathSync(mkdtempSync(join(process.env.TASK_TEMP??tmpdir(),'codex-hd-'))),home=join(root,'home'),bin=join(root,'bin');chmodSync(root,0o700);mkdirSync(home,{mode:0o700});mkdirSync(bin,{mode:0o700});mkdirSync(join(home,'thread-writer-locks'),{mode:0o700});
 let history:DatabaseSync|undefined;
 t.after(()=>{try{history?.close();}finally{rmSync(root,{recursive:true,force:true});}});
 const state=new DatabaseSync(join(home,'state_5.sqlite'));state.exec('CREATE TABLE threads(id TEXT, cwd TEXT)');state.prepare('INSERT INTO threads VALUES(?,?)').run(thread,home);state.close();
 // Model a live warm WAL store: keep the owner connection open so other
 // fixture connections cannot remove/recreate WAL and SHM between probes.
 // DELETE-mode writes can expose a rollback journal that the observer refuses.
 if(warm){const db=history=new DatabaseSync(join(home,'thread_history_1.sqlite'));db.exec('PRAGMA journal_mode=WAL');db.exec(schema);db.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run(thread,'turn-fixture','completed');db.prepare('INSERT INTO thread_history_projection_state VALUES(?,?,?)').run(thread,100,100);}
 const lock=join(home,'thread-writer-locks',thread+'.lock'),locks=createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');
 // The retained writer really opens this home's state inode and runs from an
 // existing cwd, so the production storage binding guard needs no fixture bypass.
 const held=spawn(process.execPath,['-e',"const f=require('fs').openSync(process.argv[1],'w',0o600);require(process.argv[2]).flockSync(f,'exnb');const db=require('fs').openSync(process.argv[3],'r');console.log('ready');setInterval(()=>{},1000)",lock,locks,join(home,'state_5.sqlite')],{cwd:home});held.stderr.resume();await once(held.stdout,'data');t.after(async()=>{if(held.exitCode===null&&held.signalCode===null){held.kill('SIGKILL');await once(held,'close');}});
 // The real tools are native executables. Do not spend the bounded owner
 // probe's budget on four extra Node startups under parallel CI load.
 // Owner data stays in a separate file, never interpolated into shell code.
 const lsof=join(bin,'lsof');writeFileSync(lsof+'.data','p'+held.pid+'\0ccodex-fixture\0u'+process.getuid?.()+'\0',{mode:0o600});
 writeFileSync(lsof+'.cwd','p'+held.pid+'\0fcwd\0n'+home+'\0',{mode:0o600});
 const stateInfo=statSync(join(home,'state_5.sqlite'),{bigint:true});
 writeFileSync(lsof+'.fds','p'+held.pid+'\0f4\0D0x'+stateInfo.dev.toString(16)+'\0i'+stateInfo.ino+'\0n'+join(home,'state_5.sqlite')+'\0',{mode:0o600});
 writeFileSync(lsof,'#!/bin/sh\ncase " $* " in\n  *" -d cwd "*) exec /bin/cat "$0.cwd";;\n  *" -F0fDin "*) exec /bin/cat "$0.fds";;\n  *) exec /bin/cat "$0.data";;\nesac\n',{mode:0o700});
 writeFileSync(join(bin,'ps'),'#!/bin/sh\nprintf "Fixture stable start\\n"\n',{mode:0o700});
 const log=join(root,'queue-log-\'"\\\n\u2028\u2029'),nativeLog=join(root,'native-calls.jsonl');writeFileSync(log,'');writeFileSync(nativeLog,'');const codex=join(bin,'codex');
 const initializeReady=join(root,'initialize-ready'),initializeRelease=join(root,'initialize-release');
 // Runtime configuration is JSON data; no fixture path/mode/version is code.
 writeFileSync(codex+'.json',JSON.stringify({mode,version,log,nativeLog,initializeReady,initializeRelease}),{mode:0o600});
 writeFileSync(codex,`#!${process.execPath}
const fs=require('fs'),readline=require('readline'),path=require('path');
const {mode,version,log,nativeLog,initializeReady,initializeRelease}=JSON.parse(fs.readFileSync(__filename+'.json','utf8'));
fs.appendFileSync(nativeLog,JSON.stringify({command:process.argv[2]??null})+'\\n');
if(process.argv[2]==='--version'){console.log('codex-cli '+version);process.exit(0);}
if(process.argv[2]==='queue'){fs.appendFileSync(log,JSON.stringify({method:'legacy'})+'\\n');console.log('Queued message legacy-1 for thread '+process.argv[4]+'.');process.exit(0);}
const {DatabaseSync:Sql}=require('node:sqlite');globalThis.keptDatabases=[new Sql(path.join(process.env.CODEX_HOME,'state_5.sqlite'),{readOnly:true}),new Sql(path.join(process.env.CODEX_SQLITE_HOME,'queue_1.sqlite'))];
readline.createInterface({input:process.stdin}).on('line',async line=>{const r=JSON.parse(line);if(r.method==='initialize'){
if(mode==='concurrent-stop'){fs.writeFileSync(initializeReady,'ready');await new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync(initializeRelease)){clearInterval(timer);resolve();}},10);});}
console.log(JSON.stringify({id:r.id,result:{codexHome:process.env.CODEX_HOME,platformFamily:'unix',platformOs:'macos',userAgent:'session-peer-native-queue/'+version+' (fixture)'}}));}else if(r.method==='thread/queue/add'){
fs.appendFileSync(log,JSON.stringify({method:r.method,clientId:r.params.clientUserMessageId})+'\\n');
if(mode==='concurrent-stop')return;
if(mode==='loss'){process.exit(0);return;}
if(mode==='ledger-failure')fs.chmodSync(path.join(process.env.SESSION_PEER_HANDOFF_HOME,'ledger.json'),0o644);
if(mode==='inject'){const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(process.env.CODEX_HOME,'thread_history_1.sqlite'));db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?)').run(r.params.threadId,'turn-fixture','native-item-not-client-id',1,JSON.stringify({type:'userMessage',id:'native-item-not-client-id',clientId:r.params.clientUserMessageId,content:[{text:'PRIVATE_BODY_SENTINEL'}]}),'userMessage');db.close();}
console.log(JSON.stringify({id:r.id,result:{queuedSubmission:{id:'queue-fixture',clientUserMessageId:r.params.clientUserMessageId,input:r.params.input}}}));
}});`,{mode:0o700});
 const env={...process.env,HOME:root,USERPROFILE:root,CODEX_HOME:home,SESSION_PEER_CODEX_HOMES:'[]',CLAUDE_CONFIG_DIR:join(root,'.claude'),SESSION_PEER_TAILSCALE:'off',SESSION_PEER_UPDATE_NOTICE:'',CODEX_THREAD_ID:'',CODEX_SESSION_ID:'',PATH:bin+delimiter+(process.env.PATH??''),SESSION_PEER_HANDOFF_HOME:join(root,'state','handoff')};
 const args=['send','--to','codex:'+thread,'--codex-home',home,'--codex-bin',codex,'--message','fixture request','--no-from','--no-reply-to'];
 let activeSend:undefined|{child:ReturnType<typeof spawn>;closed:()=>boolean;output:()=>{stdout:string;stderr:string}};
 function start(options:string[]){const child=spawn(process.execPath,[cli,...options,'--json'],{env});let stdout='',stderr='',closedOutput=false;child.once('close',()=>{closedOutput=true;});child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);if(options[0]==='send')activeSend={child,closed:()=>closedOutput,output:()=>({stdout,stderr})};child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),15000);const closed=once(child,'close');const result=closed.then(([code,signal])=>{clearTimeout(timer);assert.equal(signal,null,stderr);return{code,value:JSON.parse(stdout),stdout,stderr};});void result.catch(()=>{});t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}});return{child,result};}
 async function invoke(options:string[]){return start(options).result;}
 assert.equal((await invoke(['handoff','init'])).code,0);
 const calls=()=>readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const nativeCalls=()=>readFileSync(nativeLog,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 // Readiness is the persisted queue evidence, not an fs.watch notification.
 // Polling also detects a CLI that refused/exited before reaching the queue.
 // Read/parse errors remain failures; neither they nor an exit mean readiness.
 async function queued(){
  if(calls().length)return;
  await new Promise<void>((ok,fail)=>{
   let settled=false;
   const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);if(error)fail(error);else ok();};
   const diagnostic=()=>JSON.stringify({queueCalls:calls(),nativeCalls:nativeCalls(),send:activeSend?{
    exitCode:activeSend.child.exitCode,signalCode:activeSend.child.signalCode,...activeSend.output()
   }:null});
   const check=()=>{try{
    if(calls().length){finish();return;}
    if(activeSend?.closed())finish(new Error('queue fixture not called: send exited before queue evidence; '+diagnostic()));
   }catch(error){finish(error);}};
   const poll=setInterval(check,25);
   const timer=setTimeout(()=>{check();if(!settled){try{finish(new Error('queue fixture not called before 10000ms deadline; '+diagnostic()));}catch(error){finish(error);}}},10000);
   t.after(()=>finish(new Error('fixture ended before queue evidence')));check();
  });
 }
 // Initialization readiness also comes from persisted fixture evidence.
 async function initialized(){
  if(existsSync(initializeReady))return;
  await new Promise<void>((ok,fail)=>{
   let settled=false;
   const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);if(error)fail(error);else ok();};
   const diagnostic=()=>JSON.stringify({initializeReady:existsSync(initializeReady),nativeCalls:nativeCalls(),send:activeSend?{
    exitCode:activeSend.child.exitCode,signalCode:activeSend.child.signalCode,...activeSend.output()
   }:null});
   const check=()=>{try{
    if(existsSync(initializeReady)){finish();return;}
    if(activeSend?.closed())finish(new Error('initialize fixture not reached: send exited before initialize evidence; '+diagnostic()));
   }catch(error){finish(error);}};
   const poll=setInterval(check,25);
   const timer=setTimeout(()=>{check();if(!settled){try{finish(new Error('initialize fixture not reached before 10000ms deadline; '+diagnostic()));}catch(error){finish(error);}}},10000);
   t.after(()=>finish(new Error('fixture ended before initialize evidence')));check();
  });
 }
 const ledgerFile=join(root,'state','handoff','ledger.json');
 const ledger=()=>JSON.parse(readFileSync(ledgerFile,'utf8'));
 // Watch the directory because the ledger publishes by rename. Reading errors
 // are failures, not a fabricated absence or a fixed-sleep readiness signal.
 async function pendingWait(id:string,previousOperation?:string){
  const pending=()=>{const waits=ledger().data.records[id].waits;return waits.find((wait:any)=>wait.public.operationId!==previousOperation&&wait.public.status==='pending')?.public;};
  const current=pending();if(current)return current;
  return new Promise<any>((ok,fail)=>{let settled=false;
   const watcher=watch(join(root,'state','handoff'),()=>check());
   const timer=setTimeout(()=>finish(new Error('pending observation operation not persisted')),10000);
   const finish=(error?:unknown,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);watcher.close();if(error)fail(error);else ok(value);};
   const check=()=>{try{const value=pending();if(value)finish(undefined,value);}catch(error){finish(error);}};
   t.after(()=>finish(new Error('fixture ended before wait barrier')));check();
  });
 }
 function inject(clientId:string){const db=new DatabaseSync(join(home,'thread_history_1.sqlite'));try{db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?)').run(thread,'turn-fixture','after-submit-item',1,JSON.stringify({type:'userMessage',id:'after-submit-item',clientId,content:[{text:'PRIVATE_BODY_SENTINEL'}]}),'userMessage');}finally{db.close();}}
 return{root,home,codex,env,calls,nativeCalls,args,invoke,start,queued,initialized,ledger,ledgerFile,pendingWait,inject,foreignOwner:()=>writeFileSync(lsof+'.data','p'+held.pid+'\0ccodex-fixture\0u'+((process.getuid?.()??0)+1)+'\0',{mode:0o600}),releaseInitialize:()=>writeFileSync(initializeRelease,'release')};
}
async function directEnvironment<T>(f:{root:string;env:NodeJS.ProcessEnv},action:()=>Promise<T>):Promise<T>{
 const saved={...process.env},cwd=process.cwd();Object.assign(process.env,f.env);process.chdir(f.root);
 try{return await action();}finally{process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
}
test('direct handoff dry-run never probes a live agent for observation or required delivery',qualified,async t=>{
 const f=await fixture(t),before=readFileSync(f.ledgerFile,'utf8');
 await directEnvironment(f,async()=>{
  for(const intent of [{observeDelivery:true},{waitFor:'delivered' as const}]){
   await assert.rejects(handoffSend({to:'codex:'+thread,home:f.home,codexBin:f.codex,message:'direct dry-run',dryRun:true},
    {...intent,ledgerPath:f.env.SESSION_PEER_HANDOFF_HOME}),{code:'incompatible_handoff_dry_run'});
   assert.deepEqual(f.nativeCalls(),[]);assert.deepEqual(f.calls(),[]);
  }
 });
 assert.equal(readFileSync(f.ledgerFile,'utf8'),before);
});
test('qualified owned handoff binds cloud-possible storage while fallback remains unqualified',qualified,async t=>{
 const f=await fixture(t);writeFileSync(join(f.home,'auth.json'),'fixture-credentials-never-read',{mode:0o600});
 const sent=await f.invoke([...f.args,'--observe-delivery']);
 assert.equal(sent.code,0,sent.stdout);assert.equal(sent.value.submitted,true);
 assert.equal(sent.value.storage.cloudConfiguration,'requires_owned_storage_binding');
 assert.equal(sent.value.handoff.observation.injectionObserved,true);assert.equal(f.calls().length,1);
});
test('direct handoff qualification and queue both retain the canonical binary across an alias change during selection',qualified,async t=>{
 const f=await fixture(t),alias=join(f.root,'selected-codex'),other=join(f.root,'other-codex'),otherLog=join(f.root,'other-native-log');
 fs.copyFileSync(f.codex,other);chmodSync(other,0o700);
 const config=JSON.parse(readFileSync(f.codex+'.json','utf8'));config.version='0.162.1';config.nativeLog=otherLog;config.log=join(f.root,'other-queue-log');
 writeFileSync(other+'.json',JSON.stringify(config),{mode:0o600});fs.symlinkSync(f.codex,alias);
 const lstat=fs.lstatSync;let changed=false;
 t.mock.method(fs,'lstatSync',((path:any,...args:any[])=>{const value=(lstat as any)(path,...args);
  if(path===join(f.home,'thread-writer-locks',thread+'.lock')&&!changed){changed=true;fs.unlinkSync(alias);fs.symlinkSync(other,alias);}return value;
 }) as typeof fs.lstatSync);syncBuiltinESMExports();
 try{
  await directEnvironment(f,async()=>{
   const sent=await handoffSend({to:'codex:'+thread,home:f.home,codexBin:alias,message:'pinned qualification'},
    {observeDelivery:true,ledgerPath:f.env.SESSION_PEER_HANDOFF_HOME});
   assert.equal(sent.exitCode,0,JSON.stringify(sent.value));assert.equal(sent.value.submitted,true);
   const handoff=sent.value.handoff as {correlationId:string},record=f.ledger().data.records[handoff.correlationId];
   assert.equal(record.observationQualification.version,'0.160.1');assert.equal('binary' in record.binding,false);
   assert.equal(JSON.stringify(sent.value).includes(f.codex),false);
  });
  assert.equal(changed,true);assert.equal(existsSync(otherLog),false);assert.equal(f.calls().length,1);
  assert.ok(f.nativeCalls().some(row=>row.command==='--version'));assert.ok(f.nativeCalls().some(row=>row.command==='app-server'));
 }finally{t.mock.restoreAll();syncBuiltinESMExports();}
});
test('warm history fixture keeps WAL sidecar identities stable across synthetic injection',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,'none'),database=join(f.home,'thread_history_1.sqlite');
 const mode=new DatabaseSync(database,{readOnly:true});
 try{assert.equal((mode.prepare('PRAGMA journal_mode').get() as {journal_mode?:unknown}|undefined)?.journal_mode,'wal');}finally{mode.close();}
 // Only the fixture's retained owner connection may keep sidecars alive here.
 const sidecars=()=>['','-wal','-shm'].map(suffix=>{const value=statSync(database+suffix,{bigint:true});return{suffix,dev:value.dev,ino:value.ino};});
 const before=sidecars();assert.equal(existsSync(database+'-journal'),false);
 const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';f.inject(id);
 assert.equal(existsSync(database+'-journal'),false);assert.deepEqual(sidecars(),before);
 const read=new DatabaseSync(database,{readOnly:true});
 try{assert.equal((read.prepare(`SELECT count(*) AS total FROM thread_items WHERE json_extract(item_json,'$.clientId')=?`).get(id) as {total?:unknown}|undefined)?.total,1);}finally{read.close();}
});
test('scripted fixture paths, modes and versions remain literal data', {skip:process.platform==='win32'}, async t=>{
 const payload='\');throw new Error("fixture data executed");//\n\u2028\u2029';
 const f=await fixture(t,payload,payload);
 const version=spawnSync(process.execPath,[f.codex,'--version'],{env:f.env,encoding:'utf8'});
 assert.equal(version.status,0,version.stderr);assert.equal(version.stdout,'codex-cli '+payload+'\n');
 const queue=spawnSync(process.execPath,[f.codex,'queue','add',thread],{env:f.env,encoding:'utf8'});
 assert.equal(queue.status,0,queue.stderr);assert.deepEqual(f.calls(),[{method:'legacy'}]);
 assert.equal(queue.stdout,'Queued message legacy-1 for thread '+thread+'.\n');
});
test('queue readiness observes persisted fixture evidence when filesystem notifications are suppressed',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,'none');
 const realWatch=fs.watch;
 t.mock.method(fs,'watch',((path:any)=>realWatch(path,()=>{})) as typeof fs.watch);syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const ready=f.queued();
 const queued=spawnSync(process.execPath,[f.codex,'queue','add',thread],{env:f.env,encoding:'utf8',timeout:5000});
 assert.ifError(queued.error);assert.equal(queued.signal,null);assert.equal(queued.status,0,queued.stderr);
 await ready;
 assert.deepEqual(f.calls(),[{method:'legacy'}]);
});
test('initialize readiness observes persisted fixture evidence when filesystem notifications are suppressed',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,'none');
 const realWatch=fs.watch;
 t.mock.method(fs,'watch',((path:any)=>realWatch(path,()=>{})) as typeof fs.watch);syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const ready=f.initialized();
 writeFileSync(join(f.root,'initialize-ready'),'ready');
 await ready;
 assert.equal(readFileSync(join(f.root,'initialize-ready'),'utf8'),'ready');
});
test('initialize readiness reports a send that exits before initialization with its current outcome',qualified,async t=>{
 const f=await fixture(t,'concurrent-stop','0.165.0');
 const active=f.start([...f.args,'--wait-for','delivered']);
 await assert.rejects(f.initialized(),error=>{
  assert.ok(error instanceof Error);assert.match(error.message,/send exited before initialize evidence/);
  assert.match(error.message,/evidence_unsupported/);assert.match(error.message,/exitCode.:1/);return true;
 });
 const result=await active.result;assert.equal(result.code,1,result.stdout);assert.equal(result.value.submitted,false);
 assert.equal(existsSync(join(f.root,'initialize-ready')),false);assert.deepEqual(f.calls(),[]);
 assert.deepEqual(f.nativeCalls().filter((row:{command:string})=>row.command==='app-server'),[]);
});
test('queue readiness reports a send that exits before submission with its current outcome',qualified,async t=>{
 const f=await fixture(t,'none','0.165.0');
 const active=f.start([...f.args,'--wait-for','delivered']);
 await assert.rejects(f.queued(),error=>{
  assert.ok(error instanceof Error);assert.match(error.message,/send exited before queue evidence/);
  assert.match(error.message,/evidence_unsupported/);assert.match(error.message,/exitCode.:1/);return true;
 });
 const result=await active.result;assert.equal(result.code,1,result.stdout);assert.equal(result.value.submitted,false);
 assert.deepEqual(f.calls(),[]);
});
test('qualified local opt-in waits for exact client ID injection, not completed turn/ACK',qualified,async t=>{
 const f=await fixture(t);const r=await f.invoke([...f.args,'--wait-for','delivered']);assert.equal(r.code,0,r.stdout);assert.equal(r.value.status,'queued');assert.equal(r.value.submitted,true);assert.equal(r.value.consumptionConfirmed,false);assert.equal(r.value.queueId,'queue-fixture');const h=validateHandoff(r.value.handoff);assert.equal(h.state,'delivered');assert.equal(h.wait.status,'satisfied');assert.equal(h.observation.clientUserMessageId,h.correlationId);assert.equal(h.observation.turn?.status,'completed');assert.equal(h.ack.status,'not_requested');assert.equal(f.calls().length,1);assert.equal(f.calls()[0].method,'thread/queue/add');assert.equal(f.calls()[0].clientId,h.correlationId);assert.equal(r.stdout.includes('PRIVATE_BODY_SENTINEL'),false);
 const status=await f.invoke(['handoff','status','--correlation-id',h.correlationId]);assert.equal(status.code,0);assert.equal(status.value.handoff.observation.injectionObserved,true);assert.equal(f.calls().length,1);
});
test('unknown after possible native write never falls back to legacy queue',qualified,async t=>{
 const f=await fixture(t,'loss');const r=await f.invoke([...f.args,'--wait-for','delivered']);assert.equal(r.code,1,r.stdout);assert.equal(r.value.status,'unknown',r.stdout);assert.equal(r.value.submitted,null);assert.equal(r.value.handoff.submission.status,'unknown');assert.equal(r.value.handoff.wait.status,'failed');assert.equal(f.calls().length,1);assert.equal(f.calls()[0].method,'thread/queue/add');
});
test('positive native acceptance survives a subsequent ledger failure without another submission',qualified,async t=>{
 const f=await fixture(t,'ledger-failure');
 const r=await f.invoke([...f.args,'--wait-for','delivered']);
 assert.equal(r.code,1,r.stdout);assert.equal(r.value.ok,false);
 assert.equal(r.value.error,'handoff_persistence_failed');
 assert.equal(r.value.status,'queued');assert.equal(r.value.submitted,true);
 assert.equal(r.value.queueId,'queue-fixture');assert.equal(r.value.consumptionConfirmed,false);
 const h=validateHandoff(r.value.handoff);
 assert.equal(h.submission.status,'submitted');assert.equal(h.state,'submitted');
 assert.equal(h.wait.status,'pending');assert.equal(h.wait.reason,undefined);assert.equal(r.value.handoffWarning,'persistence_failed');
 assert.equal(h.observation.injectionObserved,false);assert.equal(h.ack.status,'not_requested');
 assert.equal(h.retry.allowed,false);assert.deepEqual(f.calls().map(call=>call.method),['thread/queue/add']);
 // The accepted result is an in-memory fact. Persistence failure did not
 // magically commit it: a different invocation must reconcile the retained
 // pre-effect fence as unknown and cannot submit this intent a second time.
 const retained=JSON.parse(readFileSync(f.ledgerFile,'utf8'));
 assert.equal(retained.data.records[h.correlationId].handoff.wait.status,'pending');
 chmodSync(join(f.root,'state','handoff','ledger.json'),0o600);
 const recovered=await f.invoke(['handoff','status','--correlation-id',h.correlationId]);
 assert.equal(recovered.code,0);assert.equal(recovered.value.handoff.submission.status,'unknown');
 const duplicate=await f.invoke([...f.args,'--correlation-id',h.correlationId]);
 assert.equal(duplicate.code,1);assert.equal(duplicate.value.error,'handoff_already_attempted');
 assert.equal(f.calls().length,1);
});
test('storage-qualified but observation-unqualified native version cannot enter the app-server or required delivery path',qualified,async t=>{
 // 0.165.0 has reviewed local loader semantics but no delivery observation row.
 const f=await fixture(t,'inject','0.165.0');
 const required=await f.invoke([...f.args,'--wait-for','delivered']);
 assert.equal(required.code,1);assert.equal(required.value.submitted,false);
 assert.equal(required.value.handoff.wait.status,'unsupported');assert.equal(f.calls().length,0);
 const best=await f.invoke([...f.args,'--observe-delivery']);
 assert.equal(best.code,0);assert.equal(best.value.status,'queued');assert.equal(best.value.submitted,true);
 assert.equal(best.value.handoff.observation.status,'unsupported');
 assert.equal(best.value.handoff.observation.injectionObserved,false);
 assert.deepEqual(f.calls(),[{method:'legacy'}]);
});
test('unsupported observation version/absent warm store refuse required goals, best-effort fallback is chosen before app-server effect',qualified,async t=>{
 const f=await fixture(t,'inject','0.165.0');const r=await f.invoke([...f.args,'--wait-for','delivered']);assert.equal(r.code,1);assert.equal(r.value.submitted,false);assert.equal(r.value.handoff.wait.status,'unsupported');assert.equal(f.calls().length,0);
 const best=await f.invoke([...f.args,'--observe-delivery']);assert.equal(best.code,0);assert.equal(best.value.handoff.observation.status,'unsupported');assert.deepEqual(f.calls(),[{method:'legacy'}]);
 const missing=await fixture(t,'inject','0.160.1',false);const blocked=await missing.invoke([...missing.args,'--wait-for','delivered']);assert.equal(blocked.code,1);assert.equal(blocked.value.submitted,false);assert.equal(missing.calls().length,0);
});
test('deadline without matching injection preserves native queued facts and immutable timed-out wait',qualified,async t=>{
 const f=await fixture(t,'none');const r=await f.invoke([...f.args,'--wait-for','delivered','--wait-timeout','10']);assert.equal(r.code,1,r.stdout);assert.equal(r.value.status,'queued');assert.equal(r.value.submitted,true);assert.equal(r.value.handoff.submission.status,'submitted');assert.equal(r.value.handoff.wait.status,'timed_out_unknown');assert.equal(r.value.handoff.observation.injectionObserved,false);assert.equal(r.value.handoff.ack.status,'not_requested');assert.equal(f.calls().length,1);
});
test('SIGINT stops an explicit wait without retracting or submitting again',qualified,async t=>{
 const f=await fixture(t,'none');const active=f.start([...f.args,'--wait-for','delivered']);await f.queued();active.child.kill('SIGINT');const r=await active.result;assert.equal(r.code,130,r.stdout);assert.equal(r.value.handoff.wait.status,'stopped');assert.equal(r.value.handoff.wait.reason,'stopped_by_operator');assert.equal(r.value.handoff.retry.allowed,false);assert.equal(f.calls().length,1);assert.notEqual(r.value.submitted,false);
});
test('concurrent wait before effect cannot hide the original pending operation from SIGINT',qualified,async t=>{
 const f=await fixture(t,'concurrent-stop');
 const active=f.start([...f.args,'--wait-for','delivered']);await f.initialized();
 const wrapper=JSON.parse(readFileSync(join(f.root,'state','handoff','ledger.json'),'utf8'));
 const id=Object.keys(wrapper.data.records)[0]!;
 const original=await f.invoke(['handoff','status','--correlation-id',id]);const originalOperation=original.value.handoff.wait.operationId;
 assert.equal(original.value.handoff.wait.status,'pending');
 const newer=await f.invoke(['handoff','wait','--correlation-id',id,'--wait-for','acknowledged']);
 assert.equal(newer.code,1);assert.equal(newer.value.handoff.wait.status,'unsupported');
 assert.notEqual(newer.value.handoff.wait.operationId,originalOperation);
 f.releaseInitialize();await f.queued();active.child.kill('SIGINT');const r=await active.result;
 assert.equal(r.code,130,r.stdout);const h=validateHandoff(r.value.handoff);
 assert.equal(h.wait.operationId,originalOperation);assert.equal(h.wait.status,'stopped');assert.equal(h.wait.reason,'stopped_by_operator');
 assert.notEqual(r.value.submitted,false);assert.ok(r.value.submitted===null||r.value.submitted===true);
 assert.equal(h.retry.allowed,false);assert.equal(f.calls().length,1);assert.equal(f.calls()[0].method,'thread/queue/add');
 const latest=await f.invoke(['handoff','status','--correlation-id',id]);
 assert.deepEqual(latest.value.handoff.wait,newer.value.handoff.wait);
 const duplicate=await f.invoke([...f.args,'--correlation-id',id]);assert.equal(duplicate.code,1);assert.equal(duplicate.value.error,'handoff_already_attempted');assert.equal(f.calls().length,1);
});

test('independent wait resumes exact submitted scope and observes later injection without native calls',qualified,async t=>{
 const f=await fixture(t,'none');const sent=await f.invoke([...f.args,'--observe-delivery']);
 assert.equal(sent.code,0,sent.stdout);assert.equal(sent.value.status,'queued');assert.equal(sent.value.submitted,true);
 const original=validateHandoff(sent.value.handoff);assert.equal(original.observation.status,'pending');
 const before=f.ledger().data.records[original.correlationId],nativeBefore=f.nativeCalls();
 const contextBefore=new HandoffLedger(f.env.SESSION_PEER_HANDOFF_HOME!).observationContext(original.correlationId);assert.ok(contextBefore);
 assert.ok(before.observationQualification);assert.equal(f.calls().length,1);
 assert.equal(f.calls()[0].clientId,original.correlationId);
 const active=f.start(['handoff','wait','--correlation-id',original.correlationId,'--wait-for','delivered','--wait-timeout','10']);
 const pending=await f.pendingWait(original.correlationId);
 f.inject(original.correlationId);const result=await active.result;
 assert.equal(result.code,0,result.stdout);assert.equal(result.value.ok,true);
 const observed=validateHandoff(result.value.handoff);
 assert.equal(observed.wait.operationId,pending.operationId);assert.equal(observed.wait.status,'satisfied');
 assert.equal(observed.targetGeneration,original.targetGeneration);assert.equal(observed.submission.status,'submitted');
 assert.equal(observed.observation.clientUserMessageId,original.correlationId);assert.equal(observed.observation.injectionObserved,true);
 assert.equal(observed.ack.status,'not_requested');assert.equal(observed.retry.allowed,false);
 const after=f.ledger().data.records[original.correlationId];
 assert.equal(after.clockId,before.clockId);assert.equal(after.preparedMono,before.preparedMono);
 assert.deepEqual(new HandoffLedger(f.env.SESSION_PEER_HANDOFF_HOME!).observationContext(original.correlationId),contextBefore);
 assert.match(after.binding.payloadDigest,/^sealed-v1:/);assert.notEqual(after.binding.payloadDigest,contextBefore.binding.payloadDigest);
 assert.deepEqual(f.calls().map(call=>call.method),['thread/queue/add']);assert.deepEqual(f.nativeCalls(),nativeBefore);
 for(const privateField of ['PRIVATE_BODY_SENTINEL','observationQualification','payloadDigest'])assert.equal(result.stdout.includes(privateField),false);
});

test('independent wait timeout preserves original submission and never starts another native queue',qualified,async t=>{
 const f=await fixture(t,'none');const sent=await f.invoke([...f.args,'--observe-delivery']);
 assert.equal(sent.code,0,sent.stdout);const original=validateHandoff(sent.value.handoff),nativeBefore=f.nativeCalls();
 const started=performance.now();const result=await f.invoke(['handoff','wait','--correlation-id',original.correlationId,'--wait-for','delivered','--wait-timeout','6']);
 assert.equal(result.code,1,result.stdout);assert.equal(result.value.ok,false);
 const waited=validateHandoff(result.value.handoff);
 assert.equal(waited.submission.status,'submitted');assert.equal(waited.targetGeneration,original.targetGeneration);
 assert.equal(waited.wait.status,'timed_out_unknown');assert.equal(waited.observation.injectionObserved,false);
 assert.equal(waited.retry.allowed,false);assert.equal(f.calls().length,1);assert.deepEqual(f.nativeCalls(),nativeBefore);assert.ok(performance.now()-started<6000);
 const status=await f.invoke(['handoff','status','--correlation-id',original.correlationId]);
 assert.equal(status.code,0);assert.deepEqual(status.value.handoff.wait,waited.wait);assert.equal(f.calls().length,1);
});

test('independent wait SIGINT records its persisted operation as stopped without retracting submission',qualified,async t=>{
 const f=await fixture(t,'none');const sent=await f.invoke([...f.args,'--observe-delivery']);
 assert.equal(sent.code,0,sent.stdout);const original=validateHandoff(sent.value.handoff),nativeBefore=f.nativeCalls();
 const active=f.start(['handoff','wait','--correlation-id',original.correlationId,'--wait-for','delivered','--wait-timeout','10']);
 const pending=await f.pendingWait(original.correlationId);active.child.kill('SIGINT');const result=await active.result;
 assert.equal(result.code,130,result.stdout);assert.equal(result.value.ok,false);
 const stopped=validateHandoff(result.value.handoff);
 assert.equal(stopped.wait.operationId,pending.operationId);assert.equal(stopped.wait.status,'stopped');assert.equal(stopped.wait.reason,'stopped_by_operator');
 assert.equal(stopped.submission.status,'submitted');assert.equal(stopped.targetGeneration,original.targetGeneration);
 assert.equal(stopped.retry.allowed,false);assert.equal(f.calls().length,1);assert.deepEqual(f.nativeCalls(),nativeBefore);
 const status=await f.invoke(['handoff','status','--correlation-id',original.correlationId]);
 assert.equal(status.code,0);assert.deepEqual(status.value.handoff.wait,stopped.wait);assert.equal(f.calls().length,1);
});

test('independent wait cannot adopt another owner or reconstruct missing retained qualification',qualified,async t=>{
 const wrong=await fixture(t,'none');const submitted=await wrong.invoke([...wrong.args,'--observe-delivery']);
 assert.equal(submitted.code,0,submitted.stdout);const original=validateHandoff(submitted.value.handoff),wrongNative=wrong.nativeCalls();wrong.foreignOwner();
 const refused=await wrong.invoke(['handoff','wait','--correlation-id',original.correlationId,'--wait-for','delivered','--wait-timeout','10']);
 assert.equal(refused.code,1,refused.stdout);const changed=validateHandoff(refused.value.handoff);
 assert.equal(changed.wait.status,'unsupported');assert.equal(changed.submission.status,'submitted');assert.equal(changed.targetGeneration,original.targetGeneration);
 assert.equal(changed.observation.injectionObserved,false);assert.equal(wrong.calls().length,1);assert.deepEqual(wrong.nativeCalls(),wrongNative);
 const old=await fixture(t,'none');const sent=await old.invoke([...old.args,'--observe-delivery']);
 assert.equal(sent.code,0,sent.stdout);const handoff=validateHandoff(sent.value.handoff),oldNative=old.nativeCalls();
 const retained=old.ledger();delete retained.data.records[handoff.correlationId].observationQualification;
 retained.digest=payloadDigest(JSON.stringify(retained.data));
 writeFileSync(old.ledgerFile,JSON.stringify(retained),{mode:0o600});old.inject(handoff.correlationId);
 const historical=await old.invoke(['handoff','status','--correlation-id',handoff.correlationId]);
 assert.equal(historical.code,0,historical.stdout);assert.equal(historical.value.handoff.submission.status,'submitted');
 assert.equal(historical.value.handoff.observation.injectionObserved,false);
 const unsupported=await old.invoke(['handoff','wait','--correlation-id',handoff.correlationId,'--wait-for','delivered','--wait-timeout','10']);
 assert.equal(unsupported.code,1,unsupported.stdout);const result=validateHandoff(unsupported.value.handoff);
 assert.equal(result.wait.status,'unsupported');assert.equal(result.submission.status,'submitted');assert.equal(result.observation.injectionObserved,false);
 assert.equal(result.targetGeneration,handoff.targetGeneration);assert.equal(result.retry.allowed,false);assert.equal(old.calls().length,1);assert.deepEqual(old.nativeCalls(),oldNative);
});

async function submittedBarrier(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, id: string): Promise<void> {
 const ready=()=>f.ledger().data.records[id].phase==='finished';
 if(ready())return;
 await new Promise<void>((resolve,reject)=>{
  let settled=false;const watcher=watch(join(f.root,'state','handoff'),()=>check());
  const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);watcher.close();if(error)reject(error);else resolve();};
  const timer=setTimeout(()=>finish(new Error('submitted outcome not persisted')),10000);
  const check=()=>{try{if(ready())finish();}catch(error){finish(error);}};
  t.after(()=>finish(new Error('fixture ended before submission barrier')));check();
 });
}
test('original send and independent concurrent wait each observe injection under their own deadline',qualified,async t=>{
 const f=await fixture(t,'none');
 const original=f.start([...f.args,'--wait-for','delivered','--wait-timeout','15']);await f.queued();
 const id=Object.keys(f.ledger().data.records)[0]!;await submittedBarrier(t,f,id);
 const first=f.ledger().data.records[id].waits[0].public;
 const second=f.start(['handoff','wait','--correlation-id',id,'--wait-for','delivered','--wait-timeout','15']);
 const next=await f.pendingWait(id,first.operationId);f.inject(id);
 const [a,b]=await Promise.all([original.result,second.result]);
 for(const result of [a,b]){assert.equal(result.code,0,result.stdout);assert.equal(result.value.ok,true);assert.equal(result.value.handoff.submission.status,'submitted');assert.equal(result.value.handoff.wait.status,'satisfied');assert.equal(result.value.handoff.ack.status,'not_requested');}
 assert.equal(a.value.handoff.wait.operationId,first.operationId);assert.equal(a.value.handoff.wait.deadlineAtUtcMs,first.deadlineAtUtcMs);
 assert.equal(b.value.handoff.wait.operationId,next.operationId);assert.equal(b.value.handoff.wait.deadlineAtUtcMs,next.deadlineAtUtcMs);
 assert.equal(f.calls().length,1);assert.equal(f.calls()[0].method,'thread/queue/add');
 const stored=f.ledger().data.records[id].waits;assert.equal(stored[0].public.status,'satisfied');assert.equal(stored[1].public.status,'satisfied');
});
test('independent wait retains known submission after persistence becomes unreadable',qualified,async t=>{
 const f=await fixture(t,'none');const sent=await f.invoke([...f.args,'--observe-delivery']);assert.equal(sent.code,0,sent.stdout);
 const id=sent.value.handoff.correlationId,native=f.nativeCalls();
 const active=f.start(['handoff','wait','--correlation-id',id,'--wait-for','delivered','--wait-timeout','10']);
 const pending=await f.pendingWait(id);chmodSync(f.ledgerFile,0o644);f.inject(id);
 const result=await active.result;
 assert.equal(result.code,1,result.stdout);assert.equal(result.value.error,'handoff_persistence_failed');assert.equal(result.value.handoffWarning,'persistence_failed');
 const h=validateHandoff(result.value.handoff);assert.equal(h.submission.status,'submitted');assert.equal(h.wait.operationId,pending.operationId);
 assert.equal(h.wait.status,'pending');assert.equal(h.retry.allowed,false);assert.equal(h.observation.injectionObserved,false);
 assert.equal(f.calls().length,1);assert.deepEqual(f.nativeCalls(),native);
 chmodSync(f.ledgerFile,0o600);const after=f.ledger().data.records[id].waits.at(-1).public;assert.deepEqual(after,pending);
});

test('exact qualified 0.162.1 native profile retains its own source when resuming observation',qualified,async t=>{
 const f=await fixture(t,'none','0.162.1');const sent=await f.invoke([...f.args,'--observe-delivery']);assert.equal(sent.code,0,sent.stdout);
 const id=sent.value.handoff.correlationId,record=f.ledger().data.records[id],nativeBefore=f.nativeCalls();
 assert.equal(record.observationQualification.version,'0.162.1');assert.equal(record.observationQualification.commit,'092d3acd6bec3e3a14bdc7e7a2810ab628ab759d');assert.equal(record.observationQualification.platform,'darwin-arm64');
 const active=f.start(['handoff','wait','--correlation-id',id,'--wait-for','delivered','--wait-timeout','10']);
 await f.pendingWait(id);f.inject(id);const result=await active.result;assert.equal(result.code,0,result.stdout);
 assert.equal(result.value.handoff.submission.status,'submitted');assert.equal(result.value.handoff.observation.injectionObserved,true);
 assert.equal(result.value.handoff.wait.status,'satisfied');assert.equal(result.value.handoff.ack.status,'not_requested');
 assert.equal(f.calls().length,1);assert.deepEqual(f.nativeCalls(),nativeBefore);
});
