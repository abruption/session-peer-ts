// Windows owned process-tree cleanup. The virtual-table cases run everywhere
// (deterministic PID reuse, vanish, denial, hang); the native cases run only on
// win32 (CI windows job) with real node -> node -> node trees.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import timers from 'node:timers/promises';
import { filetime, parseTreeReply, reapWindowsTree, run, treeReserve, WINDOWS_TREE_RESERVE_MS,
  type TreeHelper, type TreeReply } from '../dist/process.js';

type Proc = { pid: number; ppid: number; start: bigint; exit: bigint | null; stubborn?: boolean; denied?: boolean; spawnOnKill?: Proc };
// A virtual process table behind the helper protocol: holding keeps a PID
// (and its zombie) addressable; kills apply only to held entries.
class Table {
  clock = 1000n; procs = new Map<number, Proc>(); held = new Set<number>(); kills: number[] = []; holds: number[] = [];
  requests = 0; closed = false; vanish = new Set<number>(); onRequest?: (table: Table) => void;
  tick() { return this.clock += 10n; }
  add(pid: number, ppid: number, start = this.tick(), extra: Partial<Proc> = {}) { const p = { pid, ppid, start, exit: null, ...extra }; this.procs.set(pid, p); return p; }
  reply(hold: number[], kill: number[]): TreeReply {
    this.requests++; this.onRequest?.(this);
    const errors = new Map<number, 'gone' | 'denied'>();
    for (const pid of hold) {
      this.holds.push(pid);
      const p = this.procs.get(pid);
      if (this.vanish.has(pid) || !p || (p.exit !== null && !this.held.has(pid))) { this.procs.delete(pid); errors.set(pid, 'gone'); continue; }
      if (p.denied) { errors.set(pid, 'denied'); continue; }
      this.held.add(pid);
    }
    for (const pid of kill) {
      assert.ok(this.held.has(pid), `kill ${pid} without a held handle`);
      this.kills.push(pid);
      const p = this.procs.get(pid)!;
      if (p.spawnOnKill && !this.procs.has(p.spawnOnKill.pid)) { this.procs.set(p.spawnOnKill.pid, { ...p.spawnOnKill, start: this.tick() }); }
      if (!p.stubborn && p.exit === null) p.exit = this.tick();
    }
    const snapshot = this.tick(), rows = new Map<number, number>(), held = new Map<number, { start: bigint; exit: bigint | null }>();
    for (const p of this.procs.values()) if (p.exit === null) rows.set(p.pid, p.ppid);
    for (const pid of this.held) { const p = this.procs.get(pid)!; held.set(pid, { start: p.start, exit: p.exit }); }
    return { snapshot, rows, held, errors };
  }
  helper(pid = 7): TreeHelper {
    return { pid, request: async (hold, kill) => this.reply(hold, kill), close: () => { this.closed = true; } };
  }
}
const SELF = 50, ROOT = 100;
function rooted(table: Table, exitAfter = 1) {
  const spawnedAt = table.tick();
  table.add(ROOT, SELF, table.tick());
  let exitedAt: bigint | undefined;
  table.onRequest = t => { if (t.requests > exitAfter && exitedAt === undefined) { t.procs.get(ROOT)!.exit = exitedAt = t.tick(); } };
  return { pid: ROOT, spawnedAt, exitedAt: () => exitedAt };
}
const reap = (table: Table, root: ReturnType<typeof rooted>, deadlineMs = 2000, helper = table.helper()) =>
  reapWindowsTree(root, performance.now() + deadlineMs, { helper: () => helper, self: SELF });

test('an owned child and grandchild are killed through held handles; unrelated processes are never touched', async () => {
  const table = new Table(), root = rooted(table);
  table.add(101, ROOT); table.add(102, 101); table.add(200, 1); table.add(300, SELF); table.add(4, 0);
  assert.equal(await reap(table, root), 'confirmed');
  assert.deepEqual([...new Set(table.kills)].sort(), [101, 102]);
  for (const pid of [SELF, 7, ROOT, 200, 300, 4]) assert.equal(table.holds.includes(pid), false, String(pid));
  assert.equal(table.closed, true);
});

