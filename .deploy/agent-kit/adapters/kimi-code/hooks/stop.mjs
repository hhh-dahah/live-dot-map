import { runHookCli } from '../../../lib/hooks.mjs';

await runHookCli('stop', { env: { ...process.env, LIVEDOT_AGENT: 'kimi' } });

