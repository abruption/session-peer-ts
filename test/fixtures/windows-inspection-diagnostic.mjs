// Test-only preload. Report bounded transport metadata, never native output,
// arguments, environment, message bodies or credentials.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawnSync;
childProcess.spawnSync = function (command, ...args) {
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
    }) + '\n');
  }
  return result;
};
syncBuiltinESMExports();
