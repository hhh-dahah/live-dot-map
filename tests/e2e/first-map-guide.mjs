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
const expected = ['空白开始', '看看简单示例', '让 Agent 初始化我的项目地图'];
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
    assert.match(initial, /未点击前不会扫描项目/);
    await page.getByRole('button', { name: /看看简单示例/ }).click();
    await page.waitForFunction(() => window.LiveDotApp?.serialize()?.nodes?.length > 0);
    const demo = await page.evaluate(() => ({ nodes: window.LiveDotApp.serialize().nodes.length, bridgeActive: Boolean(window.LiveDotBridge?.active) }));
    assert.ok(demo.nodes > 0, `${name}: 示例没有可阅读节点`);
    assert.equal(demo.bridgeActive, false, `${name}: 示例不应连接项目桥`);

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#first-map-guide.on', { timeout: 10_000 });
    await page.getByRole('button', { name: /让 Agent 初始化我的项目地图/ }).click();
    const agentStart = await page.evaluate(() => ({ drawer: document.querySelector('#drawer')?.classList.contains('on'), bridgeActive: Boolean(window.LiveDotBridge?.active), nodes: window.LiveDotApp.serialize().nodes.length }));
    assert.equal(agentStart.drawer, true, `${name}: Agent 初始化没有打开接入入口`);
    assert.equal(agentStart.bridgeActive, false, `${name}: 初始化入口点击前不应连接项目桥`);
    assert.equal(agentStart.nodes, 0, `${name}: 初始化入口点击前不应生成伪造节点`);
    results.push({ browser: name, choices: choices.map((value) => value.split('\n')[0]), demoNodes: demo.nodes, agentDrawer: agentStart.drawer });
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify(results, null, 2));
