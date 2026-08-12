#!/usr/bin/env node
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { buildApp } from './build-app.mjs';

const root = resolve(import.meta.dirname, '..');
const deploy = resolve(root, '.deploy');

await mkdir(deploy, { recursive: true });
// Wrangler 3（当前 GitHub Action 的兼容回退版本）使用 .assetsignore；
// Windows SEA 桥由安装器/Release 分发，不应作为网页静态资产上传。
await writeFile(resolve(deploy, '.assetsignore'), [
  'livedot-bridge-win-x64.exe',
  'livedot-bridge-win-x64.blob',
  'sea-prep.exe',
  'sea-manifest.json',
  '',
].join('\n'), 'utf8');
await buildApp({ input: resolve(root, 'app.html'), output: resolve(deploy, 'app.html') });
await build({
  entryPoints: [resolve(root, 'src/cli/livedot.ts')],
  outfile: resolve(deploy, 'livedot.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  legalComments: 'none',
});
await cp(resolve(root, 'agent-kit'), resolve(deploy, 'agent-kit'), { recursive: true, force: true });
console.log('已校验生成 .deploy/app.html、.deploy/livedot.mjs 与 .deploy/agent-kit/（未部署）');
