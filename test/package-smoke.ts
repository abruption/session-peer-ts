import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const task = mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-node-pack-'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'invoke through npm run test:package');
const runNpm = (args: string[]) => execFileSync(process.execPath, [npm, ...args], { encoding: 'utf8', timeout: 60000 });
try {
  const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(metadata.private, false);
  assert.deepEqual(metadata.publishConfig, { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'latest' });
  assert.deepEqual(metadata.dependencies, { 'fs-ext-extra-prebuilt': '2.2.14' });
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
    assert.equal(metadata.scripts[hook], undefined);
  }
  assert.match(readFileSync('LICENSE', 'utf8'), /MIT License/);
  assert.deepEqual(metadata.bin, { 'session-peer': 'dist/cli.js' });
  assert.equal(execFileSync(process.execPath, ['dist/cli.js', '--version'], { encoding: 'utf8' }).trim(), `session-peer ${metadata.version} (typescript)`);
  let hash;
  for (let index = 0; index < 2; index++) {
    const [packed] = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', task]));
    assert.deepEqual(packed.files.map((file: {path: string}) => file.path).sort(), ['CONTRIBUTING.md', 'LICENSE', 'README.ja.md', 'README.ko.md', 'README.md', 'README.zh-CN.md', 'RELEASING.md', 'SECURITY.md', 'VALIDATION.md', 'dist/cli.js', 'dist/discovery.js', 'dist/process.js', 'dist/protocol.js', 'dist/send.js', 'dist/windows.js', 'dist/writer.js', 'dist/index.js', 'dist/index.d.ts', 'dist/cli.d.ts', 'dist/discovery.d.ts', 'dist/process.d.ts', 'dist/protocol.d.ts', 'dist/send.d.ts', 'dist/windows.d.ts', 'dist/writer.d.ts', 'package.json'].sort());
    const next = createHash('sha256').update(readFileSync(join(task, packed.filename))).digest('hex');
    if (hash) assert.equal(next, hash, 'same build must produce identical tarball');
    hash = next;
  }
  const prefix = join(task, 'install');
  const home = join(task, 'empty-home');
  mkdirSync(home);
  runNpm(['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', join(task, `${metadata.name}-${metadata.version}.tgz`)]);
  const windows = process.platform === 'win32';
  const binary = join(prefix, 'node_modules/.bin/session-peer' + (windows ? '.cmd' : ''));
  const installed = join(prefix, 'node_modules/session-peer');
  const entry = join(installed, 'dist/cli.js');
  assert.ok(existsSync(binary));
  if (windows) {
    // .cmd is a shell launcher, not a JavaScript source file. Only fixed test
    // paths/options enter this command; no peer-controlled text is interpolated.
    const output = spawnSync(process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `""${binary}" --version"`],
      { encoding: 'utf8', windowsVerbatimArguments: true, timeout: 10000 });
    assert.equal(output.status, 0, String(output.error ?? output.stderr));
    assert.equal(output.stdout.trim(), `session-peer ${metadata.version} (typescript)`);
  } else assert.ok(statSync(binary).mode & 0o111);
  const result = JSON.parse(execFileSync(process.execPath, [entry, 'list', '--agent', 'claude', '--json'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: '', HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), ANTHROPIC_CONFIG_DIR: '' }
  }));
  assert.equal(result.ok, true);
  // Load and exercise the installed native dependency with a private fixture.
  // Empty discovery alone would never load it and cannot prove prebuild support.
  const nativeProbe = join(prefix, 'native-probe.mjs');
  writeFileSync(nativeProbe, `import { openSync, closeSync, writeFileSync } from 'node:fs';
import * as locks from 'fs-ext-extra-prebuilt';
const path = new URL('./native.lock', import.meta.url); writeFileSync(path, '');
const fd = openSync(path, 'r+');
try {
  if (process.platform === 'win32') {
    locks.lockFileExSync(fd, 3, 0, 0, 0xffffffff, 0xffffffff);
    locks.unlockFileExSync(fd, 0, 0, 0, 0xffffffff, 0xffffffff);
  } else { locks.flockSync(fd, 'exnb'); locks.flockSync(fd, 'un'); }
} finally { closeSync(fd); }
`);
  execFileSync(process.execPath, [nativeProbe], { encoding: 'utf8', timeout: 10000 });
  assert.equal(metadata.types, './dist/index.d.ts');
  assert.ok(existsSync(join(prefix, 'node_modules/session-peer', metadata.types)));
  const consumer = join(prefix, 'consumer.mts');
  writeFileSync(consumer, 'import { reply, envelope, VERSION } from "session-peer";\nconst destination: { to: string; host?: string; home?: string } = reply("session-peer://v1/reply?agent=claude&session=fixture&transport=local");\nconst message: string = envelope(VERSION, true);\nvoid destination; void message;\n');
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', consumer], {encoding:'utf8'});
  assert.deepEqual(result.sessions, []);
  runNpm(['uninstall', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', metadata.name]);
  assert.equal(existsSync(binary), false);
  assert.equal(existsSync(join(prefix, 'node_modules', metadata.name)), false);
  console.log(JSON.stringify({ packageSmoke: 'pass', reproducibleSha256: hash, cleanInstall: true, uninstall: true }));
} finally {
  rmSync(task, { recursive: true });
}
