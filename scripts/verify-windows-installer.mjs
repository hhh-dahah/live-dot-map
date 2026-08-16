import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploy = join(root, '.deploy');
const output = resolve(process.env.LIVEDOT_WINDOWS_INSTALLER_OUTPUT || join(root, 'dist', 'windows-installer'));
const executable = join(output, 'LiveDotMapSetup.exe');
const payload = join(output, 'payload');
const bridge = join(payload, 'livedot-bridge-win-x64.exe');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileDigest(path) {
  return sha256(await readFile(path));
}

function run(exe, args, { cwd = root, timeoutMs = 30_000 } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun({ stdout, stderr });
      else reject(new Error(`${exe} exited ${code ?? signal}: ${stderr || stdout}`));
    });
  });
}

function assertManifestFile(manifest, relative, actualSha256) {
  const entry = manifest.files?.[relative];
  assert.ok(entry, `manifest misses ${relative}`);
  assert.equal(entry.sha256, actualSha256, `manifest hash mismatch: ${relative}`);
}

await access(executable, constants.F_OK);
assert.ok((await stat(executable)).size > 1_000_000, 'WinForms setup executable is unexpectedly small');
const required = [
  'payload/payload-manifest.json',
  'payload/app.html',
  'payload/livedot-bridge-win-x64.exe',
  'payload/agent-kit/skills/live-dot-map/SKILL.md',
  'payload/agent-kit/skills/live-dot-map/templates/attempt.md',
  'installer-manifest.json',
];
for (const relative of required) await access(join(output, relative), constants.F_OK);
assert.ok((await stat(bridge)).size > 1_000_000, 'SEA payload is unexpectedly small');

const releaseManifestPath = join(deploy, 'release-manifest.json');
const releaseManifest = JSON.parse(await readFile(releaseManifestPath, 'utf8'));
const payloadManifest = JSON.parse(await readFile(join(payload, 'payload-manifest.json'), 'utf8'));
const installerManifest = JSON.parse(await readFile(join(output, 'installer-manifest.json'), 'utf8'));
// WinExe installers intentionally do not attach a console. Verify the payload
// directly here instead of depending on stdout from the GUI process.
for (const [relative, entry] of Object.entries(payloadManifest.files ?? {})) {
  const actual = await fileDigest(join(payload, relative));
  assert.equal(actual, entry.sha256, `payload hash mismatch: ${relative}`);
}
assert.equal(payloadManifest.schema, 1);
assert.equal(payloadManifest.product, 'live-dot-map');
assert.equal(installerManifest.schema, 1);
assert.equal(installerManifest.signed, false);
assert.equal(installerManifest.requiresAdministrator, false);
assert.equal(installerManifest.installScope, 'user-selected\\livedotmap\\current');
assert.equal(installerManifest.files['LiveDotMapSetup.exe'].bytes > 1_000_000, true);

const sourceSkill = join(root, 'agent-kit', 'skills', 'live-dot-map', 'SKILL.md');
const deploySkill = join(deploy, 'agent-kit', 'skills', 'live-dot-map', 'SKILL.md');
const payloadSkill = join(payload, 'agent-kit', 'skills', 'live-dot-map', 'SKILL.md');
const skillHash = await fileDigest(sourceSkill);
assert.equal(await fileDigest(deploySkill), skillHash, 'deploy canonical Skill differs from source');
assert.equal(await fileDigest(payloadSkill), skillHash, 'installer canonical Skill differs from source');
assert.equal(await fileDigest(join(root, 'livedot.mjs')), await fileDigest(join(deploy, 'livedot.mjs')), 'root and deploy livedot.mjs differ');

