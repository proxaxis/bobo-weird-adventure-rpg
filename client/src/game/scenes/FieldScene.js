/**
 * @fileoverview 探索フェーズのメインシーン。
 * - WASD/矢印キーで移動、Eキーで近接NPCと対話開始（dialog:open 発火）
 * - ボイド結晶の接触収集、汚染ゾーンでの汚染度蓄積
 * - player:vital_update を定期的にイベントバスへ送出
 * ゲーム一時停止は GameCanvas が game:pause を購読して scene.pause/resume する。
 */

import Phaser from 'phaser';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { NPC_DEFS } from '@/game/npcs.js';
import { ensureFieldTextures } from '@/game/textures.js';

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1200;
const PLAYER_SPEED = 200;
const INTERACT_DISTANCE = 56;
const VOID_NODE_COUNT = 14;
const VOID_RESPAWN_MS = 6000;
const POLLUTION_RATE = 0.12; // 汚染ゾーン内での毎秒蓄積
const POLLUTION_DECAY = 0.02; // ゾーン外での毎秒回復
const HP_DRAIN_POLLUTION = 0.8; // この汚染度を超えるとHP減少
const HP_DRAIN_RATE = 0.04;
const VITAL_EMIT_MS = 250;

/**
 * 汚染ゾーン定義。
 * @type {Array<{x: number, y: number, r: number}>}
 */
const POLLUTION_ZONES = [
  { x: 350, y: 900, r: 160 },
  { x: 1250, y: 300, r: 140 },
];

export class FieldScene extends Phaser.Scene {
  constructor() {
    super('FieldScene');
    /** @type {Phaser.Physics.Arcade.Sprite} */
    this.player = /** @type {any} */ (null);
    /** @type {Phaser.Physics.Arcade.StaticGroup} */
    this.voids = /** @type {any} */ (null);
    /** @type {Record<string, Phaser.Input.Keyboard.Key>} */
    this.keys = /** @type {any} */ ({});
    /** @type {Phaser.GameObjects.Text | null} */
    this.promptText = null;
    this.pollution = 0;
    this.hp = 1;
    this.voidCount = 0;
    this.vitalTimer = 0;
    /** @type {Phaser.GameObjects.Sprite | null} */
    this.nearestNpc = null;
  }

  /**
   * @returns {void}
   */
  create() {
    ensureFieldTextures(this);

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor('#07090c');

    // 地面
    this.add
      .tileSprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 'tile-ground')
      .setDepth(-10);