test('PID reuse: children of a reused or older PID holder are held but never killed', async () => {
  const table = new Table(), root = rooted(table, 0);
  const early = table.add(111, ROOT, 1n);               // created before the spawn by an earlier PID holder
  const child = table.add(101, ROOT);
  table.add(120, 101, child.start - 5n);               // ppid 101 but older than the owned 101
  table.onRequest = t => {
    if (t.requests === 1) {
      t.procs.get(ROOT)!.exit = t.tick(); exited = t.clock;
      t.procs.delete(ROOT); t.add(ROOT, 999);         // root PID reused after Node observed its exit
      t.add(110, ROOT);                                // child of the reuser
    }
  };
  let exited: bigint | undefined; root.exitedAt = () => exited;
  assert.equal(await reap(table, root), 'confirmed');
  assert.deepEqual([...new Set(table.kills)], [101]);
  for (const pid of [early.pid, 110, 120]) assert.equal(table.kills.includes(pid), false, String(pid));
});

test('a reused PID between snapshot and hold is attributed by the held identity, not the old row', async () => {
  const table = new Table(), root = rooted(table);
  table.add(101, ROOT);
  // Between the snapshot that listed 101 and the hold, 101 exits and an
  // unrelated process with PID 101 and a different parent appears.
  let swapped = false;
  const original = table.reply.bind(table);
  table.reply = (hold, kill) => {
    if (hold.includes(101) && !swapped) { swapped = true; table.procs.delete(101); table.add(101, 1); }
    return original(hold, kill);
  };
  assert.equal(await reap(table, root), 'confirmed');
  assert.equal(table.kills.includes(101), false);
});

test('an exited (zombie) candidate is attributed from the earlier row only if it owned the PID then', async () => {
  const table = new Table(), root = rooted(table, 3);
  const child = table.add(101, ROOT); table.add(102, 101);
  const original = table.reply.bind(table);
  table.reply = (hold, kill) => {
    // 101 exits right after being held: the next snapshot no longer lists it.
    const reply = original(hold, kill);
    if (hold.includes(101)) { child.exit = table.tick(); reply.rows.delete(101); reply.held.set(101, { start: child.start, exit: child.exit }); }
    return reply;
  };
  assert.equal(await reap(table, root), 'confirmed');
  assert.deepEqual([...new Set(table.kills)], [102]);

  // The listed 101 is replaced after that snapshot by an unrelated process that
  // exits at once: its earlier row cannot describe it, so nothing under it is killed.
  const other = new Table(), second = rooted(other, 3);
  other.add(101, ROOT);
  const forward = other.reply.bind(other);
  other.reply = (hold, kill) => {
    if (hold.includes(101)) {
      other.procs.delete(101); const replaced = other.add(101, 1); other.add(102, 101);
      const reply = forward(hold, kill); replaced.exit = other.tick(); reply.rows.delete(101);
      reply.held.set(101, { start: replaced.start, exit: replaced.exit }); return reply;
    }
    return forward(hold, kill);
  };
  assert.equal(await reap(other, second), 'unconfirmed');
  assert.deepEqual(other.kills, []);
});

test('a descendant started during cleanup is found and killed in a later round', async () => {
  const table = new Table(), root = rooted(table, 4);
  table.add(101, ROOT, undefined, { spawnOnKill: { pid: 103, ppid: 101, start: 0n, exit: null } });
  assert.equal(await reap(table, root), 'confirmed');
  assert.deepEqual([...new Set(table.kills)].sort(), [101, 103]);
});

test('denied, vanished-with-children and unkillable candidates make cleanup unconfirmed without foreign kills', async () => {
  let table = new Table(), root = rooted(table);
  table.add(101, ROOT, undefined, { denied: true });
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.deepEqual(table.kills, []);

  table = new Table(); root = rooted(table);
  table.add(101, ROOT); table.add(102, 101); table.vanish.add(101);
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.equal(table.kills.includes(102), false, 'an unattributable orphan is not killed');

  table = new Table(); root = rooted(table);
  table.add(101, ROOT, undefined, { stubborn: true });
  const started = performance.now();
  assert.equal(await reap(table, root, 300), 'unconfirmed');
  assert.ok(performance.now() - started < 1000);
  assert.deepEqual([...new Set(table.kills)], [101]);
});

