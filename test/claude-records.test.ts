// Isolated local metadata only: no real Claude registry or inbox connections.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { claude } from '../dist/discovery.js';
import { sender } from '../dist/replies.js';

const limit = 1024 * 1024;
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-claude-records-'));
  const directory = join(root, 'sessions'); fs.mkdirSync(directory);
  const prior = { ...process.env };
  Object.assign(process.env, { HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: root, ANTHROPIC_CONFIG_DIR: '',
    CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', SESSION_PEER_TAILSCALE: 'off', SESSION_PEER_UPDATE_NOTICE: '' });
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior); fs.rmSync(root, { recursive: true, force: true });
  });
  const file = (name: string) => join(directory, name);
  const regular = (name = '1.json', record: unknown = { pid: 1, name: 'healthy' }) => fs.writeFileSync(file(name), JSON.stringify(record));
  function child(script?: string) {
    const args = script === undefined ? [resolve('dist/cli.js'), 'list', '--agent', 'claude', '--all', '--json'] :
      ['--input-type=module', '--eval', script];
    const result = spawnSync(process.execPath, args, { env: process.env, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  return { root, directory, file, regular, child };
}

test('regular Claude records retain all/mismatch behavior while malformed entries are skipped', t => {
  const f = fixture(t); f.regular();
  f.regular('2.json', { pid: 3, name: 'mismatch' });
  for (const [name, value] of [['4.json', []], ['5.json', null], ['6.json', { pid: '6' }], ['not-numeric.json', { pid: 7 }]] as const) f.regular(name, value);
  fs.writeFileSync(f.file('8.json'), '{invalid');
  fs.mkdirSync(f.file('9.json'));
  const all = claude(true) as any;
  assert.deepEqual(all.sessions.map((row: any) => [row.pid, row.name, row.staleReason]),
    [[1, 'healthy', process.platform === 'win32' ? 'process_unverified' : undefined], [3, 'mismatch', 'record_pid_mismatch']]);
  assert.deepEqual(claude(false).sessions, []);
  assert.equal(all.discovery.claude.status, 'ok');
});

test('1 MiB records are accepted and larger records are skipped before open', t => {
  const f = fixture(t), text = JSON.stringify({ pid: 1, name: 'boundary' });
  fs.writeFileSync(f.file('1.json'), text.padEnd(limit));
  fs.writeFileSync(f.file('2.json'), JSON.stringify({ pid: 2 }).padEnd(limit + 1));
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    assert.notEqual(args[0], f.file('2.json'), 'oversized metadata must be rejected before open');
    return open(...args);
  }); syncBuiltinESMExports();
  assert.deepEqual((claude(true).sessions as any[]).map(row => row.name), ['boundary']);
});

test('Claude metadata symlinks are skipped', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); f.regular();
  fs.symlinkSync(f.file('1.json'), f.file('2.json'));
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    assert.notEqual(args[0], f.file('2.json')); return open(...args);
  }); syncBuiltinESMExports();
  assert.equal((claude(true).sessions as any[]).length, 1);
});

test('FIFO without a writer cannot block CLI listing and healthy records survive', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); f.regular();
  const fifo = spawnSync('mkfifo', [f.file('2.json')], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(fifo.error); assert.equal(fifo.status, 0, fifo.stderr);
  const result = f.child();
  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions.map((row: any) => row.name), ['healthy']);
});

