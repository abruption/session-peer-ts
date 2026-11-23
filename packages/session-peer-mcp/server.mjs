import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { authorizeList, authorizeSend, PolicyError } from './policy.mjs';
import { DEFAULT_TIMEOUT_MS, runWorker } from './worker.mjs';

const MAX_FRAME = 128 * 1024;
const MAX_TEXT = 64 * 1024;
const MAX_RESULT = 512 * 1024;
const MAX_ACTIVE = 2;
const destination = { type: 'string', maxLength: 48 };
const agent = { type: 'string', enum: ['claude', 'codex'] };

const tools = [
  {
    name: 'list_sessions',
    description: 'List sessions for an operator-authorized destination and agent.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: { destination, agent, all: { type: 'boolean' } } },
  },
  {
    name: 'send_message',
    description: 'Submit one message to an operator-authorized destination and target. Submission is not confirmation of receipt.',
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: { type: 'object', additionalProperties: false, required: ['target', 'message'],
      properties: { destination, target: { type: 'string', minLength: 1, maxLength: 4096 },
        message: { type: 'string', minLength: 1, maxLength: MAX_TEXT }, dryRun: { type: 'boolean' } } },
  },
];

function validDestination(input) {
  return input.destination === undefined ||
    (typeof input.destination === 'string' && input.destination.length <= 48);
}

function validate(name, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !validDestination(input)) return false;
  const keys = Object.keys(input);
  if (name === 'list_sessions') return keys.every(key => ['destination', 'agent', 'all'].includes(key)) &&
    (input.agent === undefined || ['claude', 'codex'].includes(input.agent)) &&
    (input.all === undefined || typeof input.all === 'boolean');
  if (name === 'send_message') return keys.every(key => ['destination', 'target', 'message', 'dryRun'].includes(key)) &&
    typeof input.target === 'string' && input.target.length > 0 && input.target.length <= 4096 &&
    typeof input.message === 'string' && !!input.message.trim() && !input.message.includes('\0') &&
    Buffer.byteLength(input.message, 'utf8') <= MAX_TEXT &&
    (input.dryRun === undefined || typeof input.dryRun === 'boolean');
  return false;
}

function refused(error) {
  return { schemaVersion: 1, ok: false, status: 'refused', error, submitted: false,
    consumptionConfirmed: false, retryAllowed: false };
}

function result(value) {
  const text = JSON.stringify(value);
  return { isError: value.ok !== true, structuredContent: value, content: [{ type: 'text', text }] };
}

async function executeList(cli, decision, all, signal, run) {
  const { route, agents } = decision;
  if (agents.length === 1) return run({ cli, signal, operation: { route, agent: agents[0], command: 'list', all } });
  // Each agent has its own eligibility and Codex home. Keep a healthy agent's
  // results if the other lookup fails or cancellation stops remaining work.
  const outcome = { schemaVersion: 1, command: 'list', ok: true, sessions: [], discovery: {} };
  let completed = false;
  for (const agent of agents) {
    if (signal.aborted) {
      outcome.discovery[agent] = { status: 'error', error: 'cancelled' };
      outcome.ok = false;
      continue;
    }
    const item = await run({ cli, signal, operation: { route, agent, command: 'list', all } });
    if (Array.isArray(item.sessions)) outcome.sessions.push(...item.sessions);
    outcome.discovery[agent] = item.discovery?.[agent] ?? {
      status: 'error', error: item.error ?? 'discovery_failed',
    };
    if (item.ok) completed = true;
    else outcome.ok = false;
  }
  if (!outcome.ok) outcome.error = signal.aborted && !completed && outcome.sessions.length === 0 ? 'cancelled' : 'partial_discovery';
  // Bound the combined result without replacing successful agent rows on an
  // ordinary partial failure. Each worker already has its own output cap.
  if (Buffer.byteLength(JSON.stringify(outcome), 'utf8') > MAX_RESULT)
    return refused('result_too_large');
  return outcome;
}

export async function startServer({ cli, policy, reply, version, stdin = process.stdin, stdout = process.stdout, run = runWorker }) {
  const active = new Set();
  const server = new Server({ name: 'session-peer-mcp', version }, { capabilities: { tools: {} } });
  const transport = new StdioServerTransport(stdin, stdout, { maxBufferSize: MAX_FRAME });
  const stop = () => { for (const controller of active) controller.abort(); };
  server.onclose = stop;
  server.onerror = () => { stop(); void server.close().catch(() => {}); };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    const input = params.arguments ?? {};
    if (!validate(params.name, input)) return result(refused('invalid_tool_arguments'));
    if (active.size >= MAX_ACTIVE) return result(refused('server_busy'));
    const controller = new AbortController();
    active.add(controller);
    const signal = AbortSignal.any([controller.signal, extra.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]);
    let effectfulWorkerCalled = false;
    try {
      if (signal.aborted) return result(refused('cancelled'));
      if (params.name === 'list_sessions') {
        const decision = authorizeList(policy, input);
        return result(await executeList(cli, decision, input.all ?? false, signal, run));
      }
      const decision = authorizeSend(policy, input, reply);
      if (decision.agent === 'codex' && Buffer.byteLength(input.message, 'utf8') > 32768)
        return result(refused('invalid_message'));
      effectfulWorkerCalled = input.dryRun !== true;
      const outcome = await run({ cli, signal, operation: {
        ...decision, command: 'send', message: input.message, dryRun: input.dryRun ?? false,
      } });
      return result(outcome);
    } catch (error) {
      if (effectfulWorkerCalled)
        return result({ ...refused('mcp_operation_failed'), submitted: null, status: 'unknown' });
      return result(refused(error instanceof PolicyError ? 'operation_not_allowed' : 'mcp_operation_failed'));
    } finally {
      active.delete(controller);
    }
  });

  // The v1 SDK transport does not close on input EOF itself.
  stdin.once('end', () => { stop(); void server.close().catch(() => {}); });
  await server.connect(transport);
  return { close: async () => { stop(); await server.close(); } };
}
