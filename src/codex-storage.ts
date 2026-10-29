// Source-qualified LOCAL loader layers, independent of observation profiles.
// See docs: rust-v0.160.1, rust-v0.162.1 and rust-v0.165.0 config/src/loader.
// Never return TOML, preference values, native diagnostics or configuration paths.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync, realpathSync, statSync, type BigIntStats } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { parse } from 'smol-toml';

export const STORAGE_LOADER_VERSIONS = ['0.160.1', '0.162.1', '0.165.0'] as const;
const LIMIT = 1024 * 1024;
type Layer = 'home' | 'system' | 'requirements' | 'legacy' | 'preferences' | 'project' | 'context' | 'daemon' | 'cloud';
export type StorageCheck = {
  status: 'classified' | 'unsupported' | 'unknown'; code: string;
  verification: 'local_loader_layers'; loaderVersion: string | null;
  loaderVersionVerified: boolean; localLoaderPlatformSupported: boolean;
  layers: Layer[]; consumerContext: 'inspected' | 'not_provided';
  cloudConfiguration: 'ineligible_by_metadata' | 'requires_owned_storage_binding' | 'unclassified';
  // Private continuity evidence; callers expose only storageDiagnostic().
  fingerprint: string; queueCwd?: string;
};
export type StorageOptions = {
  home: string; queueCwd?: string; consumerCwds?: string[]; version?: string;
  platform?: string; ownedAppServer?: boolean;
  // Dependency injection for hermetic fixtures, never environment-controlled.
  systemBase?: string; preferences?: () => { forced: boolean; value: unknown }[];
  environment?: NodeJS.ProcessEnv;
};
const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
class Invalid extends Error { constructor(readonly layer: Layer, readonly configured = false) { super(); } }
function metadata(s: BigIntStats): string {
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
}
// Never follow a config symlink or open a special file; a racing FIFO cannot
// block this read. Missing parents that are not directories are unclassifiable.
function bytes(path: string, layer: Layer): Buffer | undefined {
  let before;
  try { before = lstatSync(path, { bigint: true }); } catch (e) { if (absent(e)) return; throw new Invalid(layer); }
  let fd: number | undefined;
  try {
    if (!before.isFile() || before.size > BigInt(LIMIT)) throw new Error();
    fd = openSync(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || metadata(opened) !== metadata(before)) throw new Error();
    const out = Buffer.alloc(LIMIT + 1); let length = 0;
    while (length < out.length) { const n = readSync(fd, out, length, out.length - length, length); if (!n) break; length += n; }
    const after = fstatSync(fd, { bigint: true }), named = lstatSync(path, { bigint: true });
    if (length > LIMIT || BigInt(length) !== opened.size || !after.isFile() || !named.isFile() ||
        metadata(after) !== metadata(before) || metadata(named) !== metadata(before)) throw new Error();
    return out.subarray(0, length);
  } catch { throw new Invalid(layer); } finally { if (fd !== undefined) closeSync(fd); }
}
// Both 0.160.1 and 0.162.1 (also 0.165.0) require forced values, before AND
// after CopyAppValue. Do not import the older Python wake-version policy.
export function managedStoragePreferences(): { forced: boolean; value: unknown }[] {
  const script = `ObjC.import('CoreFoundation');
var domain=$('com.openai.codex');
if (!$.CFPreferencesAppSynchronize(domain)) throw Error('unavailable');
var out=[];
['config_toml_base64','requirements_toml_base64'].forEach(function(name){
 var key=$(name); if (!$.CFPreferencesAppValueIsForced(key,domain)) return;
 var raw=$.CFPreferencesCopyAppValue(key,domain);
 if (!$.CFPreferencesAppValueIsForced(key,domain)) return;
 var value=ObjC.deepUnwrap(raw);
 if(typeof value !== 'string' || value.length>2097152) throw Error('invalid');
 out.push({forced:true,value:value});
}); JSON.stringify(out);`;
  try {
    const value: unknown = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 5 * LIMIT, stdio: ['ignore', 'pipe', 'pipe'] }));
    if (!Array.isArray(value) || value.length > 2) throw new Error();
    return value;
  } catch { throw new Invalid('preferences'); }
}
export function storageDiagnostic(check: StorageCheck): Omit<StorageCheck, 'fingerprint' | 'queueCwd'> {
  const { fingerprint: _private, queueCwd: _cwd, ...diagnostic } = check; return diagnostic;
}
export function classifyCodexStorage(options: StorageOptions): StorageCheck {
  const platform = options.platform ?? process.platform;
  const layers = new Set<Layer>(), evidence: unknown[] = [];
  const qualified = platform === 'darwin' || platform === 'linux';
  const versionOK = options.version === undefined || (STORAGE_LOADER_VERSIONS as readonly string[]).includes(options.version);
  let queueCwd: string | undefined, total = 0;
  let cloudConfiguration: StorageCheck['cloudConfiguration'] = 'unclassified';
  const result = (status: StorageCheck['status'], code: string): StorageCheck => ({ status, code,
    verification: 'local_loader_layers', loaderVersion: options.version ?? null,
    loaderVersionVerified: options.version !== undefined && versionOK, localLoaderPlatformSupported: qualified,
    layers: [...layers], consumerContext: options.consumerCwds?.length ? 'inspected' : 'not_provided',
    cloudConfiguration,
    fingerprint: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'), ...(queueCwd ? { queueCwd } : {}) });
  if (!qualified) return result('unsupported', 'codex_storage_platform_unqualified');
  if (!versionOK) return result('unsupported', 'codex_storage_loader_unsupported');
  try {
    const environment = options.environment ?? process.env;
    const remoteMarkers = ['CODEX_EXEC_SERVER_URL', 'CODEX_EXEC_SERVER_NOISE_REGISTRY_URL',
      'CODEX_EXEC_SERVER_NOISE_ENVIRONMENT_ID', 'CODEX_EXEC_SERVER_NOISE_AUTH_TOKEN', 'CODEX_EXEC_SERVER_NOISE_CHATGPT_ACCOUNT_ID'];
    if (remoteMarkers.some(name => Boolean(environment[name]?.trim()))) throw new Invalid('context');
    try { lstatSync(join(options.home, 'environments.toml')); throw new Invalid('context'); }
    catch (e) { if (!absent(e)) throw e instanceof Invalid ? e : new Invalid('context'); }
    let customMarkers = false, nonFileAuthStore = false, configServer = false;
    const config = (data: Buffer, layer: Layer) => {
      total += data.length; if (total > 8 * LIMIT) throw new Invalid(layer);
      let value;
      try { value = parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { throw new Invalid(layer); }
      if (Object.hasOwn(value, 'sqlite_home')) throw new Invalid(layer, true);
      customMarkers ||= Object.hasOwn(value, 'project_root_markers');
      // A legacy profile can select auth storage. Inspect this selector without
      // reading any credential values, including inactive profiles conservatively.
      const pending: unknown[] = [value]; let count = 0;
      while (pending.length) {
        if (++count > 65536) throw new Invalid(layer);
        const item = pending.pop();
        if (!item || typeof item !== 'object') continue;
        configServer ||= Object.hasOwn(item, 'config_server');
        if (Object.hasOwn(item, 'cli_auth_credentials_store') &&
            (item as Record<string, unknown>).cli_auth_credentials_store !== 'file' &&
            (item as Record<string, unknown>).cli_auth_credentials_store !== 'ephemeral') nonFileAuthStore = true;
        pending.push(...Object.values(item));
      }
    };
    const visited = new Set<string>();
    const inspect = (path: string, layer: Layer) => {
      if (visited.has(path)) return; visited.add(path); layers.add(layer);
      const data = bytes(path, layer);
      evidence.push([layer, path, data ? createHash('sha256').update(data).digest('hex') : null,
        data ? metadata(lstatSync(path, { bigint: true })) : null]);
      if (data) config(data, layer);
    };
    inspect(join(options.home, 'config.toml'), 'home');
    const base = options.systemBase ?? '/etc/codex';
    for (const [name, layer] of [['config.toml', 'system'], ['requirements.toml', 'requirements'], ['managed_config.toml', 'legacy']] as const) inspect(join(base, name), layer);
    if (platform === 'darwin') {
      layers.add('preferences');
      const values = (options.preferences ?? managedStoragePreferences)();
      if (!Array.isArray(values) || values.length > 2) throw new Invalid('preferences');
      for (const entry of values) {
        if (!entry || typeof entry.forced !== 'boolean') throw new Invalid('preferences');
        if (!entry.forced) continue;
        if (typeof entry.value !== 'string' || entry.value.length > 2 * LIMIT) throw new Invalid('preferences');
        const encoded = entry.value.trim();
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Invalid('preferences');
        const data = Buffer.from(encoded, 'base64');
        if (data.length > LIMIT) throw new Invalid('preferences');
        evidence.push(['preferences', createHash('sha256').update(data).digest('hex')]); config(data, 'preferences');
      }
      evidence.push(['preferences_end']);
    }
    layers.add('cloud');
    // Source: cloud-config/service.rs only loads bundles for eligible backend
    // auth; cache absence alone is insufficient because it fetches on a miss.
    // Default auth storage is File (config/types.rs). Never read auth.json or
    // keychain contents: possible auth/cache/keyring/external identity instead
    // requires the owned process's actual opened-SQLite binding, or refusal.
    let authMetadataPresent = false;
    for (const name of ['auth.json', 'cloud-config-bundle-cache.json']) {
      try { const info = lstatSync(join(options.home, name), { bigint: true }); authMetadataPresent = true;
        if (!options.ownedAppServer) evidence.push(['cloud_metadata', name, metadata(info)]); }
      catch (e) { if (!absent(e)) throw new Invalid('cloud'); if (!options.ownedAppServer) evidence.push(['cloud_metadata', name, null]); }
    }
    const externalAuth = ['CODEX_ACCESS_TOKEN', 'OPENAI_FEDERATION_RULE_ID', 'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_WORKLOAD_IDENTITY_CONTEXT']
      .some(name => Object.hasOwn(environment, name));
    evidence.push(['external_auth_marker', externalAuth]);
    const possibleCloud = () => authMetadataPresent || nonFileAuthStore || externalAuth || configServer;
    const physical = (cwd: string) => {
      try { if (!isAbsolute(cwd)) throw new Error(); const path = realpathSync(cwd); if (!statSync(path).isDirectory()) throw new Error(); return path; }
      catch { throw new Invalid('context'); }
    };
    queueCwd = physical(options.queueCwd ?? process.cwd());
    const scanAllAncestors = customMarkers || possibleCloud();
    const contexts = [queueCwd, ...(options.consumerCwds ?? []).map(physical)];
    const inspectContexts = (scanAllAncestors: boolean) => {
    for (const cwd of new Set(contexts)) {
      layers.add('context'); evidence.push(['cwd', cwd]);
      const directories: string[] = []; let dir = cwd;
      for (;;) {
        if (directories.length >= 256) throw new Invalid('context'); directories.push(dir);
        if (!scanAllAncestors) {
          try {
            const marker = lstatSync(join(dir, '.git'));
            if (marker.isSymbolicLink()) throw new Invalid('project');
            if (!marker.isDirectory()) break;
            try { statSync(join(dir, '.git', 'HEAD')); break; } catch (e) { if (!absent(e)) throw new Invalid('project'); }
          } catch (e) { if (!absent(e)) throw e instanceof Invalid ? e : new Invalid('project'); }
        }
        const parent = dirname(dir); if (dir === parent) { if (!scanAllAncestors) directories.splice(1); break; } dir = parent;
      }
      evidence.push(['project_roots', directories]);
      for (const directory of directories) inspect(join(directory, '.codex', 'config.toml'), 'project');
    }
    };
    inspectContexts(scanAllAncestors);
    if (!scanAllAncestors && possibleCloud()) inspectContexts(true);
    cloudConfiguration = possibleCloud() ? 'requires_owned_storage_binding' : 'ineligible_by_metadata';
    evidence.push(['cloud_gate', possibleCloud()]);
    if (possibleCloud() && !options.ownedAppServer) { cloudConfiguration = 'unclassified'; throw new Invalid('cloud'); }
    // A reused daemon retains its startup QueueStore. Disk config/read cannot
    // attest to it; owned stdio has a separate opened-FD binding guard.
    if (!options.ownedAppServer) {
      layers.add('daemon');
      try { lstatSync(join(options.home, 'app-server-control', 'app-server-control.sock')); throw new Invalid('daemon'); }
      catch (e) { if (!absent(e)) throw e instanceof Invalid ? e : new Invalid('daemon'); }
      evidence.push(['daemon', 'absent']);
    }
    return result('classified', 'codex_local_storage_classified');
  } catch (e) {
    const error = e instanceof Invalid ? e : new Invalid('context');
    layers.add(error.layer);
    return result(error.configured ? 'unsupported' : 'unknown', error.configured ? 'unsupported_codex_sqlite_home' :
      error.layer === 'home' ? 'codex_config_unreadable' : error.layer === 'daemon' ? 'codex_daemon_storage_unverified' :
      error.layer === 'cloud' ? 'codex_cloud_storage_unverified' : 'codex_storage_config_unverifiable');
  }
}

// Only the saved thread's cwd column is inspected: never transcripts, accounts,
// credentials, preference files or arbitrary environment variables.
let sqlite: typeof import('node:sqlite') | undefined;
export function codexStateIdentity(home: string): string {
  const info = lstatSync(join(home, 'state_5.sqlite'), { bigint: true });
  if (!info.isFile()) throw new Error('codex_consumer_context_unverifiable');
  return `${info.dev}:${info.ino}`;
}
// Initialized lazily by the first Codex-only read. The final dispatch barrier
// then queries metadata synchronously, without importing SQLite for Claude.
export function codexConsumerSnapshotSync(home: string, threadId: string): { cwd: string; database: string } {
  try {
    if (!sqlite) throw new Error();
    const database = codexStateIdentity(home);
    const db = new sqlite.DatabaseSync(join(home, 'state_5.sqlite'), { readOnly: true });
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000');
      const row = db.prepare('SELECT cwd FROM threads WHERE id=? LIMIT 1').get(threadId) as { cwd?: unknown } | undefined;
      if (typeof row?.cwd !== 'string' || row.cwd.length > 32768 || !isAbsolute(row.cwd)) throw new Error();
      if (codexStateIdentity(home) !== database) throw new Error();
      return { cwd: row.cwd, database };
    } finally { db.close(); }
  } catch { throw new Error('codex_consumer_context_unverifiable'); }
}
export async function codexConsumerCwd(home: string, threadId: string): Promise<string> {
  sqlite ??= await import('node:sqlite');
  return codexConsumerSnapshotSync(home, threadId).cwd;
}

// Optional live consumer context complements the persisted thread cwd. A PID
// comes only from the already retained writer evidence, never from discovery.
export function codexWriterCwd(pid: number): string {
  try {
    if (!Number.isSafeInteger(pid) || pid < 2) throw new Error();
    if (process.platform === 'linux') return realpathSync(readlinkSync(`/proc/${pid}/cwd`));
    if (process.platform !== 'darwin') throw new Error();
    const output = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn0'],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] });
    const paths = output.split(/[\0\n]/).filter(item => item.startsWith('n')).map(item => item.slice(1));
    if (paths.length !== 1 || !isAbsolute(paths[0]!)) throw new Error();
    return realpathSync(decodeLsofFilename(paths[0]!));
  } catch { throw new Error('codex_consumer_context_unverifiable'); }
}

export function decodeLsofFilename(raw: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') { const char = String.fromCodePoint(raw.codePointAt(i)!); bytes.push(...Buffer.from(char)); i += char.length - 1; continue; }
    const next = raw[++i];
    if (next === '\\') { bytes.push(92); continue; }
    if (next === 'x' && /^[0-9a-f]{2}$/i.test(raw.slice(i + 1, i + 3))) { bytes.push(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; continue; }
    throw new Error('codex_storage_binding_unverifiable');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes));
}
// A sender version never qualifies a running consumer's environment/loader.
// Instead bind the retained writer PID's CURRENT opened state database inode.
// Observe metadata only; no process environment, DB contents or executable run.
// Queue descriptors, when present, must agree as well. Missing state evidence
// or another SQLite namespace is unclassifiable and refuses submission.
export function codexWriterStorage(pid: number, home: string): void {
  try {
    if (!Number.isSafeInteger(pid) || pid < 2 || !['darwin', 'linux'].includes(process.platform)) throw new Error();
    const binary = process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof';
    const out = execFileSync(binary, ['-a', '-p', String(pid), '-F0fDin'],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' } });
    const files: { name?: string; dev?: bigint; ino?: bigint }[] = []; let current: typeof files[number] | undefined;
    for (const raw of out.split('\0')) {
      const field = raw.replace(/^\n/, '');
      if (field.startsWith('f')) { current = {}; files.push(current); }
      else if (current && field.startsWith('n')) current.name = decodeLsofFilename(field.slice(1));
      else if (current && /^D0x[0-9a-f]+$/i.test(field)) current.dev = BigInt(field.slice(1));
      else if (current && /^i[0-9]+$/.test(field)) current.ino = BigInt(field.slice(1));
    }
    if (!files.some(file => file.name === join(home, 'state_5.sqlite'))) throw new Error();
    for (const file of files) {
      if (!file.name || !/^(?:state_5|queue_1)\.sqlite(?:-(?:wal|shm))?(?: \(deleted\))?$/.test(basename(file.name))) continue;
      if (file.name !== join(home, basename(file.name)) || file.name.endsWith(' (deleted)')) throw new Error();
      const info = lstatSync(file.name, { bigint: true });
      if (!info.isFile() || info.dev !== file.dev || info.ino !== file.ino) throw new Error();
    }
  } catch { throw new Error('codex_consumer_storage_unverifiable'); }
}
