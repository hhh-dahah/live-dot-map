import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installProject, doctorProject } from '../agent-kit/lib/installer.mjs';

const root = await mkdtemp(join(tmpdir(), 'livedot-installer-gate-'));
const result = await installProject({
  projectRoot: root,
  createDesktopShortcut: true,
  register: false,
  discoverAgents: false,
  platform: 'win32',
  env: { USERPROFILE: root },
  exec: () => { throw new Error('simulated desktop shortcut denial'); },
});
assert.equal(result.ok, true);
// 产品安装器负责唯一的“活点地图”桌面入口；项目配置不再创建“本地桥”快捷方式。
assert.equal(result.shortcut?.ok, true);
assert.equal(result.shortcut?.reason, 'product-installer-manages-shortcut');
assert.equal(result.shortcut?.skipped, true);
const config = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-kit.json'), 'utf8'));
assert.equal(config.version, 2);
assert.equal(Object.keys(config.installed).length, 4);
const doctor = await doctorProject({ projectRoot: root, checkBridge: false });
assert.equal(doctor.ok, true, JSON.stringify(doctor));
console.log(JSON.stringify({ ok: true, fallback: result.shortcut.fallback, doctor: doctor.ok }));
