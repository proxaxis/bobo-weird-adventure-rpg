/**
 * @fileoverview 空間ハッシュ（64bit BigInt キー）。
 * "tx,ty" 文字列キーは毎フレームの Map 参照で GC ゴミを生むため、
 * 高頻度参照のタイル/チャンクキーは BigInt のビット結合で持つ。
 */

/**
 * タイル座標 → 64bit キー。
 * @param {number} tx - int32 タイルX
 * @param {number} ty - int32 タイルY
 * @returns {bigint}
 */
export function tileKey(tx, ty) {
  return (BigInt(tx) << 32n) | (BigInt.asUintN(32, BigInt(ty)));
}

/**
 * チャンク座標 → 64bit キー（タイルキーと同じ結合規則）。
 * @param {number} cx
 * @param {number} cy
 * @returns {bigint}
 */
export function chunkKey(cx, cy) {
  return tileKey(cx, cy);
}

/**
 * キー → タイルX（符号付きに復元）。
 * @param {bigint} k
 * @returns {number}
 */
export function keyX(k) {
  return Number(k >> 32n);
}

/**
 * キー → タイルY（符号付きに復元）。
 * @param {bigint} k
 * @returns {number}
 */
export function keyY(k) {
  return Number(BigInt.asIntN(32, k));
}
