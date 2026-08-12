import { build } from 'esbuild';

await build({
  entryPoints: ['src/shared/index.ts'],
  outfile: 'src/shared/index.mjs',
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
});
