// Local artifact continuity and a private nonce challenge; this is not code authentication.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, type Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Refusal } from './discovery.js';
import { inspectMacosAcls } from './macos-acl.js';
import { run } from './process.js';
import { VERSION } from './protocol.js';
import { parseProducerProbeResponse, type ProducerEvidence, type ReceiptPair } from './receipt-protocol.js';
const fail = (): never => { throw new Refusal('receipt_producer_mismatch', 1); };
const identity = (s: Stats) => [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs,s.birthtimeMs].join(':');
export async function validateReceiptProducer(pair: ReceiptPair, options: { timeoutMs?: number } = {}): Promise<{ evidence: ProducerEvidence; revalidate(): void }> {
  const entry = fileURLToPath(new URL('./cli.js', import.meta.url)), directory = dirname(entry), node = realpathSync(process.execPath);
  const pinned = new Map<string,string>(), hash = createHash('sha256');
  const inspect = (path: string, directory = false) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) ||
        ![0,process.getuid?.()].includes(stat.uid) || (stat.mode & 0o022) !== 0) fail();
    return stat;
  };
  try {
    pinned.set(directory, identity(inspect(directory,true)));
    pinned.set(node, identity(inspect(node)));
    const names: string[] = [], listing = opendirSync(directory);
    try {
      let count = 0;
      for (;;) {
        const item = listing.readSync(); if (!item) break;
        if (++count > 128) fail();
        if (item.name.endsWith('.js')) names.push(item.name);
      }
    } finally { listing.closeSync(); }
    names.sort();
    if (!names.length || !names.includes('cli.js')) fail();
    let total = 0;
    for (const name of names) {
      const path = join(directory,name), stat = inspect(path);
      if (stat.size > 4 * 1024 * 1024 || total + stat.size > 16 * 1024 * 1024) fail();
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (identity(fstatSync(fd)) !== identity(stat)) fail();
        const buffer = Buffer.alloc(stat.size + 1); let length = 0;
        while (length < buffer.length) {
          const got = readSync(fd,buffer,length,buffer.length-length,null);
          if (!got) break; length += got;
        }
        total += length;
        if (length !== stat.size || total > 16 * 1024 * 1024 || identity(fstatSync(fd)) !== identity(stat) || identity(inspect(path)) !== identity(stat)) fail();
        const bytes = buffer.subarray(0,length);
        hash.update(name).update('\0').update(bytes); pinned.set(path,identity(stat));
      } finally { closeSync(fd); }
    }
    const revalidate = () => {
      try {
        for (const [path,value] of pinned) if (identity(inspect(path,path === directory)) !== value) fail();
        if (process.platform === 'darwin' && inspectMacosAcls([...pinned.keys()]) !== 'clear') fail();
        for (const [path,value] of pinned) if (identity(inspect(path,path === directory)) !== value) fail();
      } catch { fail(); }
    };
    revalidate();
    const challenge = { producerProtocolVersion: 1 as const, challengeId: randomUUID(), receiptSchemaVersion: pair.receiptSchemaVersion, receiptScope: pair.receiptScope };
    const timeout = Math.min(2000, Math.floor(options.timeoutMs ?? 2000));
    if (timeout < 1) fail();
    const result = await run(node,[entry,'receipt','probe','--json'],{input:JSON.stringify(challenge)+'\n',timeout,limit:4096,rawStdout:true,
      env:{ PATH:'/usr/bin:/bin', LANG:'C', LC_ALL:'C' }});
    if (result.interrupted || result.code !== 0 || !result.spawned || result.stderr.length) fail();
    const response = parseProducerProbeResponse(result.stdoutBytes ?? Buffer.from(result.stdout),challenge);
    if (response.runtimeVersion !== VERSION || response.implementation !== 'typescript') fail();
    revalidate();
    return { evidence:{protocolVersion:1,artifactSha256:hash.digest('hex'),challengeId:challenge.challengeId,
      receiptSchemaVersion:pair.receiptSchemaVersion,receiptScope:pair.receiptScope}, revalidate };
  } catch { return fail(); }
}
