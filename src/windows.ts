import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import { Refusal } from './discovery.js';
import { UnknownOutcome } from './process.js';

export type WindowsProcess = {pid: number; uid: string; command: string; start: string};

// Get-CimInstance and Restart Manager are Windows read-only APIs. The script
// emits only PID, SID, executable basename and creation time. No arguments,
// command line, message body, token or file contents are returned.
const inspectScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Reader {
  [StructLayout(LayoutKind.Sequential)] public struct Time { public uint Lo; public uint Hi; }
  [StructLayout(LayoutKind.Sequential)] public struct Unique { public uint Pid; public Time Start; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Info {
    public Unique Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string App;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string Service;
    public uint Kind; public uint Status; public uint Session;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("Rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmStartSession(out uint session, uint flags, StringBuilder key);
  [DllImport("Rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmRegisterResources(uint session, uint files, string[] paths, uint apps, IntPtr app, uint services, IntPtr svc);
  [DllImport("Rstrtmgr.dll")] public static extern int RmGetList(uint session, out uint needed, ref uint count, [In,Out] Info[] info, ref uint reasons);
  [DllImport("Rstrtmgr.dll")] public static extern int RmEndSession(uint session);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out Time creation, out Time exit, out Time kernel, out Time user);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static ulong Start(uint pid) {
    var handle = OpenProcess(0x1000, false, pid);
    if (handle == IntPtr.Zero) throw new Exception("process_unavailable");
    try {
      Time created, exited, kernel, user;
      if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) throw new Exception("process_unavailable");
      return ((ulong)created.Hi << 32) | created.Lo;
    } finally { CloseHandle(handle); }
  }
}
'@
function Identity([uint32]$identifier, [string]$expected = '') {
  $item = Get-CimInstance Win32_Process -Filter "ProcessId = $identifier"
  if (!$item) { throw 'process_unavailable' }
  $start = [string][Reader]::Start($identifier)
  if ($expected -and $start -ne $expected) { throw 'process_replaced' }
  $owner = Invoke-CimMethod -InputObject $item -MethodName GetOwnerSid
  if (!$owner.Sid) { throw 'owner_unavailable' }
  return @{pid=[int]$identifier; uid=[string]$owner.Sid; command=[string]$item.Name; start=$start}
}
function Openers([string]$location) {
  [uint32]$session = 0
  $key = New-Object System.Text.StringBuilder 33
  if ([Reader]::RmStartSession([ref]$session, 0, $key) -ne 0) { throw 'rm_start_failed' }
  try {
    $paths = [string[]]@($location)
    if ([Reader]::RmRegisterResources($session, 1, $paths, 0, [IntPtr]::Zero, 0, [IntPtr]::Zero) -ne 0) { throw 'rm_register_failed' }
    [uint32]$needed = 0; [uint32]$count = 128; [uint32]$reasons = 0
    $rows = New-Object 'Reader+Info[]' 128
    if ([Reader]::RmGetList($session, [ref]$needed, [ref]$count, $rows, [ref]$reasons) -ne 0 -or $count -gt 128) { throw 'rm_list_failed' }
    $result = @()
    for ($i=0; $i -lt $count; $i++) {
      $ticks = ([uint64]$rows[$i].Process.Start.Hi -shl 32) -bor $rows[$i].Process.Start.Lo
      $result += Identity $rows[$i].Process.Pid ([string]$ticks)
    }
    return ,$result
  } finally { [void][Reader]::RmEndSession($session) }
}
`;

// Add-Type compiles the helper with csc on every inspectWindows call, which has
// exceeded 8 s on slow runners (#47, #65). Timeouts still fail closed. The
// compile-free creation-time probe keeps the shorter deadline.
export const COMPILED_INSPECTION_TIMEOUT_MS = 20000;
export const START_PROBE_TIMEOUT_MS = 8000;
export function inspectWindows(mode: 'identity' | 'openers', value: string): WindowsProcess[] {
  if (process.platform !== 'win32') throw new Refusal('windows_inspection_unavailable', 1);
  const encodedValue = Buffer.from(value, 'utf8').toString('base64');
  const code = inspectScript + `
$value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedValue}'))
try {
  $result = if ('${mode}' -eq 'identity') { @(Identity ([uint32]$value)) } else { @(Openers $value) }
  ConvertTo-Json -InputObject @($result) -Compress -Depth 4
} catch { exit 1 }
`;
  const done = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$script = [Console]::In.ReadToEnd(); Invoke-Expression $script'],
    { input:code, encoding:'utf8', timeout:COMPILED_INSPECTION_TIMEOUT_MS, maxBuffer:65536, windowsHide:true });
  if (done.status !== 0 || done.error) throw new Refusal('windows_owner_inspection_failed', 1);
  let rows: unknown;
  try { rows = JSON.parse(done.stdout); } catch { throw new Refusal('windows_owner_inspection_failed', 1); }
  if (!Array.isArray(rows) || rows.length > 128 || rows.some(row =>
    !row || !Number.isSafeInteger(row.pid) || row.pid <= 0 ||
    typeof row.uid !== 'string' || !row.uid.startsWith('S-') ||
    typeof row.command !== 'string' || !row.command ||
    typeof row.start !== 'string' || !/^\d+$/.test(row.start))) {
    throw new Refusal('windows_owner_inspection_failed', 1);
  }
  return rows as WindowsProcess[];
}

export function windowsProcessStart(pid: number): bigint | undefined {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 1 || pid > 2147483647) return undefined;
  // Claude discovery only needs the creation time. Avoid compiling Reader and
  // querying CIM/GetOwnerSid for every listed PID; Codex ownership still uses
  // inspectWindows above. Dispose the native process handle on every path.
  const code = `
$ErrorActionPreference = 'Stop'
try {
  $item = [Diagnostics.Process]::GetProcessById(${pid})
  try {
    if ($item.HasExited) { exit 1 }
    $ticks = $item.StartTime.ToUniversalTime().ToFileTimeUtc()
    [Console]::Out.WriteLine($ticks.ToString([Globalization.CultureInfo]::InvariantCulture))
  } finally { $item.Dispose() }
} catch { exit 1 }
`;
  try {
    const done = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code],
      { encoding: 'utf8', timeout: START_PROBE_TIMEOUT_MS, maxBuffer: 65536, windowsHide: true });
    if (done.status !== 0 || done.error) return undefined;
    const text = done.stdout.trim();
    if (!/^[1-9][0-9]{0,18}$/.test(text)) return undefined;
    const ticks = BigInt(text);
    return ticks <= 9223372036854775807n ? ticks : undefined;
  } catch { return undefined; }
}

function authLine(pid: number): string {
  const directory = join(process.env.CLAUDE_CONFIG_DIR || process.env.ANTHROPIC_CONFIG_DIR ||
    join(process.env.USERPROFILE || '', '.claude'), 'sessions');
  let names: string[];
  try { names = readdirSync(directory).filter(name => new RegExp(`^${pid}\\.[^.]+\\.key$`).test(name)); }
  catch { throw new Refusal('windows_inbox_auth_unavailable', 1); }
  if (names.length !== 1) throw new Refusal('windows_inbox_auth_unavailable', 1);
  const file = join(directory, names[0]!);
  try {
    const entry = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 16384) throw new Error('invalid_key');
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const token = (value as {peerToken?: unknown})?.peerToken;
    if (typeof token !== 'string' || !token.trim()) throw new Error('invalid_key');
    return JSON.stringify({type:'auth',token}) + '\n';
  } catch { throw new Refusal('windows_inbox_auth_unavailable', 1); }
}

export async function postWindowsPipe(pipe: string, pid: number, text: string): Promise<void> {
  if (!/^\\\\\.\\pipe\\[^\r\n]+$/i.test(pipe)) throw new Refusal('invalid_windows_pipe', 1);
  const auth = authLine(pid);
  const payload = auth + JSON.stringify({type:'user',message:{role:'user',content:text}}) + '\n';
  return new Promise((resolve,reject) => {
    let connected = false, finished = false;
    const socket = createConnection(pipe);
    const timeout = setTimeout(() => finish(new Error('timeout')), 10000);
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); socket.destroy();
      if (error) reject(connected ? new UnknownOutcome() : new Refusal('inbox_unreachable', 1));
      else resolve();
    };
    socket.once('error', error => finish(error));
    socket.once('connect', () => {
      connected = true;
      socket.write(payload, error => {
        if (error) return finish(error);
        const drain = setTimeout(() => finish(), 2000);
        socket.once('close', () => { clearTimeout(drain); finish(); });
        socket.once('data', () => { clearTimeout(drain); finish(); });
      });
    });
  });
}
