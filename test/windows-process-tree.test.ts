// Windows process cleanup. Production run() kills only the direct child on
// Windows and never starts the tree helper; that is pinned here. The rest
// tests the candidate tree backend (reapWindowsTree), which no production
// path selects: virtual-table cases run everywhere, native ones only on win32.
// They test the candidate (provisional, UTC-ordering) classifier and record
// its design limits; they are not evidence that descendant ownership can be
// proven on Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import timers from 'node:timers/promises';
import { parseTreeReply, reapWindowsTree, run,
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

test('candidate backend: the root is held first; accepted child and grandchild are killed through held handles; unrelated processes are not touched', async () => {
  const table = new Table(), root = rooted(table);
  table.add(101, ROOT); table.add(102, 101); table.add(200, 1); table.add(300, SELF); table.add(4, 0);
  assert.equal(await reap(table, root), 'confirmed');
  assert.equal(table.holds[0], ROOT);
  assert.deepEqual([...new Set(table.kills)].sort(), [ROOT, 101, 102]);
  assert.ok(root.kills() >= 1);
  for (const pid of [SELF, 7, 200, 300, 4]) assert.equal(table.holds.includes(pid), false, String(pid));
  assert.equal(table.closed, true);
});

test('candidate backend: creation-time ordering excludes earlier PID holders under shifted clock bases (not under a rollback; see the todo)', async () => {
  // UTC times far from the current wall clock, with the whole base shifted;
  // this does not cover a rollback (see the todo).
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

test('a root whose exit Node already observed, or whose PID was reused before the hold, is left unidentified', async () => {
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

test('a PID swap observed between snapshot and hold is never killed and makes the result unconfirmed', async () => {
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
  // The listed 101 may have started descendants that are no longer visible.
  assert.equal(await reap(table, root), 'unconfirmed');
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

test('a child the root starts while being killed is seen in a post-kill snapshot before confirming', async () => {
  // Not stubborn: the root exits at its kill, so only a fresh snapshot after
  // that kill can reveal the child it started in between.
  const table = new Table(), root = rooted(table);
  table.procs.get(ROOT)!.spawnOnKill = { pid: 104, ppid: ROOT, start: 0n, exit: null };
  assert.equal(await reap(table, root), 'confirmed');
  assert.ok(table.kills.includes(104), 'the late child is killed');
  assert.equal(table.procs.get(104)!.exit !== null, true);
});

// Counted as todo, never as a pass or skip: the limit is unresolved.
test.todo('DESIGN LIMIT, UNRESOLVED (not a pass): GetProcessTimes are UTC wall-clock instants, so after a clock rollback a child of an earlier holder of a parent PID can satisfy parent.start <= start <= parent.exit and be misattributed; no production path uses this backend until a Job-object (or equivalent) ownership boundary exists');

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
});

// Fake powershell.exe child speaking the helper line protocol over real streams.
function fakePowerShell(table: Table) {
  const helper = Object.assign(new EventEmitter(), { pid: 7, stdin: new PassThrough(), stdout: new PassThrough(), killed: false,
    kill() { this.killed = true; return true; } });
  let input = '';
  helper.stdin.setEncoding('utf8');
  helper.stdin.on('data', (part: string) => {
    input += part;
    for (let end = input.indexOf('\n'); end >= 0; end = input.indexOf('\n')) {
      const [hold, kill] = input.slice(0, end).split(' ').map(text => text === '-' ? [] : text.split(',').map(Number));
      input = input.slice(end + 1);
      const r = table.reply(hold!, kill!);
      const field = (items: string[]) => items.length ? items.join(',') : '-';
      helper.stdout.write(`ok ${field([...r.rows].map(([a, b]) => `${a}:${b}`))} ${field([...r.held].map(([pid, s]) => `${pid}:${s.start}:${s.exit ?? ''}`))} ${field([...r.errors].map(([pid, e]) => `${pid}:${e}`))}\r\n`);
    }
  });
  return helper;
}

test('candidate backend: the helper transport speaks the line protocol with a fixed, hidden, shell-free PowerShell', async t => {
  const table = new Table(), root = rooted(table), calls: { args: readonly string[]; options: childProcess.SpawnOptions }[] = [];
  table.add(101, ROOT);
  t.mock.method(childProcess, 'spawn', (binary: string, args: readonly string[], options: childProcess.SpawnOptions) => {
    assert.equal(binary, 'powershell.exe'); calls.push({ args, options }); return fakePowerShell(table);
  });
  t.after(() => t.mock.restoreAll());
  const deadline = performance.now() + 2000;
  assert.equal(await reapWindowsTree(root, () => deadline, { self: SELF }), 'confirmed');
  assert.ok(table.kills.includes(101));
  const call = calls[0]!;
  assert.equal(call.options.shell, false); assert.equal(call.options.detached, undefined); assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']); assert.equal(call.args.length, 4);
  const script = Buffer.from(call.args[3]!, 'base64').toString('utf16le');
  assert.match(script, /GetProcessById/); assert.doesNotMatch(script, /taskkill|Stop-Process|Invoke-Expression|UtcNow/i);
});

// Production: no path starts the helper. On Windows run() therefore kills only
// the child it spawned (descendants may linger); POSIX keeps its own owned
// process-group reap, which this test does not change.
test('production run() never starts the tree helper on timeout, overflow or completion', async t => {
  let helpers = 0;
  const original = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (binary: string, args: readonly string[], options: childProcess.SpawnOptions) => {
    if (/powershell/i.test(binary)) helpers++;
    return original(binary, args, options);
  });
  t.after(() => t.mock.restoreAll());
  const stopped = await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 300 });
  const flooded = await run(process.execPath, ['-e', 'process.stdout.write("x".repeat(65536)); setInterval(() => {}, 1000)'], { timeout: 4000, limit: 1024 });
  const ok = await run(process.execPath, ['-e', 'process.stdout.write("ok")'], { timeout: 4000 });
  assert.equal(stopped.stopReason, 'timeout'); assert.equal(flooded.stopReason, 'output_limit'); assert.equal(ok.stdout, 'ok');
  for (const done of [stopped, flooded, ok]) assert.equal('cleanup' in done, false);
  assert.equal(helpers, 0);
});

// Native Windows. Unrun on non-Windows hosts.
const native = { skip: process.platform !== 'win32' };
// A non-Node parent (powershell.exe) starts PING.EXE via CreateProcessW
// (Start-Process -NoNewWindow), which inherits and holds the output pipes, like
// ssh.exe starting a ProxyCommand. The grandchild has a short, explicit
// lifetime (-n 12, about 11 s). The test never kills it by PID: a bare PID may
// already belong to another process. It only waits for it to end on its own,
// and the parent is terminated only through its own ChildProcess handle.
const GRANDCHILD_SECONDS = 11;
test('native win32: production run() kills only the direct child; its CreateProcessW grandchild is left alone', native, async t => {
  const dir = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-wnative-')));
  const pids = join(dir, 'pids.json'), quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
  const script = `$g = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\PING.EXE') -ArgumentList '-n','${GRANDCHILD_SECONDS + 1}','127.0.0.1' -NoNewWindow -PassThru
[IO.File]::WriteAllText(${quote(pids)}, (ConvertTo-Json @{child=$PID; grandchild=$g.Id} -Compress))
Start-Sleep -Seconds 600`;
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // One cleanup path: observe the grandchild end on its own (observation only,
  // never a kill), then remove the directory. If it is still running, the
  // directory and PID file are kept as evidence and the test fails.
  t.after(async () => {
    if (!existsSync(pids)) { rmSync(dir, { recursive: true, force: true }); return; }
    const { grandchild } = JSON.parse(readFileSync(pids, 'utf8')) as { grandchild: number };
    for (let i = 0; i < (GRANDCHILD_SECONDS + 10) * 10 && alive(grandchild); i++) await timers.setTimeout(100);
    if (alive(grandchild)) throw new Error(`fixture grandchild ${grandchild} still running; evidence kept in ${dir}`);
    rmSync(dir, { recursive: true, force: true });
  });
  const started = performance.now();
  const done = await run('powershell.exe', args, { timeout: 8000 });
  assert.equal(done.stopReason, 'timeout'); assert.equal('cleanup' in done, false);
  assert.ok(performance.now() - started < 8800);
  assert.ok(existsSync(pids), 'the fixture recorded its PIDs');
  const { child, grandchild } = JSON.parse(readFileSync(pids, 'utf8')) as { child: number; grandchild: number };
  t.diagnostic(`fixture child ${child}, grandchild ${grandchild}`);
  for (let i = 0; i < 50 && alive(child); i++) await timers.setTimeout(50);
  assert.equal(alive(child), false, 'the direct child is terminated');
  assert.equal(alive(grandchild), true, 'production does not kill descendants');
});
// The known-unsound candidate backend is not run natively: its kills cannot be
// bounded to fixture identities on Windows, and an isolated host approval does
// not authorize terminating foreign processes. Its algorithm is covered only by
// the virtual-table cases above.
