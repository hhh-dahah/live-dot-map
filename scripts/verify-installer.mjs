import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
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
assert.equal(result.shortcut?.ok, false);
assert.equal(result.shortcut?.type, 'windows-lnk');
await stat(result.shortcut.fallback);
const config = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-kit.json'), 'utf8'));
assert.equal(config.version, 2);
assert.equal(Object.keys(config.installed).length, 3);
const doctor = await doctorProject({ projectRoot: root, checkBridge: false });
assert.equal(doctor.ok, true, JSON.stringify(doctor));
console.log(JSON.stringify({ ok: true, fallback: result.shortcut.fallback, doctor: doctor.ok }));
