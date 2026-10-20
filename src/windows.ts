import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, win32 } from 'node:path';
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
// exceeded 8 s on slow runners (#47, #65). Timeouts still fail closed.
export const COMPILED_INSPECTION_TIMEOUT_MS = 20000;
// The compile-free creation-time probe also exceeded 8 s on a cold runner (#78);
// discovery runs it once per listed PID, so it stays below the compiling path.
export const START_PROBE_TIMEOUT_MS = 15000;
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

// Private Windows storage (#131). Read-only inspection of reparse attributes
// along the path and of the leaf's owner and DACL; the only write is creating a new leaf directory with a
// protected owner-only DACL. No existing ACL is changed or relaxed (no icacls,
// no Set-Acl on existing paths, no inheritance edits above the leaf). Nothing
// here is wired into the handoff ledger yet: without native evidence for
// LockFileEx fencing, replace-over-open and durability, Windows ledger storage
// stays unsupported and these checks only define what qualification requires.
export type WindowsAce = { sid: string; allow: boolean; rights: number; inherited: boolean; inherits: boolean };
export type WindowsStorageEntry = { path: string; exists: boolean; directory?: boolean; reparse?: boolean;
  owner?: string; protected?: boolean; nullDacl?: boolean; rules?: WindowsAce[] };
export type WindowsStorageReport = { user: string; tokenOwner: string; entries: WindowsStorageEntry[] };
export type WindowsStorageFailure = 'path_unsupported' | 'inspection_failed' | 'missing' | 'reparse_point' | 'not_directory' |
  'not_file' | 'owner_mismatch' | 'acl_missing' | 'acl_inherited' | 'acl_broad';
