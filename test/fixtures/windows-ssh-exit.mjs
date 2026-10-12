// Synthetic native result fixture. No agent process, writer, queue or session is touched.
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
let mode = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') {
  appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ flag: '--version', argvCount: args.length }) + '\n');
  console.log(mode.preflightBanner);
  process.exit(mode.preflightExit ?? 0);
}
if (args[0] !== '--stdio-request' || args.length !== 1) throw new Error('unexpected_fixture_argv');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 65536) throw new Error('fixture_input_overflow');
}
const request = JSON.parse(input);
if (request.schemaVersion !== 1 || !Array.isArray(request.args)) throw new Error('fixture_frame');
if (mode.requestModes) {
  const previous = readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).filter(call => call.flag === '--stdio-request').length;
  const selected = mode.requestModes[previous];
  if (!selected) throw new Error('fixture_request_count');
  mode = { ...mode, ...selected };
}
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ flag: '--stdio-request', argvCount: args.length,
  command: request.args[0], hasStdinMessage: request.args.some(a => a.startsWith('--message=')) }) + '\n');
const to = request.args[request.args.indexOf('--to') + 1];
const codex = to?.startsWith('codex:');
const result = mode.resultKind === 'success' ? {
  schemaVersion: 1, host: 'windows-fixture', command: 'send', ok: true,
  status: codex ? 'queued' : 'posted', submitted: true, consumptionConfirmed: false,
  target: codex ? { agent: 'codex', id: to.slice(6) } : { pid: Number(to), name: null },
  ...(codex ? { queueId: 'fixture-only-queue-id', codexHome: request.args[request.args.indexOf('--codex-home') + 1] } : {}),
} : {
  schemaVersion: 1, host: 'windows-fixture', command: 'send', ok: false,
  error: 'fixture_refusal', status: 'refused', submitted: false, consumptionConfirmed: false, retryAllowed: false,
};
if (mode.resultKind === 'malformed') process.stdout.write('{"schemaVersion":1,\n');
else if (mode.resultKind !== 'missing') process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = mode.nativeExit;
