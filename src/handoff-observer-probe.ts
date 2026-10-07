// Owned one-shot worker. node:sqlite is synchronous, so it never runs on the
// caller's event loop. Its supervisor kills only this process group at deadline.
// Codex rust-v0.160.1 / d27764b82f7118f674371e6d6e76271d9d606edb:
// state/thread_history_migrations/0001_thread_history.sql, 0002_thread_items_item_type.sql;
// app-server-protocol/src/protocol/v2/item.rs (userMessage.clientId);
// thread-store/src/local/thread_history.rs (turn_status, projection lag).
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';

type Reason = 'metadata_storage_untrusted' | 'metadata_schema_unsupported' | 'metadata_history_unavailable' |
  'metadata_probe_failed' | 'metadata_ambiguous';
type SqlRow = Record<string, unknown>;
const fail = (reason: Reason) => ({ supported: false, injectionObserved: false, reason });
const safe = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length > 0 &&
  Buffer.byteLength(value) <= bytes && !/[\x00-\x1f\x7f-\x9f]/.test(value) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function main(raw: Buffer): unknown {
  let request: { mode: string; database: string; threadId: string; clientUserMessageId?: string };
  try {
    request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    if (!request || !['capability', 'observe'].includes(request.mode) || !safe(request.database, 2200) ||
        !isAbsolute(request.database) || basename(request.database) !== 'thread_history_1.sqlite' ||
        !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(request.threadId) ||
        Object.keys(request).some(key => !['mode', 'database', 'threadId', 'clientUserMessageId'].includes(key)) ||
        (request.mode === 'observe' && !safe(request.clientUserMessageId, 128))) return fail('metadata_probe_failed');
  } catch { return fail('metadata_probe_failed'); }
  let db: DatabaseSync | undefined;
  try {
    const uid = process.getuid?.(), home = lstatSync(dirname(request.database)), info = lstatSync(request.database);
    if (uid === undefined || !home.isDirectory() || home.isSymbolicLink() || home.uid !== uid || (home.mode & 0o022) ||
        realpathSync(request.database) !== request.database || !info.isFile() || info.isSymbolicLink() ||
        info.uid !== uid || info.nlink !== 1 || (info.mode & 0o022)) return fail('metadata_storage_untrusted');
    const sides = new Set<string>();
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { const side = lstatSync(request.database + suffix);
        if (suffix === '-journal' || !side.isFile() || side.isSymbolicLink() || side.uid !== uid || side.nlink !== 1 || (side.mode & 0o022)) return fail('metadata_storage_untrusted');
        sides.add(suffix);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail('metadata_storage_untrusted'); }
    }
    if (sides.has('-wal') !== sides.has('-shm')) return fail('metadata_storage_untrusted');
    db = new DatabaseSync(request.database, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=40;');
    const opened = lstatSync(request.database);
    if (opened.dev !== info.dev || opened.ino !== info.ino) return fail('metadata_storage_untrusted');
    const tables = db.prepare("SELECT name,type FROM sqlite_schema WHERE name IN ('thread_items','thread_turns','thread_history_projection_state')").all() as SqlRow[];
    if (tables.length !== 3 || tables.some(row => row.type !== 'table')) return fail('metadata_schema_unsupported');
    const columns: Record<string, Record<string, string>> = {
      thread_items: { thread_id: 'TEXT', turn_id: 'TEXT', item_id: 'TEXT', rollout_ordinal: 'INTEGER', item_json: 'TEXT', item_type: 'TEXT' },
      thread_turns: { thread_id: 'TEXT', turn_id: 'TEXT', status: 'TEXT' },
      thread_history_projection_state: { thread_id: 'TEXT', next_rollout_byte_offset: 'INTEGER', next_rollout_ordinal: 'INTEGER' },
    };
    for (const [table, required] of Object.entries(columns)) {
      const actual = db.prepare('PRAGMA table_info(' + table + ')').all() as SqlRow[];
      if (Object.entries(required).some(([name, type]) => !actual.some(row => row.name === name && row.type === type))) return fail('metadata_schema_unsupported');
      const keys = table === 'thread_items' ? ['thread_id', 'turn_id', 'item_id'] : table === 'thread_turns' ? ['thread_id', 'turn_id'] : ['thread_id'];
      if (actual.filter(row => typeof row.pk === 'number' && row.pk > 0).length !== keys.length ||
          keys.some((name, i) => !actual.some(row => row.name === name && row.pk === i + 1))) return fail('metadata_schema_unsupported');
    }
    const indexes = db.prepare('PRAGMA index_list(thread_items)').all() as SqlRow[];
    const userIndex = indexes.find(row => row.name === 'idx_thread_items_user_messages' && row.partial === 1);
    const indexColumns = db.prepare('PRAGMA index_info(idx_thread_items_user_messages)').all() as SqlRow[];
    if (!userIndex || indexColumns.length !== 2 || indexColumns[0]?.name !== 'thread_id' || indexColumns[1]?.name !== 'rollout_ordinal') return fail('metadata_schema_unsupported');
    const projection = db.prepare('SELECT next_rollout_byte_offset,next_rollout_ordinal FROM thread_history_projection_state WHERE thread_id=?').get(request.threadId) as SqlRow | undefined;
    if (!projection || !Object.values(projection).every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return fail('metadata_history_unavailable');
    // Preparing this query also verifies the partial index's actual predicate.
    // LIMIT is applied inside a materialized CTE before any JSON parsing. Raw
    // item_json stays INSIDE SQLite; no body-bearing column crosses into JS.
    const query = db.prepare(`WITH recent AS MATERIALIZED (
      SELECT thread_id,turn_id,item_json FROM thread_items INDEXED BY idx_thread_items_user_messages
      WHERE thread_id=? AND item_type='userMessage' ORDER BY rollout_ordinal DESC LIMIT 256
    ), projected AS MATERIALIZED (
      SELECT thread_id,turn_id,CASE WHEN typeof(item_json)='text' THEN
        CASE WHEN length(CAST(item_json AS BLOB))<=262144 THEN
          CASE WHEN json_valid(item_json) THEN
            CASE WHEN json_extract(item_json,'$.type')='userMessage' THEN json_extract(item_json,'$.clientId') END
          END
        END
      END AS client_id FROM recent
    ) SELECT projected.thread_id AS threadId,projected.turn_id AS turnId,
      projected.client_id AS clientUserMessageId,thread_turns.status AS status
      FROM projected LEFT JOIN thread_turns ON thread_turns.thread_id=projected.thread_id AND thread_turns.turn_id=projected.turn_id
      WHERE typeof(projected.client_id)='text' AND projected.client_id=? LIMIT 2`);
    if (request.mode === 'capability') return { supported: true, injectionObserved: false };
    const rows = query.all(request.threadId, request.clientUserMessageId!) as SqlRow[];
    if (rows.length > 1) return fail('metadata_ambiguous');
    if (!rows.length) return { supported: true, injectionObserved: false };
    const row = rows[0]!;
    if (row.threadId !== request.threadId || row.clientUserMessageId !== request.clientUserMessageId || !safe(row.turnId, 128)) return fail('metadata_probe_failed');
    const status = row.status === 'inProgress' ? 'running' : ['completed', 'failed', 'interrupted'].includes(row.status as string) ? row.status : 'unknown';
    return { supported: true, injectionObserved: true, clientUserMessageId: request.clientUserMessageId, turn: { id: row.turnId, status } };
  } catch { return fail('metadata_probe_failed'); }
  finally { try { db?.close(); } catch { /* No diagnostics or storage mutation. */ } }
}
let bytes = 0, oversized = false; const parts: Buffer[] = [];
process.stdin.on('data', (part: Buffer) => { bytes += part.length; if (bytes > 4096) { oversized = true; parts.length = 0; } else if (!oversized) parts.push(part); });
process.stdin.once('end', () => {
  const result = oversized ? fail('metadata_probe_failed') : main(Buffer.concat(parts));
  process.stdout.write(JSON.stringify(result) + '\n');
});
process.stdin.once('error', () => { process.stdout.write(JSON.stringify(fail('metadata_probe_failed')) + '\n'); });
