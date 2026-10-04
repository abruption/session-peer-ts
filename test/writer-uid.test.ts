import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { inspectWriter, probeLock } from '../dist/writer.js';

const id = '11111111-1111-4111-8111-111111111111';
const posix = { skip: process.platform === 'win32' };
const posixProcess = process as typeof process & { getuid: () => number };
const nativeLocks = createRequire(import.meta.url).resolve('fs-ext-extra-prebuilt');

async function writer(t: TestContext, reportedUid: string) {
  const path = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-writer-uid-')));
  const home = join(path, 'home'), bin = join(path, 'bin');
  mkdirSync(join(home, 'thread-writer-locks'), { recursive: true });
  mkdirSync(bin);
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const lock = join(home, 'thread-writer-locks', `${id}.lock`);
  const script = `const fs=require('node:fs'), locks=require(${JSON.stringify(nativeLocks)});
const fd=fs.openSync(process.argv[1], 'w', 0o600);
locks.flockSync(fd, 'exnb'); process.stdout.write('ready\\n'); setInterval(()=>{},1000);`;
  const held = spawn(process.execPath, ['-e', script, lock], { stdio: ['ignore', 'pipe', 'pipe'] });
  held.stderr.resume();
  t.after(async () => {
    if (held.exitCode === null && held.signalCode === null) {
      held.kill('SIGTERM');
      await once(held, 'close');
    }
  });
  await once(held.stdout, 'data');
  assert.equal(await probeLock(lock), 'held');
  // Real kernel lock; deterministic owner observations emulate UID 0 without sudo.
  writeFileSync(join(bin, 'lsof'), `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(`p${held.pid}\0ccodex-fixture\0${reportedUid}\0`)});\n`, { mode: 0o700 });
  writeFileSync(join(bin, 'ps'), `#!${process.execPath}\nconsole.log('Fixture stable process start');\n`, { mode: 0o700 });
  const previous = process.env.PATH;
  process.env.PATH = bin + delimiter + previous;
  t.after(() => { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; });
  return home;
}

test('a stable held writer matching UID 0 is accepted', posix, async t => {
  const home = await writer(t, 'u0');
  t.mock.method(posixProcess, 'getuid', () => 0);
  assert.equal((await inspectWriter(home, id)).activity, 'live_writer');
});

test('UID 0 still refuses a mismatched or missing owner UID', posix, async t => {
  t.mock.method(posixProcess, 'getuid', () => 0);
  for (const owner of ['u1', '', 'u', 'u ', 'u0x0', 'u-0']) {
    const home = await writer(t, owner);
    await assert.rejects(inspectWriter(home, id), /active_writer_unverified/);
  }
});

test('an unknown caller identity is refused even with a stable UID 0 owner', posix, async t => {
  const home = await writer(t, 'u0');
  t.mock.method(posixProcess, 'getuid', () => undefined as unknown as number);
  await assert.rejects(inspectWriter(home, id), /active_writer_unverified/);
});

test('an ordinary matching UID still accepts a stable writer', posix, async t => {
  const home = await writer(t, 'u42');
  t.mock.method(posixProcess, 'getuid', () => 42);
  assert.equal((await inspectWriter(home, id)).activity, 'live_writer');
});

test('a nonzero caller still refuses a UID 0 owner', posix, async t => {
  const home = await writer(t, 'u0');
  t.mock.method(posixProcess, 'getuid', () => 42);
  await assert.rejects(inspectWriter(home, id), /active_writer_unverified/);
});
