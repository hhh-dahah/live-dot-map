import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<textarea id="ed"><!-- @author: human -->\nHello World</textarea>');
  
  // Test deleting tag line with execCommand
  await page.evaluate(() => {
    const ed = document.getElementById('ed');
    ed.focus();
    // Select the tag line (0 to 24)
    ed.setSelectionRange(0, 24);
    document.execCommand('delete');
  });
  
  console.log('After delete:', JSON.stringify(await page.$eval('#ed', el => el.value)));
  
  // Press Ctrl+Z
  await page.focus('#ed');
  await page.keyboard.press('Control+z');
  console.log('After Ctrl+Z:', JSON.stringify(await page.$eval('#ed', el => el.value)));
  
  await browser.close();
}

test();
