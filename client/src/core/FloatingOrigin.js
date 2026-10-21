/**
 * @fileoverview Floating Origin（セクタ座標系）。
 * 世界座標は int32 全域を取りうるが、Phaser/WebGL の内部座標は
 * プレイヤー周辺のセクタ原点からの相対（ローカル）値で扱う。
 * プレイヤーがセクタ境界を越えたらローカル座標を -2048 ずらして
 * セクタを進め、頂点座標を常に小さく保つ（float32 量子化崩壊の防止）。
 */

/** セクタサイズ(px) = 64タイル。 */
export const SECTOR_SIZE = 2048;

export class FloatingOrigin {
  /**
   * @param {number} absX - 初期ワールド絶対X
   * @param {number} absY - 初期ワールド絶対Y
   */
  constructor(absX, absY) {
    this.sectorX = Math.floor(absX / SECTOR_SIZE);
    this.sectorY = Math.floor(absY / SECTOR_SIZE);
    /** ローカル原点のワールド絶対座標（セクタの左隅）。 */
    this.ox = this.sectorX * SECTOR_SIZE;
    this.oy = this.sectorY * SECTOR_SIZE;
  }

  /**
   * ワールド絶対X → ローカルX。
   * @param {number} ax
   * @returns {number}
   */
  toLocalX(ax) {
    return ax - this.ox;
  }

  /**
   * ワールド絶対Y → ローカルY。
   * @param {number} ay
   * @returns {number}
   */
  toLocalY(ay) {
    return ay - this.oy;
  }

  /**
   * ローカルX → ワールド絶対X。
   * @param {number} lx
   * @returns {number}
   */
  absX(lx) {
    return lx + this.ox;
  }

  /**
   * ローカルY → ワールド絶対Y。
   * @param {number} ly
   * @returns {number}
   */
  absY(ly) {
    return ly + this.oy;
  }

  /**
   * プレイヤーのローカル座標からセクタ越境を判定し、
   * 越えていれば原点を進める。
   * @param {number} localX
   * @param {number} localY
   * @returns {{dx: number, dy: number} | null} 全オブジェクトに加えるべきローカル移動量（負値）
   */
  checkRebase(localX, localY) {
    const nsx = Math.floor(this.absX(localX) / SECTOR_SIZE);
    const nsy = Math.floor(this.absY(localY) / SECTOR_SIZE);
    if (nsx === this.sectorX && nsy === this.sectorY) return null;
    const dx = (nsx - this.sectorX) * SECTOR_SIZE;
    const dy = (nsy - this.sectorY) * SECTOR_SIZE;
    this.sectorX = nsx;
    this.sectorY = nsy;
    this.ox += dx;
    this.oy += dy;
    return { dx, dy };
  }
}
