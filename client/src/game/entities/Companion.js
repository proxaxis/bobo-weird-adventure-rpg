/**
 * @fileoverview 仲間（コンパニオン）エンティティ。
 * - プレイヤーに追従
 * - 近くのボイドを自動収集
 * - 近くのクリーチャーを自動攻撃（援護）
 */

import Phaser from 'phaser';

const FOLLOW_DIST = 64;
const FOLLOW_SPEED = 210;
const COLLECT_RANGE = 44;
const ASSIST_RANGE = 150;
const ASSIST_DAMAGE = 1;
const ASSIST_COOLDOWN_MS = 800;

export class Companion {
  /**
   * @param {Phaser.Scene} scene
   * @param {{id: string, name: string}} npc
   * @param {number} x
   * @param {number} y
   */
  constructor(scene, npc, x, y) {
    this.scene = scene;
    this.npc = npc;
    /** @type {Phaser.Physics.Arcade.Sprite} */
    this.sprite = scene.physics.add.sprite(x, y, 'tex-npc');
    this.sprite.setTint(0xaef7e4);
    this.label = scene.add
      .text(x, y - 30, `${npc.name}（仲間）`, { color: '#aef7e4', fontSize: '11px' })
      .setOrigin(0.5);
    this.lastAssistAt = 0;
  }

  /**
   * 追従・収集・援護を行う。
   * @param {number} time - ms
   * @param {Phaser.Physics.Arcade.Sprite} player
   * @param {{voids: Phaser.Physics.Arcade.StaticGroup, creatures: import('./Creature.js').Creature[], onCollect: (node: Phaser.Physics.Arcade.Sprite) => void, onAssist: (c: import('./Creature.js').Creature) => void}} ctx
   * @returns {void}
   */
  update(time, player, ctx) {
    const { voids, creatures, onCollect, onAssist } = ctx;
    const me = this.sprite;

    // 追従
    const d = Phaser.Math.Distance.Between(me.x, me.y, player.x, player.y);
    if (d > FOLLOW_DIST) {
      this.scene.physics.moveTo(me, player.x, player.y, FOLLOW_SPEED);
    } else {
      me.setVelocity(0, 0);
    }
    this.label.setPosition(me.x, me.y - 30);

    // ボイド収集
    for (const node of voids.getChildren()) {
      const sprite = /** @type {Phaser.Physics.Arcade.Sprite} */ (node);
      if (!sprite.active) continue;
      if (
        Phaser.Math.Distance.Between(me.x, me.y, sprite.x, sprite.y) < COLLECT_RANGE
      ) {
        onCollect(sprite);
      }
    }

    // 援護攻撃
    if (time - this.lastAssistAt >= ASSIST_COOLDOWN_MS) {
      for (const c of creatures) {
        if (!c.sprite.active) continue;
        if (
          Phaser.Math.Distance.Between(me.x, me.y, c.sprite.x, c.sprite.y) <
          ASSIST_RANGE
        ) {
          this.lastAssistAt = time;
          onAssist(c);
          break;
        }
      }
    }
  }

  /**
   * @returns {void}
   */
  destroy() {
    this.label.destroy();
    this.sprite.destroy();
  }
}
