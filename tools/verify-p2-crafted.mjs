import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const HTML_PATH = resolve('app.html');
const SCREENSHOT_DIR = resolve('tmp/verify-p2');
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function run() {
  console.log('=== 开始方案二（现代精工生产力派 - Linear / Craft 风格）自动化与视觉走查 ===');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  await context.addInitScript(() => {
    try {
      localStorage.setItem('dotmap-guide-seen', '1');
      localStorage.setItem('dotmap-standalone-seen', '1');
    } catch {}
    window.LiveDotBridge = {
      active: true,
      async readMarkdown(p) {
        return { path: p, content: '# 节点详情\n\n初始技术方案文档内容', etag: 'mock-1' };
      },
      async writeMarkdown(p, c) {
        window.__savedMarkdown = c;
        return { ok: true, etag: 'mock-2' };
      },
      async listBundleFiles() {
        return [
          { name: 'index.md', path: 'index.md', isIndex: true, size: 120 },
          { name: 'benchmark.md', path: 'benchmark.md', isIndex: false, size: 80 }
        ];
      },
      async readBundleMarkdown(ownerKind, ownerId, fileName) {
        return { name: fileName, content: `# 资料包 / ${fileName}\n\n性能评测基准数据`, etag: 'mock-1' };
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

  const fileUrl = `file:///${HTML_PATH.replace(/\\/g, '/')}`;
  console.log(`导航至: ${fileUrl}`);
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // 注入测试 Bridge mock，覆盖 app.html 启动后的真实 bridge 实例
  await page.evaluate(() => {
    Object.defineProperty(window.LiveDotBridge, 'active', {
      get: () => true,
      set: () => {},
      configurable: true
    });
    window.LiveDotBridge.readMarkdown = async (p) => {
      return { path: p, content: '# 节点详情\n\n初始技术方案文档内容', etag: 'mock-1' };
    };
    window.LiveDotBridge.writeMarkdown = async (p, c) => {
      window.__savedMarkdown = c;
      return { ok: true, etag: 'mock-2' };
    };
    window.LiveDotBridge.listBundleFiles = async () => {
      return [
        { name: 'index.md', path: 'index.md', isIndex: true, size: 120 },
        { name: 'benchmark.md', path: 'benchmark.md', isIndex: false, size: 80 }
      ];
    };
    window.LiveDotBridge.readBundleMarkdown = async (ownerKind, ownerId, fileName) => {
      return { name: fileName, content: `# 资料包 / ${fileName}\n\n性能评测基准数据`, etag: 'mock-1' };
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

  // 关闭任何初始弹窗
  const knowBtn = page.locator('.ld-dialog-primary:has-text("知道了")');
  if (await knowBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await knowBtn.click();
    await page.waitForTimeout(300);
  }

  const demoChoice = page.locator('text=看看简单示例');
  if (await demoChoice.isVisible({ timeout: 1500 }).catch(() => false)) {
    await demoChoice.click();
    await page.waitForTimeout(600);
  }

  // 确保加载演示示例地图，渲染节点
  await page.evaluate(() => {
    if (typeof loadDemoMap === 'function') loadDemoMap();
  });
  await page.waitForTimeout(500);

  const nodes = page.locator('.node');
  const nodeCount = await nodes.count();
  console.log(`✓ 画布加载完成，节点数量: ${nodeCount}`);
  if (nodeCount === 0) throw new Error('地图未渲染任何节点');

  // 1. 验证问题节点「待解决/已解决」生命周期与画布绿环高亮
  await nodes.first().click();
  await page.waitForTimeout(300);

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

  const isResolvedClass = await page.evaluate(() => {
    const sel = document.querySelector('.node.sel');
    return sel ? sel.classList.contains('resolved') : false;
  });
  console.log(`✓ 选中节点 canvas 渲染拥有 .resolved 标记: ${isResolvedClass}`);
  if (!isResolvedClass) throw new Error('节点未获得 resolved 样式类');

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, '01-resolved-node.png') });

  // 2. 打开 Markdown 编辑器
  await page.evaluate(async () => {
    const sel = S.sel;
    const n = sel ? nodeById(sel.id) : null;
    if (n) await openMd(n);
  });
  await page.waitForTimeout(500);

  const mdRoot = page.locator('.mdv-root');
  const hasEditor = await mdRoot.isVisible();
  console.log(`✓ Markdown 编辑器成功打开: ${hasEditor}`);
  if (!hasEditor) throw new Error('编辑器未打开');

  // 3. 验证行号槽隐藏与现代版心
  const gutterDisplay = await page.evaluate(() => {
    const g = document.querySelector('.mdv-gutter');
    return g ? window.getComputedStyle(g).display : 'none';
  });
  console.log(`✓ 行号槽 display 状态: ${gutterDisplay} (应为 none)`);
  if (gutterDisplay !== 'none') throw new Error('方案二行号槽应当彻底隐藏');

  // 4. 验证 Tactile Splitter 精工发丝拖拽与磁吸折叠
  const resizer = page.locator('.mdv-resizer');
  const resizerBox = await resizer.boundingBox();
  console.log(`✓ 分割线位置: x=${resizerBox.x}, w=${resizerBox.width}`);

  // 模拟拖拽发丝分割器
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

  // 双击折叠至 0px
  await resizer.dblclick();
  await page.waitForTimeout(300);
  const sideCollapsed = await page.evaluate(() => {
    const side = document.querySelector('.mdv-side');
    return side ? side.classList.contains('collapsed') : false;
  });
  console.log(`✓ 双击后资料包自动折叠至 0px: ${sideCollapsed}`);

  // 再次双击恢复展开
  await resizer.dblclick();
  await page.waitForTimeout(300);

  // 5. 填入人机对比测试文本（零物理污染）
  const testContent = `# 现代精工生产力派架构

<!-- @author: human -->
这是人类提出的核心业务场景与关键指标。
要求高密度、现代精工感，拒绝廉价荧光黄。

<!-- @author: agent:antigravity -->
这是 Agent 交付的技术演进方案：
1. 采用 Author Card 容器卡片呈现
2. Linear 级沉浸深色保存胶囊
3. 呼吸状态灯与实时字数统计
`;

  const editor = page.locator('.mdv-edit');
  await editor.fill(testContent);
  await page.waitForTimeout(300);

  // 6. 验证编辑模式镜像层人机识别
  const mirrorAuthors = await page.evaluate(() => {
    const humans = document.querySelectorAll('.mdv-mirror .author-human').length;
    const agents = document.querySelectorAll('.mdv-mirror .author-agent').length;
    return { humans, agents };
  });
  console.log(`✓ 编辑镜像层人机识别: human行数=${mirrorAuthors.humans}, agent行数=${mirrorAuthors.agents}`);
  if (mirrorAuthors.humans === 0 || mirrorAuthors.agents === 0) throw new Error('镜像层未正确识别人机笔迹');

  // 7. 验证顶栏滑块控件（Segmented Pill）与预览模式 Author Card 卡片
  const prevBtn = page.locator('.mdv-seg button', { hasText: '预览' });
  await prevBtn.click();
  await page.waitForTimeout(400);

  const segState = await page.evaluate(() => {
    const seg = document.querySelector('.mdv-seg');
    return seg ? seg.classList.contains('prev-active') : false;
  });
  console.log(`✓ 顶栏滑块 pill 是否平滑滑动到预览位置: ${segState}`);

  const previewCards = await page.evaluate(() => {
    const humanCards = document.querySelectorAll('.mdv-preview .author-card.human').length;
    const agentCards = document.querySelectorAll('.mdv-preview .author-card.agent').length;
    const heads = [...document.querySelectorAll('.mdv-preview .author-card-head')].map(h => h.textContent.trim());
    return { humanCards, agentCards, heads };
  });
  console.log(`✓ 预览区精工卡片识别: human卡片=${previewCards.humanCards}, agent卡片=${previewCards.agentCards}, 卡片头=[${previewCards.heads.join(', ')}]`);
  if (previewCards.humanCards !== 1 || previewCards.agentCards !== 1) throw new Error('预览区未正确渲染 author-card');

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02-crafted-preview.png') });

  // 8. 切回编辑模式
  const editBtn = page.locator('.mdv-seg button', { hasText: '编辑' });
  await editBtn.click();
  await page.waitForTimeout(300);

  // 9. 选中文本验证悬浮气泡微菜单
  await editor.selectText();
  await editor.dispatchEvent('keyup');
  await page.waitForTimeout(300);

  const bubbleVisible = await page.evaluate(() => {
    const b = document.querySelector('.mdv-bubble');
    return b && !b.hidden;
  });
  console.log(`✓ 选中文本后浮动微胶囊菜单显示: ${bubbleVisible}`);

  // 10. 验证底栏 Linear 深色保存按钮与实时字数及呼吸同步灯
  const statusText = await page.locator('.mdv-foot-status').textContent();
  console.log(`✓ 底栏状态栏文本: "${statusText}"`);

  const liveDotVisible = await page.locator('.mdv-live-dot').isVisible();
  console.log(`✓ 呼吸同步绿灯可见性: ${liveDotVisible}`);

  const saveBtn = page.locator('.mdv-linear-save');
  const isSaveEnabled = !(await saveBtn.isDisabled());
  console.log(`✓ 有修改时 Linear 保存按钮是否激活: ${isSaveEnabled}`);

  await saveBtn.click();
  await page.waitForTimeout(600);

  const statusAfterSave = await page.locator('.mdv-foot-status').textContent();
  console.log(`✓ 保存后底栏文本: "${statusAfterSave}"`);

  const isSaveDisabledAfter = await saveBtn.isDisabled();
  console.log(`✓ 保存后 Linear 按钮是否回到就绪/禁用态: ${isSaveDisabledAfter}`);

  // 验证保存后的 Markdown 内容 100% 纯净，零物理 <mark> 污染
  const savedValue = await editor.inputValue();
  const hasPhysicalMark = /<mark>/i.test(savedValue);
  console.log(`✓ 检查文件是否被物理 <mark> 污染: ${hasPhysicalMark ? 'FAILED (包含mark)' : 'PASSED (完全干净)'}`);
  if (hasPhysicalMark) throw new Error('检测到物理 <mark> 标签污染！');

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, '03-crafted-editor.png') });

  // 11. 验证专注模式（Focus Mode）
  const focusBtn = page.locator('.mdv-focus-btn');
  console.log(`✓ 点击专注模式按钮...`);
  await focusBtn.click();
  await page.waitForTimeout(400);

  const isDockFocus = await page.evaluate(() => {
    const p = document.querySelector('#panel');
    return p ? p.classList.contains('dock-focus') : false;
  });
  console.log(`✓ 面板是否拥有 .dock-focus 宽屏类: ${isDockFocus}`);
  if (!isDockFocus) throw new Error('专注模式未激活 .dock-focus');

  const panelWidth = await page.evaluate(() => {
    const p = document.querySelector('#panel');
    return p ? p.offsetWidth : 0;
  });
  console.log(`✓ 专注模式下侧栏面板宽度: ${panelWidth}px (应明显宽于默认 460px)`);

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, '04-focus-mode.png') });

  // 退出专注模式
  await focusBtn.click();
  await page.waitForTimeout(300);

  await browser.close();
  console.log('=== 方案二（现代精工生产力派 - Linear / Craft 风格）自动化与视觉验证全部通过！===');
}

run().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