test('a root that never exits, a hung, failing or absent helper are all bounded and unconfirmed', async () => {
  const table = new Table(), root = rooted(table, Infinity);
  let started = performance.now();
  assert.equal(await reap(table, root, 200), 'unconfirmed');
  assert.ok(performance.now() - started < 800);
  let closed = 0;
  const helpers: TreeHelper[] = [
    { request: () => new Promise(() => {}), close: () => { closed++; } },
    { request: async () => { throw new Error('private-native-error'); }, close: () => { closed++; } },
  ];
  for (const helper of helpers) {
    started = performance.now();
    assert.equal(await reapWindowsTree(rooted(new Table()), performance.now() + 200, { helper: () => helper }), 'unconfirmed');
    assert.ok(performance.now() - started < 800);
  }
  assert.equal(closed, 2);
  assert.equal(await reapWindowsTree(rooted(new Table()), performance.now() + 200, { helper: () => { throw new Error('spawn'); } }), 'unconfirmed');
  assert.equal(await reapWindowsTree(rooted(new Table()), performance.now() - 1, { helper: () => new Table().helper() }), 'unconfirmed');
});

test('helper replies are parsed strictly', () => {
  const reply = parseTreeReply('ok 133000000000000000 100:50,101:100 101:133000000000000010:,102:133000000000000020:133000000000000030 103:gone,104:denied');
  assert.equal(reply.rows.get(101), 100);
  assert.deepEqual(reply.held.get(101), { start: 133000000000000010n, exit: null });
  assert.equal(reply.held.get(102)!.exit, 133000000000000030n);
  assert.equal(reply.errors.get(104), 'denied');
  assert.equal(parseTreeReply('ok 1 - - -').rows.size, 0);
  for (const line of ['', 'error', 'ok 1 - -', 'ok 0 - - -', 'ok x - - -', 'ok 1 1:2:3 - -', 'ok 1 a:1 - -', 'ok 1 - 1:2 -',
    'ok 1 - 1:0: -', 'ok 1 - - 1:other', 'ok 1 - - - extra', 'ok 1 12345678901:1 - -']) {
    assert.throws(() => parseTreeReply(line), /tree_reply/, line);
  }
  assert.equal(treeReserve(3000), 1500); assert.equal(treeReserve(60000), WINDOWS_TREE_RESERVE_MS); assert.equal(treeReserve(1), 0);
  assert.equal(filetime(0), 116444736000000000n);
});

// Fake powershell.exe child speaking the helper line protocol over real streams.
function fakePowerShell(table: Table, options: { hang?: boolean } = {}) {
  const helper = Object.assign(new EventEmitter(), { pid: 7, stdin: new PassThrough(), stdout: new PassThrough(), killed: false,
    kill() { this.killed = true; return true; } });
  let input = '';
  helper.stdin.setEncoding('utf8');
  helper.stdin.on('data', (part: string) => {
    input += part;
    for (let end = input.indexOf('\n'); end >= 0; end = input.indexOf('\n')) {
      const [hold, kill] = input.slice(0, end).split(' ').map(text => text === '-' ? [] : text.split(',').map(Number));
      input = input.slice(end + 1);
      if (options.hang) continue;
      const r = table.reply(hold!, kill!);
      const field = (items: string[]) => items.length ? items.join(',') : '-';
      helper.stdout.write(`ok ${r.snapshot} ${field([...r.rows].map(([a, b]) => `${a}:${b}`))} ${field([...r.held].map(([pid, s]) => `${pid}:${s.start}:${s.exit ?? ''}`))} ${field([...r.errors].map(([pid, e]) => `${pid}:${e}`))}\r\n`);
    }
  });
  return helper;
}
function windows(t: TestContext) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => { t.mock.restoreAll(); Object.defineProperty(process, 'platform', platform); });
}
// The real child is an ordinary local node process that records its PID; its
// descendants are virtual entries keyed to that PID, created after the spawn.
function emulate(t: TestContext, options: { hang?: boolean } = {}) {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-tree-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const table = new Table(), calls: { args: readonly string[]; options: childProcess.SpawnOptions }[] = [], pid = join(dir, 'pid');
  const original = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (binary: string, args: readonly string[], spawnOptions: childProcess.SpawnOptions) => {
    if (binary !== 'powershell.exe') return original(binary, args, spawnOptions);
    calls.push({ args, options: spawnOptions });
    table.clock = filetime(Date.now());
    if (existsSync(pid)) { const root = Number(readFileSync(pid, 'utf8')); table.add(9001, root, table.clock); table.add(9002, 9001, table.tick()); }
    return fakePowerShell(table, options);
  });
  const script = (body: string) => `require('node:fs').writeFileSync(${JSON.stringify(pid)}, String(process.pid)); ${body}`;
  return { table, calls, script };
}

