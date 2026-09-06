import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.setContent(`
    <div style="position: relative;">
      <textarea id="ed" style="width: 300px; height: 150px;">First paragraph\n\nSecond paragraph\nThird line</textarea>
      <div id="pop">
        <button id="btn-human" type="button">标为人写</button>
        <button id="btn-clear" type="button">清除标记</button>
      </div>
    </div>
  `);

  await page.evaluate(() => {
    const ed = document.getElementById('ed');
    const pop = document.getElementById('pop');

    // Prevent blur on pointerdown
    pop.addEventListener('pointerdown', e => {
      e.preventDefault();
    });

    document.getElementById('btn-human').addEventListener('click', () => {
      const s = ed.selectionStart;
      const lastNl = ed.value.lastIndexOf('\n', s - 1);
      const pos = lastNl === -1 ? 0 : lastNl + 1;
      ed.setSelectionRange(pos, pos);
      document.execCommand('insertText', false, '<!-- @author: human -->\n');
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      const s = ed.selectionStart;
      const val = ed.value;
      const tagIdx = val.indexOf('<!-- @author: human -->\n');
      if (tagIdx !== -1) {
        ed.setSelectionRange(tagIdx, tagIdx + '<!-- @author: human -->\n'.length);
        document.execCommand('insertText', false, '');
      }
    });
  });

  const ed = page.locator('#ed');
  await ed.focus();
  await ed.evaluate(el => el.setSelectionRange(20, 20));

  const initVal = await ed.inputValue();
  console.log('Init:', JSON.stringify(initVal));

  // Click btn-human
  await page.locator('#btn-human').click();
  const markedVal = await ed.inputValue();
  console.log('After mark:', JSON.stringify(markedVal));

  // Press Ctrl+Z
  await page.keyboard.press('Control+z');
  const undo1 = await ed.inputValue();
  console.log('After Ctrl+Z (undo mark):', JSON.stringify(undo1), 'Matches init?', undo1 === initVal);

  // Click btn-human again
  await page.locator('#btn-human').click();
  // Click btn-clear
  await page.locator('#btn-clear').click();
  const clearedVal = await ed.inputValue();
  console.log('After clear:', JSON.stringify(clearedVal));

  // Press Ctrl+Z (should restore the tag!)
  await page.keyboard.press('Control+z');
  const undoClear = await ed.inputValue();
  console.log('After Ctrl+Z (undo clear):', JSON.stringify(undoClear), 'Has tag?', undoClear.includes('<!-- @author: human -->'));

  await browser.close();
}

test();
