import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type()==='error') console.log('[cerr]', m.text().slice(0,200)); });
await page.goto('http://localhost:8010', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 5000));
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.includes('対話テスト')) { b.click(); break; }
  }
});
await page.waitForSelector('.dialog-overlay', { timeout: 8000 });
await new Promise((r) => setTimeout(r, 6000));
await page.screenshot({ path: '/app/d-open.png' });
const inputSel = '.dialog-overlay input[type="text"], .dialog-overlay textarea';
await page.click(inputSel);
await page.type(inputSel, 'こんにちは', { delay: 20 });
await page.keyboard.press('Enter');
console.log('sent');
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const txt = await page.evaluate(() => {
    const dlg = document.querySelector('.dialog-overlay');
    return dlg ? dlg.innerText.replace(/\n+/g,' | ').slice(0, 300) : 'gone';
  });
  console.log(`t+${(i+1)*5}s: ${txt}`);
  if (txt.includes('▌') === false && i > 0) break;
}
await page.screenshot({ path: '/app/d-final.png' });
await browser.close();
console.log('done');
