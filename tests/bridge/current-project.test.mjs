import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readCurrentProject, recordCurrentProject, resolveProjectRootToUse } from '../../src/bridge/current-project.mjs';

async function makeRoots(t) {
  const base = await mkdtemp(join(tmpdir(), 'current-project-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const a = join(base, 'project-a');
  const b = join(base, 'project-b');
  await mkdir(a, { recursive: true });
  await mkdir(b, { recursive: true });
  const pointer = join(base, 'current-project.json');
  return { a, b, pointer, missing: join(base, 'nonexistent') };
}

test('recordCurrentProject → readCurrentProject → resolveProjectRootToUse 跟随', async (t) => {
  const { a, b, pointer, missing } = await makeRoots(t);

  // 指针不存在：读取 null、解析回落 fallback
  assert.equal(await readCurrentProject({ file: pointer }), null);
  assert.equal(await resolveProjectRootToUse(null, a, { file: pointer }), a);

  // 写入 A → 读回 A → 解析跟随 A（即使 fallback 是 B）
  assert.equal(await recordCurrentProject(a, { file: pointer }), true);
  assert.equal(await readCurrentProject({ file: pointer }), a);
  assert.equal(await resolveProjectRootToUse(null, b, { file: pointer }), a);

  // 切到 B → 解析跟随 B
  await recordCurrentProject(b, { file: pointer });
  assert.equal(await resolveProjectRootToUse(null, a, { file: pointer }), b);

  // 指针指向不存在的目录：fail-open 回落 fallback
  await recordCurrentProject(missing, { file: pointer });
  assert.equal(await resolveProjectRootToUse(null, a, { file: pointer }), a);

  // 损坏指针文件：回落
  await writeFile(pointer, '{broken', 'utf8');
  assert.equal(await readCurrentProject({ file: pointer }), null);
  assert.equal(await resolveProjectRootToUse(null, a, { file: pointer }), a);
});

test('resolveProjectRootToUse 直接传入候选根也校验目录存在', async (t) => {
  const { a, missing } = await makeRoots(t);
  assert.equal(await resolveProjectRootToUse(a, missing), a, '候选存在则用候选');
  assert.equal(await resolveProjectRootToUse(missing, a), a, '候选不存在回落 fallback');
});

test('readCurrentProject 容忍 UTF-8 BOM 头', async (t) => {
  const { a, pointer } = await makeRoots(t);
  await writeFile(pointer, `\uFEFF${JSON.stringify({ projectRoot: a })}`, 'utf8');
  assert.equal(await readCurrentProject({ file: pointer }), a, '即使带 BOM 也应正常解析');
});