    this.#createPollutionZones();
    this.#createPlayer();
    this.#createVoidNodes();
    this.#createNpcs();
    this.#createInput();
    this.#createPrompt();
  }

  /**
   * @returns {void}
   */
  #createPlayer() {
    this.player = this.physics.add.sprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'tex-player');
    this.player.setCollideWorldBounds(true);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
  }

  /**
   * @returns {void}
   */
  #createVoidNodes() {
    this.voids = this.physics.add.staticGroup();
    for (let i = 0; i < VOID_NODE_COUNT; i++) {
      this.#spawnVoid();
    }
    this.physics.add.overlap(this.player, this.voids, (_p, node) => {
      this.#collectVoid(/** @type {Phaser.Physics.Arcade.Sprite} */ (node));
    });
  }

  /**
   * @returns {void}
   */
  #spawnVoid() {
    const x = Phaser.Math.Between(60, WORLD_WIDTH - 60);
    const y = Phaser.Math.Between(60, WORLD_HEIGHT - 60);
    const node = this.voids.create(x, y, 'tex-void');
    node.refreshBody();
    this.tweens.add({
      targets: node,
      scale: { from: 0.85, to: 1.15 },
      duration: 900 + Math.random() * 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * @param {Phaser.Physics.Arcade.Sprite} node
   * @returns {void}
   */
  #collectVoid(node) {
    node.disableBody(true, true);
    this.voidCount += 1;
    this.#emitVitals();
    this.time.delayedCall(VOID_RESPAWN_MS, () => {
      const x = Phaser.Math.Between(60, WORLD_WIDTH - 60);
      const y = Phaser.Math.Between(60, WORLD_HEIGHT - 60);
      node.enableBody(false, x, y, true, true);
    });
  }

  /**
   * @returns {void}
   */
  #createPollutionZones() {
    for (const z of POLLUTION_ZONES) {
      this.add.circle(z.x, z.y, z.r, 0x3fbf6f, 0.14).setDepth(-5);
      this.add
        .circle(z.x, z.y, z.r)
        .setStrokeStyle(1.5, 0x3fbf6f, 0.5)
        .setDepth(-5);
      this.add
        .text(z.x, z.y - z.r - 14, '汚染区域', {
          color: '#7fe8a8',
          fontSize: '12px',
        })
        .setOrigin(0.5)
        .setDepth(-5);
    }
  }

  /**
   * @returns {void}
   */
  #createNpcs() {
    for (const def of NPC_DEFS) {
      const sprite = this.add.sprite(def.x, def.y, 'tex-npc');
      sprite.setData('npc', def);
      this.tweens.add({
        targets: sprite,
        y: def.y - 6,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.add
        .text(def.x, def.y - 30, def.name, {
          color: '#ffb7d5',
          fontSize: '12px',
        })
        .setOrigin(0.5);
    }
  }

  /**
   * @returns {void}
   */
  #createInput() {
    const kb = this.input.keyboard;
    if (!kb) return;
    this.keys = /** @type {Record<string, Phaser.Input.Keyboard.Key>} */ (
      kb.addKeys({
        up: 'W',
        down: 'S',
        left: 'A',
        right: 'D',
        upArrow: 'UP',
        downArrow: 'DOWN',
        leftArrow: 'LEFT',
        rightArrow: 'RIGHT',
        interact: 'E',
      })
    );
    kb.on('keydown-E', () => this.#tryInteract());
  }

  /**
   * @returns {void}
   */
  #createPrompt() {
    this.promptText = this.add
      .text(0, 0, 'Ｅ：話しかける', {
        color: '#ffffff',
        fontSize: '13px',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(100)
      .setVisible(false);
  }

  /**
   * 近接 NPC への対話要求。dialog:open を発火する。
   * @returns {void}
   */
  #tryInteract() {
    if (this.scene.isPaused()) return;
    const npc = this.#findNearestNpc(INTERACT_DISTANCE);
    if (!npc) return;
    const def = /** @type {import('@/game/npcs.js').NpcDef} */ (npc.getData('npc'));
    eventBus.emit(GAME_EVENTS.DIALOG_OPEN, {
      npcId: def.id,
      name: def.name,
      vrmModelUrl: def.vrmModelUrl,
    });
  }

  /**
   * @param {number} maxDist
   * @returns {Phaser.GameObjects.Sprite | null}
   */
  #findNearestNpc(maxDist) {
    /** @type {Phaser.GameObjects.Sprite | null} */
    let nearest = null;
    let best = maxDist;
    for (const obj of this.children.list) {
      if (!(obj instanceof Phaser.GameObjects.Sprite)) continue;
      const def = obj.getData('npc');
      if (!def) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y);
      if (d < best) {
        best = d;
        nearest = obj;
      }
    }
    return nearest;
  }

  /**
   * @returns {void}
   */
  #emitVitals() {
    /** @type {import('@/types.js').VitalUpdate} */
    const vital = {
      pollution: this.pollution,
      hp: this.hp,
      voidCount: this.voidCount,
    };
    eventBus.emit(GAME_EVENTS.VITAL_UPDATE, vital);
  }

  /**
   * @param {number} _time
   * @param {number} delta - ms
   * @returns {void}
   */
  update(_time, delta) {
    const dt = delta / 1000;
    this.#updateMovement();
    this.#updatePollution(dt);
    this.#updatePrompt();

    this.vitalTimer += delta;
    if (this.vitalTimer >= VITAL_EMIT_MS) {
      this.vitalTimer = 0;
      this.#emitVitals();
    }
  }

  /**
   * @returns {void}
   */
  #updateMovement() {
    const k = this.keys;
    let vx = 0;
    let vy = 0;
    if (k.left?.isDown || k.leftArrow?.isDown) vx -= 1;
    if (k.right?.isDown || k.rightArrow?.isDown) vx += 1;
    if (k.up?.isDown || k.upArrow?.isDown) vy -= 1;
    if (k.down?.isDown || k.downArrow?.isDown) vy += 1;
    if (vx !== 0 && vy !== 0) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }
    this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
  }

  /**
   * @param {number} dt - 秒
   * @returns {void}
   */
  #updatePollution(dt) {
    const inside = POLLUTION_ZONES.some(
      (z) =>
        Phaser.Math.Distance.Between(this.player.x, this.player.y, z.x, z.y) < z.r,
    );
    if (inside) {
      this.pollution = Math.min(1, this.pollution + POLLUTION_RATE * dt);
    } else {
      this.pollution = Math.max(0, this.pollution - POLLUTION_DECAY * dt);
    }
    if (this.pollution >= HP_DRAIN_POLLUTION) {
      this.hp = Math.max(0, this.hp - HP_DRAIN_RATE * dt);
    }
  }

  /**
   * @returns {void}
   */
  #updatePrompt() {
    const npc = this.#findNearestNpc(INTERACT_DISTANCE);
    if (!this.promptText) return;
    if (npc) {
      this.promptText.setPosition(npc.x, npc.y - 46).setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }
  }
}
