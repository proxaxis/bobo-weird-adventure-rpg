// フィールド検証: スポーン→移動→拠点確認→対話→クラフトパネル（dev専用）
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') {
    console.log('[console]', m.type(), m.text().slice(0, 200));
  }
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));

await page.goto('http://localhost:8010', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 5000));
await page.screenshot({ path: '/app/v-spawn.png' });
console.log('shot: v-spawn');

// 右へ2秒移動（差分スクロールの確認）
await page.keyboard.down('d');
await new Promise((r) => setTimeout(r, 2000));
await page.keyboard.up('d');
await page.screenshot({ path: '/app/v-moved.png' });
console.log('shot: v-moved');

// 下+右へ2秒（対角移動）
await page.keyboard.down('s');
await page.keyboard.down('d');
await new Promise((r) => setTimeout(r, 2000));
await page.keyboard.up('s');
await page.keyboard.up('d');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/app/v-moved2.png' });
console.log('shot: v-moved2');

// 拠点に戻るため逆方向へ
await page.keyboard.down('w');
await page.keyboard.down('a');
await new Promise((r) => setTimeout(r, 2800));
await page.keyboard.up('w');
await page.keyboard.up('a');
await page.screenshot({ path: '/app/v-base.png' });
console.log('shot: v-base');

// クラフトパネル
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.includes('装備')) { b.click(); break; }
  }
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/app/v-craft.png' });
console.log('shot: v-craft');

// 対話（debugボタン）
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.includes('対話テスト')) { b.click(); break; }
  }
});
try {
  await page.waitForSelector('.dialog-overlay', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 8000));
  await page.screenshot({ path: '/app/v-dialog.png' });
  console.log('shot: v-dialog');
} catch {
  console.log('dialog did not open');
}

await browser.close();
console.log('done');
