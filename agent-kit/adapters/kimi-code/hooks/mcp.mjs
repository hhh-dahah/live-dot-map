import { createClientFromEnv } from '../../../lib/hooks.mjs';
import { MapMcpServer } from '../../../lib/mcp-tools.mjs';

await new MapMcpServer({ client: createClientFromEnv({ ...process.env, LIVEDOT_AGENT: 'kimi' }) }).serveStdio();

