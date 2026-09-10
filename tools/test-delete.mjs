import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<textarea id="ed">Line 1\n<!-- @author: human -->\nLine 2</textarea>');
  
  // Test 1: execCommand('delete')
  const r1 = await page.evaluate(() => {
    const ed = document.getElementById('ed');
    ed.focus();
    ed.setSelectionRange(7, 31); // '<!-- @author: human -->\n'
    let ok = false;
    try { ok = document.execCommand('delete'); } catch(e){}
    return { ok, val: ed.value };
  });
  console.log('Test delete:', r1);
  await page.focus('#ed');
  await page.keyboard.press('Control+z');
  console.log('After Ctrl+Z (delete):', JSON.stringify(await page.$eval('#ed', el => el.value)));

  // Reset
  await page.setContent('<textarea id="ed">Line 1\n<!-- @author: human -->\nLine 2</textarea>');

  // Test 2: execCommand('insertText', false, '')
  const r2 = await page.evaluate(() => {
    const ed = document.getElementById('ed');
    ed.focus();
    ed.setSelectionRange(7, 31); // '<!-- @author: human -->\n'
    let ok = false;
    try { ok = document.execCommand('insertText', false, ''); } catch(e){}
    return { ok, val: ed.value };
  });
  console.log('Test insertText empty:', r2);
  await page.focus('#ed');
  await page.keyboard.press('Control+z');
  console.log('After Ctrl+Z (insertText empty):', JSON.stringify(await page.$eval('#ed', el => el.value)));

  await browser.close();
}

test();