test('win32 run(): a timeout terminates the child and its owned tree within the original total', async t => {
  windows(t);
  const fake = emulate(t), total = 1200, started = performance.now();
  const done = await run(process.execPath, ['-e', fake.script('setInterval(() => {}, 1000)'), 'private-message-text'], { timeout: total });
  const elapsed = performance.now() - started;
  assert.equal(done.interrupted, true); assert.equal(done.stopReason, 'timeout'); assert.equal(done.cleanup, 'confirmed');
  assert.ok(elapsed >= total - treeReserve(total) - 50 && elapsed < total + 300, `${elapsed} ms`);
  assert.deepEqual([...new Set(fake.table.kills)].sort(), [9001, 9002]);
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0]!;
  assert.equal(call.options.shell, false); assert.equal(call.options.detached, true); assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']); assert.equal(call.args.length, 4);
  const script = Buffer.from(call.args[3]!, 'base64').toString('utf16le');
  assert.equal(script.includes('private-message-text'), false);
  assert.match(script, /GetProcessById/); assert.doesNotMatch(script, /taskkill|Stop-Process|Invoke-Expression/i);
});

test('win32 run(): output overflow, a hung helper and normal completion', async t => {
  windows(t);
  let fake = emulate(t), started = performance.now();
  let done = await run(process.execPath, ['-e', fake.script('process.stdout.write("x".repeat(65536)); setInterval(() => {}, 1000)')], { timeout: 4000, limit: 1024 });
  assert.equal(done.stopReason, 'output_limit'); assert.equal(done.cleanup, 'confirmed');
  assert.ok(performance.now() - started < 3000);
  assert.deepEqual([...new Set(fake.table.kills)].sort(), [9001, 9002]);
  t.mock.restoreAll();
  fake = emulate(t, { hang: true }); started = performance.now();
  done = await run(process.execPath, ['-e', fake.script('setInterval(() => {}, 1000)')], { timeout: 800 });
  const elapsed = performance.now() - started;
  assert.equal(done.stopReason, 'timeout'); assert.equal(done.cleanup, 'unconfirmed');
  assert.ok(elapsed >= 750 && elapsed < 1100, `${elapsed} ms`);
  assert.deepEqual(fake.table.kills, []);
  t.mock.restoreAll();
  fake = emulate(t);
  done = await run(process.execPath, ['-e', 'process.stdout.write("ok")'], { timeout: 4000 });
  assert.equal(done.code, 0); assert.equal(done.stdout, 'ok'); assert.equal(done.interrupted, false);
  assert.equal('cleanup' in done, false); assert.equal(fake.calls.length, 0);
});

test('POSIX run() results never carry a cleanup field', { skip: process.platform === 'win32' }, async () => {
  const done = await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 200 });
  assert.equal(done.interrupted, true); assert.equal('cleanup' in done, false);
});

// Emulated on POSIX, where a real signal can reach the runner: the win32
// handler terminates the child, kills the owned virtual descendant, re-raises.
test('win32 run(): a signal runs the tree cleanup, then re-raises', { skip: process.platform === 'win32' }, async t => {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-tree-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'log.json'), pid = join(dir, 'pid'), runner = join(dir, 'runner.mjs');
  const dist = (name: string) => JSON.stringify(pathToFileURL(join(process.cwd(), 'dist', name)).href);
  writeFileSync(runner, `import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, writeFileSync } from 'node:fs';
import { filetime, run } from ${dist('process.js')};
Object.defineProperty(process, 'platform', { value: 'win32' });
const original = childProcess.spawn, kills = [];
childProcess.spawn = (binary, args, options) => {
  if (binary !== 'powershell.exe') return original(binary, args, options);
  const root = Number(readFileSync(${JSON.stringify(pid)}, 'utf8')), start = filetime(Date.now());
  const helper = Object.assign(new EventEmitter(), { pid: 7, stdin: new PassThrough(), stdout: new PassThrough(), kill() { return true; } });
  helper.stdin.setEncoding('utf8');
  helper.stdin.on('data', line => {
    const kill = line.trim().split(' ')[1];
    if (kill !== '-') { kills.push(...kill.split(',').map(Number)); writeFileSync(${JSON.stringify(log)}, JSON.stringify(kills)); }
    const held = line.startsWith('-') && !kills.length ? '-' : '9001:' + start + ':' + (kills.length ? start + 10n : '');
    helper.stdout.write('ok ' + filetime(Date.now()) + ' ' + (kills.length ? '-' : '9001:' + root) + ' ' + held + ' -\\n');
  });
  return helper;
};
await run(process.execPath, ['-e', 'require("node:fs").writeFileSync(${JSON.stringify(pid).replace(/"/g, '\\"')}, String(process.pid)); setInterval(() => {}, 1000)'], { timeout: 60000 });
`);
  const child = spawn(process.execPath, [runner], { stdio: 'ignore' });
  for (let i = 0; i < 250 && !existsSync(pid); i++) await timers.setTimeout(20);
  assert.ok(existsSync(pid));
  const rootPid = Number(readFileSync(pid, 'utf8'));
  const started = Date.now(); child.kill('SIGTERM');
  const [code, signal] = await once(child, 'close');
  assert.equal(signal, 'SIGTERM', String(code)); assert.ok(Date.now() - started < 3000);
  assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), [9001]);
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) { try { process.kill(rootPid, 0); await timers.setTimeout(20); } catch { alive = false; } }
  assert.equal(alive, false);
});

