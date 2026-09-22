#!/usr/bin/env node
// 一键发布产品内更新通道（批次 B2）：
//   bump patch 版本 → 全量构建（core/app/bridge/installer，复用现有 npm scripts）
//   → 校验产物与更新通道三件套 hash 自洽 → 生成 .edgeone-deploy
//   → 默认只打印变更清单与建议的 commit 命令；--push 才真正 git add/commit/push。
//
// 通道事实（2026-08 核实）：
// - 发布通道 = master 分支 .deploy/ → EdgeOne Makers 自动部署到 livedotmap.top。
// - 桥端 /api/v1/update/apply 只接受清单里的相对 url，从 https://livedotmap.top/windows-installer/ 下载；
//   清单没有 installer 字段时回退用本地已安装的 exe 执行切换（src/bridge/server.mjs applyUpdate）。
// - LiveDotMapSetup.exe ~196MB，超 GitHub 单文件 100MB 硬限，永远进不了 git 通道
//   （.gitignore 已排除；安装器本体按仓库约定走 GitHub Release 附件分发）。
//   因此发布时从通道 update-manifest.json 摘除 installer 字段，让桥走本地 exe 回退，
//   避免线上 404 导致 UPDATE_DOWNLOAD_FAILED。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploy = join(root, '.deploy');
const updateDir = join(deploy, 'windows-installer');
const updateManifestPath = join(updateDir, 'update-manifest.json');
const payloadManifestPath = join(updateDir, 'payload', 'payload-manifest.json');
const setupExePath = join(updateDir, 'LiveDotMapSetup.exe');
const distInstallerDir = process.env.LIVEDOT_WINDOWS_INSTALLER_OUTPUT
  ? resolve(process.env.LIVEDOT_WINDOWS_INSTALLER_OUTPUT)
  : join(root, 'dist', 'windows-installer');

const push = process.argv.includes('--push');
// GitHub 单文件硬限 100MB；EdgeOne Pages 单文件限制 25MiB（超出部署失败）。
const GITHUB_HARD_LIMIT = 95 * 1024 * 1024;
const EDGEONE_FILE_LIMIT = 25 * 1024 * 1024;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileDigest = async (path) => sha256(await readFile(path));
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

