import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkMessage } from '../dist/send.js';
import { envelope } from '../dist/protocol.js';

test('message budget counts code points, UTF-8 bytes and explicit envelope overhead', () => {
  assert.doesNotThrow(() => checkMessage('🚀'.repeat(1_000_000)));
  assert.throws(() => checkMessage('🚀'.repeat(1_000_001)), /invalid_message/);
  const body = '🚀'.repeat(8192);
  assert.equal(Buffer.byteLength(body), 32768);
  assert.doesNotThrow(() => checkMessage(body, true));
  assert.throws(() => checkMessage(body + 'x', true), /invalid_message/);
  const withReply = envelope(body, true, 'session-peer://v1/reply?agent=claude&session=fixture&transport=local');
  assert.throws(() => checkMessage(withReply, true), /invalid_message/);
  for (const invalid of ['', ' \n', 'a\0b']) assert.throws(() => checkMessage(invalid), /invalid_message/);
});

test('remote stdin limit includes JSON escaping and rejects before dispatch', () => {
  const wire = (message: string) => JSON.stringify({ schemaVersion: 1,
    args: ['send', '--to', 'codex:invalid', '--message', message, '--no-from', '--json'] });
  const budget = 4_100_000 - Buffer.byteLength(wire(''));
  const input = wire('\u0001'.repeat(Math.floor(budget / 6)) + 'x'.repeat(budget % 6));
  assert.equal(Buffer.byteLength(input), 4_100_000);
  function invoke(stdin: string | Buffer) {
    const child = spawnSync(process.execPath, [resolve('dist/cli.js'), '--stdio-request'], {
      input: stdin, encoding: 'utf8', timeout: 15000, maxBuffer: 65536
    });
    assert.equal(child.signal, null, String(child.error));
    assert.equal(child.status, 2, child.stderr);
    const value = JSON.parse(child.stdout);
    assert.equal(value.submitted, false);
    return value.error;
  }
  // At the byte boundary, decoding succeeds and the later Codex size guard
  // refuses before home/process discovery. One extra byte fails wire decoding.
  assert.equal(invoke(input), 'invalid_message');
  assert.equal(invoke(input + ' '), 'invalid_remote_request');
  assert.equal(invoke(Buffer.from([0xff])), 'invalid_remote_request');
});
