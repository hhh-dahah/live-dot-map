import { chromium } from 'playwright';
import { execSync } from 'child_process';

async function main() {
  const jsonStr = execSync('node livedot.mjs serve --project . --app app.html', { encoding: 'utf8' }).trim();
  const info = JSON.parse(jsonStr);
  const targetUrl = info.url;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 922, height: 780 } });
  const page = await context.newPage();

  console.log('1. 打开测试页面 (922px 视口):', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  console.log('2. 选中 n24 节点并验证顶栏不遮挡属性面板...');
  await page.evaluate(() => {
    const node = S.nodes?.find(n => n.id === 'n24') || S.nodes?.[0];
    if (node) select('node', node.id);
  });
  await page.waitForTimeout(500);

  const panelBox = await page.locator('#panel').boundingBox();
  const toolbarBox = await page.locator('#toolbar').boundingBox();
  console.log('Panel box:', panelBox);
  console.log('Toolbar box:', toolbarBox);

  if (panelBox && toolbarBox) {
    const overlap = toolbarBox.x + toolbarBox.width > panelBox.x;
    console.log('Toolbar overlap panel?', overlap, 'Toolbar right:', toolbarBox.x + toolbarBox.width, 'Panel left:', panelBox.x);
    if (overlap) throw new Error('Toolbar still overlaps panel!');
  }

  await page.screenshot({ path: 'tools/01-narrow-no-overlap.png' });
  console.log('✓ 截图 01-narrow-no-overlap.png 保存成功');

  console.log('3. 打开 n24 的 Markdown 编辑器...');
  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24') || S.nodes?.[0];
    if (node) await openMd(node);
  });
  await page.waitForTimeout(600);

  // 验证 toolbar 在编辑模式下已隐藏
  const toolbarVisibleInEdit = await page.locator('#toolbar').isVisible();
  console.log('Toolbar visible in editor mode?', toolbarVisibleInEdit);
  if (toolbarVisibleInEdit) throw new Error('Toolbar should be hidden in editor mode!');

  // 验证人机发丝在编辑镜像层呈现
  const humanLines = await page.locator('.mdv-mirror .author-human').count();
  const agentLines = await page.locator('.mdv-mirror .author-agent').count();
  console.log('Editor mirror lines: human=', humanLines, 'agent=', agentLines);
  if (humanLines === 0 || agentLines === 0) throw new Error('人机发丝边框未在编辑镜像层呈现');

  await page.screenshot({ path: 'tools/02-editor-both-authors.png' });
  console.log('✓ 截图 02-editor-both-authors.png 保存成功');

  console.log('4. 切换到「预览」模式验证 Agent 独立徽标卡片...');
  const prevBtn = page.locator('.mdv-seg button', { hasText: '预览' });
  await prevBtn.click();
  await page.waitForTimeout(400);

  const agentBlocks = await page.locator('.mdv-preview .author-block.agent').count();
  const badges = await page.locator('.mdv-preview .author-badge').allTextContents();
  console.log('Preview agent blocks:', agentBlocks, 'Badges:', badges);
  if (agentBlocks === 0) throw new Error('预览区未渲染 Agent author-block');

  await page.screenshot({ path: 'tools/03-preview-agent-card.png' });
  console.log('✓ 截图 03-preview-agent-card.png 保存成功');

  console.log('5. 切回「编辑」模式，测试人机标记与 Ctrl+Z 原生撤销...');
  const editBtn = page.locator('.mdv-seg button', { hasText: '编辑' });
  await editBtn.click();
  await page.waitForTimeout(300);

  const initialVal = await page.locator('.mdv-edit').inputValue();

  const paletteBtn = page.locator('.mdv-btn-palette');
  await paletteBtn.click();
  await page.waitForTimeout(200);

  const markHumanBtn = page.locator('[data-palette="human"]');
  await markHumanBtn.click();
  await page.waitForTimeout(300);

  const markedVal = await page.locator('.mdv-edit').inputValue();
  console.log('Marked value changed?', markedVal !== initialVal);
  if (markedVal === initialVal) throw new Error('点击标记后文档未发生变化');

  await page.focus('.mdv-edit');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  const undoVal = await page.locator('.mdv-edit').inputValue();
  console.log('After Ctrl+Z, matches initialVal?', undoVal === initialVal);
  if (undoVal !== initialVal) throw new Error('Ctrl+Z 撤销失败！文档内容未复原');
  console.log('✓ Ctrl+Z 原生撤销验证成功！');

  await page.screenshot({ path: 'tools/04-after-undo.png' });
  console.log('✓ 截图 04-after-undo.png 保存成功');

  await browser.close();
  console.log('=== 全部验证通过！===');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
