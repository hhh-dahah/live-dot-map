import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  EditorService,
  parseRegistryOutput,
} from '../../src/bridge/editor-service.mjs';

const TEST_ROOT = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');

async function fixture(testContext) {
  await mkdir(TEST_ROOT, { recursive: true });
  const root = await mkdtemp(join(TEST_ROOT, 'editor-service-'));
  const settingsPath = join(root, 'state', 'settings.json');
  const docs = join(root, 'docs');
  await mkdir(docs, { recursive: true });
  await writeFile(join(docs, 'note.md'), '# note\n');
  testContext.after(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  return { root, settingsPath, note: join(docs, 'note.md') };
}

test('编辑器清单只暴露 opaque id，并优先识别真实 Code.exe', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const vscode = join(root, 'Code.exe');
  await writeFile(vscode, 'fake executable');
  const service = await EditorService.open({
    projectRoot: root,
    settingsPath,
    nativeHelper: async () => undefined,
    registryReader: async () => [join(root, 'code.cmd'), vscode],
    knownVSCodePaths: [],
    extraEditors: [],
  });

  const listing = await service.list();
  assert.deepEqual(listing.editors.map((item) => item.id), ['vscode', 'system', 'folder', 'manual']);
  assert.equal(listing.editors.find((item) => item.id === 'vscode').available, true);
  assert.equal(JSON.stringify(listing).includes(vscode), false);
  assert.equal(JSON.stringify(listing).includes('code.cmd'), false);
});

test('VS Code 启动只使用实际 Code.exe、固定参数和 shell:false', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const vscode = join(root, 'Code.exe');
  await writeFile(vscode, 'fake executable');
  const calls = [];
  const service = await EditorService.open({
    projectRoot: root,
    settingsPath,
    registryReader: async () => [join(root, 'code.cmd'), vscode],
    knownVSCodePaths: [],
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      return { unref() {} };
    },
  });

  const result = await service.open({ editorId: 'vscode', relativePath: 'docs/note.md' });
  assert.equal(result.launched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, vscode);
  assert.deepEqual(calls[0].args, ['--reuse-window', join(root, 'docs', 'note.md')]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].args.includes('code.cmd'), false);
});

test('VS Code 失效后重新探测并回退到默认应用', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const vscode = join(root, 'Code.exe');
  await writeFile(vscode, 'fake executable');
  const service = await EditorService.open({
    projectRoot: root,
    settingsPath,
    nativeHelper: async () => undefined,
    registryReader: async () => [vscode],
    knownVSCodePaths: [],
    extraEditors: [],
  });
  assert.equal((await service.list()).editors.some((item) => item.id === 'vscode' && item.available), true);
  await unlink(vscode);
  const listing = await service.list();
  assert.equal(listing.editors.some((item) => item.id === 'vscode'), false);
  assert.equal(listing.preferredEditorId, 'system');
});

test('额外编辑器按候选路径探测、暴露 opaque id 并用固定参数启动', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const antigravity = join(root, 'Antigravity.exe');
  await writeFile(antigravity, 'fake executable');
  const calls = [];
  const service = await EditorService.open({
    projectRoot: root,
    settingsPath,
    nativeHelper: async () => undefined,
    registryReader: async () => [],
    knownVSCodePaths: [],
    extraRegistryReader: async () => [],
    extraEditors: [{ id: 'antigravity', label: 'Antigravity', appPaths: ['Antigravity.exe'], candidates: () => [antigravity] }],
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      return { unref() {} };
    },
  });

  const listing = await service.list();
  assert.deepEqual(listing.editors.map((item) => item.id), ['antigravity', 'system', 'folder', 'manual']);
  assert.equal(listing.preferredEditorId, 'antigravity');
  assert.equal(JSON.stringify(listing).includes(antigravity), false);

  const result = await service.open({ editorId: 'antigravity', relativePath: 'docs/note.md' });
  assert.equal(result.launched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, antigravity);
  assert.deepEqual(calls[0].args, [join(root, 'docs', 'note.md')]);
  assert.equal(calls[0].options.shell, false);
});