const storageScript = String.raw`
$ErrorActionPreference = 'Stop'
$sid = [Security.Principal.SecurityIdentifier]
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$user = $identity.User.Value; $tokenOwner = $identity.Owner.Value
$entries = @()
foreach ($path in $paths) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if (!$item) { $entries += @{path=$path; exists=$false}; continue }
  $entry = @{path=$path; exists=$true; directory=[bool]$item.PSIsContainer; reparse=[bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)}
  if (!$entry.reparse -and $path -eq $paths[-1]) {
    $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]'Owner, Access')
    $entry.owner = $acl.GetOwner($sid).Value
    $entry.protected = [bool]$acl.AreAccessRulesProtected
    $entry.nullDacl = [bool]($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -match 'D:NO_ACCESS_CONTROL')
    $entry.rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object { @{sid=$_.IdentityReference.Value;
      allow=($_.AccessControlType -eq 'Allow'); rights=[int64]$_.FileSystemRights; inherited=[bool]$_.IsInherited;
      inherits=($_.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::None)} })
  }
  $entries += $entry
}
[Console]::Out.Write((ConvertTo-Json -InputObject @{user=$user; tokenOwner=$tokenOwner; entries=@($entries)} -Compress -Depth 5))
`;
// Every component from the drive root to the leaf, for reparse checks. UNC,
// device (\\?\, \\.\) and relative paths are not private-storage candidates.
export function windowsAncestors(path: string): string[] | undefined {
  if (!/^[A-Za-z]:\\/.test(path) || /[\0\r\n]/.test(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.')) return undefined;
  const parts = win32.normalize(path).replace(/\\+$/, '').split('\\');
  return parts.map((_, index) => index ? parts.slice(0, index + 1).join('\\') : parts[0] + '\\');
}
const sidPattern = /^S-1-[0-9]+(?:-[0-9]+){1,14}$/;
function storageReport(value: unknown, paths: string[]): WindowsStorageReport | undefined {
  const report = value as WindowsStorageReport;
  if (!report || typeof report !== 'object' || typeof report.user !== 'string' || !sidPattern.test(report.user) ||
      typeof report.tokenOwner !== 'string' || !sidPattern.test(report.tokenOwner) ||
      !Array.isArray(report.entries) || report.entries.length !== paths.length) return undefined;
  for (const [index, entry] of report.entries.entries()) {
    if (!entry || entry.path !== paths[index] || typeof entry.exists !== 'boolean') return undefined;
    if (!entry.exists) continue;
    if (typeof entry.directory !== 'boolean' || typeof entry.reparse !== 'boolean') return undefined;
    if (entry.reparse || index !== paths.length - 1) continue;
    if (typeof entry.owner !== 'string' || !sidPattern.test(entry.owner) || typeof entry.protected !== 'boolean' ||
        typeof entry.nullDacl !== 'boolean' || !Array.isArray(entry.rules) || entry.rules.length > 256 ||
        entry.rules.some(rule => !rule || typeof rule.sid !== 'string' || !sidPattern.test(rule.sid) || typeof rule.allow !== 'boolean' ||
          !Number.isSafeInteger(rule.rights) || typeof rule.inherited !== 'boolean' || typeof rule.inherits !== 'boolean')) return undefined;
  }
  return report;
}
// The leaf must be owned by the current user SID or the token's default owner
// (an elevated administrator's new files are owned by Administrators; measured
// on Windows 10 x64), but every allow ACE, inherited
// or inheritable included, must name that SID; a directory's DACL must be
// protected from its parent. No component may be a reparse point (symlink,
// junction, mount point or other tag), checked by attribute, not lstat.
export function windowsStorageFailure(report: WindowsStorageReport, kind: 'directory' | 'file'): WindowsStorageFailure | undefined {
  const entries = report.entries, leaf = entries.at(-1);
  if (!leaf) return 'inspection_failed';
  if (entries.some(entry => entry.exists && entry.reparse)) return 'reparse_point';
  if (!leaf.exists || entries.some(entry => !entry.exists)) return 'missing';
  if (kind === 'directory' ? !leaf.directory : leaf.directory) return kind === 'directory' ? 'not_directory' : 'not_file';
  if (leaf.owner !== report.user && leaf.owner !== report.tokenOwner) return 'owner_mismatch';
  if (leaf.nullDacl) return 'acl_missing';
  if (leaf.rules!.some(rule => rule.allow && rule.sid !== report.user)) return 'acl_broad';
  if (kind === 'directory' && (!leaf.protected || leaf.rules!.some(rule => rule.inherited))) return 'acl_inherited';
  return undefined;
}
export function inspectWindowsStorage(path: string): WindowsStorageReport {
  if (process.platform !== 'win32') throw new Refusal('windows_inspection_unavailable', 1);
  const paths = windowsAncestors(path);
  if (!paths) throw new Refusal('handoff_storage_untrusted', 1);
  const encoded = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64');
  // PowerShell 5.1 emits a JSON array as one object; cast, do not wrap in @().
  const code = `$paths = [string[]](ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))))\ntry {\n${storageScript}\n} catch { exit 1 }`;
  const done = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$script = [Console]::In.ReadToEnd(); Invoke-Expression $script'],
    { input: code, encoding: 'utf8', timeout: START_PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
  if (done.status !== 0 || done.error) throw new Refusal('windows_owner_inspection_failed', 1);
  let report: WindowsStorageReport | undefined;
  try { report = storageReport(JSON.parse(done.stdout), paths); } catch { /* Rejected below. */ }
  if (!report) throw new Refusal('windows_owner_inspection_failed', 1);
  return report;
}
// Fails closed with handoff_storage_untrusted; the specific failure is not
// surfaced because it would describe local ACL layout.
export function verifyWindowsPrivate(path: string, kind: 'directory' | 'file', inspect = inspectWindowsStorage): void {
  if (windowsStorageFailure(inspect(path), kind)) throw new Refusal('handoff_storage_untrusted', 1);
}
// Creates only a new leaf under an existing reparse-free parent, owned by the
// current user with a protected DACL granting that user alone, inherited by its
// contents; the whole chain is inspected again afterwards.
export function createWindowsPrivateDirectory(path: string, inspect = inspectWindowsStorage): void {
  if (process.platform !== 'win32') throw new Refusal('handoff_storage_unsupported', 1);
  const paths = windowsAncestors(path);
  if (!paths || paths.length < 2) throw new Refusal('handoff_storage_untrusted', 1);
  if (inspect(paths.at(-2)!).entries.some(entry => !entry.exists || entry.reparse)) throw new Refusal('handoff_storage_untrusted', 1);
  const encoded = Buffer.from(paths.at(-1)!, 'utf8').toString('base64');
  const code = `
$ErrorActionPreference = 'Stop'
try {
  $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
  if (Test-Path -LiteralPath $path) { exit 3 }
  if (!(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($path)) -PathType Container)) { exit 4 }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetOwner($user)
  $security.SetAccessRuleProtection($true, $false)
  $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($user, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
  [void][IO.Directory]::CreateDirectory($path, $security)
} catch { exit 1 }
`;
  const done = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$script = [Console]::In.ReadToEnd(); Invoke-Expression $script'],
    { input: code, encoding: 'utf8', timeout: START_PROBE_TIMEOUT_MS, maxBuffer: 65536, windowsHide: true });
  if (done.status === 3) throw new Refusal('handoff_ledger_exists', 1);
  if (done.status !== 0 || done.error) throw new Refusal('handoff_storage_untrusted', 1);
  verifyWindowsPrivate(paths.at(-1)!, 'directory', inspect);
}
