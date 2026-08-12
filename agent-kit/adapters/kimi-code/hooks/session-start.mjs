import { runHookCli } from '../../../lib/hooks.mjs';

await runHookCli('session-start', { env: { ...process.env, LIVEDOT_AGENT: 'kimi' } });