test('项目路径越界和符号链接均被拒绝', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const outside = await mkdtemp(join(TEST_ROOT, 'editor-outside-'));
  await writeFile(join(outside, 'secret.md'), 'secret');
  t.after(() => rm(outside, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  const service = await EditorService.open({
    projectRoot: root,
    settingsPath,
    nativeHelper: async () => undefined,
  });

  await assert.rejects(
    service.open({ editorId: 'system', relativePath: '../editor-outside/secret.md' }),
    (error) => error.code === 'EDITOR_PATH_OUTSIDE_PROJECT',
  );
  const link = join(root, 'docs', 'outside.md');
  try {
    await symlink(join(outside, 'secret.md'), link, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) return;
    throw error;
  }
  await assert.rejects(
    service.open({ editorId: 'system', relativePath: 'docs/outside.md' }),
    (error) => error.code === 'SYMLINK_ESCAPE',
  );
});

test('系统默认应用、所在文件夹和手动程序都走原生 helper', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const manual = join(root, 'MyEditor.exe');
  await writeFile(manual, 'fake executable');
  const calls = [];
  const nativeHelper = async (request) => {
    calls.push(request);
    if (request.operation === 'pick-editor') return { path: manual };
    if (request.operation === 'save-as') return { destinationPath: join(root, 'export.md') };
    return { ok: true };
  };
  const service = await EditorService.open({ projectRoot: root, settingsPath, nativeHelper });
  await assert.rejects(service.open({ editorId: 'manual', relativePath: 'docs/note.md' }), /手动选择/);
  await service.pickManualEditor();
  await service.open({ editorId: 'manual', relativePath: 'docs/note.md' });
  await service.open({ editorId: 'system', relativePath: 'docs/note.md' });
  await service.open({ editorId: 'folder', relativePath: 'docs/note.md' });
  const exported = await service.saveAs({ relativePath: 'docs/note.md' });

  assert.equal(exported.exported, true);
  assert.deepEqual(calls.map((item) => item.operation), ['pick-editor', 'open-manual', 'open-default', 'open-folder', 'save-as']);
  assert.equal(calls.every((item) => !('command' in item) && !('args' in item)), true);
  assert.equal(calls.find((item) => item.operation === 'open-folder').targetPath, join(root, 'docs'));
  assert.equal(calls.find((item) => item.operation === 'save-as').suggestedName, 'note.md');
});

test('对象形式 native helper 保持实例上下文', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const calls = [];
  const helper = {
    marker: 'bound',
    async run(request) { calls.push({ marker: this.marker, ...request }); return { ok: true }; },
  };
  const service = await EditorService.open({ projectRoot: root, settingsPath, nativeHelper: helper });
  await service.open({ editorId: 'system', relativePath: 'docs/note.md' });
  assert.equal(calls[0].marker, 'bound');
  assert.equal(calls[0].operation, 'open-default');
});

test('手动程序只能由原生选择器登记，设置文件原子写入且不暴露路径', async (t) => {
  const { root, settingsPath } = await fixture(t);
  const manual = join(root, 'MyEditor.exe');
  await writeFile(manual, 'fake executable');
  const service = await EditorService.open({
    projectRoot: root,
    settingsPath,
    nativePicker: async () => manual,
    nativeHelper: async () => undefined,
  });
  await assert.rejects(service.registerManual({ path: manual }), (error) => error.code === 'NATIVE_PICKER_REQUIRED');
  await service.pickManualEditor();
  const persisted = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.editors.manual.path, manual);
  assert.equal(JSON.stringify((await service.list())).includes(manual), false);

  await writeFile(settingsPath, '{broken');
  const recovered = await EditorService.open({ projectRoot: root, settingsPath, nativeHelper: async () => undefined });
  const listing = await recovered.list();
  assert.equal(listing.editors.some((item) => item.id === 'manual'), true);
});

test('App Paths 注册表解析只提取默认 Code.exe 值', () => {
  const output = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe',
    '    (Default)    REG_SZ    "C:\\Program Files\\Microsoft VS Code\\Code.exe" "%1"',
    '    Path         REG_SZ    C:\\Program Files\\Microsoft VS Code',
  ].join('\n');
  assert.deepEqual(parseRegistryOutput(output), ['C:\\Program Files\\Microsoft VS Code\\Code.exe']);
});
