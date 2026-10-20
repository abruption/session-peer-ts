// #20: Win32-OpenSSH client ProxyCommand construction for --ssh-jump. Pure
// models of the Win32 path, ported from PowerShell/openssh-portable latestw_all
// d0c65f24b6eec32b7cae4ed08eca81e8c1df791c (identical in v8.1.0.0, v9.5.0.0 and
// v10.0.0.0), libuv quote_cmd_arg and the UCRT argv parser. Source evidence, not
// an actual Windows client run: the CLI still refuses a Windows client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jumpOptions, proxyCommand, sshJump, windowsProxyCommand } from '../dist/ssh.js';

// libuv src/win/process.c quote_cmd_arg: how Node hands one argv element to CreateProcessW.
function libuvQuote(arg: string): string {
  if (!arg) return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  if (!/["\\]/.test(arg)) return `"${arg}"`;
  let out = '', quoteHit = true;
  for (let i = arg.length; i > 0; i--) {
    const c = arg[i - 1]!;
    out += c;
    if (quoteHit && c === '\\') out += '\\';
    else if (c === '"') { quoteHit = true; out += '\\'; } else quoteHit = false;
  }
  return `"${[...out].reverse().join('')}"`;
}
// UCRT argv_parsing.cpp parse_command_line (post-2008 rules), as used by ssh.exe wmain.
function ucrtArgv(line: string): string[] {
  const argv: string[] = []; let p = 0, name = '', quoted = false;
  // Program name: quotes toggle, backslashes are literal.
  for (; p < line.length && (quoted || (line[p] !== ' ' && line[p] !== '\t')); p++) {
    if (line[p] === '"') quoted = !quoted; else name += line[p];
  }
  argv.push(name); quoted = false;
  for (;;) {
    while (line[p] === ' ' || line[p] === '\t') p++;
    if (p >= line.length) return argv;
    let arg = '';
    for (;;) {
      let slashes = 0, copy = true;
      while (line[p] === '\\') { p++; slashes++; }
      if (line[p] === '"') {
        if (slashes % 2 === 0) {
          if (quoted && line[p + 1] === '"') p++;
          else { copy = false; quoted = !quoted; }
        }
        slashes = Math.floor(slashes / 2);
      }
      arg += '\\'.repeat(slashes);
      if (p >= line.length || (!quoted && (line[p] === ' ' || line[p] === '\t'))) break;
      if (copy) arg += line[p];
      p++;
    }
    argv.push(arg);
  }
}
// CreateProcessW(NULL, line): the module is the first quoted token or the text up to whitespace.
function createProcessModule(line: string): string {
  return line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(/[ \t]/)[0]!;
}
// misc.c argv_split(s, ..., 1): readconf runs it on every value and fails on unbalanced quotes.
function argvSplit(s: string): string[] {
  const argv: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ' ' || s[i] === '\t') continue;
    if (s[i] === '#') break;
    let quote = '', arg = '';
    for (; i < s.length; i++) {
      const c = s[i]!;
      if (c === '\\') {
        const n = s[i + 1];
        if (n === "'" || n === '"' || n === '\\' || (!quote && n === ' ')) arg += s[++i]; else arg += c;
      } else if (!quote && (c === ' ' || c === '\t')) break;
      else if (!quote && (c === '"' || c === "'")) quote = c;
      else if (quote && c === quote) quote = '';
      else arg += c;
    }
    if (i >= s.length && quote) throw new Error('invalid quotes');
    argv.push(arg);
    if (i >= s.length) break;
  }
  return argv;
}
// misc.c percent_expand: %% and the listed keys only; anything else is fatal.
function percentExpand(s: string, keys: Record<string, string>): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '%') { out += s[i]; continue; }
    const k = s[++i];
    if (k === '%') out += '%';
    else if (k !== undefined && k in keys) out += keys[k];
    else throw new Error('percent_expand: unknown key');
  }
  return out;
}
// misc.c build_commandline_string(cmd, {NULL}, FALSE) for posix_spawnp with no arguments.
function buildCommandline(cmd: string): string {
  if (cmd.startsWith('"')) return cmd;
  const exe = cmd.indexOf('.exe'), space = exe < 0 ? -1 : cmd.indexOf(' ', exe);
  return space < 0 ? `"${cmd}"` : `"${cmd.slice(0, space)}"${cmd.slice(space)}`;
}
// End to end: Node -> outer ssh.exe argv -> readconf -> sshconnect.c -> CreateProcessW -> hop ssh.exe argv.
function hopArgv(ssh: string, jump: string, target: { host: string; port: number }) {
  const options = jumpOptions(ssh, sshJump(jump), 'win32');
  const outer = ucrtArgv(['"C:\\outer\\ssh.exe"', ...options.map(libuvQuote)].join(' ')).slice(1);
  assert.deepEqual(outer, options, 'Node/UCRT round trip of the outer options');
  const line = outer[outer.length - 1]!;
  assert.match(line, /^ProxyCommand=/);
  const value = line.slice('ProxyCommand='.length);
  argvSplit(value);
  const expanded = percentExpand(`exec ${value}`, { h: target.host, k: target.host, n: target.host, p: String(target.port), r: 'u' }).slice(5);
  const commandLine = buildCommandline(expanded);
  assert.equal(commandLine, expanded, 'a leading quote is passed to CreateProcessW unchanged');
  return { module: createProcessModule(commandLine), argv: ucrtArgv(commandLine) };
}
const hardening = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=10',
  '-o', 'ConnectionAttempts=1', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'ControlPath=none', '-o', 'ForwardAgent=no',
  '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no'];

