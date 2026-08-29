#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS } from '../src/bridge/tool-service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'agent-kit', 'lib', 'tool-definitions.generated.mjs');
const source = `// 由 scripts/sync-tool-definitions.mjs 生成，请勿手改。\nexport const MCP_TOOL_DEFINITIONS = Object.freeze(${JSON.stringify(TOOL_DEFINITIONS, null, 2)});\nexport const MCP_TOOL_NAMES = Object.freeze(MCP_TOOL_DEFINITIONS.map((tool) => tool.name));\n`;
await writeFile(output, source, 'utf8');
console.log(`已同步 ${TOOL_DEFINITIONS.length} 项工具定义到 ${output}`);
