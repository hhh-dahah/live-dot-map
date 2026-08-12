import { build } from 'esbuild';

const outputIndex = process.argv.indexOf('--output');
const outfile = outputIndex >= 0 ? process.argv[outputIndex + 1] : 'livedot.mjs';

await build({
  entryPoints: ['src/cli/livedot.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  legalComments: 'none',
});
