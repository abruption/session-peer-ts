// Explicit test preload only. Production never reads this environment key or
// writes diagnostic files. Per process: <=64 attempts, <=512 bytes per record.
// The shared-file quota is best-effort under multiple writers, not atomic.
// An absent terminal capture summary means completeness is unknown.
import { channel } from 'node:diagnostics_channel';
import { appendFileSync, lstatSync } from 'node:fs';
const file=process.env.SESSION_PEER_TEST_OWNER_PROBE_LOG;
if(file){
  let observed=0,captured=0,dropped=0;
  const append=value=>{
    try{
      const line=JSON.stringify(value)+'\n',bytes=Buffer.byteLength(line),stat=lstatSync(file);
      if(bytes>512||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size+bytes>32768)return false;
      appendFileSync(file,line,{mode:0o600});return true;
    }catch{return false;}
  };
  const keys=['schemaVersion','phase','outcome','elapsedMs','timeoutMs','spawned','code','interrupted','stopReason'];
  const outcomes=['matched','generation_mismatch','invalid_reply','unverified_reply','timeout','output_limit','process_error','nonzero_exit','interrupted','stopped','aborted','budget_exhausted'];
  const safe=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))&&
    value.schemaVersion===1&&['send','wait'].includes(value.phase)&&outcomes.includes(value.outcome)&&
    Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0&&Number.isFinite(value.timeoutMs)&&value.timeoutMs>=0&&value.timeoutMs<=800&&
    typeof value.spawned==='boolean'&&typeof value.interrupted==='boolean'&&
    (value.code===null||Number.isInteger(value.code))&&[null,'timeout','output_limit','process_error'].includes(value.stopReason);
  channel('session-peer.handoff.owner-probe').subscribe(value=>{
    observed++;
    try{
      if(observed>64||!safe(value)){dropped++;return;}
      // Project into a fresh plain record; never serialize unknown properties
      // or a supplied object's custom toJSON method.
      const record=Object.fromEntries(keys.map(k=>[k,value[k]]));
      if(!append(record)){dropped++;return;}
      captured++;
    }catch{dropped++;}
  });
  process.once('exit',()=>append({captureSummary:{observed,captured,dropped}}));
}
