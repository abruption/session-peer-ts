import assert from 'node:assert/strict';
import test from 'node:test';
import { reply } from '../dist/index.js';
// Optional package policy is plain Node ESM and carries no SDK dependency.
const { authorizeList, authorizeSend, parsePolicy, readPolicy } =
  await import(new URL('../packages/session-peer-mcp/policy.mjs', import.meta.url).href);

const codexId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function uri(agent: string, session: string, options: Record<string, string> = {}) {
  return 'session-peer://v1/reply?' + new URLSearchParams({ agent, session, transport: 'ssh', ...options });
}

test('default policy only lists local Claude and a selected missing policy fails closed', () => {
  const policy = readPolicy(undefined, reply);
  assert.deepEqual(authorizeList(policy).agents, ['claude']);
  assert.throws(() => authorizeList(policy, { agent: 'codex' }), /operation_not_allowed/);
  assert.throws(() => authorizeSend(policy, { target: 'claude:1' }, reply), /operation_not_allowed/);
  assert.throws(() => readPolicy('non-absolute-missing-policy.json', reply), /invalid_policy/);
});

test('policy requires an exact explicit Codex home and rejects duplicate JSON grants', () => {
  const base = { id: 'worker', transport: 'ssh', host: 'user@worker', remotePlatform: 'posix',
    agents: ['codex'], capabilities: ['send'], codexHome: '/fixture/.codex' };
  const policy = parsePolicy(JSON.stringify({ schemaVersion: 1, destinations: [base] }), reply);
  const valid = uri('codex', codexId, { host: base.host, codexHome: base.codexHome });
  assert.equal(authorizeSend(policy, { destination: 'worker', target: valid }, reply).to, 'codex:' + codexId);
  for (const target of [
    uri('codex', codexId, { host: base.host }),
    uri('codex', codexId, { host: 'worker', codexHome: base.codexHome }),
    uri('codex', codexId, { host: base.host, codexHome: base.codexHome + '/' }),
    uri('codex', codexId, { transport: 'local', codexHome: base.codexHome }),
    'claude:1',
  ]) assert.throws(() => authorizeSend(policy, { destination: 'worker', target }, reply), /operation_not_allowed/);
  assert.throws(() => authorizeList(policy, { destination: 'worker' }), /operation_not_allowed/);
  assert.throws(() => parsePolicy(JSON.stringify({ schemaVersion: 1, destinations: [{ ...base, codexHome: 'relative' }] }), reply), /invalid_policy/);
  assert.throws(() => parsePolicy('{"schemaVersion":1,"destinations":[],"\\u0064estinations":[]}', reply), /invalid_policy/);
});
