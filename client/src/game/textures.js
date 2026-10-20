/**
 * @fileoverview プレースホルダ画像を CanvasTexture で生成する。
 * アセット確定までは全てコード生成とし、後で Tiled/atlas 読み込みに差し替える。
 */

/**
 * CanvasTexture を作り ctx 描画して返す。既存キーなら描画せず終了。
 * @param {Phaser.Scene} scene
 * @param {string} key
 * @param {number} width
 * @param {number} height
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} draw
 * @returns {void}
 */
function makeTexture(scene, key, width, height, draw) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) return;
  const ctx = tex.getContext();
  draw(ctx, width, height);
  tex.refresh();
}

/**
 * 円形キャラクターのプレースホルダ。
 * @param {Phaser.Scene} scene
 * @param {string} key
 * @param {number} r - 半径
 * @param {string} fill
 * @param {string} stroke
 * @returns {void}
 */
function circleTexture(scene, key, r, fill, stroke) {
  makeTexture(scene, key, r * 2, r * 2, (ctx, w, h) => {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  });
}

/**
 * フィールド用テクスチャ一式を生成する。
 * @param {Phaser.Scene} scene
 * @returns {void}
 */
export function ensureFieldTextures(scene) {
  // プレイヤー
  circleTexture(scene, 'tex-player', 14, '#9fe6ff', '#1c5d7a');

  // 他プレイヤー（P2P）
  circleTexture(scene, 'tex-peer', 14, '#ffd29f', '#7a4a1c');

  // ボイド結晶（菱形＋発光）
  makeTexture(scene, 'tex-void', 28, 28, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 14);
    g.addColorStop(0, 'rgba(102,247,209,0.9)');
    g.addColorStop(1, 'rgba(102,247,209,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx, h - 4);
    ctx.lineTo(cx - 8, cy);
    ctx.closePath();
    ctx.fillStyle = '#aef7e4';
    ctx.fill();
    ctx.strokeStyle = '#0f5e4b';
    ctx.stroke();
  });

  // NPC（顔つきプレースホルダ）
  makeTexture(scene, 'tex-npc', 32, 32, (ctx, w, h) => {
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#ffb7d5';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7a1c4e';
    ctx.stroke();
    // 目
    ctx.fillStyle = '#402030';
    ctx.beginPath();
    ctx.arc(11, 15, 1.8, 0, Math.PI * 2);
    ctx.arc(21, 15, 1.8, 0, Math.PI * 2);
    ctx.fill();
    // 口
    ctx.beginPath();
    ctx.arc(16, 20, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = '#402030';
    ctx.stroke();
  });

  // 地面タイル（64x64、暗め＋罫線＋ノイズ）
  makeTexture(scene, 'tile-ground', 64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#14181d';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
  });
}
