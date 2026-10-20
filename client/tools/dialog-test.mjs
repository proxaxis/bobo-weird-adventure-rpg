// 対話動作検証 v2: 対話パネル内のinputを特定して送信（dev専用）
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));

await page.goto('http://localhost:8010', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 5000));

await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.includes('対話テスト')) { b.click(); break; }
  }
});
await page.waitForSelector('.dialog-overlay', { timeout: 8000 });
await new Promise((r) => setTimeout(r, 7000));

// 対話パネル内の入力欄を特定
const inputSel = '.dialog-overlay input[type="text"], .dialog-overlay textarea';
await page.waitForSelector(inputSel, { timeout: 5000 });
await page.click(inputSel);
await page.type(inputSel, 'こんにちは、名前を教えて', { delay: 30 });
await page.keyboard.press('Enter');
console.log('sent');

for (let i = 0; i < 5; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: `/app/d-resp${i}.png` });
  console.log(`shot: d-resp${i}`);
}

// 全テキストノードからメッセージ候補を収集
const dump = await page.evaluate(() => {
  const dlg = document.querySelector('.dialog-overlay');
  return dlg ? dlg.innerText.slice(0, 1500) : 'no dialog';
});
console.log('DIALOG TEXT:\n' + dump);

await browser.close();
console.log('done');
