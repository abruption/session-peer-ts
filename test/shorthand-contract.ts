import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Shell = 'bash' | 'zsh' | 'powershell';
export function shorthandFixture(installed: string, bin: string, task: string) {
  const root = join(task, 'shorthand space 한글'); mkdirSync(root);
  const home = join(root, 'home'); mkdirSync(home);
  const codexHome = join(home, '.codex'); mkdirSync(codexHome);
  const db = new DatabaseSync(join(codexHome, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,rollout_path TEXT)');
  const id = '00000000-0000-4000-8000-000000000001';
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(id, 'fixture', root, 1, 0, 'unused'); db.close();
  const win = process.platform === 'win32';
  const tools = join(root, 'tools'); mkdirSync(tools);
  if (win) copyFileSync(process.execPath, join(tools, 'node.exe'));
  else symlinkSync(process.execPath, join(tools, 'node'));
  const shells: Shell[] = win ? ['powershell'] : ['bash', ...(existsSync('/bin/zsh') ? ['zsh' as const] : [])];
  // Never fall through to a real Python/TS install after fixture uninstall.
  const env = { ...process.env, PATH: bin + delimiter + tools,
    HOME: home, USERPROFILE: home, CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]',
    CLAUDE_CONFIG_DIR: join(home, '.claude'), ANTHROPIC_CONFIG_DIR: '',
    CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', CODEX_SQLITE_HOME: '',
    // Same isolation as test/fixtures/isolate-env.mjs, which test:package does not
    // preload: no real tailnet lookup, sender identity, reply host or notices.
    SESSION_PEER_TAILSCALE: 'off', CLAUDE_CODE_MESSAGING_SOCKET: '', SESSION_PEER_REPLY_HOST: '',
    CC_PEER_REPLY_HOST: '', SESSION_PEER_UPDATE_NOTICE: '',
    SP_NODE: process.execPath, SP_ROOT: root, SP_STDIN: '' };
  const psHeader = `$ErrorActionPreference = 'Stop'\n$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n`;
  const psClear = 'Remove-Item Alias:sp -Force -ErrorAction Stop\n';
  function execute(shell: Shell, body: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
    const file = join(root, shell === 'powershell' ? 'invoke.ps1' : 'invoke.sh');
    const argv = join(root, 'arguments.json'); writeFileSync(argv, JSON.stringify(args));
    writeFileSync(file, shell === 'powershell' ? '\ufeff' + psHeader + body : body);
    const program = shell === 'powershell'
      ? join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/' + shell;
    // Windows PowerShell -Command maps any script exit code other than 0/1 to 1
    // unless the command string ends with `exit $LASTEXITCODE` (about_PowerShell_exe).
    // -Command (global scope) is kept so the AllScope builtin sp alias can be removed.
    const options = shell === 'powershell' ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '. $env:SP_SCRIPT; exit $LASTEXITCODE']
      : (shell === 'bash' ? ['--noprofile', '--norc', file, ...args] : ['-f', file, ...args]);
    const result = spawnSync(program, options, { encoding: 'utf8', timeout: 120000,
      env: { ...env, SP_SCRIPT: file, SP_ARGUMENTS: argv,
        SP_ACTIVATOR: join(installed, 'shorthand', shell === 'powershell' ? 'sp.ps1' : 'sp.sh'), ...extra } });
    assert.ifError(result.error); assert.equal(result.signal, null, result.stderr);
    return result;
  }
  function invoke(shell: Shell, alias: boolean, args: string[], stdin = '', probe = false) {
    let body = shell === 'powershell' ? psClear : shell === 'bash' ? 'shopt -s expand_aliases\n' : '';
    if (probe) body += shell === 'powershell'
      ? 'function session-peer { $input | & $env:SP_NODE $env:SP_CAPTURE @args }\n'
      : 'session-peer() { "$SP_NODE" "$SP_CAPTURE" "$@"; }\n';
    if (alias) body += shell === 'powershell' ? "try { . $env:SP_ACTIVATOR } catch { [Console]::Error.WriteLine((Get-Command sp -All -ListImported | Format-List * | Out-String)); throw }\n" : '. "$SP_ACTIVATOR" || exit $?\n';
    const name = alias ? 'sp' : 'session-peer';
    body += shell === 'powershell'
      ? `$arguments = Get-Content -LiteralPath $env:SP_ARGUMENTS -Raw -Encoding UTF8 | ConvertFrom-Json\n$env:SP_STDIN | & ${name} @arguments\nexit $LASTEXITCODE\n`
      : `printf '%s' "$SP_STDIN" | ${name} "$@"\n`;
    return execute(shell, body, args, { SP_STDIN: stdin, SP_CAPTURE: join(root, 'capture.mjs') });
  }
  writeFileSync(join(root, 'capture.mjs'), `import {readFileSync} from 'node:fs';\nconsole.log(JSON.stringify({args:process.argv.slice(2),stdin:readFileSync(0,'utf8')})); process.exitCode=7;\n`);
  const dry = ['send', '--to', 'codex:' + id, '--codex-home', codexHome,
    '--codex-bin', process.execPath, '--allow-inactive-codex-home', '--no-from', '--dry-run', '--json'];
  const cases = [
    ['--version'], ['--help'], ['list', '--help'], ['send', '--help'], ['doctor', '--help'],
    ['list', '--agent', 'claude', '--json'], ['list', '--json'],
    ['list', '--bad', '--json'], ['send', '--message', '--dry-run', '--json'],
    [...dry, '--message=space 한글 🚀'], [...dry, '--', '-leading 한글'], [...dry, '--message', '-'],
  ];
  // Node 22 prefixes its SQLite ExperimentalWarning with the process ID; only
  // that per-process number is normalized before comparing stderr.
  const stderrOf = (result: { stderr: string }) => result.stderr.replace(/\(node:\d+\)/g, '(node:PID)');
  for (const shell of shells) {
    // The runner must report a script's own exit code, not a 0/1 summary.
    const sanity = execute(shell, 'exit 3\n');
    assert.equal(sanity.status, 3, `${shell} runner exit code: ${sanity.stdout} ${sanity.stderr}`);
    // Collect every case before asserting so one CI run reports all mismatches.
    const failures: string[] = [];
    for (const args of cases) {
      const direct = invoke(shell, false, args, 'stdin 한글\nsecond line');
      const short = invoke(shell, true, args, 'stdin 한글\nsecond line');
      const expected = args.includes('--allow-inactive-codex-home') ? 0 : args.includes('--bad') || args.includes('--message') ? 2 : 0;
      let detail = '';
      if (short.status !== direct.status || short.stdout !== direct.stdout || stderrOf(short) !== stderrOf(direct)) detail = 'alias differs from canonical';
      else if (short.status !== expected) detail = `exit ${short.status}, expected ${expected}`;
      else if (args.includes('--allow-inactive-codex-home')) {
        try { const result = JSON.parse(short.stdout); if (result.status !== 'validated' || result.submitted !== false) detail = 'not validated'; }
        catch { detail = 'stdout is not JSON'; }
      }
      if (detail) failures.push(`${shell} ${JSON.stringify(args)}: ${detail}; direct=${direct.status} ${direct.stdout.trim().slice(0, 300)} ${direct.stderr.trim().slice(0, 300)}; alias=${short.status} ${short.stdout.trim().slice(0, 300)} ${short.stderr.trim().slice(0, 300)}`);
    }
    assert.deepEqual(failures, [], failures.join('\n'));
    const args = ['one two', '한글 🚀', '--', '-leading', "single'quote", '$HOME;$(echo BAD)&|%PATH%!^'];
    const direct = invoke(shell, false, args, 'stdin α\nsecond line', true);
    const short = invoke(shell, true, args, 'stdin α\nsecond line', true);
    const report = `${shell} capture: direct=${direct.status} ${direct.stdout} ${direct.stderr}; alias=${short.status} ${short.stdout} ${short.stderr}`;
    assert.equal(direct.status, 7, report);
    assert.equal(short.status, 7, report);
    assert.equal(short.stdout, direct.stdout);
    assert.equal(stderrOf(short), stderrOf(direct));
    const captured = JSON.parse(short.stdout);
    assert.deepEqual(captured.args, args, `${shell}: arguments must not be reparsed: ${short.stdout}`);
    assert.ok(captured.stdin.includes('stdin α\nsecond line'), `${shell}: preserve stdin`);
    // Windows PowerShell's text pipeline adds a newline; the alias must retain
    // exactly the same bytes as the canonical pipeline, not rewrite them.
    if (shell !== 'powershell') assert.equal(captured.stdin, 'stdin α\nsecond line');

    const foreign = join(root, 'foreign-' + shell); mkdirSync(foreign);
    writeFileSync(join(foreign, win ? 'sp.cmd' : 'sp'), win ? '@echo foreign\r\n' : '#!/bin/sh\nprintf foreign\n', { mode: 0o755 });
    for (const kind of ['alias', 'function', 'executable', 'missing', ...(win ? ['default'] : [])]) {
      let body = shell === 'powershell' ? (kind === 'default' ? '' : psClear) : shell === 'bash' ? 'shopt -s expand_aliases\n' : '';
      if (kind === 'alias') body += shell === 'powershell' ? 'Set-Alias sp Write-Output\n' : "alias sp='printf foreign'\n";
      if (kind === 'function') body += shell === 'powershell' ? "function sp { 'foreign' }\n" : 'sp() { printf foreign; }\n';
      body += shell === 'powershell'
        ? `$before = Get-Command sp -ListImported -ErrorAction SilentlyContinue\ntry { . $env:SP_ACTIVATOR; throw 'unexpected activation' } catch {\n if ($_.Exception.Message -notmatch '${kind === 'missing' ? 'session-peer is not available' : 'sp already exists'}') { throw }\n}\n$after = Get-Command sp -ListImported -ErrorAction SilentlyContinue\nif ($before.Definition -ne $after.Definition -or $before.CommandType -ne $after.CommandType) { throw 'collision changed' }\nexit 0\n`
        : 'before=$(command -v sp)\n. "$SP_ACTIVATOR"\ncode=$?\nafter=$(command -v sp)\n[ "$code" -eq 1 ] && [ "$before" = "$after" ]\n';
      const result = execute(shell, body, [], { PATH: kind === 'missing' ? '' : kind === 'executable' ? foreign + delimiter + env.PATH : env.PATH });
      assert.equal(result.status, 0, `${shell} ${kind}: ${result.stdout} ${result.stderr}`);
    }
    const clean = execute(shell, shell === 'powershell'
      ? psClear + '. $env:SP_ACTIVATOR\nRemove-Item Alias:sp\nif (Get-Command sp -ListImported -ErrorAction SilentlyContinue) { throw "sp remains" }\n'
      : (shell === 'bash' ? 'shopt -s expand_aliases\n' : '') + '. "$SP_ACTIVATOR" || exit $?\nunalias sp\n! command -v sp\n');
    assert.equal(clean.status, 0, clean.stderr);
    console.log(JSON.stringify({ shorthandContract: shell, status: 'pass' }));
  }
  return {
    // Install version A, activate, update in place to version B, then uninstall,
    // in every shell. The alias must follow the canonical command, not pin A.
    lifecycle(prefix: string, npm: string, from: { tarball: string; version: string }, to: { tarball: string; version: string }) {
      const npmFlags = ['--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund'];
      for (const shell of shells) {
        const install = spawnSync(process.execPath, [npm, 'install', ...npmFlags, from.tarball], { encoding: 'utf8', timeout: 120000 });
        assert.equal(install.status, 0, `${shell} install ${from.version}: ${install.stderr}`);
        const body = shell === 'powershell' ? psClear + `. $env:SP_ACTIVATOR
function Assert-Version([string]$name, [string]$expected, [string]$stage) {
    $actual = (& $name --version | Out-String).Trim()
    if ($actual -ne $expected) { throw "$name $stage reported '$actual', expected '$expected'" }
}
Assert-Version sp $env:SP_VERSION_A 'before update'
Assert-Version session-peer $env:SP_VERSION_A 'before update'
& $env:SP_NODE $env:SP_NPM install --prefix $env:SP_PREFIX --ignore-scripts --no-audit --no-fund $env:SP_TARBALL_B | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'update failed' }
Assert-Version sp $env:SP_VERSION_B 'after update'
Assert-Version session-peer $env:SP_VERSION_B 'after update'
& $env:SP_NODE $env:SP_NPM uninstall --prefix $env:SP_PREFIX --ignore-scripts --no-audit --no-fund session-peer | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'uninstall failed' }
foreach ($name in 'sp', 'session-peer') {
    try { & $name --version; throw "$name still runs after uninstall" }
    catch [System.Management.Automation.CommandNotFoundException] { }
}
Remove-Item Alias:sp
if (Get-Command sp -ListImported -ErrorAction SilentlyContinue) { throw 'sp remains' }
exit 0
` : (shell === 'bash' ? 'shopt -s expand_aliases\n' : '') + `. "$SP_ACTIVATOR" || exit $?
[ "$(sp --version)" = "$SP_VERSION_A" ] || { echo "sp before update: $(sp --version)" >&2; exit 11; }
[ "$(session-peer --version)" = "$SP_VERSION_A" ] || { echo "session-peer before update" >&2; exit 12; }
"$SP_NODE" "$SP_NPM" install --prefix "$SP_PREFIX" --ignore-scripts --no-audit --no-fund "$SP_TARBALL_B" >/dev/null || exit $?
[ "$(sp --version)" = "$SP_VERSION_B" ] || { echo "sp after update: $(sp --version)" >&2; exit 13; }
[ "$(session-peer --version)" = "$SP_VERSION_B" ] || { echo "session-peer after update" >&2; exit 14; }
"$SP_NODE" "$SP_NPM" uninstall --prefix "$SP_PREFIX" --ignore-scripts --no-audit --no-fund session-peer >/dev/null || exit $?
missing=$(sp --version 2>&1); code=$?
case "$code:$missing" in 127:*'not found'*) ;; *) echo "sp after uninstall: $code $missing" >&2; exit 15 ;; esac
missing=$(session-peer --version 2>&1); code=$?
case "$code:$missing" in 127:*'not found'*) ;; *) echo "session-peer after uninstall: $code $missing" >&2; exit 16 ;; esac
unalias sp || exit 17
! command -v sp
`;
        const result = execute(shell, body, [], { SP_NPM: npm, SP_PREFIX: prefix, SP_TARBALL_B: to.tarball, SP_VERSION_A: from.version, SP_VERSION_B: to.version });
        assert.equal(result.status, 0, `${shell} lifecycle: ${result.stdout} ${result.stderr}`);
        console.log(JSON.stringify({ shorthandLifecycle: shell, update: `${from.version} -> ${to.version}`, uninstall: true }));
      }
    }
  };
}
