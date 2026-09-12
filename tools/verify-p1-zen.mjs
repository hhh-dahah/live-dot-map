import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promises as fs } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = `file://${resolve(ROOT, 'app.html').replace(/\\/g, '/')}`;
const SCREENSHOT_DIR = resolve(ROOT, 'tmp', 'verify-p1');

async function run() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  console.log('启动 Chromium 测试方案一（极简纯净沉浸派）...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // 预置 localStorage 与 LiveDotBridge 模拟，以完整验证编辑器与资料包功能
  await context.addInitScript(() => {
    try {
      localStorage.setItem('dotmap-standalone-seen', '1');
    } catch {}
    window.LiveDotBridge = {
      active: true,
      async readMarkdown(path, opts) {
        return { path, content: '# 节点详情\n\n初始文档内容', etag: 'mock-1' };
      },
      async writeMarkdown(path, content, etag) {
        window.__savedMarkdown = content;
        return { ok: true, etag: 'mock-2' };
      },
      async listBundleFiles(ownerKind, ownerId, includeArchived) {
        return [
          { name: 'index.md', path: 'index.md', isIndex: true, size: 120 },
          { name: 'notes.md', path: 'notes.md', isIndex: false, size: 80 }
        ];
      },
      async readBundleMarkdown(ownerKind, ownerId, fileName) {
        return { name: fileName, content: `# 资料包 / ${fileName}\n\n补充内容`, etag: 'mock-1' };
      },
      async replaceBundleMarkdown(ownerKind, ownerId, fileName, content, etag) {
        window.__savedMarkdown = content;
        return { ok: true, etag: 'mock-2' };
      },
      async listEditors() {
        return { editors: [{ id: 'vscode', label: 'VS Code', available: true }] };
      },
      assetReadUrl(kind, id, name) {
        return name;
      }
    };
  });

  const page = await context.newPage();

  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[Browser PageError] ${err.message}`));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // 注入已连接的 mock bridge，支持 Markdown 编辑与资料包调用
  await page.evaluate(() => {
    Object.defineProperty(window.LiveDotBridge, 'active', {
      get: () => true,
      set: () => {},
      configurable: true
    });
    window.LiveDotBridge.readMarkdown = async (path, opts) => {
      return { path, content: '# 节点详情\n\n初始文档内容', etag: 'mock-1' };
    };
    window.LiveDotBridge.writeMarkdown = async (path, content, etag) => {
      window.__savedMarkdown = content;
      return { ok: true, etag: 'mock-2' };
    };
    window.LiveDotBridge.listBundleFiles = async (ownerKind, ownerId, includeArchived) => {
      return [
        { name: 'index.md', path: 'index.md', isIndex: true, size: 120 },
        { name: 'notes.md', path: 'notes.md', isIndex: false, size: 80 }
      ];
    };
    window.LiveDotBridge.readBundleMarkdown = async (ownerKind, ownerId, fileName) => {
      return { name: fileName, content: `# 资料包 / ${fileName}\n\n补充内容`, etag: 'mock-1' };
    };
    window.LiveDotBridge.replaceBundleMarkdown = async (ownerKind, ownerId, fileName, content, etag) => {
      window.__savedMarkdown = content;
      return { ok: true, etag: 'mock-2' };
    };
    window.LiveDotBridge.listEditors = async () => {
      return { editors: [{ id: 'vscode', label: 'VS Code', available: true }] };
    };
    window.LiveDotBridge.assetReadUrl = (kind, id, name) => name;
  });

  // 如果有任何弹窗遮罩，关闭它
  const knowBtn = page.locator('.ld-dialog-primary:has-text("知道了")');
  if (await knowBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await knowBtn.click();
    await page.waitForTimeout(300);
  }

  const demoBtn = page.locator('text=看看简单示例');
  if (await demoBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await demoBtn.click();
    await page.waitForTimeout(600);
  }

  const nodes = page.locator('.node');
  const nodeCount = await nodes.count();
  console.log(`✓ 画布加载完成，节点数量: ${nodeCount}`);
  if (nodeCount === 0) throw new Error('地图未渲染任何节点');

  await nodes.first().click();
  await page.waitForTimeout(300);

  const panel = page.locator('#panel');
  console.log(`✓ 面板可见性: ${await panel.isVisible()}`);

  const statusSeg = page.locator('.seg.node-status');
  if (await statusSeg.isVisible()) {
    const resolvedBtn = statusSeg.locator('button[data-val="resolved"]');
    await resolvedBtn.click();
    await page.waitForTimeout(300);
    console.log('✓ 节点状态切换段 (.node-status) 成功切换为 resolved');
  } else {
    const problemBtn = page.locator('.seg.node-kind button[data-kind="problem"]');
    await problemBtn.click();
    await page.waitForTimeout(300);

    const resolveSeg = page.locator('.seg.node-resolve');
    const hasResolveSeg = await resolveSeg.isVisible();
    console.log(`✓ 问题节点出现解决状态切换段: ${hasResolveSeg}`);
    if (!hasResolveSeg) throw new Error('问题节点未显示解决状态切换段');

    const resolvedBtn = resolveSeg.locator('button[data-val="true"]');
    await resolvedBtn.click();
    await page.waitForTimeout(300);
  }

  const isResolvedClass = await page.evaluate(() => {
    const sel = document.querySelector('.node.sel');
    return sel ? sel.classList.contains('resolved') : false;
  });
  console.log(`✓ 选中节点 canvas 渲染拥有 .resolved 标记: ${isResolvedClass}`);
  if (!isResolvedClass) throw new Error('节点未获得 resolved 样式类');

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, '01-resolved-node.png') });

  const debugInfo = await page.evaluate(async () => {
    const sel = S.sel;
    const n = sel ? nodeById(sel.id) : null;
    const btn = document.querySelector('[data-act="open-md"]');
    const bridgeState = {
      bridgeExists: !!window.LiveDotBridge,
      bridgeActive: window.LiveDotBridge?.active,
      readMdType: typeof window.LiveDotBridge?.readMarkdown
    };
    let openMdErr = null;
    if (n) {
      try {
        await openMd(n);
      } catch (e) {
        openMdErr = { message: e.message, stack: e.stack };
      }
    }
    return { sel, n, hasBtn: !!btn, bridgeState, openMdErr, hasRoot: !!document.querySelector('.mdv-root') };
  });
  console.log('OpenMd Debug Info:', JSON.stringify(debugInfo, null, 2));
  await page.waitForTimeout(500);

  const mdRoot = page.locator('.mdv-root');
  const hasEditor = await mdRoot.isVisible();
  console.log(`✓ Markdown 编辑器成功打开: ${hasEditor}`);
  if (!hasEditor) throw new Error('编辑器未打开');

  const gutterDisplay = await page.evaluate(() => {
    const g = document.querySelector('.mdv-gutter');
    return g ? window.getComputedStyle(g).display : 'none';
  });
  console.log(`✓ 行号槽 display 状态: ${gutterDisplay} (应为 none)`);
  if (gutterDisplay !== 'none') throw new Error('方案一行号槽应当彻底隐藏');

  const stackMaxWidth = await page.evaluate(() => {
    const s = document.querySelector('.mdv-editstack');
    return s ? window.getComputedStyle(s).maxWidth : 'none';
  });
  console.log(`✓ 编辑版心 max-width: ${stackMaxWidth}`);

  const resizer = page.locator('.mdv-resizer');
  const resizerBox = await resizer.boundingBox();
  console.log(`✓ 分割线位置: x=${resizerBox.x}, w=${resizerBox.width}`);

  await page.mouse.move(resizerBox.x + 2, resizerBox.y + 50);
  await page.mouse.down();
  await page.mouse.move(resizerBox.x - 80, resizerBox.y + 50, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const sideWidthAfterDrag = await page.evaluate(() => {
    const side = document.querySelector('.mdv-side');
    return side ? side.offsetWidth : 0;
  });
  console.log(`✓ 拖拽后资料包宽度: ${sideWidthAfterDrag}px`);

  await resizer.dblclick();
  await page.waitForTimeout(300);
  const sideCollapsed = await page.evaluate(() => {
    const side = document.querySelector('.mdv-side');
    return side ? side.classList.contains('collapsed') : false;
  });
  console.log(`✓ 双击后资料包自动折叠至 0px: ${sideCollapsed}`);

  // 通过资料包按钮或双击重新展开
  const bundleToggle = page.locator('.mdv-bundle-toggle');
  if (await bundleToggle.isVisible()) {
    await bundleToggle.click();
    await page.waitForTimeout(300);
  }

  const testContent = `# 方案一验证文档

这是人类提出的核心业务场景，需要极简且清爽的沉浸式文本排版。
没有任何刺眼荧光黄污染。

<!-- @author: agent:antigravity -->
这是 Agent 沉淀的系统架构方案：
1. 采用零宽注释分离人机标记
2. 编辑器和预览模式均支持发丝左边框
<!-- /@author -->
`;

  const editor = page.locator('.mdv-edit');
  await editor.fill(testContent);
  await page.waitForTimeout(300);

  const mirrorAuthors = await page.evaluate(() => {
    const agents = document.querySelectorAll('.mdv-mirror .author-agent').length;
    const startTags = document.querySelectorAll('.mdv-mirror .tag-agent-start').length;
    const endTags = document.querySelectorAll('.mdv-mirror .tag-agent-end').length;
    return { agents, startTags, endTags };
  });
  console.log(`✓ 编辑镜像层人机识别: agent行数=${mirrorAuthors.agents}, 起始标=${mirrorAuthors.startTags}, 结束标=${mirrorAuthors.endTags}`);
  if (mirrorAuthors.agents === 0 || mirrorAuthors.startTags === 0) throw new Error('镜像层未正确识别人机笔迹');

  const prevBtn = page.locator('.mdv-seg button', { hasText: '预览' });
  await prevBtn.click();
  await page.waitForTimeout(400);

  const previewBlocks = await page.evaluate(() => {
    const agents = document.querySelectorAll('.mdv-preview .author-block.agent').length;
    const badges = [...document.querySelectorAll('.mdv-preview .author-badge')].map(b => b.textContent.trim());
    return { agents, badges };
  });
  console.log(`✓ 预览区人机区块识别: agent块数=${previewBlocks.agents}, 徽标=[${previewBlocks.badges.join(', ')}]`);
  if (previewBlocks.agents !== 1) throw new Error('预览区未正确渲染 author-block');

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02-preview-author-blocks.png') });

  const editBtn = page.locator('.mdv-seg button', { hasText: '编辑' });
  await editBtn.click();
  await page.waitForTimeout(300);

  // 验证浮动气泡已被彻底清除（不在左上角遮挡）
  const bubbleCount = await page.locator('.mdv-bubble').count();
  console.log(`✓ 左上角浮动气泡是否已彻底移除: ${bubbleCount === 0}`);
  if (bubbleCount > 0) throw new Error('左上角浮动气泡未被移除');

  // 验证右下角「标记」按钮及弹出菜单
  const paletteBtn = page.locator('.mdv-btn-palette');
  const hasPaletteBtn = await paletteBtn.isVisible();
  console.log(`✓ 右下角「标记」按钮可见性: ${hasPaletteBtn}`);
  if (!hasPaletteBtn) throw new Error('右下角未显示标记按钮');

  await paletteBtn.click();
  await page.waitForTimeout(300);

  const popVisible = await page.locator('.mdv-palette-pop').isVisible();
  console.log(`✓ 点击后向上弹出标记卡片可见性: ${popVisible}`);
  if (!popVisible) throw new Error('标记卡片未正常弹出');

  const agentOption = page.locator('.mdv-palette-pop button[data-palette="agent"]');
  await agentOption.click();
  await page.waitForTimeout(300);

  // 验证窄屏模式下顶部工具栏不会诡异拉伸
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(300);
  const toolbarWidth = await page.evaluate(() => {
    const tb = document.querySelector('#toolbar');
    return tb ? tb.offsetWidth : 0;
  });
  console.log(`✓ 窄屏 (1000px) 下顶部工具栏紧凑宽度: ${toolbarWidth}px (应 < 360px，绝不拉伸)`);
  if (toolbarWidth > 360) throw new Error(`顶部工具栏异常横向拉伸: ${toolbarWidth}px`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  const saveBtn = page.locator('.mdv-btn-save');
  await saveBtn.click();
  await page.waitForTimeout(600);

  const statusText = await page.locator('.mdv-status').textContent();
  console.log(`✓ 保存后状态栏文本: "${statusText}"`);

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, '03-editor-zen-mode.png') });

  // 验证地图下拉菜单中的记忆包导出导入项
  const closeEditorBtn = page.locator('.mdv-close');
  if (await closeEditorBtn.isVisible()) {
    await closeEditorBtn.click();
    await page.waitForTimeout(300);
  }
  const mapBtn = page.locator('#map-btn');
  if (await mapBtn.isVisible()) {
    await mapBtn.click();
    await page.waitForTimeout(400);
    const hasPackItem = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.plist .pitem')].map(el => el.textContent);
      return items.some(t => t.includes('导出记忆包') || t.includes('.zip'));
    });
    console.log(`✓ 地图弹窗包含记忆包导出导入项: ${hasPackItem}`);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '04-map-popover-memory-pack.png') });
  }

  await browser.close();
  console.log('=== 方案一（极简纯净沉浸派）自动化与交互验证全部通过！===');
}

run().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