function run(command, args, { shell = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}

// Windows 上 spawn npm.cmd 必须经 shell（Node 安全修复后对 .cmd 直拉会 EINVAL）。
const npm = 'npm';
const node = process.execPath;

async function git(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('git', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun(stdout.trim()) : reject(new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`)));
  });
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

let bumpedFrom = null;
let bumpedTo = null;

async function step(name, remediation, fn) {
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    return await fn();
  } catch (error) {
    console.error(`\n✖ 步骤失败：${name}`);
    console.error(`  原因：${error?.message || error}`);
    if (bumpedFrom && bumpedTo) {
      console.error(`  版本号：已从 ${bumpedFrom} bump 到 ${bumpedTo}。`);
      console.error(`  如需放弃本次发布，把 package.json 的 version 改回 "${bumpedFrom}" 即可（产物与 .deploy 不推送就不会影响线上）。`);
    }
    if (remediation) console.error(`  人工补救：${remediation}`);
    process.exit(1);
  }
}

// ---- 1. bump patch 版本 ----------------------------------------------------
await step('bump package.json patch 版本', '手工编辑 package.json 的 version 字段后重跑本脚本。', async () => {
  const packageJsonPath = join(root, 'package.json');
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const parts = String(pkg.version).split('.').map((n) => Number.parseInt(n, 10));
  assert.equal(parts.length, 3, `version 不是 x.y.z 形式：${pkg.version}`);
  assert.ok(parts.every((n) => Number.isInteger(n) && n >= 0), `version 不是 x.y.z 形式：${pkg.version}`);
  bumpedFrom = pkg.version;
  bumpedTo = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  pkg.version = bumpedTo;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`版本：${bumpedFrom} → ${bumpedTo}`);
});

// ---- 2. 全量构建（全部复用现有 npm scripts） -------------------------------
const buildStartedAt = Date.now();
await step(
  '构建 core/app/bridge',
  '先单独跑 npm run build 看具体失败点；常见原因是 src 在制品语法错误，修好后重跑本脚本（版本号会再 bump 一次，或先改回再跑）。',
  () => run(npm, ['run', 'build'], { shell: true }),
);
await step(
  '构建 Windows 安装器与更新通道三件套',
  '先单独跑 npm run build:windows-installer；若提示输出目录占用，关闭仍在运行的 LiveDotMapSetup.exe 后重试。需要 dotnet SDK 与 powershell。',
  () => run(npm, ['run', 'build:windows-installer'], { shell: true }),
);

// ---- 3. 产物校验（verify-release + verify-installer） ----------------------
await step(
  '校验 release 产物（verify-release.mjs）',
  '对照 scripts/verify-release.mjs 的断言逐项检查 .deploy；SEA 相关断言失败时先确认 npm run build:sea 产物存在。',
  () => run(node, ['scripts/verify-release.mjs']),
);
await step(
  '校验安装器逻辑（verify-installer.mjs）',
  '对照 scripts/verify-installer.mjs；agent-kit 安装/医生逻辑失败时先跑 npm run verify:installer 复现。',
  () => run(node, ['scripts/verify-installer.mjs']),
);

// ---- 4. 通道三件套：新构建 + hash 自洽 --------------------------------------
let updateManifest;
await step('校验更新通道三件套 hash 自洽', '三件套都由 build:windows-installer 一次产出；不一致说明 .deploy/windows-installer 被手工动过，重跑上一步构建。', async () => {
  for (const path of [updateManifestPath, payloadManifestPath, setupExePath]) await access(path);
  for (const path of [updateManifestPath, payloadManifestPath, setupExePath]) {
    const info = await stat(path);
    assert.ok(info.mtimeMs >= buildStartedAt - 5_000, `${relative(root, path)} 不是本次构建产出（mtime 早于构建开始）`);
  }
  updateManifest = JSON.parse(await readFile(updateManifestPath, 'utf8'));
  const payloadManifest = JSON.parse(await readFile(payloadManifestPath, 'utf8'));
  assert.equal(updateManifest.version, bumpedTo, 'update-manifest 版本与 bump 不一致');
  assert.equal(payloadManifest.version, bumpedTo, 'payload-manifest 版本与 bump 不一致');
  assert.equal(updateManifest.payloadHash, payloadManifest.payloadHash, 'payloadHash 不一致');
  for (const [entry, meta] of Object.entries(updateManifest.files)) {
    const file = join(updateDir, meta.url);
    const bytes = await readFile(file);
    assert.equal(bytes.byteLength, meta.bytes, `${entry} 字节数与清单不一致`);
    assert.equal(sha256(bytes), meta.sha256, `${entry} sha256 与清单不一致`);
  }
  assert.ok(updateManifest.installer?.sha256, 'update-manifest 缺 installer 字段（构建脚本行为变了？）');
  assert.equal(await fileDigest(setupExePath), updateManifest.installer.sha256, 'LiveDotMapSetup.exe 与清单 installer.sha256 不一致');
  assert.equal(await fileDigest(setupExePath), await fileDigest(join(distInstallerDir, 'LiveDotMapSetup.exe')), '.deploy 与 dist 的 exe 不一致');
  console.log(`三件套就绪：update-manifest.json + payload/${Object.keys(updateManifest.files).length} 项 + LiveDotMapSetup.exe（${mb(updateManifest.installer.bytes)}）`);
  console.log(`payloadHash: ${updateManifest.payloadHash}`);
});

// ---- 5. exe 通道决策：超 GitHub 硬限 → 摘除 installer 字段 -----------------
await step('安装器本体通道决策', '若 exe 实际可走通道（如更换了托管），删掉本步骤并保留 installer 字段。', async () => {
  const exeBytes = (await stat(setupExePath)).size;
  if (exeBytes <= GITHUB_HARD_LIMIT && updateManifest.installer) {
    console.log(`exe ${mb(exeBytes)} 未超 GitHub 硬限，installer 字段保留（确认 EdgeOne 25MiB 限制已解除再上线）。`);
    return;
  }
  delete updateManifest.installer;
  await writeFile(updateManifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, 'utf8');
  console.log(`exe ${mb(exeBytes)} 超 GitHub 100MB 硬限，不进 git 通道（.gitignore 已排除）。`);
  console.log('已从通道 update-manifest.json 摘除 installer 字段：桥端 applyUpdate 将回退使用本地已安装 exe 执行切换。');
  console.log('安装器本体请走 GitHub Release 附件分发（仓库既定约定）：');
  console.log(`  文件：${setupExePath}`);
  console.log(`  sha256：${await fileDigest(setupExePath)}`);
});

// ---- 6. EdgeOne 静态输出 ----------------------------------------------------
await step('生成 .edgeone-deploy', '单独跑 npm run build:edgeone 复现；它只做 .deploy → .edgeone-deploy 的复制与剔除。', () => run(npm, ['run', 'build:edgeone'], { shell: true }));

// ---- 7. .deploy 与 .edgeone-deploy 通道目录一致性 ---------------------------
await step('核对 .edgeone-deploy 通道内容', '不一致说明 edgeone-build.mjs 的剔除清单与本脚本假设漂移，对照修改。', async () => {
  const edgeoneDir = join(root, '.edgeone-deploy', 'windows-installer');
  const sourceFiles = (await enumerateFiles(updateDir)).map((file) => relative(updateDir, file).replaceAll('\\', '/'));
  for (const relativePath of sourceFiles) {
    if (relativePath === 'LiveDotMapSetup.exe' || relativePath === 'payload/livedot-bridge-win-x64.exe') {
      // exe 不进 EdgeOne 输出（25MiB 限制 + 不进 git，CI 侧 .deploy 里根本没有它）。
      await access(join(edgeoneDir, relativePath)).then(() => {
        throw new Error('.edgeone-deploy 不应包含发布级大二进制（Setup/payload exe）');
      }, () => undefined);
      continue;
    }
    assert.equal(await fileDigest(join(edgeoneDir, relativePath)), await fileDigest(join(updateDir, relativePath)), `.edgeone-deploy 与 .deploy 不一致：${relativePath}`);
  }
  console.log(`.edgeone-deploy/windows-installer 与 .deploy 一致（${sourceFiles.length - 2} 个文件；两个发布级 exe 按预期缺席）。`);
});

// ---- 8. git 变更清单与可选推送 ----------------------------------------------
const commitMessage = `chore(release): 发布 v${bumpedTo} 更新通道（payloadHash ${updateManifest.payloadHash.slice(0, 12)}）`;
await step('准备 git 变更清单', 'git 命令失败时手工执行打印出的命令序列。', async () => {
  const status = await git(['status', '--porcelain']);
  const lines = status ? status.split('\n') : [];
  console.log(`工作区变更 ${lines.length} 项。与本次发布直接相关：`);
  console.log(`  M package.json（version ${bumpedFrom} → ${bumpedTo}）`);
  console.log('  M .deploy/windows-installer/update-manifest.json');
  console.log('  ? .deploy/windows-installer/payload/**（首次进 git：旧布局顶层文件将删除，改为 payload/ 布局）');
  console.log('  M .deploy/release-manifest.json / .deploy/livedot.mjs / .deploy/app.html 等构建产物');
  // 大文件体检：payload 里超 EdgeOne 25MiB 的文件会给部署带来风险，必须显眼提示。
  const payloadFiles = await enumerateFiles(join(updateDir, 'payload'));
  for (const file of payloadFiles) {
    const size = (await stat(file)).size;
    if (size > EDGEONE_FILE_LIMIT) {
      console.log(`  ⚠ ${relative(updateDir, file)} = ${mb(size)}，超 EdgeOne 25MiB 单文件限制：`);
      console.log('    它必须进 git 通道否则产品内更新拿不到新桥本体；但若 EdgeOne 部署因此失败，');
      console.log('    需要为桥二进制另找托管（桥端只认通道相对 url，届时再改桥）。本次先按现状提交。');
    }
  }
  const other = lines.filter((line) => !line.includes('.deploy/') && !line.includes('package.json') && !line.includes('.gitignore'));
  if (other.length) {
    console.log(`  注意：还有 ${other.length} 项与发布无关的在制品变更会被 git add -A 一并提交，推送前请人工过目：`);
    for (const line of other.slice(0, 30)) console.log(`    ${line}`);
    if (other.length > 30) console.log(`    … 以及另外 ${other.length - 30} 项（git status 查看全部）`);
  }
  if (!push) {
    console.log('\n未加 --push：不执行任何 git 写操作。确认无误后发布：');
    console.log('  git add -A');
    console.log(`  git commit -m "${commitMessage}"`);
    console.log('  git push origin master');
    console.log('（EdgeOne Makers 检测到 master 推送后自动部署到 livedotmap.top）');
    return;
  }
  console.log('\n--push 已指定，执行 git add -A && commit && push origin master …');
  await git(['add', '-A']);
  await git(['commit', '-m', commitMessage]);
  await git(['push', 'origin', 'master']);
  console.log('已推送。EdgeOne Makers 将自动部署；用 npm run verify:online 确认线上 hash。');
});

// ---- 9. 回滚指引 -------------------------------------------------------------
console.log(`
=== 回滚指引 ===
版本：${bumpedTo}（上一版本 ${bumpedFrom}），payloadHash：${updateManifest.payloadHash}
- 已 push 要回滚：git revert HEAD && git push origin master。
  产品内更新以 payloadHash 为第一判定信号且不回推降级：线上清单回到旧 payloadHash 后，
  已更新到 ${bumpedTo} 的客户端不会收到任何提示，停留在新版本，等下一次修复发布即可。
- 未 push 要放弃：把 package.json 的 version 改回 "${bumpedFrom}"，再跑一次
  npm run build:windows-installer && npm run build:edgeone 让 .deploy 回到旧内容（或干脆不提交）。
- 安装器 exe 若已上传 GitHub Release：到 Release 页面删除对应附件/整个 Release。
- 线上应急核对：curl https://livedotmap.top/windows-installer/update-manifest.json 看 version/payloadHash。`);
