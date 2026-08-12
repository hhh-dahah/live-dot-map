import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEA_CONFIG = resolve(ROOT, 'scripts', 'sea-config.json');
const OUT = resolve(ROOT, '.deploy', 'livedot-bridge-win-x64.exe');
const BLOB = resolve(ROOT, '.deploy', 'livedot-bridge-win-x64.blob');
const SEA_ENTRY = resolve(ROOT, '.deploy', 'sea-entry.cjs');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log(`跳过 Windows SEA：当前平台 ${process.platform}-${process.arch}`);
  process.exit(0);
}

async function run(command, args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

await build({
  entryPoints: [resolve(ROOT, 'src', 'cli', 'livedot.ts')],
  outfile: SEA_ENTRY,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
});
const config = {
  main: SEA_ENTRY,
  output: BLOB,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(SEA_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
await run(process.execPath, ['--experimental-sea-config', SEA_CONFIG]);
const blank = resolve(ROOT, '.deploy', 'sea-prep.exe');
await copyFile(process.execPath, blank);
const binary = (await readFile(process.execPath)).toString('latin1');
const fuse = binary.match(/NODE_SEA_FUSE_[A-Za-z0-9_]+/)?.[0];
if (!fuse) throw new Error('当前 Node 可执行文件没有可识别的 SEA sentinel fuse');
await run(process.execPath, [resolve(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'), blank, 'NODE_SEA_BLOB', BLOB, 'NODE_SEA_BLOB', '--sentinel-fuse', fuse]);
await rm(OUT, { force: true });
await copyFile(blank, OUT);
await rm(blank, { force: true });
await rm(BLOB, { force: true });
await writeFile(resolve(ROOT, '.deploy', 'sea-manifest.json'), `${JSON.stringify({ version: '2.0.0', platform: 'windows-x64', path: OUT, node: process.version, builtAt: new Date().toISOString(), note: 'unsigned internal RC; production installer still pending' }, null, 2)}\n`);
console.log(`已生成 ${OUT}`);