test('the parser models agree with documented MSVCRT and libuv examples', () => {
  for (const [line, argv] of [['a "b c" d', ['b c', 'd']], ['a "a\\"b"', ['a"b']], ['a a\\\\\\"b', ['a\\"b']], ['a "a\\\\"b', ['a\\b']],
    ['a "a""b"', ['a"b']], ['a c:\\x\\ y\\', ['c:\\x\\', 'y\\']], ['"C:\\a b\\x.exe" -T', ['-T']]] as const) {
    assert.deepEqual(ucrtArgv(line).slice(1), argv, line);
  }
  assert.equal(ucrtArgv('"C:\\a b\\x.exe" -T')[0], 'C:\\a b\\x.exe');
  for (const arg of ['', 'a b', 'a"b', 'a\\', 'a b\\', 'a\\"b', '\\\\"', 'x "y" \\z\\', '%PATH% ^&|<>', '日本 語', '"'])
    assert.deepEqual(ucrtArgv(`p ${libuvQuote(arg)}`).slice(1), [arg], JSON.stringify(arg));
  assert.deepEqual(argvSplit('"a b" c\\ d \'e"f\''), ['a b', 'c d', 'e"f']);
  assert.throws(() => argvSplit('"a'), /invalid quotes/);
  assert.equal(buildCommandline('C:\\a b\\ssh.exe -T x'), '"C:\\a b\\ssh.exe" -T x');
  assert.equal(buildCommandline('"C:\\a\\ssh.exe" -T'), '"C:\\a\\ssh.exe" -T');
});

test('windowsProxyCommand gives the hop exactly the fixed argv for adversarial ssh.exe paths', () => {
  const paths = ['C:\\Windows\\System32\\OpenSSH\\ssh.exe', 'C:\\Program Files\\OpenSSH\\ssh.exe', 'd:\\a b\\  c\\SSH.EXE',
    "C:\\Users\\O'Brien\\it's\\ssh.exe", 'C:\\100% sure\\%h %p %%\\ssh.exe', 'C:\\x^y&z(w)!;,=#$`{}[]~@+\\ssh.exe',
    'C:\\%PATH%\\%USERPROFILE%\\ssh.exe', 'C:\\x\\#start\\ssh.exe', 'C:\\Usuários\\José 日本語 😀\\ssh.exe', 'C:\\trailing. \\ssh.exe',
    'C:\\back\\\'\\ssh.exe', 'C:\\ssh.exe'];
  const jumps = [['hop@jump', ['-l', 'hop', '-W', '[target.example]:22', '--', 'jump']],
    ['h_o.p-1@jump.example:2200', ['-p', '2200', '-l', 'h_o.p-1', '-W', '[target.example]:22', '--', 'jump.example']],
    ['hop@[2001:db8::2]:22', ['-p', '22', '-l', 'hop', '-W', '[target.example]:22', '--', '2001:db8::2']]] as const;
  for (const path of paths) for (const [jump, tail] of jumps) {
    const { module, argv } = hopArgv(path, jump, { host: 'target.example', port: 22 });
    assert.equal(module, path, path);
    assert.deepEqual(argv, [path, ...hardening, ...tail], `${path} ${jump}`);
  }
  // The fixed target follows the outer destination: IPv6 is bracketed for -W.
  assert.deepEqual(hopArgv('C:\\a b\\ssh.exe', 'hop@jump', { host: '2001:db8::1', port: 2222 }).argv.slice(-4), ['-W', '[2001:db8::1]:2222', '--', 'jump']);
  // A configured HostName with a space (trusted ssh_config) still yields one -W argument and no extra option.
  assert.deepEqual(hopArgv('C:\\a\\ssh.exe', 'hop@jump', { host: 'a -oProxyCommand=x', port: 22 }).argv.slice(-4), ['-W', '[a -oProxyCommand=x]:22', '--', 'jump']);
  assert.equal(windowsProxyCommand('C:\\100%\\ssh.exe', sshJump('hop@jump:2200'), {}),
    '"C:\\100%%\\ssh.exe" -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ConnectTimeout=10 -o ConnectionAttempts=1 ' +
    '-o ProxyCommand=none -o ProxyJump=none -o ControlPath=none -o ForwardAgent=no -o ClearAllForwardings=yes -o PermitLocalCommand=no ' +
    '-p 2200 -l hop -W "[%h]:%p" -- jump');
  assert.deepEqual(jumpOptions('C:\\a\\ssh.exe', sshJump('hop@jump'), 'win32').slice(0, 6),
    ['-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ProxyUseFdpass=no']);
});

