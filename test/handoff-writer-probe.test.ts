import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectWriter, probeLock } from '../dist/writer.js';
import { run } from '../dist/process.js';

const posix = { skip: process.platform === 'win32' };
const id = '11111111-1111-4111-8111-111111111111';
const nativeLocks = createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');
const probe = resolve('dist/handoff-writer-probe.js');
async function fixture(t: TestContext, uid: string = String(process.getuid?.()), order = 'command-first') {
  const root = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-writer-probe-')));
  chmodSync(root, 0o700); const home = join(root, 'home'), bin = join(root, 'bin');
  mkdirSync(join(home, 'thread-writer-locks'), { recursive: true, mode: 0o700 }); mkdirSync(bin, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lock = join(home, 'thread-writer-locks', id + '.lock');
  const held = spawn(process.execPath, ['-e', `const fs=require('node:fs'),locks=require(${JSON.stringify(nativeLocks)});const fd=fs.openSync(process.argv[1],'w',0o600);locks.flockSync(fd,'exnb');process.stdout.write('ready');setInterval(()=>{},1000);`, lock],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  held.stderr.resume(); await once(held.stdout, 'data'); assert.equal(await probeLock(lock), 'held');
  t.after(async () => { if (held.exitCode === null && held.signalCode === null) { held.kill('SIGKILL'); await once(held, 'close'); } });
  const owner = `p${held.pid}\0` + (order === 'command-first' ? `ccodex-fixture\0u${uid}\0` : `u${uid}\0ccodex-fixture\0`);
  writeFileSync(join(bin, 'lsof'), `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(owner)});\n`, { mode: 0o700 });
  writeFileSync(join(bin, 'ps'), `#!${process.execPath}\nconsole.log('Fixture stable start time');\n`, { mode: 0o700 });
  const env = { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ''), NODE_OPTIONS: undefined, NODE_PATH: undefined };
  return { root, home, bin, held, env };
}
test('bounded probe hashes exactly the existing inspectWriter identity for either owner token order', posix, async t => {
  for (const order of ['command-first', 'uid-first']) {
    const f = await fixture(t, String(process.getuid?.()), order), saved = process.env.PATH;
    process.env.PATH = f.env.PATH;
    let identity: string; try { identity = (await inspectWriter(f.home, id)).identity; }
    finally { if (saved === undefined) delete process.env.PATH; else process.env.PATH = saved; }
    const result = await run(process.execPath, [probe, f.home, id], { env: f.env, timeout: 1000, limit: 4096 });
    assert.equal(result.code, 0); assert.equal(result.interrupted, false);
    assert.deepEqual(JSON.parse(result.stdout), { schemaVersion: 1, ok: true,
      generation: createHash('sha256').update(identity!).digest('hex') });
    assert.equal(result.stderr, ''); assert.equal(result.stdout.includes(f.home), false);
  }
});
test('invalid/missing/inactive/foreign owner results are closed sanitized failures without paths', posix, async t => {
  const f = await fixture(t, String((process.getuid?.() ?? 0) + 1));
  for (const args of [[f.home, id], [f.home, 'invalid'], ['relative', id], [f.home, id, 'extra'], [join(f.root, 'PRIVATE_PATH_SENTINEL'), id]]) {
    const done = await run(process.execPath, [probe, ...args], { env: f.env, timeout: 1000, limit: 4096 });
    const value = JSON.parse(done.stdout); assert.equal(value.ok, false);
    assert.deepEqual(Object.keys(value).sort(), ['error', 'ok', 'schemaVersion']);
    assert.ok(['writer_probe_invalid', 'writer_probe_unverified'].includes(value.error));
    assert.equal(done.stdout.includes(f.root), false); assert.equal(done.stderr.includes('PRIVATE_PATH_SENTINEL'), false);
  }
  f.held.kill('SIGKILL'); await once(f.held, 'close');
  const inactive = await run(process.execPath, [probe, f.home, id], { env: f.env, timeout: 1000 });
  assert.deepEqual(JSON.parse(inactive.stdout), { schemaVersion: 1, ok: false, error: 'writer_probe_unverified' });
});
test('tool stderr and malformed owner metadata never appear in probe output', posix, async t => {
  const f = await fixture(t);
  writeFileSync(join(f.bin, 'lsof'), `#!${process.execPath}\nprocess.stderr.write('PRIVATE_BODY_SENTINEL');process.stdout.write('pbad\\0cother\\0u0\\0');\n`, { mode: 0o700 });
  const result = await run(process.execPath, [probe, f.home, id], { env: f.env, timeout: 1000 });
  assert.deepEqual(JSON.parse(result.stdout), { schemaVersion: 1, ok: false, error: 'writer_probe_unverified' });
  assert.equal(result.stderr, ''); assert.equal(result.stdout.includes('PRIVATE_BODY_SENTINEL'), false);
});
test('supervisor deadline reaps stalled lsof/ps and their descendants while retaining the unrelated writer', posix, async t => {
  for (const tool of ['lsof', 'ps']) {
    const f = await fixture(t), marker = join(f.root, tool + '-pids.json');
    writeFileSync(join(f.bin, tool), `#!${process.execPath}\nconst cp=require('node:child_process'),fs=require('node:fs');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);\n`, { mode: 0o700 });
    const started = performance.now();
    const result = await run(process.execPath, [probe, f.home, id], { env: f.env, timeout: 1000, limit: 4096 });
    assert.equal(result.interrupted, true); assert.ok(performance.now() - started < 1600); assert.equal(existsSync(marker), true);
    const pids: number[] = JSON.parse(readFileSync(marker, 'utf8'));
    for (let n = 0; n < 50 && pids.some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }); n++) await new Promise(resolve => setTimeout(resolve, 10));
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.doesNotThrow(() => process.kill(f.held.pid!, 0)); assert.equal(await probeLock(join(f.home, 'thread-writer-locks', id + '.lock')), 'held');
  }
});
