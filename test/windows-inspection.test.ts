import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { type SpawnSyncReturns } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { COMPILED_INSPECTION_TIMEOUT_MS, inspectWindows, START_PROBE_TIMEOUT_MS, windowsProcessStart } from '../dist/windows.js';
import { claude } from '../dist/discovery.js';
import { diagnoseClaude } from '../dist/diagnostics.js';

function windows(t: TestContext) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', platform);
  });
}
function result(stdout: string, fields: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> {
  return { pid: 99, status: 0, signal: null, output: [], stdout, stderr: 'private-native-output', ...fields };
}

test('Windows creation time retains FILETIME precision and rejects unverified native results', t => {
  windows(t);
  const ticks = 133000000000001237n;
  let done = result(`${ticks}\r\n`), calls = 0;
  t.mock.method(childProcess, 'spawnSync', () => { calls++; return done; });
  syncBuiltinESMExports();
  assert.equal(windowsProcessStart(123), ticks);
  for (const stdout of ['', '0', '-1', '1\n2', '{}', '9223372036854775808', 'private-native-output']) {
    done = result(stdout); assert.equal(windowsProcessStart(123), undefined);
  }
  for (const fields of [
    { status: 1 }, { status: null, signal: 'SIGTERM' as const },
    { error: Object.assign(new Error('private-timeout'), { code: 'ETIMEDOUT' }) },
    { error: Object.assign(new Error('private-spawn-error'), { code: 'ENOENT' }) },
  ]) {
    done = result(String(ticks), fields); assert.equal(windowsProcessStart(123), undefined);
  }
  const before = calls;
  for (const pid of [0, 1, -1, 1.5, NaN, Infinity, 2147483648]) assert.equal(windowsProcessStart(pid), undefined);
  assert.equal(calls, before, 'invalid PIDs must not invoke a native process');
  t.mock.method(childProcess, 'spawnSync', () => { throw new Error('private-native-exception'); });
  syncBuiltinESMExports();
  assert.equal(windowsProcessStart(123), undefined);
});

test('Windows discovery samples each PID once; stale and failed probes cannot authorize an inbox', t => {
  windows(t);
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-windows-probe-'));
  const directory = join(root, 'sessions'); mkdirSync(directory);
  const saved = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = root;
  t.after(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rmSync(root, { recursive: true, force: true });
  });
  const startedAt = Date.now();
  const record = { pid: 123, startedAt, name: 'fixture', messagingSocketPath: '\\\\.\\pipe\\fixture' };
  writeFileSync(join(directory, '123.json'), JSON.stringify(record));
  const ticks = 116444736000000000n + BigInt(startedAt - 1000) * 10000n + 1237n;
  let done = result(String(ticks)), calls = 0;
  t.mock.method(childProcess, 'spawnSync', () => { calls++; return done; });
  syncBuiltinESMExports();
  assert.equal((claude(false).sessions as Record<string, unknown>[]).length, 1);
  assert.equal(calls, 1, 'a live PID must use one native sample, not two');
  done = result(String(ticks), { error: Object.assign(new Error('private-timeout'), { code: 'ETIMEDOUT' }) });
  assert.equal((claude(false).sessions as unknown[]).length, 0);
  const all = claude(true).sessions as Record<string, unknown>[];
  assert.equal(all[0]!.reachable, false); assert.equal(all[0]!.staleReason, 'process_unverified');
  const diagnostic = diagnoseClaude();
  assert.equal(diagnostic.ready, false); assert.equal(diagnostic.unknownInspections, 1);
  assert.equal(JSON.stringify(diagnostic).includes('private-timeout'), false);
  done = result(String(ticks));
  writeFileSync(join(directory, '123.json'), JSON.stringify({ ...record, startedAt: 1 }));
  assert.equal((claude(false).sessions as unknown[]).length, 0);
  assert.equal(diagnoseClaude().ready, false);
});

test('compiling owner inspection gets a cold-start deadline and still fails closed', t => {
  windows(t);
  const row = { pid: 123, uid: 'S-1-5-21-1', command: 'codex.exe', start: '133000000000001237' };
  let done = result(JSON.stringify([row]));
  const timeouts: (number | undefined)[] = [];
  t.mock.method(childProcess, 'spawnSync', (_file: string, _args: string[], options: { timeout?: number }) => { timeouts.push(options.timeout); return done; });
  syncBuiltinESMExports();
  assert.deepEqual(inspectWindows('identity', '123'), [row]);
  windowsProcessStart(123);
  assert.deepEqual(timeouts, [COMPILED_INSPECTION_TIMEOUT_MS, START_PROBE_TIMEOUT_MS]);
  assert.equal(COMPILED_INSPECTION_TIMEOUT_MS, 20000); assert.equal(START_PROBE_TIMEOUT_MS, 15000);
  for (const fields of [
    { status: null, signal: 'SIGTERM' as const, error: Object.assign(new Error('private-timeout'), { code: 'ETIMEDOUT' }) },
    { status: 1 }, { stdout: 'private-native-output' }, { stdout: JSON.stringify([{ ...row, uid: 'x' }]) },
  ]) {
    done = result(JSON.stringify([row]), fields);
    assert.throws(() => inspectWindows('openers', 'C:\\lock'), /windows_owner_inspection_failed/);
  }
});
