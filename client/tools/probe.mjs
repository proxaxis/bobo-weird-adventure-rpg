// シーン内部状態のプローブ（dev専用）
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://localhost:8010', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 5000));

const info = await page.evaluate(() => {
  // Phaser シーンを取得
  const game = /** @type {any} */ (window).game ??
    /** @type {any} */ (document.querySelector('canvas'));
  // phaser game はグローバルに無いことが多い → scene 経由で探す
  const g = /** @type {any} */ (window).__PHASER_GAME__;
  if (!g) return { err: 'no game handle' };
  const s = g.scene.getScene('FieldScene');
  if (!s) return { err: 'no scene' };
  const base = s.baseGroup?.getChildren() ?? [];
  return {
    spawnX: Math.round(s.spawnX),
    spawnY: Math.round(s.spawnY),
    playerX: Math.round(s.player.x),
    playerY: Math.round(s.player.y),
    baseBlocks: base.length,
    baseTypes: base.map((b) => b.texture.key),
    doorRect: s.doorRect,
    voids: s.voids?.getChildren().length,
    creatures: s.creatures.length,
    npcs: [...s.npcStates.keys()],
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
