/**
 * @fileoverview P2P共有ワールドのための決定論的レイアウト。
 * 接続ピアのID集合から同じシードを両端で計算し、
 * ボイドノードの配置・リスポーン位置を共有する。
 * （シグナリング不要・後続ピアは同じ集合で再計算）
 */

/**
 * FNV-1a 32bit ハッシュ。
 * @param {string} s
 * @returns {number}
 */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 PRNG。
 * @param {number} seed
 * @returns {() => number} 0〜1の乱数関数
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 参加メンバーから共有ワールドシードを導出する。
 * @param {string} myId
 * @param {string[]} peerIds
 * @returns {number} 接続ピアなしなら固定のローカルシード
 */
export function computeWorldSeed(myId, peerIds) {
  if (!myId || peerIds.length === 0) {
    return hashString('local-world');
  }
  const ids = [myId, ...peerIds].sort();
  return hashString(ids.join('|'));
}

/**
 * シードから count 個のボイド配置を決定論的に生成する。
 * @param {number} seed
 * @param {number} count
 * @param {number} worldW
 * @param {number} worldH
 * @param {number} margin
 * @returns {Array<{x: number, y: number}>}
 */
export function voidLayout(seed, count, worldW, worldH, margin = 60) {
  const rng = mulberry32(seed);
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: margin + rng() * (worldW - margin * 2),
      y: margin + rng() * (worldH - margin * 2),
    });
  }
  return points;
}

/**
 * リスポーン位置（採取通算番号 seq で決定論的に導出）。
 * @param {number} seed
 * @param {number} seq - ワールド全体の採取回数
 * @param {number} worldW
 * @param {number} worldH
 * @param {number} margin
 * @returns {{x: number, y: number}}
 */
export function voidRespawn(seed, seq, worldW, worldH, margin = 60) {
  const rng = mulberry32((seed ^ Math.imul(seq + 1, 2654435761)) >>> 0);
  return {
    x: margin + rng() * (worldW - margin * 2),
    y: margin + rng() * (worldH - margin * 2),
  };
}