test('abnormal registry files retain a reachable fixture for list, dry-run and sender discovery', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), socket = join(f.root, 's');
  let connections = 0;
  const server = createServer(connection => { connections++; connection.destroy(); });
  server.listen(socket); await once(server, 'listening');
  t.after(() => new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())));
  f.regular(`${process.pid}.json`, { pid: process.pid, name: 'healthy-fixture', messagingSocketPath: socket });
  const fifo = spawnSync('mkfifo', [f.file('2.json')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(fifo.status, 0, fifo.stderr);
  fs.writeFileSync(f.file('3.json'), ' '.repeat(limit + 1));
  assert.deepEqual((claude(false).sessions as any[]).map(row => row.pid), [process.pid]);
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = socket;
  assert.deepEqual(sender(), { agent: 'claude', id: 'healthy-fixture' });
  const result = spawnSync(process.execPath, [resolve('dist/cli.js'), 'send', '--to', String(process.pid),
    '--message', 'fixture', '--dry-run', '--no-from', '--no-reply-to', '--json'],
  { env: process.env, encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.status, 'validated'); assert.equal(value.submitted, false);
  assert.equal(value.target.pid, process.pid);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(connections, 0);
});

test('FIFO replacement between lstat and open cannot block descriptor validation', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); f.regular(); f.regular('2.json', { pid: 2 });
  const result = f.child(`
    import fs from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { claude } from ${JSON.stringify(pathToFileURL(resolve('dist/discovery.js')).href)};
    const target = ${JSON.stringify(f.file('2.json'))}, open = fs.openSync;
    let safe = false;
    fs.openSync = (...args) => {
      if (args[0] === target) {
        safe = Boolean((args[1] & fs.constants.O_NONBLOCK) && (args[1] & fs.constants.O_NOFOLLOW));
        fs.unlinkSync(target);
        const fifo = spawnSync('mkfifo', [target], { encoding: 'utf8', timeout: 1000 });
        if (fifo.status !== 0) throw Error(fifo.stderr);
      }
      return open(...args);
    };
    syncBuiltinESMExports();
    const result = claude(true);
    if (!safe) throw Error('unsafe open flags');
    console.log(JSON.stringify(result));
  `);
  assert.deepEqual(result.sessions.map((row: any) => row.name), ['healthy']);
});

test('replacement by a different regular inode is skipped and opened descriptors close', t => {
  const f = fixture(t); f.regular();
  fs.writeFileSync(f.file('replacement'), JSON.stringify({ pid: 1, name: 'replacement' }));
  const open = fs.openSync, close = fs.closeSync;
  const opened: number[] = [], closed: number[] = [];
  t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    fs.renameSync(f.file('replacement'), f.file('1.json'));
    const fd = open(...args); opened.push(fd); return fd;
  });
  t.mock.method(fs, 'closeSync', (fd: number) => { closed.push(fd); return close(fd); }); syncBuiltinESMExports();
  assert.deepEqual(claude(true).sessions, []);
  assert.equal(opened.length, 1); assert.deepEqual(closed, opened);
});

test('growth after fstat reads at most 1 MiB plus one byte and closes the descriptor', t => {
  const f = fixture(t); f.regular();
  const read = fs.readSync, close = fs.closeSync;
  let bytesRead = 0, closes = 0, grew = false;
  t.mock.method(fs, 'readSync', (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
    if (!grew) {
      grew = true; fs.writeFileSync(f.file('1.json'), JSON.stringify({ pid: 1 }).padEnd(limit * 2));
    }
    assert.ok(bytesRead + length <= limit + 1, 'the total requested bytes must remain bounded');
    // Exercise multiple partial reads rather than relying on a single syscall.
    const count = read(fd, buffer, offset, Math.min(length, 65536), position); bytesRead += count; return count;
  });
  t.mock.method(fs, 'closeSync', (fd: number) => { closes++; return close(fd); }); syncBuiltinESMExports();
  assert.deepEqual(claude(true).sessions, []);
  assert.equal(bytesRead, limit + 1); assert.equal(closes, 1);
});

test('parse and read failures skip metadata and close each descriptor', t => {
  const f = fixture(t); fs.writeFileSync(f.file('1.json'), '{invalid'); f.regular('2.json', { pid: 2 }); f.regular('3.json', { pid: 3 });
  const open = fs.openSync, read = fs.readSync, close = fs.closeSync;
  let failFd = -1;
  const opened: number[] = [], closed: number[] = [];
  t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    const fd = open(...args); opened.push(fd); if (args[0] === f.file('2.json')) failFd = fd; else failFd = -1; return fd;
  });
  t.mock.method(fs, 'readSync', (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
    if (fd === failFd) throw Object.assign(new Error('fixture denied'), { code: 'EACCES' });
    return read(fd, buffer, offset, length, position);
  });
  t.mock.method(fs, 'closeSync', (fd: number) => { closed.push(fd); return close(fd); }); syncBuiltinESMExports();
  assert.deepEqual((claude(true).sessions as any[]).map(row => row.pid), [3]);
  assert.equal(opened.length, 3); assert.deepEqual(closed, opened);
});
