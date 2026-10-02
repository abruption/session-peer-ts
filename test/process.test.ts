// Bounded run(): a timeout reaps the owned process group, including a
// descendant that keeps the output pipes open, and completes promptly.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import timers from 'node:timers/promises';
import { run } from '../dist/process.js';

const posix = { skip: process.platform === 'win32' };
// The child starts a grandchild that inherits stdout/stderr (like a jump
// ProxyCommand), records both PIDs, then either stays or exits at once.
function fixture(t: TestContext) {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-process-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pids = join(dir, 'pids.json'), tree = join(dir, 'tree.cjs');
  writeFileSync(tree, `const {spawn}=require('node:child_process');
const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});
require('node:fs').writeFileSync(${JSON.stringify(pids)},JSON.stringify({child:process.pid,grandchild:g.pid}));
if(process.argv[2]==='exit')process.exit(0);setInterval(()=>{},1000);`);
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  async function gone() {
    const { child, grandchild } = JSON.parse(readFileSync(pids, 'utf8'));
    for (let i = 0; i < 50 && (alive(child) || alive(grandchild)); i++) await timers.setTimeout(20);
    return !alive(child) && !alive(grandchild);
  }
  return { tree, pids, gone };
}

test('a timeout reaps the child and a pipe-holding grandchild and returns promptly', posix, async t => {
  for (const mode of ['stay', 'exit']) {
    const f = fixture(t), started = Date.now();
    const done = await run(process.execPath, [f.tree, mode], { timeout: 300 });
    const elapsed = Date.now() - started;
    assert.equal(done.interrupted, true, mode); assert.equal(done.spawned, true, mode);
    assert.ok(elapsed < 1500, `${mode}: ${elapsed} ms`);
    assert.equal(await f.gone(), true, mode);
  }
});

test('a signal to the CLI reaps the owned process group before it exits', posix, async t => {
  const f = fixture(t), runner = join(realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-runner-'))), 'runner.mjs');
  t.after(() => rmSync(join(runner, '..'), { recursive: true, force: true }));
  writeFileSync(runner, `import { run } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist/process.js')).href)};
await run(process.execPath, [${JSON.stringify(f.tree)}, 'stay'], { timeout: 60000 });`);
  const child = spawn(process.execPath, [runner], { stdio: 'ignore' });
  for (let i = 0; i < 250 && !existsSync(f.pids); i++) await timers.setTimeout(20);
  assert.ok(existsSync(f.pids));
  const started = Date.now(); child.kill('SIGTERM');
  const [code, signal] = await once(child, 'close');
  assert.equal(signal, 'SIGTERM', String(code)); assert.ok(Date.now() - started < 1500);
  assert.equal(await f.gone(), true);
});
