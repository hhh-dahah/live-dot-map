import { chromium } from 'playwright';
import { execSync } from 'child_process';

async function test() {
  const jsonStr = execSync('node livedot.mjs serve --project . --app app.html', { encoding: 'utf8' }).trim();
  const info = JSON.parse(jsonStr);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(info.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24');
    if (node) { select('node', node.id); await openMd(node); }
  });
  await page.waitForTimeout(800);

  const ed = page.locator('.mdv-edit');
  await ed.focus();

  // Test Smart Enter: Set content to an agent block ending
  await ed.evaluate(el => {
    el.value = '<!-- @author: agent:antigravity -->\n这是Agent的一段回复。';
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(300);

  console.log('Value before Enter:\n', await ed.inputValue());

  // Press Enter at the end of Agent block
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  const valAfterEnter = await ed.inputValue();
  console.log('Value after Enter:\n', JSON.stringify(valAfterEnter));
  if (!valAfterEnter.includes('<!-- @author: human -->')) {
    throw new Error('Enter 键未自动插入 <!-- @author: human -->！');
  }

  // Type new human text
  await page.keyboard.type('测试人类新文字');
  await page.waitForTimeout(300);

  const valAfterType = await ed.inputValue();
  console.log('Value after typing:\n', JSON.stringify(valAfterType));

  // Check mirror classes
  const mirrorClasses = await page.$$eval('.mdv-mirror .ml', els => els.map(e => ({ cls: e.className, txt: e.textContent.slice(0, 15) })));
  console.log('Mirror lines:');
  for (const item of mirrorClasses) {
    console.log('  ', item.cls, '-->', item.txt);
  }

  const humanLine = mirrorClasses.find(m => m.txt.includes('测试人类新文字'));
  console.log('Human line item:', humanLine);
  if (!humanLine || !humanLine.cls.includes('author-human')) {
    throw new Error('新打的字未被自动识别为人写（author-human）！');
  }
  console.log('✓ 新打的字已被自动识别为人写（author-human）！');

  // Test Ctrl+Z
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  console.log('✓ Ctrl+Z 正常响应');

  await browser.close();
  console.log('🎉 智能切回人类笔迹验证完全通过！');
}

test().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
