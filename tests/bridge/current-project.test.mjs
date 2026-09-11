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
  await mkdir(join(a, '.live-dot-map'), { recursive: true });
  await mkdir(join(b, '.live-dot-map'), { recursive: true });
  const pointer = join(base, 'current-project.json');
  return { a, b, pointer, missing: join(base, 'nonexistent') };
}

test('recordCurrentProject → readCurrentProject → resolveProjectRootToUse 跟随', async (t) => {
  const { a, b, pointer, missing } = await makeRoots(t);
  const opts = { file: pointer, allowTemp: true };

  // 指针不存在：读取 null、解析回落 fallback
  assert.equal(await readCurrentProject(opts), null);
  assert.equal(await resolveProjectRootToUse(null, a, opts), a);

  // 写入 A → 读回 A → 解析跟随 A（即使 fallback 是 B）
  assert.equal(await recordCurrentProject(a, opts), true);
  assert.equal(await readCurrentProject(opts), a);
  assert.equal(await resolveProjectRootToUse(null, b, opts), a);

  // 切到 B → 解析跟随 B
  await recordCurrentProject(b, opts);
  assert.equal(await resolveProjectRootToUse(null, a, opts), b);

  // 指针指向不存在的目录：fail-open 回落 fallback
  await recordCurrentProject(missing, opts);
  assert.equal(await resolveProjectRootToUse(null, a, opts), a);

  // 损坏指针文件：回落
  await writeFile(pointer, '{broken', 'utf8');
  assert.equal(await readCurrentProject(opts), null);
  assert.equal(await resolveProjectRootToUse(null, a, opts), a);
});

test('resolveProjectRootToUse 拒绝系统临时目录（防测试污染）', async (t) => {
  const { a, b, pointer } = await makeRoots(t);
  await recordCurrentProject(a, { file: pointer });
  // 默认不传 allowTemp 时，临时目录被坚决拒绝，自动回落 b
  assert.equal(await resolveProjectRootToUse(null, b, { file: pointer }), b);
});

test('resolveProjectRootToUse 拒绝没有 .live-dot-map 的非活点项目目录', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'current-project-no-map-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const emptyDir = join(base, 'not-a-map-project');
  const fallback = join(base, 'fallback');
  await mkdir(emptyDir, { recursive: true });
  await mkdir(join(fallback, '.live-dot-map'), { recursive: true });
  const pointer = join(base, 'current-project.json');
  await recordCurrentProject(emptyDir, { file: pointer });

  assert.equal(await resolveProjectRootToUse(null, fallback, { file: pointer, allowTemp: true }), fallback);
});

test('resolveProjectRootToUse 直接传入候选根也校验目录存在', async (t) => {
  const { a, missing } = await makeRoots(t);
  assert.equal(await resolveProjectRootToUse(a, missing, { allowTemp: true }), a, '候选存在则用候选');
  assert.equal(await resolveProjectRootToUse(missing, a, { allowTemp: true }), a, '候选不存在回落 fallback');
});

test('readCurrentProject 容忍 UTF-8 BOM 头', async (t) => {
  const { a, pointer } = await makeRoots(t);
  await writeFile(pointer, `\uFEFF${JSON.stringify({ projectRoot: a })}`, 'utf8');
  assert.equal(await readCurrentProject({ file: pointer }), a, '即使带 BOM 也应正常解析');
});