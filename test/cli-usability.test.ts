import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { casefold, CASEFOLD_UNICODE_VERSION } from '../dist/casefold.js';
import { renderOutput } from '../dist/output.js';
const cli = resolve('dist/cli.js');
function fixture(t: import('node:test').TestContext) {
  const home = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-cli-'));
  mkdirSync(join(home, '.claude/sessions'), {recursive:true});
  t.after(() => rmSync(home,{recursive:true,force:true}));
  return { home, env: {...process.env, HOME:home, USERPROFILE:home, CODEX_HOME:'', SESSION_PEER_CODEX_HOMES:'[]', CLAUDE_CONFIG_DIR:join(home,'.claude'), ANTHROPIC_CONFIG_DIR:''} };
}
test('help, format compatibility, input conflicts, wire JSON and partial text diagnostics', t => {
  const {home,env}=fixture(t);
  const call=(args:string[], input='') => spawnSync(process.execPath,[cli,...args],{env,input,encoding:'utf8',timeout:15000});
  for(const args of [['--help'],['list','--help'],['send','-h'],['doctor','--help']]) {
    const r=call(args); assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/Usage:/); assert.doesNotMatch(r.stdout,/preview/i);
  }
  assert.equal(JSON.parse(call(['list']).stdout).error,'json_output_required');
  for(const args of [['list','--json'],['list','--output-format','json'],['list','--json','--output-format=json']]) {
    const r=call(args);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).ok,true);
  }
  const diagnostic=call(['doctor','--output-format','text']);assert.equal(diagnostic.status,0);assert.match(diagnostic.stdout,/Ready: no/);assert.match(diagnostic.stdout,/does not authorize/);
  const doctorJson=call(['doctor','--json']);assert.equal(doctorJson.status,0);assert.equal(JSON.parse(doctorJson.stdout).ready,false);assert.equal(JSON.parse(doctorJson.stdout).ok,true);
  const doctorWire=call(['--stdio-request'],JSON.stringify({schemaVersion:1,args:['doctor','--json']}));assert.equal(JSON.parse(doctorWire.stdout).command,'doctor');
  const text=call(['list','--output-format','text']);assert.equal(text.status,0);assert.match(text.stdout,/No sessions found/);
  const conflict=call(['send','--to','fixture','--json','--output-format=text']);assert.equal(conflict.status,2);assert.equal(JSON.parse(conflict.stdout).error,'conflicting_output_options');
  for(const body of [['one','-m','two'],['-m','-','two'],['one','two']]) {
    const r=call(['send','--to','fixture','--json',...body]);assert.equal(r.status,2);assert.match(JSON.parse(r.stdout).error,/conflicting_message_sources|invalid_positional_message/);
  }
  for(const body of [[],['-m','-'],['-'],['']]) {
    const r=call(['send','--to','fixture','--json',...body]);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).error,'invalid_message');
  }
  const stdin=call(['send','--to','codex:invalid','--json'],'valid stdin');assert.equal(JSON.parse(stdin.stdout).error,'codex_uuid_required');
  const literal=call(['send','--to','codex:bad','--message','--json','--output-format','text']);assert.match(literal.stdout,/Error: codex_uuid_required/);
  const afterEnd=call(['send','--to','codex:bad','--json','--','--output-format=text']);assert.equal(JSON.parse(afterEnd.stdout).error,'codex_uuid_required');
  const duplicate=call(['list','--output-format','text','--output-format','json']);assert.equal(JSON.parse(duplicate.stdout).error,'invalid_option');
  const wire=call(['--stdio-request'],JSON.stringify({schemaVersion:1,args:['list','--output-format=text']}));assert.equal(JSON.parse(wire.stdout).error,'remote_json_required');
  env.CODEX_HOME=join(home,'missing');
  const partial=call(['list','--output-format=text']);assert.equal(partial.status,1);assert.match(partial.stdout,/Discovery codex:.*error/);assert.match(partial.stdout,/Error:/);
  const error=call(['send','--to','codex:bad','--message','body','--output-format=text']);assert.equal(error.status,2);assert.match(error.stdout,/codex_uuid_required/);assert.match(error.stdout,/Nothing submitted/);
});
test('body conflict is rejected while stdin is still open',async t=>{
 const {env}=fixture(t);const child=spawn(process.execPath,[cli,'send','--to','fixture','--json','--message','-','positional'],{env,stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>child.kill(),5000);t.after(()=>{clearTimeout(timer);child.kill();});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();
 const [code,signal]=await once(child,'close');assert.equal(signal,null);assert.equal(code,2);assert.equal(JSON.parse(output).error,'conflicting_message_sources');
});
test('Unicode 14 full default casefold is exact, locale-independent and does not normalize',()=>{
 assert.equal(CASEFOLD_UNICODE_VERSION,'14.0.0');
 for(const [a,b] of [['Straße','STRASSE'],['ςΣσ','σσσ'],['ﬃ','ffi'],['İ','i\u0307'],['K','k'],['𐐀','𐐨'],['Ꭰ','ꭰ']]) assert.equal(casefold(a!),casefold(b!));
 assert.notEqual(casefold('ı'),casefold('I'));assert.notEqual(casefold('é'),casefold('e\u0301'));assert.notEqual(casefold('worker'),casefold('work'));
});
test('Unicode collision refuses, exact name and PID remain selectable; positional body sends once',async t=>{
 const {home,env}=fixture(t);const socket=process.platform==='win32'?`\\\\.\\pipe\\session-peer-cli-${process.pid}`:join(home,'inbox');
 const messages:string[]=[];const server=createServer(s=>{let data='';s.on('data',x=>data+=x);s.on('end',()=>{messages.push(data);s.end();});});
 server.listen(socket);await once(server,'listening');t.after(()=>new Promise<void>(ok=>server.close(()=>ok())));
 const other=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});assert.ok(other.pid);
 t.after(async()=>{if(other.exitCode===null){other.kill();await once(other,'close');}});
 const record=(pid:number,name:string)=>writeFileSync(join(home,'.claude/sessions',`${pid}.json`),JSON.stringify({pid,name,startedAt:Date.now(),messagingSocketPath:socket}));
 record(process.pid,'Straße');
 const call=async(target:string,body:string[],dry=true)=>{
  const preload=process.platform==='win32'?['--import',pathToFileURL(resolve('test/fixtures/windows-inspection-diagnostic.mjs')).href]:[];
  const child=spawn(process.execPath,[...preload,cli,'send','--to',target,'--json','--no-from',...(dry?['--dry-run']:[]),...body],{env,stdio:['ignore','pipe','pipe']});
  let output='',diagnostic='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>diagnostic+=(String(x).slice(0,4096-diagnostic.length)));const timer=setTimeout(()=>child.kill(),30000);
  const [code,signal]=await once(child,'close');clearTimeout(timer);assert.equal(signal,null,diagnostic);
  assert.ok(output.trim(),JSON.stringify({code,diagnostic}));
  return {code,...JSON.parse(output),diagnostic};
 };
 const normalized=await call('STRASSE',['hello']);
 assert.equal(normalized.status,'validated',JSON.stringify(normalized));
 record(other.pid,'STRASSE');assert.equal((await call('straße',['hello'])).error,'ambiguous_target');assert.equal(messages.length,0);
 assert.equal((await call(String(process.pid),['hello'])).status,'validated');
 assert.equal((await call('strass',['hello'])).error,'no_reachable_target');
 // Native Windows named-pipe posting has separate owner fixtures; this suite validates selection only there.
 if(process.platform!=='win32') {assert.equal((await call(String(process.pid),['--','-literal'],false)).status,'posted');assert.equal(messages.length,1);assert.equal(JSON.parse(messages[0]!).message.content,'-literal');}
});
test('text output retains unknown semantics and escapes terminal controls',()=>{
 assert.match(renderOutput({command:'send',ok:false,error:'outcome_unknown',submitted:null},'text'),/Do not retry automatically/);
 const text=renderOutput({command:'list',ok:true,sessions:[{agent:'claude',pid:1,name:'x\x1b[2J\ny'}]},'text');assert.doesNotMatch(text,/\x1b/);assert.match(text,/\\u001b/);
});
