// macOS task-owned ACL fixtures; no actual profile, agent or credential access.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ReceiptState } from '../dist/receipt-state.js';
import { receiptEndpoint, startReceiptCollector } from '../dist/receipt-collector.js';

const mac = { skip: process.platform !== 'darwin' };
function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-acl-')));
  const closers: (()=>void|Promise<void>)[]=[];
  fs.chmodSync(root, 0o700); t.after(async () => {for(const close of closers.reverse())await close();fs.rmSync(root, { recursive: true, force: true });});
  return {root,cleanup:(close:()=>void|Promise<void>)=>closers.push(close)};
}
function acl(path: string, remove = false) {
  const result = spawnSync('/bin/chmod', remove ? ['-N', path] : ['+a', `user:${userInfo().username} allow write`, path],
    { encoding: 'utf8', timeout: 3000, maxBuffer: 4096 });
  assert.equal(result.status, 0, 'fixture ACL setup/cleanup must succeed');
}
test('managed storage rejects inherited or named ACLs despite unchanged UID and POSIX permissions', mac, t => {
  const {root} = fixture(t), state = join(root, 'state'); fs.mkdirSync(state, { mode: 0o700 });
  const before = fs.statSync(state); acl(state);
  try {
    const after = fs.statSync(state); assert.equal(before.uid, after.uid); assert.equal(before.mode, after.mode);
    assert.throws(() => ReceiptState.initialize(state, join(state, 's')), { code: 'receipt_storage_untrusted' });
    assert.deepEqual(fs.readdirSync(state), [], 'unsafe initialization cannot create a key or authority');
  } finally { acl(state, true); }
});
test('an ACL change invalidates a previously inspected private-key snapshot without rewriting history', mac, t => {
  const f = fixture(t), statePath = join(f.root, 'state'); ReceiptState.initialize(statePath, join(statePath, 's'));
  const state = new ReceiptState(statePath).open(), key = join(statePath, 'ledger.key');
  f.cleanup(()=>state.close());
  const before = fs.statSync(key, { bigint: true }), history = fs.readFileSync(join(statePath, 'ledger.json'));
  acl(key);
  try {
    const after = fs.statSync(key, { bigint: true }); assert.equal(before.uid, after.uid); assert.equal(before.mode, after.mode);
    assert.notEqual(before.ctimeNs, after.ctimeNs, 'ACL cache invalidation relies on observed ctime');
    assert.throws(() => state.assertOpen(), { code: 'receipt_storage_untrusted' });
    assert.deepEqual(fs.readFileSync(join(statePath, 'ledger.json')), history);
  } finally { acl(key, true); state.close(); }
});
test('a collector endpoint with an extended ACL is never admitted as a private route', mac, async t => {
  const f = fixture(t), state = join(f.root, 'state'), socket = join(state, 's');
  ReceiptState.initialize(state, socket); const owner = await startReceiptCollector(state, socket);
  f.cleanup(async()=>{assert.equal((await owner.close()).cleanup,'confirmed');});
  acl(state);
  try { assert.throws(() => receiptEndpoint(socket), { code: 'receipt_endpoint_untrusted' }); }
  finally {
    acl(state, true);
    const closed = await owner.close(); assert.equal(closed.cleanup, 'confirmed');
  }
});
