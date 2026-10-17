import { fileURLToPath } from 'node:url';
import { run } from '../../dist/process.js';

export const privateMessage = () => '';
export const handoffCommand = () => {};
export async function prepareHandoff() {
  const worker = fileURLToPath(new URL('./watchdog-worker.cjs', import.meta.url));
  await run(process.execPath, [worker, process.env.FIXTURE_WATCHDOG_PID_FILE], { timeout: 60000 });
  return { value: {}, exitCode: 1 };
}
export const handoffSend = prepareHandoff;
