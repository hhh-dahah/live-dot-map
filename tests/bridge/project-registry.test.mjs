import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProjectRegistry } from '../../src/bridge/project-registry.mjs';
import { runtimePaths } from '../../src/bridge/runtime-state.mjs';

async function fixture(test) {
  const root = await mkdtemp(join(tmpdir(), 'livedot-projects-'));
  const project = await mkdtemp(join(tmpdir(), 'livedot-project-'));
  test.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(project, { recursive: true, force: true })]));
  return { root, project };
}

test('project registry assigns a stable opaque handle and persists it', async (test) => {
  const { root, project } = await fixture(test);
  const registry = await ProjectRegistry.open({ runtimeStateDir: root });
  const first = await registry.register(project);
  const second = await registry.register(project);
  assert.match(first.projectHandle, /^ph_[A-Za-z0-9_-]{32}$/);
  assert.equal(second.projectHandle, first.projectHandle);
  assert.equal(registry.resolve(first.projectHandle).projectRoot, project);

  const reopened = await ProjectRegistry.open({ runtimeStateDir: root });
  assert.equal(reopened.resolve(first.projectHandle).projectRoot, project);
});

test('unknown handles and corrupt registries fail closed', async (test) => {
  const { root } = await fixture(test);
  const registry = await ProjectRegistry.open({ runtimeStateDir: root });
  assert.throws(() => registry.resolve('ph_unknown'), (error) => error?.code === 'PROJECT_HANDLE_NOT_FOUND');
  await writeFile(runtimePaths(root).projects, '{broken', 'utf8');
  await assert.rejects(ProjectRegistry.open({ runtimeStateDir: root }), (error) => error?.code === 'PROJECT_REGISTRY_CORRUPT');
});
