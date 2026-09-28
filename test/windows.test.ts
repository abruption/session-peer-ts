import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claude } from '../dist/discovery.js';
import { send } from '../dist/send.js';
import { probeLock } from '../dist/writer.js';

test('Windows native inbox authenticates and sends one message without exposing its key',
  { skip: process.platform !== 'win32' }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-peer-ts-win-'));
    const sessions = join(root, 'sessions');
    mkdirSync(sessions);
    const prior = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = root;
    const name = `fixture-${process.pid}`;
    const pipe = `\\\\.\\pipe\\session-peer-ts-${process.pid}-${Date.now()}`;
    const secret = 'fixture-auth-secret';
    const record = { pid: process.pid, startedAt: Date.now(), name, messagingSocketPath: pipe };
    writeFileSync(join(sessions, `${process.pid}.json`), JSON.stringify(record));
    writeFileSync(join(sessions, `${process.pid}.fixture.key`), JSON.stringify({ peerToken:secret }));
    const received: string[] = [];
    let resolveReceived: (() => void) | undefined;
    const server = createServer(socket => {
      let buffer = '';
      socket.on('data', part => {
        buffer += part.toString('utf8');
        if (buffer.split('\n').length >= 3) {
          received.push(buffer);
          resolveReceived?.();
          socket.end();
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipe, resolve);
      });
      const found = claude(false).sessions;
      assert.ok(Array.isArray(found));
      assert.equal(found.length, 1);
      assert.equal(found[0].reachable, true);
      const dry = await send({ to:`claude:${name}`, message:'fixture', dryRun:true });
      assert.equal(dry.submitted, false);
      const sent = await send({ to:`claude:${name}`, message:'fixture' });
      assert.equal(sent.status, 'posted');
      assert.equal(sent.consumptionConfirmed, false);
      if (received.length === 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('fixture inbox did not receive message')), 5000);
          resolveReceived = () => { clearTimeout(timer); resolve(); };
        });
      }
      assert.equal(received.length, 1);
      const lines = received[0]!.trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(lines[0], { type:'auth', token:secret });
      assert.deepEqual(lines[1], { type:'user', message:{ role:'user', content:'fixture' } });
      assert.equal(JSON.stringify(sent).includes(secret), false);
      writeFileSync(join(sessions, `${process.pid}.json`), JSON.stringify({ ...record, startedAt:1 }));
      const stale = claude(true).sessions;
      assert.ok(Array.isArray(stale));
      assert.equal(stale[0].reachable, false);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prior;
      rmSync(root, { recursive:true, force:true });
    }
  });

test('Windows native lock probe reports an unlocked fixture as free',
  { skip: process.platform !== 'win32' }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-peer-ts-lock-'));
    const path = join(root, 'writer.lock');
    try {
      writeFileSync(path, '');
      assert.equal(await probeLock(path), 'free');
    } finally { rmSync(root, { recursive:true, force:true }); }
  });

test('Windows codex.cmd shims are reported unsupported and never spawned',
  { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-win-shim-'));
  const previous = process.env.PATH;
  try {
    writeFileSync(join(root, 'codex.cmd'), '@echo off\r\necho SHOULD-NOT-RUN>"%~dp0ran.txt"\r\n');
    writeFileSync(join(root, 'codex'), '#!/bin/sh\n'); // npm also installs an extensionless POSIX launcher
    process.env.PATH = root;
    const { diagnoseCodex } = await import('../dist/diagnostics.js');
    const diagnosed = await diagnoseCodex(join(root, 'home')) as { tool: { status: string; code: string; executed: boolean } };
    assert.equal(diagnosed.tool.status, 'unsupported'); assert.equal(diagnosed.tool.code, 'executable_unsupported');
    assert.equal(diagnosed.tool.executed, false);
    await assert.rejects(send({ to: 'codex:00000000-0000-4000-8000-000000000001', home: join(root, 'home'), message: 'x' }),
      (error: { code?: string }) => error.code === 'executable_unsupported');
  } finally {
    process.env.PATH = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