// Native Windows: real owned trees. Unrun on non-Windows hosts.
const native = { skip: process.platform !== 'win32' };
function tree(t: TestContext) {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-wtree-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pids = join(dir, 'pids.json'), script = join(dir, 'tree.cjs');
  writeFileSync(script, `const {spawn}=require('node:child_process');
const g=spawn(process.execPath,['-e',"const {spawn}=require('node:child_process');const h=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});require('node:fs').writeFileSync(process.argv[1],String(h.pid));setInterval(()=>{},1000)",${JSON.stringify(join(dir, 'great.txt'))}],{stdio:['ignore','inherit','inherit']});
const wait=()=>{try{const great=Number(require('node:fs').readFileSync(${JSON.stringify(join(dir, 'great.txt'))},'utf8'));
require('node:fs').writeFileSync(${JSON.stringify(pids)},JSON.stringify({child:process.pid,grandchild:g.pid,great}));
if(process.argv[2]==='exit')process.exit(0);if(process.argv[2]==='flood')process.stdout.write('x'.repeat(65536));}catch{setTimeout(wait,20)}};wait();setInterval(()=>{},1000);`);
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  return { script, pids, ready: () => existsSync(pids), async gone() {
    const all = Object.values(JSON.parse(readFileSync(pids, 'utf8')) as Record<string, number>);
    for (let i = 0; i < 100 && all.some(alive); i++) await timers.setTimeout(50);
    return all.filter(alive);
  } };
}

test('native win32: timeout and overflow kill the whole owned tree within the total', native, async t => {
  for (const [mode, options] of [['stay', { timeout: 12000 }], ['exit', { timeout: 12000 }], ['flood', { timeout: 12000, limit: 1024 }]] as const) {
    const f = tree(t), started = performance.now();
    const done = await run(process.execPath, [f.script, mode], options);
    const elapsed = performance.now() - started;
    assert.equal(done.interrupted, true, mode); assert.equal(done.cleanup, 'confirmed', mode);
    assert.equal(done.stopReason, mode === 'flood' ? 'output_limit' : 'timeout', mode);
    assert.ok(elapsed < options.timeout + 500, `${mode}: ${elapsed} ms`);
    assert.deepEqual(await f.gone(), [], mode);
  }
});

test('native win32: an interrupt cleans the owned tree before the CLI exits', native, async t => {
  const f = tree(t), runner = join(realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-wrunner-'))), 'runner.mjs');
  t.after(() => rmSync(join(runner, '..'), { recursive: true, force: true }));
  // Windows cannot deliver a console signal to one child here; emit the
  // SIGINT event to the installed handler, which then re-raises.
  writeFileSync(runner, `import { existsSync } from 'node:fs';
import { run } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist/process.js')).href)};
void run(process.execPath, [${JSON.stringify(f.script)}, 'stay'], { timeout: 60000 });
const poll = () => existsSync(${JSON.stringify(f.pids)}) ? process.emit('SIGINT', 'SIGINT') : setTimeout(poll, 20); poll();`);
  const child = spawn(process.execPath, [runner], { stdio: 'ignore' });
  const started = performance.now();
  const [code] = await once(child, 'close');
  assert.equal(code, 1); assert.ok(performance.now() - started < 30000);
  assert.deepEqual(await f.gone(), []);
});

