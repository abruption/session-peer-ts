// Explicit test preload only. Production never reads this environment key or
// writes diagnostic files. Capture a bounded primitive-only private record.
import { channel } from 'node:diagnostics_channel';
import { appendFileSync, lstatSync } from 'node:fs';
const file=process.env.SESSION_PEER_TEST_OWNER_PROBE_LOG;
if(file){
  let count=0;
  channel('session-peer.handoff.owner-probe').subscribe(value=>{
    try{
      if(count++>=64)return;
      const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>32768)return;
      const line=JSON.stringify(value)+'\n';if(Buffer.byteLength(line)>512)return;
      appendFileSync(file,line,{mode:0o600});
    }catch{ /* A test observer must never change an operation's outcome. */ }
  });
}
