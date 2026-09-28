// Test-only preload. Report bounded transport metadata, never native output,
// arguments, environment, message bodies or credentials.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawnSync;
childProcess.spawnSync = function (command, ...args) {
  if (command === 'powershell.exe') {
    const options = args.at(-1);
    if (options && typeof options.input === 'string') {
      args[args.length - 1] = { ...options, input: options.input
        .replace("Add-Type -TypeDefinition @'", "[Console]::Error.WriteLine('inspection-phase:add-type');\nAdd-Type -TypeDefinition @'")
        .replace("'@\nfunction Identity", "'@\n[Console]::Error.WriteLine('inspection-phase:compiled');\nfunction Identity")
        .replace('$item = Get-CimInstance', "[Console]::Error.WriteLine('inspection-phase:cim');\n  $item = Get-CimInstance")
        .replace('$start = [string][Reader]::Start', "[Console]::Error.WriteLine('inspection-phase:process-times');\n  $start = [string][Reader]::Start")
        .replace('$owner = Invoke-CimMethod', "[Console]::Error.WriteLine('inspection-phase:owner-sid');\n  $owner = Invoke-CimMethod")
        .replace('return @{pid=', "[Console]::Error.WriteLine('inspection-phase:identity-ready');\n  return @{pid=") };
    }
  }
  const started = performance.now();
  const result = original.call(this, command, ...args);
  if (command === 'powershell.exe') {
    process.stderr.write(JSON.stringify({
      inspection: 'powershell',
      durationMs: Math.round(performance.now() - started),
      status: result.status,
      signal: result.signal,
      errorCode: result.error?.code ?? null,
      stdoutBytes: Buffer.byteLength(result.stdout ?? ''),
      stderrBytes: Buffer.byteLength(result.stderr ?? ''),
      phases: [...String(result.stderr ?? '').matchAll(/inspection-phase:(add-type|compiled|cim|process-times|owner-sid|identity-ready)\b/g)].map(match => match[1]),
    }) + '\n');
  }
  return result;
};
syncBuiltinESMExports();
