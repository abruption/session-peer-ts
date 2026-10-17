#!/usr/bin/env node
'use strict';
// Runtime fixture configuration is JSON data next to this copied executable.
const fs = require('node:fs'), path = require('node:path');
const config = JSON.parse(fs.readFileSync(__filename + '.json', 'utf8'));
fs.appendFileSync(config.nativeLog, JSON.stringify({ command: process.argv[2] ?? null }) + '\n');
if (process.argv[2] === '--version') {
  console.log('codex-cli ' + config.version);
  process.exit(0);
}
if (process.argv[2] === 'queue') {
  fs.appendFileSync(config.queueLog, JSON.stringify({ method: 'legacy' }) + '\n');
  console.log('Queued message legacy-1 for thread ' + process.argv[4] + '.');
  process.exit(0);
}
const { DatabaseSync } = require('node:sqlite');
globalThis.keptDatabases = [
  new DatabaseSync(path.join(process.env.CODEX_HOME, 'state_5.sqlite'), { readOnly: true }),
  new DatabaseSync(path.join(process.env.CODEX_SQLITE_HOME, 'queue_1.sqlite')),
];
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    console.log(JSON.stringify({ id: request.id, result: {
      codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'macos', userAgent: 'session-peer-native-queue/' + config.version + ' (fixture)',
    } }));
  } else if (request.method === 'thread/queue/add') {
    fs.appendFileSync(config.queueLog, JSON.stringify({ method: request.method,
      clientId: request.params.clientUserMessageId, threadId: request.params.threadId,
      codexHome: process.env.CODEX_HOME }) + '\n');
    if (config.mode === 'loss') { process.exit(0); return; }
    if (config.mode === 'inject') {
      const db = new DatabaseSync(path.join(process.env.CODEX_HOME, 'thread_history_1.sqlite'));
      db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?)').run(request.params.threadId,
        'ssh-turn-fixture', 'native-item-not-client-id', 1, JSON.stringify({ type: 'userMessage',
          id: 'native-item-not-client-id', clientId: request.params.clientUserMessageId,
          content: [{ text: 'PRIVATE_SSH_CODEX_BODY_SENTINEL' }] }), 'userMessage');
      db.close();
    }
    console.log(JSON.stringify({ id: request.id, result: { queuedSubmission: {
      id: 'ssh-queue-fixture', clientUserMessageId: request.params.clientUserMessageId, input: request.params.input,
    } } }));
  }
});
