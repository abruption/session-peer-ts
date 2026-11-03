// Every mutation and builtin mock belongs to a private installation/Node child.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
// Explicit, bounded files: never recursively copy dist or a dependency tree.
const bundle = ['app-server','casefold','cli','codex-storage','diagnostics','discovery','handoff',
  'handoff-ledger','handoff-observer-probe','handoff-operations','handoff-writer-probe','help','index',
  'linux-native-probe','linux-proc','macos-acl','metadata-observation','native-profiles','output','process',
  'protocol','receipt-collector','receipt-command','receipt-producer','receipt-protocol','receipt-send',
  'receipt-state','receipt-store','replies','send','skill-metadata','ssh','ssh-response','updates','windows','writer'];

const worker = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [directory, scenario] = process.argv.slice(1);
const pair = {agent:'claude',receiptSchemaVersion:2,receiptScope:'delegated_context'};
const originalSpawn = cp.spawn;
let probes = 0, challenge, response = '';
cp.spawn = function(binary, args, options) {
  probes++;
  assert.equal(scenario, 'genuine', 'unsafe artifact must refuse before any probe spawn');
  assert.equal(binary, fs.realpathSync(process.execPath));
  assert.deepEqual(args, [join(directory,'cli.js'),'receipt','probe','--json']);
  assert.equal(options.shell, false);
  assert.deepEqual(options.env, {PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'});
  const child = originalSpawn(binary,args,options);
  const end = child.stdin.end;
  child.stdin.end = function(input, ...rest) {
    assert.equal(Buffer.byteLength(input) < 4096, true);
    challenge = JSON.parse(input);
    assert.deepEqual(Object.keys(challenge).sort(), ['challengeId','producerProtocolVersion','receiptSchemaVersion','receiptScope']);
    return end.call(this,input,...rest);
  };
  child.stdout.on('data', bytes => { response += bytes; assert.ok(Buffer.byteLength(response) <= 4096); });
  return child;
};
if (scenario === 'entries') {
  // Only the non-JS entries push the installation over the budget.
  const existing = fs.readdirSync(directory).length;
  assert.ok(existing < 128);
  for (let i=existing; i<129; i++) fs.writeFileSync(join(directory,'extra-'+i+'.txt'),'');
  assert.equal(fs.readdirSync(directory).length,129);
}
if (scenario === 'symlink') fs.symlinkSync(join(directory,'protocol.js'),join(directory,'untrusted.js'));
if (scenario === 'writable') fs.chmodSync(join(directory,'protocol.js'),0o622);
let targetFd, grown = false, requested = 0, allocated = 0, unbounded = false;
const expected = scenario === 'growth-small' ? 32 : 4*1024*1024;
if (scenario.startsWith('growth-')) {
  const path = join(directory,'aaa-growth.js');
  fs.writeFileSync(path,''); fs.truncateSync(path,expected);
  const open = fs.openSync, stat = fs.fstatSync, read = fs.readSync, close = fs.closeSync, readFile = fs.readFileSync;
  fs.openSync = function(pathname,...args) {
    // truncateSync may itself open this same fixture path; retain the original
    // inspected descriptor rather than accidentally tracking that nested FD.
    const fd = open.call(this,pathname,...args); if (pathname === path && targetFd === undefined) targetFd = fd; return fd;
  };
  fs.fstatSync = function(fd,...args) {
    const snapshot = stat.call(this,fd,...args);
    if (fd === targetFd && !grown) {
      // Grow AFTER the first descriptor identity check's snapshot. Sparse, no large fixture allocation.
      grown = true; fs.truncateSync(path,64*1024*1024);
    }
    return snapshot;
  };
  fs.readSync = function(fd,buffer,offset,length,...args) {
    if (fd === targetFd) { requested += length; assert.ok(requested <= expected+1,'descriptor read exceeds original size plus one'); }
    return read.call(this,fd,buffer,offset,length,...args);
  };
  fs.readFileSync = function(pathname,...args) {
    if (pathname === targetFd || pathname === path) { unbounded = true; throw new Error('unbounded descriptor read'); }
    return readFile.call(this,pathname,...args);
  };
  fs.closeSync = function(fd) { const result = close.call(this,fd); if (fd === targetFd) targetFd = undefined; return result; };
  for (const method of ['alloc','allocUnsafe','allocUnsafeSlow']) {
    const allocate = Buffer[method];
    Buffer[method] = function(size,...args) {
      if (targetFd !== undefined) { allocated += size; assert.ok(allocated <= expected+1,'allocation exceeds original size plus one'); }
      return allocate.call(this,size,...args);
    };
  }
}
syncBuiltinESMExports();
const {validateReceiptProducer} = await import(pathToFileURL(join(directory,'receipt-producer.js')).href);
if (scenario !== 'genuine') {
  await assert.rejects(validateReceiptProducer(pair), {code:'receipt_producer_mismatch'});
  assert.equal(probes,0);
  if (scenario.startsWith('growth-')) {
    assert.equal(grown,true,'fixture must reach the descriptor race');
    assert.equal(unbounded,false,'must not delegate a growing descriptor to readFileSync');
    assert.ok(requested > 0 && requested <= expected+1);
    assert.ok(allocated > 0 && allocated <= expected+1);
  }
} else {
  const {VERSION} = await import(pathToFileURL(join(directory,'protocol.js')).href);
  const result = await validateReceiptProducer(pair);
  assert.equal(probes,1);
  const answer = JSON.parse(response);
  assert.deepEqual(answer,{...challenge,implementation:'typescript',runtimeVersion:VERSION});
  assert.equal(result.evidence.challengeId,challenge.challengeId);
  assert.match(result.evidence.artifactSha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(result.evidence).sort(),['artifactSha256','challengeId','protocolVersion','receiptSchemaVersion','receiptScope']);
  assert.equal(result.evidence.receiptSchemaVersion,2);
  assert.equal(result.evidence.receiptScope,'delegated_context');
  result.revalidate();
  // Continuity is useful after the challenge too; capability authority is absent throughout.
  fs.appendFileSync(join(directory,'protocol.js'),'\n');
  assert.throws(()=>result.revalidate(),{code:'receipt_producer_mismatch'});
}
`;

function exercise(scenario: string): void {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(),'codex-producer-')));
  fs.chmodSync(root,0o700);
  try {
    // setup-node tool-cache ownership/mode can differ from a supported private
    // installation. Normalize only our fresh fixture binary, never the host.
    let node=process.execPath;const native=fs.statSync(fs.realpathSync(node));
    if(![0,process.getuid?.()].includes(native.uid)||(native.mode&0o022)!==0){
      node=join(root,'node');fs.copyFileSync(process.execPath,node);fs.chmodSync(node,0o700);
    }
    const directory = join(root,'installation'); fs.mkdirSync(directory,{mode:0o700});
    fs.writeFileSync(join(root,'package.json'),'{"type":"module"}\n',{mode:0o600});
    for (const name of bundle) {
      const source = join(project,'dist',name+'.js');
      const stat = fs.lstatSync(source);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4*1024*1024);
      fs.copyFileSync(source,join(directory,name+'.js'));
      fs.chmodSync(join(directory,name+'.js'),0o600);
    }
    // Real CLI imports smol-toml; link only this existing dependency installation.
    fs.symlinkSync(fs.realpathSync(join(project,'node_modules')),join(root,'node_modules'),'junction');
    const child = spawnSync(node,['--input-type=module','--eval',worker,directory,scenario],{
      encoding:'utf8',timeout:15000,maxBuffer:64*1024,
      env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',SESSION_PEER_TAILSCALE:'off'}
    });
    assert.ifError(child.error);
    assert.equal(child.status,0,child.stderr || child.stdout);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
}

const posixOnly = {skip:process.platform === 'win32'};
test('producer counts every installation entry before executing a probe',posixOnly,()=>exercise('entries'));
test('producer bounds descriptor growth reads and allocations at small and 4MiB limits',posixOnly,()=>{
  exercise('growth-small'); exercise('growth-limit');
});
test('producer rejects symlink and other-writable artifacts before executing a probe',posixOnly,()=>{
  exercise('symlink'); exercise('writable');
});
test('same-installation bounded CLI probe proves VERSION and nonce without capability authority',posixOnly,()=>exercise('genuine'));
