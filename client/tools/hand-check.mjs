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
await new Promise((r) => setTimeout(r, 9000));
// 手元ズーム撮影用に全身を撮る
await page.screenshot({ path: '/app/hands.png' });
console.log('done');
await browser.close();