for (const relative of ['app.html', 'livedot-bridge-win-x64.exe']) {
  const deployHash = await fileDigest(join(deploy, relative));
  const payloadHash = await fileDigest(join(payload, relative));
  assert.equal(payloadHash, deployHash, `installer payload differs from deploy: ${relative}`);
  assertManifestFile(releaseManifest, relative, deployHash);
  assertManifestFile(payloadManifest, relative, payloadHash);
  assertManifestFile(installerManifest, `payload/${relative}`, payloadHash);
}
assertManifestFile(payloadManifest, 'agent-kit/skills/live-dot-map/SKILL.md', skillHash);
assertManifestFile(installerManifest, 'payload/agent-kit/skills/live-dot-map/SKILL.md', skillHash);
assert.equal(payloadManifest.sourceReleaseManifest.sha256, await fileDigest(releaseManifestPath), 'payload references a different release manifest');

// 品牌图标：多尺寸 .ico 必须进入 payload 清单。
const appIcon = join(payload, 'assets', 'app-icon.ico');
await access(appIcon, constants.F_OK);
assert.ok((await stat(appIcon)).size > 10_000, 'app-icon.ico is unexpectedly small');
assertManifestFile(payloadManifest, 'assets/app-icon.ico', await fileDigest(appIcon));

// 产品内更新清单：.deploy/windows-installer/ 必须与安装包 payload 完全一致，
// 本地桥 /api/v1/update/check 与 /api/v1/update/apply 依赖它。
const updateDir = join(deploy, 'windows-installer');
const updateManifestPath = join(updateDir, 'update-manifest.json');
await access(updateManifestPath, constants.F_OK);
const updateManifest = JSON.parse(await readFile(updateManifestPath, 'utf8'));
assert.equal(updateManifest.schema, 1);
assert.equal(updateManifest.product, 'live-dot-map');
assert.equal(updateManifest.version, payloadManifest.version, 'update manifest version differs from payload');
for (const [relative, entry] of Object.entries(payloadManifest.files ?? {})) {
  const deployed = join(updateDir, relative);
  await access(deployed, constants.F_OK);
  assert.equal(await fileDigest(deployed), entry.sha256, `update payload differs: ${relative}`);
  assert.equal(updateManifest.files?.[relative]?.sha256, entry.sha256, `update manifest hash mismatch: ${relative}`);
  assert.equal(updateManifest.files?.[relative]?.url, `payload/${relative}`, `update manifest url mismatch: ${relative}`);
}
assert.equal(updateManifest.files?.['livedot-bridge-win-x64.exe']?.bytes > 1_000_000, true, 'update manifest misses the bridge executable');

// The package must configure a genuinely empty project using only files in
// its payload. This catches missing external Skill/agent-kit dependencies.
const testRoot = resolve(process.env.LIVEDOT_WINDOWS_TEST_ROOT || 'D:\\LiveDotMap-Test');
await mkdir(testRoot, { recursive: true });
const project = await mkdtemp(join(testRoot, 'installer-fresh-'));
try {
  const installed = await run(bridge, ['install', '--project', project, '--app', join(payload, 'app.html'), '--no-shortcut'], { cwd: payload });
  const installResult = JSON.parse(installed.stdout);
  assert.equal(installResult.ok, true, installed.stdout);
  const map = JSON.parse(await readFile(join(project, '.live-dot-map', 'map.json'), 'utf8'));
  const config = JSON.parse(await readFile(join(project, '.live-dot-map', 'agent-kit.json'), 'utf8'));
  assert.equal(map.version, 2);
  assert.equal(config.projectRoot, project);
  assert.equal(config.runtimeMode, 'sea');
  assert.equal(config.runtime, null);
  const doctorOutput = await run(bridge, ['doctor', '--project', project], { cwd: payload });
  const doctor = JSON.parse(doctorOutput.stdout);
  assert.equal(doctor.ok, true, doctorOutput.stdout);
} finally {
  await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

console.log(JSON.stringify({
  ok: true,
  version: payloadManifest.version,
  installer: executable,
  payloadVerified: true,
  freshInstall: true,
  testRoot,
  doctor: true,
  sourceDeployPayloadHashes: true,
}, null, 2));
