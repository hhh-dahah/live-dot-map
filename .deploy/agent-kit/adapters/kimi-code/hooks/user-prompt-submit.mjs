import { runHookCli } from '../../../lib/hooks.mjs';

await runHookCli('user-prompt-submit', { env: { ...process.env, LIVEDOT_AGENT: 'kimi' } });

