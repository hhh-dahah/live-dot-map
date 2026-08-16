import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploy = join(root, '.deploy');
// CI and local verification can use an isolated output while a user keeps the
// default installer open. This never changes the payload content or manifest.
const output = resolve(process.env.LIVEDOT_WINDOWS_INSTALLER_OUTPUT || join(root, 'dist', 'windows-installer'));
const payload = join(output, 'payload');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const payloadFiles = [
  'app.html', 'livedot-bridge-win-x64.exe', 'manifest.webmanifest', 'sw.js', 'favicon.ico',
  'icons/icon-192.png', 'icons/icon-512.png', 'assets/app-icon.ico',
  'agent-kit/skills/live-dot-map/SKILL.md',
  'agent-kit/skills/live-dot-map/templates/attempt.md',
];

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}

async function removeGeneratedFile(path) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'UNKNOWN'].includes(error?.code) || attempt === 7) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 300 + attempt * 300));
    }
  }
}

async function removeGeneratedDirectory(path) {
  let failure;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
      return;
    } catch (error) {
      failure = error;
      if (!['EBUSY', 'EPERM', 'UNKNOWN'].includes(error?.code) || attempt === 7) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 350 + attempt * 350));
    }
  }
  throw new Error(`无法更新 Windows 安装器输出目录（请关闭仍在运行的 LiveDotMapSetup.exe）：${failure?.message || 'unknown error'}`, { cause: failure });
}

async function buildSeaWithRetry() {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await removeGeneratedFile(join(deploy, 'sea-prep.exe'));
    await removeGeneratedFile(join(deploy, 'livedot-bridge-win-x64.blob'));
    try {
      await run(process.execPath, ['scripts/build-sea.mjs']);
      return;
    } catch (error) {
      failure = error;
      if (attempt < 3) await new Promise((resolveWait) => setTimeout(resolveWait, 1_000 * attempt));
    }
  }
  throw failure;
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

// Keep the checkout runtime, deploy runtime and installer payload on the same
// source revision. The installer verification checks these hashes explicitly.
// Synchronize every Agent distribution copy before build-deploy-runtime copies
// the tree into .deploy. Without this step a previous parallel build can leave
// an adapter/plugin Skill at an older hash even though the canonical file is
// current; the installer payload would then pass while Agent distribution
// verification fails.
await run(process.execPath, ['scripts/sync-agent-skill.mjs']);
await run(process.execPath, ['scripts/build-cli.mjs']);
await run(process.execPath, ['scripts/build-deploy-runtime.mjs']);
// 品牌图标：从 icons/icon-512.png 生成多尺寸 .ico 并同步到 deploy（供 payload 与网页 favicon 使用）。
await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'generate-app-icon.ps1')]);
await cp(join(root, 'assets', 'app-icon.ico'), join(deploy, 'assets', 'app-icon.ico'), { force: true });
await cp(join(root, 'favicon.ico'), join(deploy, 'favicon.ico'), { force: true });
// The root CLI is the checkout/runtime source of truth.  Copy the exact
// bytes into the deploy tree so a concurrent build or platform-specific
// esbuild path cannot leave a release with two different livedot.mjs hashes.
await cp(join(root, 'livedot.mjs'), join(deploy, 'livedot.mjs'), { force: true });
await buildSeaWithRetry();
await run(process.execPath, ['scripts/build-release-manifest.mjs']);
await removeGeneratedDirectory(output);
await mkdir(output, { recursive: true });
// Publish outside the final directory. GenerateBundle opens its destination
// more than once on Windows, and placing a populated payload beside it can
// make Defender/indexers race the self-contained executable.
const publishOutput = `${output}.publish-${process.pid}-${Date.now()}`;
try {
  await run('dotnet', ['publish', 'installer/winforms/LiveDotMapSetup.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-o', publishOutput]);
  await cp(join(publishOutput, 'LiveDotMapSetup.exe'), join(output, 'LiveDotMapSetup.exe'), { force: true });
} finally {
  await removeGeneratedDirectory(publishOutput);
}
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
  installScope: 'user-selected\\livedotmap\\current',
  requiresAdministrator: false,
  runtime: 'self-contained-dotnet8-win-x64 + node-sea-win-x64',
  files: installerHashes,
}, null, 2)}\n`, 'utf8');
const executable = join(output, 'LiveDotMapSetup.exe');
const executableSize = (await stat(executable)).size;
// 产品内更新清单：复制 payload 到 .deploy/windows-installer/（EdgeOne/CloudBase 线上源），
// 供本地桥 /api/v1/update/check 与 /api/v1/update/apply 下载比对。
const updateDir = join(deploy, 'windows-installer');
await removeGeneratedDirectory(updateDir);
await mkdir(updateDir, { recursive: true });
const updateFiles = {};
for (const entry of payloadFiles) {
  const source = join(payload, entry);
  const target = join(updateDir, entry);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { force: true });
  const { bytes, sha256 } = payloadHashes[entry];
  updateFiles[entry] = { bytes, sha256, url: `payload/${entry}` };
}
await writeFile(join(updateDir, 'update-manifest.json'), `${JSON.stringify({
  schema: 1,
  product: 'live-dot-map',
  version: packageJson.version,
  channel: 'internal-rc',
  files: updateFiles,
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, output, executable, executableSize, payloadFiles: Object.keys(payloadHashes), updateManifest: join(updateDir, 'update-manifest.json') }, null, 2));
