/**
 * @fileoverview 徘徊クリーチャー。
 * - 普段はランダムウェイポイントを徘徊
 * - プレイヤー/仲間が AGGRO_RANGE 内なら追跡
 * - 接触時はシーン側の overlap でダメージ処理（クールダンwn付き）
 */

import Phaser from 'phaser';

const AGGRO_RANGE = 170;
const WANDER_SPEED = 55;
const CHASE_SPEED = 105;
const WANDER_INTERVAL_MS = 2600;
const ATTACK_COOLDOWN_MS = 700;
export const CREATURE_HP = 3;
export const CREATURE_TOUCH_DAMAGE = 0.06;

export class Creature {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   */
  constructor(scene, x, y) {
    this.scene = scene;
    /** @type {Phaser.Physics.Arcade.Sprite} */
    this.sprite = scene.physics.add.sprite(x, y, 'spr-creature');
    this.sprite.setScale(0.45);
    this.sprite.setData('creature', this);
    this.hp = CREATURE_HP;
    this.lastAttackAt = 0;
    this.nextWanderAt = 0;
  }

  /**
   * @param {number} time - ms
   * @param {Array<{x: number, y: number}>} targets - 追跡候補（プレイヤー・仲間）
   * @returns {void}
   */
  update(time, targets) {
    if (!this.sprite.active) return;

    // 最寄りの追跡対象
    /** @type {{x: number, y: number} | null} */
    let target = null;
    let best = AGGRO_RANGE;
    for (const t of targets) {
      const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, t.x, t.y);
      if (d < best) {
        best = d;
        target = t;
      }
    }

    if (target) {
      this.scene.physics.moveTo(this.sprite, target.x, target.y, CHASE_SPEED);
      return;
    }

    // 徘徊: 一定間隔で新しい方向を決める
    if (time >= this.nextWanderAt) {
      this.nextWanderAt = time + WANDER_INTERVAL_MS + Math.random() * 1200;
      if (Math.random() < 0.25) {
        this.sprite.setVelocity(0, 0);
      } else {
        const angle = Math.random() * Math.PI * 2;
        this.sprite.setVelocity(
          Math.cos(angle) * WANDER_SPEED,
          Math.sin(angle) * WANDER_SPEED,
        );
      }
    }
  }

  /**
   * 接触攻撃を試みる。クールダウン中は false。
   * @param {number} now - ms
   * @returns {boolean} 攻撃が成立したか
   */
  tryAttack(now) {
    if (now - this.lastAttackAt < ATTACK_COOLDOWN_MS) return false;
    this.lastAttackAt = now;
    return true;
  }

  /**
   * ダメージを与える。
   * @param {number} amount
   * @returns {boolean} 死亡したら true
   */
  damage(amount) {
    this.hp -= amount;
    (/** @type {any} */ (this.sprite)).setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => this.sprite.clearTint());
    if (this.hp <= 0) {
      this.destroy();
      return true;
    }
    // 被弾時は一度立ち止まる（次の徘徊判定で再始動）
    this.sprite.setVelocity(0, 0);
    this.nextWanderAt = 0;
    return false;
  }

  /**
   * @returns {void}
   */
  destroy() {
    this.sprite.destroy();
  }
}