test('the POSIX ProxyCommand would not survive Win32-OpenSSH, so the platforms differ', () => {
  const posixLine = percentExpand(`exec ${proxyCommand('C:\\a b\\ssh.exe', sshJump('hop@jump'))}`, { h: 't', p: '22' }).slice(5);
  const commandLine = buildCommandline(posixLine);
  // No shell removes the single quotes: the module name and -W target are wrong.
  assert.notEqual(createProcessModule(commandLine), 'C:\\a b\\ssh.exe');
  assert.ok(ucrtArgv(commandLine).includes("'[t]:22'"));
  assert.equal(jumpOptions('/usr/bin/ssh', sshJump('hop@jump'), 'linux').at(-1), `ProxyCommand=${proxyCommand('/usr/bin/ssh', sshJump('hop@jump'))}`);
});

test('ssh.exe paths that cannot be represented safely are refused before any effect', () => {
  const jump = sshJump('hop@jump');
  for (const path of ['ssh.exe', 'ssh', 'OpenSSH\\ssh.exe', '\\ssh.exe', 'C:ssh.exe', 'C:\\a"b\\ssh.exe', 'C:\\a\\ssh.exe"', '"C:\\a\\ssh.exe"',
    'C:\\a\\', 'C:\\a\\ssh.exe\\', '\\\\server\\share\\ssh.exe', '\\\\?\\C:\\a\\ssh.exe', '\\\\.\\C:\\a\\ssh.exe', 'C:/a/ssh.exe', 'C:\\a/b\\ssh.exe',
    'C:\\a\\\\ssh.exe', 'C:\\a:b\\ssh.exe', 'C:\\a\\ssh.exe:alt', 'C:\\a*\\ssh.exe', 'C:\\a?\\ssh.exe', 'C:\\a<\\ssh.exe', 'C:\\a>\\ssh.exe',
    'C:\\a|\\ssh.exe', 'C:\\a\tb\\ssh.exe', 'C:\\a\nb\\ssh.exe', 'C:\\a\x00\\ssh.exe', 'C:\\a\x7f\\ssh.exe', 'C:\\a\\ssh.cmd', 'C:\\a\\ssh.bat',
    'C:\\a\\ssh.exe ', 'C:\\a\\ssh.exe.lnk', 'C:\\a\\sshd-session.exe', 'C:\\a\\xssh.exe', 'C:\\a\\scp.exe', 'C:\\a\uD800\\ssh.exe',
    'C:\\a\uDC00b\\ssh.exe', `C:\\${'a'.repeat(4090)}\\ssh.exe`, '/usr/bin/ssh', ''])
    assert.throws(() => windowsProxyCommand(path, jump, {}), /ssh_jump_unsupported_ssh_path/, JSON.stringify(path));
  assert.throws(() => jumpOptions('/usr/bin/ssh', jump, 'win32'), /ssh_jump_unsupported_ssh_path/);
  for (const value of ['1', ' 1', '-1', '7x']) assert.throws(() => windowsProxyCommand('C:\\a\\ssh.exe', jump, { SSH_TEST_ENVIRONMENT: value }), /ssh_jump_unsupported_environment/);
  for (const value of ['0', '', 'yes', '0x1']) assert.doesNotThrow(() => windowsProxyCommand('C:\\a\\ssh.exe', jump, { SSH_TEST_ENVIRONMENT: value }));
  // Jump fields are validated by sshJump first; nothing reaches the builder with %, quotes or spaces.
  for (const value of ['hop@j%h', 'h%r@jump', 'hop@"j"', 'hop@j k', "hop@j'k", 'hop@j\\k', 'hop@j^k', 'hop@j&k']) assert.throws(() => sshJump(value), /invalid_ssh_jump/);
});
