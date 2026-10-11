import { register } from 'node:module';

register('./watchdog-loader.mjs', import.meta.url, {
  data: JSON.parse(process.env.FIXTURE_WATCHDOG_LOADER),
});
