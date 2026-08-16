import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const appUrl = pathToFileURL(resolve(root, 'app.html')).href;
const browsers = {
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
};
const expected = ['选择项目…', '空白开始', '看看简单示例'];
const results = [];

for (const [name, executablePath] of Object.entries(browsers)) {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#first-map-guide.on', { timeout: 10_000 });
    const initial = await page.locator('#first-map-guide').innerText();
    const choices = await page.locator('#first-map-guide [data-first-choice]').allInnerTexts();
    assert.deepEqual(choices.map((value) => value.split('\n')[0]), expected, `${name}: 首次入口顺序或文案变化`);
    assert.match(initial, /自动存进项目里的 map\.json/);
    await page.getByRole('button', { name: /看看简单示例/ }).click();
    await page.waitForFunction(() => window.LiveDotApp?.serialize()?.nodes?.length > 0);
    const demo = await page.evaluate(() => ({ nodes: window.LiveDotApp.serialize().nodes.length, bridgeActive: Boolean(window.LiveDotBridge?.active) }));
    assert.ok(demo.nodes > 0, `${name}: 示例没有可阅读节点`);
    assert.equal(demo.bridgeActive, false, `${name}: 示例不应连接项目桥`);

    // 引导入口选择后已记录 seen（C2 去重）；第二次进入前清除以复现首启。
    await page.evaluate(() => { try { localStorage.removeItem('dotmap-guide-seen'); } catch {} });
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#first-map-guide.on', { timeout: 10_000 });
    // 无桥直开时「选择项目…」触发浏览器文件夹选择；无头环境选择器不可用，
    // 但必须保持「未授权不扫描、不生成伪造节点」的边界。
    await page.getByRole('button', { name: /选择项目…/ }).click();
    await page.waitForTimeout(600);
    const pickStart = await page.evaluate(() => ({ drawer: document.querySelector('#drawer')?.classList.contains('on'), bridgeActive: Boolean(window.LiveDotBridge?.active), nodes: window.LiveDotApp.serialize().nodes.length, guideSeen: (() => { try { return localStorage.getItem('dotmap-guide-seen'); } catch { return null; } })() }));
    assert.equal(pickStart.bridgeActive, false, `${name}: 选择入口不应在无授权时连接项目桥`);
    assert.equal(pickStart.nodes, 0, `${name}: 选择入口点击前不应生成伪造节点`);
    assert.equal(pickStart.guideSeen, '1', `${name}: 选择入口点击后未记录已看过引导`);
    results.push({ browser: name, choices: choices.map((value) => value.split('\n')[0]), demoNodes: demo.nodes, pickGuard: true });
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify(results, null, 2));
