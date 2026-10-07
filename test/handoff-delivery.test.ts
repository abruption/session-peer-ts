import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,watch} from 'node:fs';
import {join,delimiter,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {validateHandoff} from '../dist/handoff.js';
const qualified={skip:process.platform!=='darwin'||process.arch!=='arm64'};
const thread='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cli=resolve('dist/cli.js');
const schema=`CREATE TABLE thread_turns(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id));
CREATE TABLE thread_items(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,item_id TEXT NOT NULL,rollout_ordinal INTEGER NOT NULL,item_json TEXT NOT NULL,item_type TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id,item_id));
CREATE INDEX idx_thread_items_user_messages ON thread_items(thread_id,rollout_ordinal) WHERE item_type='userMessage';
CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER NOT NULL,next_rollout_ordinal INTEGER NOT NULL);`;
async function fixture(t:TestContext,mode='inject',version='0.160.1',warm=true){
 const root=realpathSync(mkdtempSync(join(process.env.TASK_TEMP??tmpdir(),'codex-hd-'))),home=join(root,'home'),bin=join(root,'bin');chmodSync(root,0o700);mkdirSync(home,{mode:0o700});mkdirSync(bin,{mode:0o700});mkdirSync(join(home,'thread-writer-locks'),{mode:0o700});
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const state=new DatabaseSync(join(home,'state_5.sqlite'));state.exec('CREATE TABLE threads(id TEXT)');state.prepare('INSERT INTO threads VALUES(?)').run(thread);state.close();
 if(warm){const db=new DatabaseSync(join(home,'thread_history_1.sqlite'));db.exec(schema);db.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run(thread,'turn-fixture','completed');db.prepare('INSERT INTO thread_history_projection_state VALUES(?,?,?)').run(thread,100,100);db.close();}
 const lock=join(home,'thread-writer-locks',thread+'.lock'),locks=createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');
 const held=spawn(process.execPath,['-e',`const f=require('fs').openSync(process.argv[1],'w',0o600);require(${JSON.stringify(locks)}).flockSync(f,'exnb');console.log('ready');setInterval(()=>{},1000)`,lock]);held.stderr.resume();await once(held.stdout,'data');t.after(async()=>{if(held.exitCode===null&&held.signalCode===null){held.kill('SIGKILL');await once(held,'close');}});
 writeFileSync(join(bin,'lsof'),`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify('p'+held.pid+'\0ccodex-fixture\0u'+process.getuid?.()+'\0')});`,{mode:0o700});
 writeFileSync(join(bin,'ps'),`#!${process.execPath}\nconsole.log('Fixture stable start');`,{mode:0o700});
 const log=join(root,'queue-log');writeFileSync(log,'');const codex=join(bin,'codex');
 writeFileSync(codex,`#!${process.execPath}
const fs=require('fs'),readline=require('readline'),path=require('path');
if(process.argv[2]==='--version'){console.log('codex-cli '+${JSON.stringify(version)});process.exit(0);}
if(process.argv[2]==='queue'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:'legacy'})+'\\n');console.log('Queued message legacy-1 for thread '+process.argv[4]+'.');process.exit(0);}
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{codexHome:process.env.CODEX_HOME,platformFamily:'unix',platformOs:'macos',userAgent:'fixture'}}));else if(r.method==='thread/queue/add'){
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:r.method,clientId:r.params.clientUserMessageId})+'\\n');
if(${JSON.stringify(mode)}==='loss'){process.exit(0);return;}
if(${JSON.stringify(mode)}==='inject'){const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(process.env.CODEX_HOME,'thread_history_1.sqlite'));db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?)').run(r.params.threadId,'turn-fixture','native-item-not-client-id',1,JSON.stringify({type:'userMessage',id:'native-item-not-client-id',clientId:r.params.clientUserMessageId,content:[{text:'PRIVATE_BODY_SENTINEL'}]}),'userMessage');db.close();}
console.log(JSON.stringify({id:r.id,result:{queuedSubmission:{id:'queue-fixture',clientUserMessageId:r.params.clientUserMessageId,input:r.params.input}}}));
}});`,{mode:0o700});
 const env={...process.env,HOME:root,USERPROFILE:root,CODEX_HOME:home,SESSION_PEER_CODEX_HOMES:'[]',CLAUDE_CONFIG_DIR:join(root,'.claude'),SESSION_PEER_TAILSCALE:'off',SESSION_PEER_UPDATE_NOTICE:'',CODEX_THREAD_ID:'',CODEX_SESSION_ID:'',PATH:bin+delimiter+(process.env.PATH??''),SESSION_PEER_HANDOFF_HOME:join(root,'state','handoff')};
 const args=['send','--to','codex:'+thread,'--codex-home',home,'--codex-bin',codex,'--message','fixture request','--no-from','--no-reply-to'];
 function start(options:string[]){const child=spawn(process.execPath,[cli,...options,'--json'],{env});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),15000);const result=once(child,'close').then(([code,signal])=>{clearTimeout(timer);assert.equal(signal,null,stderr);return{code,value:JSON.parse(stdout),stdout,stderr};});return{child,result};}
 async function invoke(options:string[]){return start(options).result;}
 assert.equal((await invoke(['handoff','init'])).code,0);
 const calls=()=>readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 async function queued(){if(calls().length)return;await new Promise<void>((ok,fail)=>{const watcher=watch(root,()=>{if(calls().length){clearTimeout(timer);watcher.close();ok();}});const timer=setTimeout(()=>{watcher.close();fail(new Error('queue fixture not called'));},10000);if(calls().length){clearTimeout(timer);watcher.close();ok();}});}
 return{root,home,calls,args,invoke,start,queued};
}
test('qualified local opt-in waits for exact client ID injection, not completed turn/ACK',qualified,async t=>{
 const f=await fixture(t);const r=await f.invoke([...f.args,'--wait-for','delivered']);assert.equal(r.code,0,r.stdout);assert.equal(r.value.status,'queued');assert.equal(r.value.submitted,true);assert.equal(r.value.consumptionConfirmed,false);assert.equal(r.value.queueId,'queue-fixture');const h=validateHandoff(r.value.handoff);assert.equal(h.state,'delivered');assert.equal(h.wait.status,'satisfied');assert.equal(h.observation.clientUserMessageId,h.correlationId);assert.equal(h.observation.turn?.status,'completed');assert.equal(h.ack.status,'not_requested');assert.equal(f.calls().length,1);assert.equal(f.calls()[0].method,'thread/queue/add');assert.equal(f.calls()[0].clientId,h.correlationId);assert.equal(r.stdout.includes('PRIVATE_BODY_SENTINEL'),false);
 const status=await f.invoke(['handoff','status','--correlation-id',h.correlationId]);assert.equal(status.code,0);assert.equal(status.value.handoff.observation.injectionObserved,true);assert.equal(f.calls().length,1);
});
test('unknown after possible native write never falls back to legacy queue',qualified,async t=>{
 const f=await fixture(t,'loss');const r=await f.invoke([...f.args,'--wait-for','delivered']);assert.equal(r.code,1,r.stdout);assert.equal(r.value.status,'unknown');assert.equal(r.value.submitted,null);assert.equal(r.value.handoff.submission.status,'unknown');assert.equal(r.value.handoff.wait.status,'failed');assert.equal(f.calls().length,1);assert.equal(f.calls()[0].method,'thread/queue/add');
});
test('unsupported version/absent warm store refuse required goals, best-effort fallback is chosen before app-server effect',qualified,async t=>{
 const f=await fixture(t,'inject','0.159.0');const r=await f.invoke([...f.args,'--wait-for','delivered']);assert.equal(r.code,1);assert.equal(r.value.submitted,false);assert.equal(r.value.handoff.wait.status,'unsupported');assert.equal(f.calls().length,0);
 const best=await f.invoke([...f.args,'--observe-delivery']);assert.equal(best.code,0);assert.equal(best.value.handoff.observation.status,'unsupported');assert.deepEqual(f.calls(),[{method:'legacy'}]);
 const missing=await fixture(t,'inject','0.160.1',false);const blocked=await missing.invoke([...missing.args,'--wait-for','delivered']);assert.equal(blocked.code,1);assert.equal(blocked.value.submitted,false);assert.equal(missing.calls().length,0);
});
test('deadline without matching injection preserves native queued facts and immutable timed-out wait',qualified,async t=>{
 const f=await fixture(t,'none');const r=await f.invoke([...f.args,'--wait-for','delivered','--wait-timeout','10']);assert.equal(r.code,1,r.stdout);assert.equal(r.value.status,'queued');assert.equal(r.value.submitted,true);assert.equal(r.value.handoff.submission.status,'submitted');assert.equal(r.value.handoff.wait.status,'timed_out_unknown');assert.equal(r.value.handoff.observation.injectionObserved,false);assert.equal(r.value.handoff.ack.status,'not_requested');assert.equal(f.calls().length,1);
});
test('SIGINT stops an explicit wait without retracting or submitting again',qualified,async t=>{
 const f=await fixture(t,'none');const active=f.start([...f.args,'--wait-for','delivered']);await f.queued();active.child.kill('SIGINT');const r=await active.result;assert.equal(r.code,130,r.stdout);assert.equal(r.value.handoff.wait.status,'stopped');assert.equal(r.value.handoff.wait.reason,'stopped_by_operator');assert.equal(r.value.handoff.retry.allowed,false);assert.equal(f.calls().length,1);assert.notEqual(r.value.submitted,false);
});
