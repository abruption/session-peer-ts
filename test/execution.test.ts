import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { executeLocal } from '../dist/execution.js';

test('the internal execution import runs no CLI command and installs no signal listener', () => {
  const url = new URL('../dist/execution.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    process.argv.push('--version');
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const listeners = signals.map(name => process.listenerCount(name));
    await import(${JSON.stringify(url)});
    assert.deepEqual(signals.map(name => process.listenerCount(name)), listeners);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
});

test('local dispatch forwards typed requests once and retains partial or unknown evidence', async () => {
  const calls: unknown[][] = [];
  const partial = {
    ok: false, sessions: [{ name: 'available' }], error: 'Discovery failed for: codex',
    discovery: { codex: { status: 'error', error: 'discovery_failed' } },
  };
  const unknown = { ok: false, submitted: null, status: 'unknown', consumptionConfirmed: false, retryAllowed: false };
  const adapters = {
    list: async (...args: unknown[]) => { calls.push(args); return partial; },
    doctor: () => assert.fail('unexpected doctor request'),
    send: async (...args: unknown[]) => { calls.push(args); return unknown; },
  };
  const settings = { to: 'claude:123', message: 'fixture', dryRun: false };
  assert.equal(await executeLocal({ command: 'list', all: false }, adapters), partial);
  assert.equal(await executeLocal({ command: 'send', settings }, adapters), unknown);
  assert.deepEqual(calls, [[undefined, undefined, false], [settings]]);
});
