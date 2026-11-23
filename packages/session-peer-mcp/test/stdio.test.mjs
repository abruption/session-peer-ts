import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runWorker } from '../worker.mjs';

const local = { transport: 'local', id: 'local' };

function fixture(t) {
  const dir = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-mcp-test-'));
  const cli = join(dir, 'mock-cli.mjs'), effects = join(dir, 'effects.jsonl');
  writeFileSync(cli, `
    import { appendFileSync } from 'node:fs';
    const [command, ...args] = process.argv.slice(2);
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    appendFileSync(${JSON.stringify(effects)}, JSON.stringify({command,args,input}) + '\\n');
    if (input === 'hold') {
      process.on('message', message => {
        if (message === 'session-peer:cancel') {
          appendFileSync(${JSON.stringify(effects)}, '{"cancelled":true}\\n');
          process.exit(130);
        }
      });
      setInterval(() => {}, 5000);
    } else {
      const data = command === 'list' ?
        (args.includes('--agent=codex') ?
          {ok:false,sessions:[],discovery:{codex:{status:'error',error:'fixture_failure'}}} :
          {ok:true,sessions:[{agent:'claude',id:'1'}],discovery:{claude:{status:'ok'}}}) :
        {ok:true,status:'posted',submitted:true,consumptionConfirmed:false};
      console.log(JSON.stringify({schemaVersion:1,command,...data}));
      process.exitCode = data.ok ? 0 : 1;
      process.disconnect?.();
    }
  `);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, cli, effects };
}

test('real stdio handshake exposes policy-scoped tools and preserves partial discovery and single submission', async t => {
  const f = fixture(t);
  const server = new URL('../server.mjs', import.meta.url).href;
  const policy = new URL('../policy.mjs', import.meta.url).href;
  const entry = join(f.dir, 'fixture-server.mjs');
  const localHome = join(f.dir, 'codex');
  const rawPolicy = JSON.stringify({ schemaVersion: 1, destinations: [
    { ...local, agents: ['claude', 'codex'], capabilities: ['list'], codexHome: localHome },
    { ...local, id: 'send-claude', agents: ['claude'], capabilities: ['send'] },
  ] });
  writeFileSync(entry, `
    import { startServer } from ${JSON.stringify(server)};
    import { parsePolicy } from ${JSON.stringify(policy)};
    const reply = () => { throw Error('fixture'); };
    const policy = parsePolicy(${JSON.stringify(rawPolicy)}, reply);
    await startServer({cli:${JSON.stringify(f.cli)},policy,reply,version:'0.7.0'});
  `);
  const client = new Client({ name: 'fixture', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
  t.after(() => client.close());
  await client.connect(transport);
  const exposed = await client.listTools();
  assert.deepEqual(exposed.tools.map(tool => tool.name), ['list_sessions', 'send_message']);
  assert.equal(exposed.tools[1].annotations.idempotentHint, false);
  const blocked = await client.callTool({ name: 'send_message', arguments: { target: 'claude:1', message: 'denied' } });
  assert.equal(blocked.structuredContent.error, 'operation_not_allowed');
  const partial = await client.callTool({ name: 'list_sessions' });
  assert.equal(partial.isError, true);
  assert.deepEqual(partial.structuredContent.sessions, [{ agent: 'claude', id: '1' }]);
  assert.equal(partial.structuredContent.discovery.codex.status, 'error');
  const sent = await client.callTool({ name: 'send_message',
    arguments: { destination: 'send-claude', target: 'claude:1', message: '--literal body' } });
  assert.equal(sent.structuredContent.status, 'posted');
  assert.equal(sent.structuredContent.consumptionConfirmed, false);
  const effects = readFileSync(f.effects, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(effects.map(e => e.command), ['list', 'list', 'send']);
  assert.equal(effects[2].input, '--literal body');
  assert.ok(!effects[2].args.some(a => a.includes('literal body')));
  assert.ok(effects[2].args.includes('--no-from') && effects[2].args.includes('--no-reply-to'));
});

test('a launched effectful worker times out as unknown and receives cooperative cancellation', async t => {
  const f = fixture(t);
  const outcome = await runWorker({ cli: f.cli, timeoutMs: 1000, operation: {
    command: 'send', agent: 'claude', route: local, to: 'claude:1', message: 'hold', dryRun: false,
  } });
  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.submitted, null);
  assert.equal(outcome.retryAllowed, false);
  const lines = readFileSync(f.effects, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines[0].command, 'send');
  assert.deepEqual(lines.slice(1), [{ cancelled: true }]);
});

test('the real core worker refuses a truncated stdin body before selecting a target', async t => {
  const f = fixture(t);
  const cli = fileURLToPath(new URL('../../../dist/cli.js', import.meta.url));
  const child = spawn(process.execPath, [cli, 'send', '--json', '--no-from',
    '--no-reply-to', '--no-update-notice', '--to=claude:fixture'],
  { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: { ...process.env,
    CLAUDE_CONFIG_DIR: join(f.dir, 'claude'), SESSION_PEER_MCP_WORKER: '1',
    SESSION_PEER_MCP_BODY_BYTES: '32' } });
  const output = [];
  child.stdout.on('data', bytes => output.push(bytes));
  child.stderr.resume();
  const closed = once(child, 'close');
  child.stdin.end('partial');
  const [code] = await closed;
  const outcome = JSON.parse(Buffer.concat(output).toString('utf8'));
  assert.equal(code, 2);
  assert.equal(outcome.error, 'worker_input_incomplete');
  assert.equal(outcome.submitted, false);
});
