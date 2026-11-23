import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '../packages/session-peer-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../packages/session-peer-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-mcp-package-'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'invoke through npm run test:mcp');
const optional = resolve('packages/session-peer-mcp');
const npmEnv = { ...process.env, npm_config_cache: join(root, 'npm-cache'),
  npm_config_userconfig: join(root, 'empty-npmrc') };
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], {
  cwd, env: npmEnv, encoding: 'utf8', timeout: 120000,
});
const pack = (cwd, destination) => {
  const [metadata] = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', destination], cwd));
  return { archive: join(destination, metadata.filename), files: metadata.files.map(({ path }) => path).sort() };
};
try {
  const core = pack(process.cwd(), root);
  assert.ok(core.files.every(path => !path.startsWith('packages/') && !path.startsWith('plugins/')));
  const mcp = pack(optional, root);
  assert.deepEqual(mcp.files, ['LICENSE', 'README.md', 'cli.mjs', 'package.json', 'policy.mjs', 'server.mjs', 'worker.mjs']);
  const mcpMeta = JSON.parse(readFileSync(join(optional, 'package.json'), 'utf8'));
  const peer = mcpMeta.peerDependencies['session-peer'];
  const unpack = join(root, 'unpack'), rewritten = join(root, 'fixture'), prefix = join(root, 'install');
  const home = join(root, 'home');
  for (const dir of [unpack, rewritten, prefix, home]) mkdirSync(dir);
  // The matching core peer may not yet exist in the registry. Patch only a
  // throwaway core copy's version metadata to exercise the paired install.
  execFileSync('tar', ['-xzf', core.archive, '-C', unpack], { timeout: 10000 });
  const pkg = join(unpack, 'package'), metaFile = join(pkg, 'package.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const protocol = join(pkg, 'dist/protocol.js');
  const old = readFileSync(protocol, 'utf8');
  const versionLine = `export const VERSION = '${meta.version}';`;
  assert.ok(old.includes(versionLine));
  writeFileSync(protocol, old.replace(versionLine, `export const VERSION = '${peer}';`));
  writeFileSync(metaFile, JSON.stringify({ ...meta, version: peer }));
  const fixtureCore = pack(pkg, rewritten);
  runNpm(['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', 'https://registry.npmjs.org/', fixtureCore.archive, mcp.archive], root);
  const bin = join(prefix, 'node_modules/session-peer-mcp/cli.mjs');
  const client = new Client({ name: 'package-fixture', version: '1.0.0' });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'), SESSION_PEER_TAILSCALE: 'off', SESSION_PEER_UPDATE_NOTICE: '' };
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin], env });
  try {
    await client.connect(transport);
    const list = await client.callTool({ name: 'list_sessions' });
    assert.deepEqual(list.structuredContent.sessions, []);
    const send = await client.callTool({ name: 'send_message', arguments: { target: 'claude:1', message: 'fixture' } });
    assert.equal(send.structuredContent.error, 'operation_not_allowed');
  } finally { await client.close(); }
  const relay = createServer(socket => { socket.destroy(); });
  let connections = 0;
  relay.on('connection', () => { connections++; });
  const inbox = process.platform === 'win32' ? '\\\\.\\pipe\\session-peer-mcp-fixture-' + process.pid : join(root, 's');
  relay.listen(inbox);
  await once(relay, 'listening');
  try {
    const sessions = join(home, '.claude/sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, process.pid + '.json'),
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), name: 'fixture', messagingSocketPath: inbox }));
    const policy = join(root, 'test-policy.json');
    writeFileSync(policy, JSON.stringify({ schemaVersion: 1, destinations: [{
      id: 'local', transport: 'local', agents: ['claude'], capabilities: ['send'],
    }] }), { mode: 0o600 });
    const fixture = new Client({ name: 'dry-run-fixture', version: '1.0.0' });
    const channel = new StdioClientTransport({ command: process.execPath, args: [bin, '--policy', policy], env });
    try {
      await fixture.connect(channel);
      const check = await fixture.callTool({ name: 'send_message',
        arguments: { target: 'claude:' + process.pid, message: 'fixture', dryRun: true } });
      assert.equal(check.structuredContent.status, 'validated', JSON.stringify(check.structuredContent));
      assert.equal(check.structuredContent.submitted, false);
      assert.equal(connections, 0);
    } finally { await fixture.close(); }
  } finally { await new Promise(resolve => relay.close(resolve)); }
  runNpm(['uninstall', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', 'session-peer-mcp', 'session-peer'], root);
  console.log('Optional package smoke passed: isolated paired install, stdio list/refusal/real dry-run, uninstall.');
} finally { rmSync(root, { recursive: true, force: true }); }
