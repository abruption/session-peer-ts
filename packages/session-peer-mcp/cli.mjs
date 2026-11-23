#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPolicy } from './policy.mjs';
import { startServer } from './server.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: session-peer-mcp [--policy /absolute/path/policy.json]');
  } else {
    if (args.length !== 0 && !(args.length === 2 && args[0] === '--policy')) throw new Error();
    const metadata = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
    const core = new URL(import.meta.resolve('session-peer'));
    const { VERSION, reply } = await import(core.href);
    if (VERSION !== metadata.peerDependencies['session-peer']) throw new Error();
    const policy = readPolicy(args[1], reply);
    const server = await startServer({ cli: fileURLToPath(new URL('cli.js', core)), policy, reply, version: metadata.version });
    const stop = () => { void server.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }
} catch {
  console.error('session-peer-mcp: startup refused; check the core version and policy.');
  process.exitCode = 2;
}
