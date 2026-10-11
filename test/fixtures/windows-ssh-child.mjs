// Test-only native SSH destination launcher. Base64 is request data, not JavaScript.
// Execute the exact production PowerShell command without a shell intermediary.
import { spawnSync } from 'node:child_process';
const encoded = process.argv[2];
if (process.argv.length !== 3 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded ?? '')) {
  process.stderr.write('invalid_fixture_encoded_command\n'); process.exit(2);
}
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
  { stdio: 'inherit', windowsHide: true, timeout: 55_000 });
process.exit(result.status ?? 254);
