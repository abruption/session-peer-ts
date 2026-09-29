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
    SP_NODE: process.execPath, SP_ROOT: root, SP_STDIN: '' };
  const psHeader = `$ErrorActionPreference = 'Stop'\n$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n`;
  const psClear = 'Remove-Item Alias:sp -ErrorAction SilentlyContinue\n';
  function execute(shell: Shell, body: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
    const file = join(root, shell === 'powershell' ? 'invoke.ps1' : 'invoke.sh');
    const argv = join(root, 'arguments.json'); writeFileSync(argv, JSON.stringify(args));
    writeFileSync(file, shell === 'powershell' ? '\ufeff' + psHeader + body : body);
    const program = shell === 'powershell'
      ? join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/' + shell;
    const options = shell === 'powershell' ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '. $env:SP_SCRIPT']
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
      ? `$arguments = @(Get-Content -LiteralPath $env:SP_ARGUMENTS -Raw -Encoding UTF8 | ConvertFrom-Json)\n$env:SP_STDIN | & ${name} @arguments\nexit $LASTEXITCODE\n`
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
  for (const shell of shells) {
    for (const args of cases) {
      const direct = invoke(shell, false, args, 'stdin 한글\nsecond line');
      const short = invoke(shell, true, args, 'stdin 한글\nsecond line');
      assert.equal(short.status, direct.status, `${shell} ${args[0]}: ${short.stderr}`);
      assert.equal(short.stdout, direct.stdout, `${shell} ${args[0]}`);
      if (args.includes('--allow-inactive-codex-home')) {
        const result = JSON.parse(short.stdout); assert.equal(result.status, 'validated'); assert.equal(result.submitted, false);
      } else if (args.includes('--bad') || args.includes('--message')) assert.equal(short.status, 2);
      else assert.equal(short.status, 0, short.stdout);
    }
    const args = ['one two', '한글 🚀', '--', '-leading', "single'quote", '$HOME;$(echo BAD)&|%PATH%!^'];
    const direct = invoke(shell, false, args, 'stdin α\nsecond line', true);
    const short = invoke(shell, true, args, 'stdin α\nsecond line', true);
    assert.equal(short.status, 7, short.stderr); assert.equal(short.stdout, direct.stdout);
    const captured = JSON.parse(short.stdout);
    assert.deepEqual(captured.args, args, `${shell}: arguments must not be reparsed`);
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
    lifecycle(prefix: string, npm: string, tarball: string) {
      const shell = shells[0]!;
      const body = shell === 'powershell' ? psClear + `. $env:SP_ACTIVATOR
$before = & sp --version
& $env:SP_NODE $env:SP_NPM install --prefix $env:SP_PREFIX --ignore-scripts --no-audit --no-fund $env:SP_TARBALL | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'reinstall failed' }
$after = & sp --version
if ($before -ne $after) { throw 'alias changed after update' }
& $env:SP_NODE $env:SP_NPM uninstall --prefix $env:SP_PREFIX --ignore-scripts --no-audit --no-fund session-peer | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'uninstall failed' }
try { & sp --version; throw 'unexpected command after uninstall' } catch [System.Management.Automation.CommandNotFoundException] { }
Remove-Item Alias:sp
if (Get-Command sp -ListImported -ErrorAction SilentlyContinue) { throw 'sp remains' }
` : `shopt -s expand_aliases
. "$SP_ACTIVATOR" || exit $?
before=$(sp --version) || exit $?
"$SP_NODE" "$SP_NPM" install --prefix "$SP_PREFIX" --ignore-scripts --no-audit --no-fund "$SP_TARBALL" >/dev/null || exit $?
after=$(sp --version) || exit $?
[ "$before" = "$after" ] || exit 1
"$SP_NODE" "$SP_NPM" uninstall --prefix "$SP_PREFIX" --ignore-scripts --no-audit --no-fund session-peer >/dev/null || exit $?
if sp --version; then exit 1; fi
unalias sp
! command -v sp
`;
      const result = execute(shell, body, [], { SP_NPM: npm, SP_PREFIX: prefix, SP_TARBALL: tarball });
      assert.equal(result.status, 0, `${shell} lifecycle: ${result.stdout} ${result.stderr}`);
      console.log(JSON.stringify({ shorthandLifecycle: shell, reinstall: true, uninstall: true }));
    }
  };
}
