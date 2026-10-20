// VRM対話画面のスクリーンショット取得（dev専用）
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));

await page.goto('http://localhost:8010', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 5000));
await page.screenshot({ path: '/app/shot-field.png' });

// [debug] 対話テストボタンを押してVRM対話を開く
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.includes('対話テスト')) { b.click(); break; }
  }
});
await page.waitForSelector('.dialog-overlay', { timeout: 10000 });
// VRMロード+レンダリング待ち（26MBモデルのため長めに）
await new Promise((r) => setTimeout(r, 8000));
await page.screenshot({ path: '/app/shot-dialog.png' });
console.log('done');
await browser.close();
