import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploy = join(root, '.deploy');
const output = join(root, 'dist', 'windows-installer');
const payload = join(output, 'payload');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const payloadFiles = [
  'app.html', 'livedot-bridge-win-x64.exe', 'manifest.webmanifest', 'sw.js', 'favicon.ico',
  'icons/icon-192.png', 'icons/icon-512.png',
];

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}

async function sha256(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function enumerateFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await enumerateFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

await run(process.execPath, ['scripts/build-deploy-runtime.mjs']);
await run(process.execPath, ['scripts/build-sea.mjs']);
await run(process.execPath, ['scripts/build-release-manifest.mjs']);
await rm(output, { recursive: true, force: true });
await mkdir(payload, { recursive: true });
for (const sourceRelative of payloadFiles) {
  const source = join(deploy, sourceRelative);
  const target = join(payload, sourceRelative);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { force: true });
}
const payloadHashes = Object.fromEntries(await Promise.all(payloadFiles.map(async (entry) => [entry, await sha256(join(payload, entry))])));
const releaseManifest = await sha256(join(deploy, 'release-manifest.json'));
await writeFile(join(payload, 'payload-manifest.json'), `${JSON.stringify({
  schema: 1,
  product: 'live-dot-map',
  version: packageJson.version,
  channel: 'internal-rc',
  signed: false,
  sourceReleaseManifest: releaseManifest,
  files: payloadHashes,
}, null, 2)}\n`, 'utf8');

await run('dotnet', ['publish', 'installer/winforms/LiveDotMapSetup.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-o', output]);
const installerFiles = await enumerateFiles(output);
const installerHashes = {};
for (const file of installerFiles) installerHashes[relative(output, file).replaceAll('\\', '/')] = await sha256(file);
await writeFile(join(output, 'installer-manifest.json'), `${JSON.stringify({
  schema: 1,
  product: 'live-dot-map',
  version: packageJson.version,
  channel: 'internal-rc',
  signed: false,
  installer: 'LiveDotMapSetup.exe',
  installScope: '%LocalAppData%\\LiveDotMap',
  requiresAdministrator: false,
  runtime: 'self-contained-dotnet8-win-x64 + node-sea-win-x64',
  files: installerHashes,
}, null, 2)}\n`, 'utf8');
const executable = join(output, 'LiveDotMapSetup.exe');
const executableSize = (await stat(executable)).size;
console.log(JSON.stringify({ ok: true, output, executable, executableSize, payloadFiles: Object.keys(payloadHashes) }, null, 2));
