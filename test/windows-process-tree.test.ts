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
import { parseTreeReply, reapWindowsTree, run, treeReserve, WINDOWS_TREE_RESERVE_MS,
  type TreeHelper, type TreeReply } from '../dist/process.js';

const filetime = (ms: number) => BigInt(Math.floor(ms)) * 10000n + 116444736000000000n;
type Proc = { pid: number; ppid: number; start: bigint; exit: bigint | null; stubborn?: boolean; denied?: boolean; spawnOnKill?: Proc };
// A virtual process table behind the helper protocol: holding keeps a PID
// (and its zombie) addressable; kills apply only to held entries.
class Table {
  clock = 1000n; procs = new Map<number, Proc>(); held = new Set<number>(); kills: number[] = []; holds: number[] = [];
  requests = 0; closed = false; cascade = false; vanish = new Set<number>(); onRequest?: (table: Table) => void; onKill?: (pid: number) => void;
  tick() { return this.clock += 10n; }
  // A Node parent's libuv job ends its children when it exits; an unheld one
  // is then gone for good (its PID released).
  endChildren(ppid: number) {
    for (const child of [...this.procs.values()]) if (child.ppid === ppid && child.exit === null) {
      child.exit = this.tick(); if (!this.held.has(child.pid)) this.procs.delete(child.pid); this.endChildren(child.pid);
    }
  }
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
    // As the helper does: snapshot after the holds, before the kills.
    const rows = new Map<number, number>();
    for (const p of this.procs.values()) if (p.exit === null) rows.set(p.pid, p.ppid);
    for (const pid of kill) {
      assert.ok(this.held.has(pid), `kill ${pid} without a held handle`);
      this.kills.push(pid); this.onKill?.(pid);
      const p = this.procs.get(pid)!;
      if (p.spawnOnKill && !this.procs.has(p.spawnOnKill.pid)) { this.procs.set(p.spawnOnKill.pid, { ...p.spawnOnKill, start: this.tick() }); }
      if (!p.stubborn && p.exit === null) { p.exit = this.tick(); if (this.cascade) this.endChildren(pid); }
    }
    const held = new Map<number, { start: bigint; exit: bigint | null }>();
    for (const pid of this.held) { const p = this.procs.get(pid)!; held.set(pid, { start: p.start, exit: p.exit }); }
    return { rows, held, errors };
  }
  helper(pid = 7): TreeHelper {
    return { pid, request: async (hold, kill) => this.reply(hold, kill), close: () => { this.closed = true; } };
  }
}
const SELF = 50, ROOT = 100;
// The root as run() exposes it: Node observes its exit as soon as it ends.
function rooted(table: Table, options: { exited?: boolean; stubborn?: boolean } = {}) {
  const proc = table.add(ROOT, SELF);
  if (options.exited) proc.exit = table.tick();
  if (options.stubborn) proc.stubborn = true;
  let kills = 0;
  return { pid: ROOT, exited: () => table.procs.get(ROOT) !== proc || proc.exit !== null,
    kill: () => { kills++; if (!proc.stubborn && proc.exit === null) proc.exit = table.tick(); }, kills: () => kills };
}
const reap = (table: Table, root: ReturnType<typeof rooted>, deadlineMs = 2000, helper = table.helper()) => {
  const deadline = performance.now() + deadlineMs;
  return reapWindowsTree(root, () => deadline, { helper: () => helper, self: SELF });
};

test('the root is held first; an owned child and grandchild are killed through held handles; unrelated processes are never touched', async () => {
  const table = new Table(), root = rooted(table);
  table.add(101, ROOT); table.add(102, 101); table.add(200, 1); table.add(300, SELF); table.add(4, 0);
  assert.equal(await reap(table, root), 'confirmed');
  assert.equal(table.holds[0], ROOT);
  assert.deepEqual([...new Set(table.kills)].sort(), [ROOT, 101, 102]);
  assert.ok(root.kills() >= 1);
  for (const pid of [SELF, 7, 200, 300, 4]) assert.equal(table.holds.includes(pid), false, String(pid));
  assert.equal(table.closed, true);
});

test('attribution uses held kernel times only: wall-clock changes are irrelevant and earlier PID holders are excluded', async () => {
  // Kernel times far from any wall-clock value, as after a clock step.
  for (const clock of [5n, filetime(Date.now() + 86400000)]) {
    const table = new Table(); table.clock = clock;
    const root = rooted(table), start = table.procs.get(ROOT)!.start;
    const child = table.add(101, ROOT);
    table.add(111, ROOT, start - 1n);                // same millisecond, one tick before the root: an earlier PID holder's child
    table.add(120, 101, child.start - 1n);           // ppid 101 but older than the owned 101
    assert.equal(await reap(table, root), 'confirmed');
    assert.deepEqual([...new Set(table.kills)].sort(), [ROOT, 101], String(clock));
  }
});

