import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, VERSION_LINE, reply, envelope } from '../dist/index.js';

test('typed root exposes pure helpers without CLI side effects', () => {
  const destination: {to: string; host?: string; home?: string} =
    reply('session-peer://v1/reply?agent=claude&session=fixture&transport=local');
  assert.deepEqual(destination, {to: 'fixture'});
  const message: string = envelope('hello', true);
  assert.equal(message, 'hello');
  assert.equal(VERSION_LINE, `session-peer ${VERSION} (typescript)`);
});
