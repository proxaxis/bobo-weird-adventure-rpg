/**
 * @fileoverview マルチノイズ・バイオーム生成。
 * int32 全域（-2147483647〜2147483647）でシード決定論的に同じ結果を返す。
 * チャンク単位(512px)で生成、地形は値ノイズ fBm で決める。
 */

export const CHUNK_SIZE = 512;
export const TILE_PX = 32;

/**
 * 整数2Dハッシュ → [0,1)。全クライアントで同じ値になる決定論的乱数。
 * @param {number} ix
 * @param {number} iy
 * @param {number} seed
 * @returns {number}
 */
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 値ノイズ（バイリニア補間 + スムーズステップ）。
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number} 0..1
 */
function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(ix, iy, seed);
  const n10 = hash2(ix + 1, iy, seed);
  const n01 = hash2(ix, iy + 1, seed);
  const n11 = hash2(ix + 1, iy + 1, seed);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return a + (b - a) * sy;
}

/**
 * フラクタルブラウン運動ノイズ。
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @param {number} [octaves]
 * @returns {number} 0..1
 */
export function fbm(x, y, seed, octaves = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * f, y * f, seed + i * 7919) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

/**
 * ワールド座標のバイオーム判定（タイル単位、決定論的）。
 * - continent: 大域的な高低で「荒野/廃墟」を分ける
 * - toxic: 独立ノイズで汚染区域を散らす
 * - obstacle: 廃墟ノイズが閾値超のタイルは障害物
 * @param {number} wx - ワールドX(px)
 * @param {number} wy - ワールドY(px)
 * @param {number} seed
 * @returns {{ground: number, toxic: boolean, obstacle: boolean}} ground: 0=荒野,1=草,2=瓦礫,3=岩場
 */
export function biomeAt(wx, wy, seed) {
  const continent = fbm(wx / 2400, wy / 2400, seed ^ 0x51ab);
  const detail = fbm(wx / 320, wy / 320, seed ^ 0x9e37);
  const toxicN = fbm(wx / 900 + 100, wy / 900 - 50, seed ^ 0x7f4a);
  const ruinN = fbm(wx / 640 - 33, wy / 640 + 77, seed ^ 0x1b4d);
  const v = continent * 0.65 + detail * 0.35;
  const ground = v < 0.42 ? 3 : v < 0.55 ? 0 : v < 0.72 ? 1 : 2;
  return {
    ground,
    toxic: toxicN > 0.62,
    obstacle: ruinN > 0.68,
  };
}

/**
 * チャンク内の決定論的スポーン候補（void 配置などに使用）。
 * @param {number} cx - チャンクX
 * @param {number} cy - チャンクY
 * @param {number} seed
 * @param {number} count
 * @returns {Array<{x: number, y: number}>}
 */
export function chunkPoints(cx, cy, seed, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({
      x: cx * CHUNK_SIZE + hash2(i * 7 + 1, cy, seed ^ cx) * CHUNK_SIZE,
      y: cy * CHUNK_SIZE + hash2(i * 7 + 3, cx, seed ^ cy) * CHUNK_SIZE,
    });
  }
  return pts;
}

/**
 * crypto.getRandomValues による安全なスポーン座標。
 * @returns {number}
 */
export function secureRandomCoord() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // int32 全域（±2147483647 内側に 4% マージン）
  return (buf[0] % 4123168600) - 2061584300;
}