test('a root whose exit Node already observed, or whose PID was reused before the hold, proves nothing', async () => {
  let table = new Table(), root = rooted(table, { exited: true });
  table.add(101, ROOT);
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.deepEqual(table.kills, []); assert.equal(table.holds.includes(ROOT), false);

  table = new Table(); root = rooted(table);
  table.add(101, ROOT);
  const original = table.reply.bind(table);
  let first = true;
  table.reply = (hold, kill) => {
    if (first) { first = false; table.procs.delete(ROOT); table.add(ROOT, 999); table.add(110, ROOT); }
    return original(hold, kill);
  };
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.deepEqual(table.kills, []);
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

test('an exited (unlisted) candidate is never attributed from an earlier row', async () => {
  const table = new Table(), root = rooted(table);
  const child = table.add(101, ROOT); table.add(102, 101);
  const original = table.reply.bind(table);
  table.reply = (hold, kill) => {
    // 101 exits right after being held: the next snapshot no longer lists it.
    const reply = original(hold, kill);
    if (hold.includes(101)) { child.exit = table.tick(); reply.rows.delete(101); reply.held.set(101, { start: child.start, exit: child.exit }); }
    return reply;
  };
  // Even the genuine child cannot be proven once it is unlisted: no kill.
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.deepEqual([...new Set(table.kills)].filter(pid => pid !== ROOT), []);

  // The listed 101 is replaced after that snapshot by an unrelated process that
  // exits at once: its earlier row cannot describe it, so nothing under it is killed.
  const other = new Table(), second = rooted(other);
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
  assert.deepEqual(other.kills.filter(pid => pid !== ROOT), []);
});

test('an unlisted held candidate never inherits an earlier row, whatever the helper clock said', async () => {
  // A snapshot listed 101 under the root (whatever wall clock the helper had).
  // 101 is then reused by an unrelated process (other parent) that is held,
  // exits at once and is unlisted; its child must not be attributed through
  // the old row, and the result is unconfirmed.
  const table = new Table(), root = rooted(table);
  table.add(101, ROOT);
  const original = table.reply.bind(table);
  table.reply = (hold, kill) => {
    if (!hold.includes(101)) return original(hold, kill);
    table.procs.delete(101); const reuser = table.add(101, 1); table.add(102, 101);
    const reply = original(hold, kill); reuser.exit = table.tick(); reply.rows.delete(101);
    reply.held.set(101, { start: reuser.start, exit: reuser.exit }); return reply;
  };
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.deepEqual(table.kills.filter(pid => pid !== ROOT), []);
});

test('the whole visible tree is held before anything is killed, so job-killed descendants stay attributed', async () => {
  const table = new Table(), root = rooted(table);
  table.cascade = true;
  table.add(101, ROOT); table.add(102, 101); table.add(103, 102);
  assert.equal(await reap(table, root), 'confirmed');
  assert.deepEqual([...new Set(table.holds)].sort(), [ROOT, 101, 102, 103]);
  assert.ok(table.kills.length > 0);
});

test('a descendant started during cleanup is found and killed in a later round', async () => {
  const table = new Table(), root = rooted(table, { stubborn: true });
  table.add(101, ROOT, undefined, { spawnOnKill: { pid: 103, ppid: 101, start: 0n, exit: null } });
  let rounds = 0;
  table.onRequest = t => { if (++rounds === 4) t.procs.get(ROOT)!.stubborn = false; };
  assert.equal(await reap(table, root), 'confirmed');
  assert.deepEqual([...new Set(table.kills)].filter(pid => pid !== ROOT).sort(), [101, 103]);
});

test('denied, vanished, unlisted and unkillable candidates make cleanup unconfirmed without foreign kills', async () => {
  let table = new Table(), root = rooted(table);
  table.add(101, ROOT, undefined, { denied: true });
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.deepEqual(table.kills.filter(pid => pid !== ROOT), []);

  table = new Table(); root = rooted(table);
  table.add(101, ROOT); table.add(102, 101); table.vanish.add(101);
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.equal(table.kills.includes(102), false, 'an unattributable orphan is not killed');

  // Vanished with no visible descendant: still no evidence of a complete tree.
  table = new Table(); root = rooted(table);
  table.add(101, ROOT); table.vanish.add(101);
  assert.equal(await reap(table, root), 'unconfirmed');

  // Held but unlisted afterwards and started after the earlier snapshot: its
  // parent is unknown, so it is neither attributed nor killed.
  table = new Table(); root = rooted(table);
  table.add(101, ROOT);
  const original = table.reply.bind(table);
  table.reply = (hold, kill) => {
    if (!hold.includes(101)) return original(hold, kill);
    table.procs.delete(101); const late = table.add(101, ROOT);
    const reply = original(hold, kill); late.exit = table.tick(); reply.rows.delete(101);
    reply.held.set(101, { start: late.start, exit: late.exit }); return reply;
  };
  assert.equal(await reap(table, root), 'unconfirmed');
  assert.deepEqual(table.kills.filter(pid => pid !== ROOT), []);

  table = new Table(); root = rooted(table);
  table.add(101, ROOT, undefined, { stubborn: true });
  const started = performance.now();
  assert.equal(await reap(table, root, 300), 'unconfirmed');
  assert.ok(performance.now() - started < 1000);
  assert.deepEqual([...new Set(table.kills)].filter(pid => pid !== ROOT), [101]);
});

test('a root that never exits, a hung, failing or absent helper and an abort are all bounded, unconfirmed and still kill the root', async () => {
  const table = new Table(), root = rooted(table, { stubborn: true });
  let started = performance.now();
  assert.equal(await reap(table, root, 200), 'unconfirmed');
  assert.ok(performance.now() - started < 800);
  let closed = 0;
  const helpers: TreeHelper[] = [
    { request: () => new Promise(() => {}), close: () => { closed++; } },
    { request: async () => { throw new Error('private-native-error'); }, close: () => { closed++; } },
  ];
  for (const helper of helpers) {
    const victim = rooted(new Table());
    started = performance.now(); const deadline = performance.now() + 200;
    assert.equal(await reapWindowsTree(victim, () => deadline, { helper: () => helper }), 'unconfirmed');
    assert.ok(performance.now() - started < 800); assert.ok(victim.kills() >= 1);
  }
  assert.equal(closed, 2);
  const absent = rooted(new Table()), soon = performance.now() + 200;
  assert.equal(await reapWindowsTree(absent, () => soon, { helper: () => { throw new Error('spawn'); } }), 'unconfirmed');
  assert.ok(absent.kills() >= 1);
  const past = performance.now() - 1;
  assert.equal(await reapWindowsTree(rooted(new Table()), () => past, { helper: () => new Table().helper() }), 'unconfirmed');
  // A signal shortens a cleanup that would otherwise wait for a hung helper.
  const cut = new AbortController(), far = performance.now() + 60000, hung = rooted(new Table());
  setTimeout(() => cut.abort(), 100);
  started = performance.now();
  assert.equal(await reapWindowsTree(hung, () => far, { helper: () => helpers[0]!, signal: cut.signal }), 'unconfirmed');
  assert.ok(performance.now() - started < 500); assert.ok(hung.kills() >= 1);
});

test('helper replies are parsed strictly', () => {
  const reply = parseTreeReply('ok 100:50,101:100 101:133000000000000010:,102:133000000000000020:133000000000000030 103:gone,104:denied');
  assert.equal(reply.rows.get(101), 100);
  assert.deepEqual(reply.held.get(101), { start: 133000000000000010n, exit: null });
  assert.equal(reply.held.get(102)!.exit, 133000000000000030n);
  assert.equal(reply.errors.get(104), 'denied');
  assert.equal(parseTreeReply('ok - - -').rows.size, 0);
  for (const line of ['', 'error', 'ok - -', 'ok 1 - - -', 'ok 1:2:3 - -', 'ok a:1 - -', 'ok - 1:2 -',
    'ok - 1:0: -', 'ok - 1:x: -', 'ok - - 1:other', 'ok - - - extra', 'ok 12345678901:1 - -']) {
    assert.throws(() => parseTreeReply(line), /tree_reply/, line);
  }
  assert.equal(treeReserve(3000), 1000); assert.equal(treeReserve(60000), WINDOWS_TREE_RESERVE_MS); assert.equal(treeReserve(1), 0);
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
      helper.stdout.write(`ok ${field([...r.rows].map(([a, b]) => `${a}:${b}`))} ${field([...r.held].map(([pid, s]) => `${pid}:${s.start}:${s.exit ?? ''}`))} ${field([...r.errors].map(([pid, e]) => `${pid}:${e}`))}\r\n`);
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
    if (existsSync(pid)) {
      const root = Number(readFileSync(pid, 'utf8')); table.add(root, process.pid, table.clock); table.add(9001, root); table.add(9002, 9001);
      // A kill through the held root handle ends the real local child.
      table.onKill = id => { if (id === root) try { process.kill(root, 'SIGKILL'); } catch { /* Gone. */ } };
    }
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
  assert.deepEqual([...new Set(fake.table.kills)].filter(pid => pid === 9001 || pid === 9002).sort(), [9001, 9002]);
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0]!;
  assert.equal(call.options.shell, false); assert.equal(call.options.detached, undefined); assert.equal(call.options.windowsHide, true);
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
  assert.deepEqual([...new Set(fake.table.kills)].filter(pid => pid === 9001 || pid === 9002).sort(), [9001, 9002]);
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

// Emulated on POSIX, where a real signal can reach the runner. The fake helper
// holds the real child and a virtual descendant 9001; with 'hang' it never
// answers after the child overflowed its output, so the earlier 90 s cleanup
// is still in progress when the signal arrives.
function signalRunner(t: TestContext, mode: 'answer' | 'hang') {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-tree-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'log.json'), pid = join(dir, 'pid'), runner = join(dir, 'runner.mjs');
  const dist = (name: string) => JSON.stringify(pathToFileURL(join(process.cwd(), 'dist', name)).href);
  const body = mode === 'hang' ? 'process.stdout.write("x".repeat(65536)); setInterval(() => {}, 1000)' : 'setInterval(() => {}, 1000)';
  writeFileSync(runner, `import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, writeFileSync } from 'node:fs';
import { run } from ${dist('process.js')};
Object.defineProperty(process, 'platform', { value: 'win32' });
const original = childProcess.spawn, kills = [], held = new Map(), ft = () => BigInt(Date.now()) * 10000n + 116444736000000000n;
childProcess.spawn = (binary, args, options) => {
  if (binary !== 'powershell.exe') return original(binary, args, options);
  const root = Number(readFileSync(${JSON.stringify(pid)}, 'utf8')), start = ft();
  const helper = Object.assign(new EventEmitter(), { pid: 7, stdin: new PassThrough(), stdout: new PassThrough(), kill() { return true; } });
  helper.stdin.setEncoding('utf8');
  helper.stdin.on('data', line => {
    if (${JSON.stringify(mode)} === 'hang') return;
    const [hold, kill] = line.trim().split(' ');
    for (const id of hold === '-' ? [] : hold.split(',').map(Number)) held.set(id, id === root ? start : start + 10n);
    if (kill !== '-') { kills.push(...kill.split(',').map(Number)); if (kills.includes(root)) try { process.kill(root, 'SIGKILL'); } catch {} writeFileSync(${JSON.stringify(log)}, JSON.stringify(kills)); }
    const states = [...held].map(([id, at]) => id + ':' + at + ':' + (kills.includes(id) ? at + 20n : '')).join(',') || '-';
    const rows = [[root, process.pid], [9001, root]].filter(([id]) => !kills.includes(id)).map(row => row.join(':')).join(',') || '-';
    helper.stdout.write('ok ' + rows + ' ' + states + ' -\\n');
  });
  return helper;
};
await run(process.execPath, ['-e', 'require("node:fs").writeFileSync(${JSON.stringify(pid).replace(/"/g, '\\"')}, String(process.pid)); ${body}'], { timeout: 90000, limit: 1024 });
`);
  const child = spawn(process.execPath, [runner], { stdio: 'ignore' });
  return { child, log, pid };
}
async function signalled(t: TestContext, mode: 'answer' | 'hang') {
  const f = signalRunner(t, mode);
  for (let i = 0; i < 250 && !existsSync(f.pid); i++) await timers.setTimeout(20);
  assert.ok(existsSync(f.pid));
  await timers.setTimeout(mode === 'hang' ? 300 : 0);
  const rootPid = Number(readFileSync(f.pid, 'utf8')), started = Date.now(); f.child.kill('SIGTERM');
  const [code, signal] = await once(f.child, 'close');
  const elapsed = Date.now() - started;
  assert.equal(signal, 'SIGTERM', String(code));
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) { try { process.kill(rootPid, 0); await timers.setTimeout(20); } catch { alive = false; } }
  assert.equal(alive, false, 'the child is terminated');
  return { elapsed, log: f.log };
}

test('win32 run(): a signal runs the tree cleanup, then re-raises', { skip: process.platform === 'win32' }, async t => {
  const { elapsed, log } = await signalled(t, 'answer');
  assert.ok(elapsed < 3000, `${elapsed} ms`);
  assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')).filter((pid: number) => pid === 9001), [9001]);
});

test('win32 run(): a signal caps an in-progress overflow cleanup to WINDOWS_TREE_RESERVE_MS', { skip: process.platform === 'win32' }, async t => {
  const { elapsed, log } = await signalled(t, 'hang');
  assert.ok(elapsed >= WINDOWS_TREE_RESERVE_MS - 300 && elapsed < WINDOWS_TREE_RESERVE_MS + 1500, `${elapsed} ms`);
  assert.equal(existsSync(log), false, 'nothing was killed without evidence');
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
  // No 'exit' case here: a Node child's own libuv job kills its descendants
  // when it exits, so nothing holds the pipes (measured); the non-Node tests
  // below cover a parent that exits while its child keeps the pipes.
  for (const [mode, options] of [['stay', { timeout: 8000 }], ['flood', { timeout: 8000, limit: 1024 }]] as const) {
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
  // Not a console Ctrl+C: Windows cannot deliver one to this child alone, so
  // the SIGINT event is emitted to the installed handler, which re-raises.
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


// A non-Node native parent (powershell.exe) starts ping.exe via CreateProcessW
// (Start-Process -NoNewWindow), which inherits and holds the output pipes, like
// ssh.exe starting a ProxyCommand.
function nativeTree(t: TestContext, mode: 'stay' | 'exit' | 'flood') {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-wnative-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pids = join(dir, 'pids.json'), quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
  const script = `$g = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\PING.EXE') -ArgumentList '-n','600','127.0.0.1' -NoNewWindow -PassThru
[IO.File]::WriteAllText(${quote(pids)}, (ConvertTo-Json @{child=$PID; grandchild=$g.Id} -Compress))
if ('${mode}' -eq 'flood') { [Console]::Out.Write('x' * 65536) }
if ('${mode}' -eq 'exit') { exit 0 }
Start-Sleep -Seconds 600`;
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  return { args, pids, async gone() {
    const all = Object.values(JSON.parse(readFileSync(pids, 'utf8')) as Record<string, number>);
    assert.equal(all.length, 2);
    for (let i = 0; i < 100 && all.some(alive); i++) await timers.setTimeout(50);
    return all.filter(alive);
  } };
}

test('native win32: a parent that exited before the stop proves nothing; its pipe-holding child is not killed', native, async t => {
  // Node observed the parent's exit, so its PID may already be reused: the
  // child keeping the pipes cannot be attributed, and the result is unconfirmed.
  const f = nativeTree(t, 'exit'), started = performance.now();
  const done = await run('powershell.exe', f.args, { timeout: 8000 });
  assert.equal(done.stopReason, 'timeout'); assert.equal(done.cleanup, 'unconfirmed');
  assert.ok(performance.now() - started < 8500);
  const { grandchild } = JSON.parse(readFileSync(f.pids, 'utf8')) as { grandchild: number };
  assert.doesNotThrow(() => process.kill(grandchild, 0), 'not killed without evidence');
  process.kill(grandchild); // The test's own fixture process.
  assert.deepEqual(await f.gone(), []);
});

test('native win32: a non-Node parent and its CreateProcessW grandchild are cleaned on timeout, overflow and interrupt', native, async t => {
  for (const [mode, options] of [['stay', { timeout: 8000 }], ['flood', { timeout: 8000, limit: 1024 }]] as const) {
    const f = nativeTree(t, mode), started = performance.now();
    const done = await run('powershell.exe', f.args, options);
    const elapsed = performance.now() - started;
    assert.equal(done.cleanup, 'confirmed', mode); assert.equal(done.stopReason, mode === 'flood' ? 'output_limit' : 'timeout', mode);
    assert.ok(elapsed < options.timeout + 500, `${mode}: ${elapsed} ms`);
    assert.deepEqual(await f.gone(), [], mode);
  }
  const f = nativeTree(t, 'stay'), runner = join(realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-wrunner-'))), 'runner.mjs');
  t.after(() => rmSync(join(runner, '..'), { recursive: true, force: true }));
  writeFileSync(runner, `import { existsSync } from 'node:fs';
import { run } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist/process.js')).href)};
void run('powershell.exe', ${JSON.stringify(f.args)}, { timeout: 60000 });
const poll = () => existsSync(${JSON.stringify(f.pids)}) ? process.emit('SIGINT', 'SIGINT') : setTimeout(poll, 20); poll();`);
  const child = spawn(process.execPath, [runner], { stdio: 'ignore' });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.deepEqual(await f.gone(), []);
});
