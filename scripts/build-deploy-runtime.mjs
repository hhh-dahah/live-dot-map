#!/usr/bin/env node
import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { buildApp } from './build-app.mjs';

const root = resolve(import.meta.dirname, '..');
const deploy = resolve(root, '.deploy');

await mkdir(deploy, { recursive: true });
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
