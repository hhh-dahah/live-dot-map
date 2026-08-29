import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const bridge = await readFile(new URL('../../src/web/bridge-client.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../../app.html', import.meta.url), 'utf8');

test('BridgeClient 外部编辑器 API 只传 opaque id 和相对文档路径', () => {
  for (const method of ['listEditors', 'openEditor', 'setPreferredEditor', 'pickManualEditor', 'saveMarkdownAsCopy']) {
    assert.match(bridge, new RegExp(`async ${method}\\(`), `${method} 缺失`);
  }
  for (const endpoint of ['/api/v1/editors', '/api/v1/editors/open', '/api/v1/editors/preferred', '/api/v1/editors/pick', '/api/v1/editors/save-as']) {
    assert.match(bridge, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
  assert.match(bridge, /body: \{ editorId, relativePath, targetKind \}/);
  assert.match(bridge, /body: \{ editorId \}/);
  assert.match(bridge, /body: \{ relativePath \}/);
  assert.doesNotMatch(bridge, /executablePath/);
});

test('BridgeClient 切图会先停放旧地图草稿，并按 mapKey 隔离 Markdown 基线', () => {
  assert.match(bridge, /private async attachProject\(/);
  assert.match(bridge, /await this\.prepareMapTransition\(\)/);
  assert.match(bridge, /await this\.attachProject\(/);
  assert.match(bridge, /private markdownBaseKey\(path: string, mapKey = this\.mapKey/);
  assert.match(bridge, /const effectiveBaseEtag = baseEtag \|\| base\.etag/);
  assert.match(bridge, /baseEtag: effectiveBaseEtag/);
  assert.match(bridge, /this\.mapKey = oldMapKey/);
});

test('Markdown 弹窗提供打开方式菜单、记住首选和另存副本入口（编辑器/文件夹名称由桥端清单给出）', () => {
  for (const label of ['打开方式', '下次直接用首选打开', '另存副本…']) assert.match(app, new RegExp(label));
  assert.match(app, /mdv-openwrap/);
  assert.match(app, /mdv-menu/);
  for (const method of ['listEditors', 'openEditor', 'setPreferredEditor', 'pickManualEditor', 'saveMarkdownAsCopy']) {
    assert.match(app, new RegExp(`bridge\\.bridge\\?\\.${method}|bridge\\.${method}`), `${method} 未接线`);
  }
  assert.match(app, /外部编辑器服务暂不可用，当前内容仍可编辑/);
  assert.match(app, /当前编辑内容仍保留/);
});

test('外部编辑器接口和 Markdown mapKey 基线行为可通过 BridgeClient 实际调用', async () => {
  const source = await readFile(new URL('../../src/web/bridge-client.ts', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm', platform: 'node', target: 'es2022' });
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.window = { addEventListener() {} };
  try {
    const module = await import(`data:text/javascript,${encodeURIComponent(compiled.code)}`);
    const client = new module.BridgeClient();
    client.origin = 'http://bridge.test';
    client.initialized = true;
    client.connected = true;
    client.csrf = 'csrf';
    client.projectHandle = 'project-handle';
    client.mapKey = 'map-a';
    globalThis.window.LiveDotApp = { setStatus() {} };
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith('/editors')) return new Response(JSON.stringify({ editors: [{ id: 'vscode', label: 'VS Code', available: true }], preferredEditorId: 'vscode' }), { status: 200 });
      if (requestUrl.pathname.endsWith('/markdown')) {
        if (options.method === 'PUT') return new Response(JSON.stringify({ content: 'saved', etag: 'etag-saved' }), { status: 200 });
        const etag = options.headers?.['X-LiveDot-Map-Key'] === 'map-b' ? 'etag-b' : 'etag-a';
        return new Response(JSON.stringify({ path: requestUrl.searchParams.get('path'), content: `remote-${etag}`, etag }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const listing = await client.listEditors();
    assert.equal(listing.preferredEditorId, 'vscode');
    await client.openEditor('vscode', '.live-dot-map/nodes/n1/index.md');
    await client.setPreferredEditor('vscode');
    await client.pickManualEditor();
    await client.saveMarkdownAsCopy('.live-dot-map/nodes/n1/index.md');
    const markdownPath = '.live-dot-map/nodes/n1/index.md';
    await client.readMarkdown(markdownPath);
    client.mapKey = 'map-b';
    await client.readMarkdown(markdownPath);
    client.mapKey = 'map-a';
    await client.writeMarkdown(markdownPath, 'updated');
    const openCall = calls.find(call => call.url.endsWith('/api/v1/editors/open'));
    assert.deepEqual(JSON.parse(openCall.options.body), { editorId: 'vscode', relativePath: markdownPath, targetKind: 'file' });
    const preferredCall = calls.find(call => call.url.endsWith('/api/v1/editors/preferred'));
    assert.deepEqual(JSON.parse(preferredCall.options.body), { editorId: 'vscode' });
    const saveAsCall = calls.find(call => call.url.endsWith('/api/v1/editors/save-as'));
    assert.deepEqual(JSON.parse(saveAsCall.options.body), { relativePath: markdownPath });
    const markdownSave = calls.find(call => call.url.endsWith('/api/v1/markdown') && call.options.method === 'PUT');
    assert.equal(JSON.parse(markdownSave.options.body).baseEtag, 'etag-a');
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
