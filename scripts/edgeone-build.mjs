#!/usr/bin/env node
import { cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const deploy = resolve(root, '.deploy');
const output = resolve(root, '.edgeone-deploy');
// EdgeOne Makers scans the configured output directory directly and does not
// consume Wrangler's .assetsignore. The Windows bridge belongs to the
// installer/Release, not the public static site.
await rm(output, { recursive: true, force: true });
await cp(deploy, output, { recursive: true, force: true });
for (const file of [
  'livedot-bridge-win-x64.exe',
  'livedot-bridge-win-x64.blob',
  'sea-prep.exe',
  'sea-manifest.json',
]) await rm(resolve(output, file), { force: true });
console.log('EdgeOne static output prepared: release-only binaries excluded');
