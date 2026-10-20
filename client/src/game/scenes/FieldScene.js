/**
 * @fileoverview 探索フェーズのメインシーン。
 * - Tiledマップ読み込み（ground/toxic/obstacles レイヤ、壁との衝突）
 * - WASD/矢印キー移動、SPACE 近接攻撃、Eキーで近接NPCと対話
 * - ボイド結晶収集（P2P接続時は共有シードで両端同一配置＋採取同期）
 * - クリーチャー（徘徊→追跡→接触ダメージ、討伐時ドロップ）
 * - 仲間（companion:join で追従・収集・援護）
 * - 汚染ゾーン蓄積・死亡ペナルティ・バイタル送出
 * ゲーム一時停止は GameCanvas が game:pause を購読して scene.pause/resume する。
 */

import Phaser from 'phaser';

import { playSfx } from '@/audio/audioManager.js';
import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { Companion } from '@/game/entities/Companion.js';
import { Creature, CREATURE_TOUCH_DAMAGE } from '@/game/entities/Creature.js';
import { NPC_DEFS } from '@/game/npcs.js';
import { ensureFieldTextures } from '@/game/textures.js';
import {
  computeWorldSeed,
  voidLayout,
  voidRespawn,
} from '@/game/worldSeed.js';
import { p2pSession } from '@/net/p2pSync.js';
import { usePeerStore } from '@/stores/peerStore.js';

const TILE = 32;
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1216;
const PLAYER_SPEED = 200;
const INTERACT_DISTANCE = 56;
const ATTACK_RANGE = 72;
const ATTACK_COOLDOWN_MS = 450;
const PEER_HIT_DAMAGE = 0.15;
const PEER_STEAL_MAX = 2;
const CREATURE_COUNT = 6;
const CREATURE_RESPAWN_MS = 12000;
const VOID_NODE_COUNT = 14;
const VOID_RESPAWN_MS = 6000;
const VOID_DROP_CHANCE = 0.4;
const POLLUTION_RATE = 0.12;
const POLLUTION_DECAY = 0.02;
const HP_DRAIN_POLLUTION = 0.8;
const HP_DRAIN_RATE = 0.04;
const DEATH_INVULNERABLE_MS = 2500;
const VITAL_EMIT_MS = 250;
const POSITION_EMIT_MS = 100;

/**
 * 汚染ゾーン（field.tmj の toxic レイヤと座標を合わせている）。
 * @type {Array<{x: number, y: number, r: number}>}
 */
const POLLUTION_ZONES = [
  { x: 368, y: 912, r: 160 },
  { x: 1264, y: 304, r: 128 },
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
    /** @type {import('@/game/entities/Creature.js').Creature[]} */
    this.creatures = [];
    /** @type {import('@/game/entities/Companion.js').Companion | null} */
    this.companion = null;
    /** @type {Map<string, Phaser.GameObjects.Sprite>} */
    this.peerSprites = new Map();
    /** @type {any} Phaser4 では createLayer が GPULayer を返し得るため any */
    this.obstacleLayer = null;

    this.pollution = 0;
    this.hp = 1;
    this.voidCount = 0;
    this.vitalTimer = 0;
    this.positionTimer = 0;
    this.attackReadyAt = 0;
    this.deadUntil = 0;
    this.voidSeq = 0;
    this.worldSeed = 0;
  }

  /**
   * @returns {void}
   */
  preload() {
    this.load.tilemapTiledJSON('field', '/maps/field.tmj');
    this.load.image('tiles', '/maps/tiles.png');
  }

  /**
   * @returns {void}
   */
  create() {
    ensureFieldTextures(this);

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor('#07090c');

    this.#createTilemap();
    this.#createPollutionZones();
    this.#createPlayer();
    this.#createVoidSystem();
    this.#createNpcs();
    this.#createCreatures();
    this.#createInput();
    this.#createPrompt();
    this.#bindBusEvents();
  }

  // ------------------------------------------------------------------
  // 生成系
  // ------------------------------------------------------------------

  /**
   * @returns {void}
   */
  #createTilemap() {
    const map = this.make.tilemap({ key: 'field' });
    const tiles = map.addTilesetImage('fieldtiles', 'tiles');
    if (!tiles) return;
    map.createLayer('ground', tiles, 0, 0).setDepth(-10);
    map.createLayer('toxic', tiles, 0, 0).setDepth(-9);
    this.obstacleLayer = /** @type {any} */ (
      map.createLayer('obstacles', tiles, 0, 0).setDepth(-8)
    );
    // 障害物レイヤに存在するタイルは全て衝突対象
    this.obstacleLayer.setCollisionByExclusion([-1]);
  }

  /**
   * @returns {void}
   */
  #createPlayer() {
    this.player = this.physics.add.sprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'tex-player');
    this.player.setCollideWorldBounds(true);
    if (this.obstacleLayer) {
      this.physics.add.collider(this.player, this.obstacleLayer);
    }
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
  }

  /**
   * @returns {void}
   */
  #createVoidSystem() {
    this.voids = this.physics.add.staticGroup();
    this.worldSeed = computeWorldSeed(this.#myPeerId(), this.#peerIds());
    this.#rebuildVoidLayout();
    this.physics.add.overlap(this.player, this.voids, (_p, node) => {
      this.#takeVoid(/** @type {Phaser.Physics.Arcade.Sprite} */ (node), true);
    });
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
        .text(def.x, def.y - 30, def.name, { color: '#ffb7d5', fontSize: '12px' })
        .setOrigin(0.5);
    }
  }

  /**
   * @returns {void}
   */
  #createCreatures() {
    for (let i = 0; i < CREATURE_COUNT; i++) {
      this.#spawnCreature();
    }
  }

  /**
   * @returns {void}
   */
  #spawnCreature() {
    let x = 0;
    let y = 0;
    // プレイヤーから十分離れた位置にスポーン
    do {
      x = Phaser.Math.Between(80, WORLD_WIDTH - 80);
      y = Phaser.Math.Between(80, WORLD_HEIGHT - 80);
    } while (
      Phaser.Math.Distance.Between(x, y, this.player?.x ?? 0, this.player?.y ?? 0) <
      240
    );
    const c = new Creature(this, x, y);
    c.sprite.setCollideWorldBounds(true);
    this.creatures.push(c);
    this.physics.add.overlap(this.player, c.sprite, () => this.#onCreatureTouch(c));
    if (this.obstacleLayer) {
      this.physics.add.collider(c.sprite, this.obstacleLayer);
    }
  }

  /**
   * @returns {void}
   */
  #createPollutionZones() {
    for (const z of POLLUTION_ZONES) {
      this.add
        .text(z.x, z.y - z.r - 14, '汚染区域', { color: '#7fe8a8', fontSize: '12px' })
        .setOrigin(0.5)
        .setDepth(-5);
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
        attack: 'SPACE',
      })
    );
    kb.on('keydown-E', () => this.#tryInteract());
    kb.on('keydown-SPACE', () => this.#tryAttack());
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

  // ------------------------------------------------------------------
  // イベントバス配線
  // ------------------------------------------------------------------

  /**
   * @returns {void}
   */
  #bindBusEvents() {
    this.onPeerPosition = (/** @type {import('@/types.js').PeerPosition} */ p) => {
      let sprite = this.peerSprites.get(p.peerId);
      if (!sprite) {
        sprite = this.add.sprite(p.x, p.y, 'tex-peer');
        this.peerSprites.set(p.peerId, sprite);
      } else {
        sprite.setPosition(p.x, p.y);
      }
    };
    this.onPeerStatus = (/** @type {import('@/types.js').PeerStatus} */ s) => {
      if (s.state === 'left') {
        const sprite = this.peerSprites.get(s.peerId);
        if (sprite) {
          sprite.destroy();
          this.peerSprites.delete(s.peerId);
        }
      }
      // ピア構成が変わったら共有シードとボイド配置を再計算
      this.worldSeed = computeWorldSeed(this.#myPeerId(), this.#peerIds());
      this.#rebuildVoidLayout();
    };
    this.onPeerVoidTake = (/** @type {import('@/types.js').PeerVoidTake} */ e) => {
      const node = this.#voidNodeAt(e.index);
      if (node?.active) this.#takeVoid(node, false);
    };
    this.onPeerAttack = (/** @type {import('@/types.js').PeerAttack} */ e) => {
      this.#onIncomingAttack(e);
    };
    this.onPeerStolen = (/** @type {import('@/types.js').PeerStolen} */ e) => {
      this.voidCount += e.amount;
      this.#emitVitals();
    };
    this.onCompanionJoin = (
      /** @type {import('@/types.js').CompanionJoinPayload} */ p,
    ) => this.#spawnCompanion(p.npcId, p.name);
    this.onCompanionLeave = () => this.#despawnCompanion();

    const E = GAME_EVENTS;
    eventBus.on(E.PEER_POSITION, this.onPeerPosition);
    eventBus.on(E.PEER_STATUS, this.onPeerStatus);
    eventBus.on(E.PEER_VOID_TAKE, this.onPeerVoidTake);
    eventBus.on(E.PEER_ATTACK, this.onPeerAttack);
    eventBus.on(E.PEER_STOLEN, this.onPeerStolen);
    eventBus.on(E.COMPANION_JOIN, this.onCompanionJoin);
    eventBus.on(E.COMPANION_LEAVE, this.onCompanionLeave);

    this.events.once('shutdown', () => {
      eventBus.off(E.PEER_POSITION, this.onPeerPosition);
      eventBus.off(E.PEER_STATUS, this.onPeerStatus);
      eventBus.off(E.PEER_VOID_TAKE, this.onPeerVoidTake);
      eventBus.off(E.PEER_ATTACK, this.onPeerAttack);
      eventBus.off(E.PEER_STOLEN, this.onPeerStolen);
      eventBus.off(E.COMPANION_JOIN, this.onCompanionJoin);
      eventBus.off(E.COMPANION_LEAVE, this.onCompanionLeave);
      this.peerSprites.clear();
      this.creatures.forEach((c) => c.destroy());
      this.companion?.destroy();
    });
  }

  // ------------------------------------------------------------------
  // P2P ヘルパ
  // ------------------------------------------------------------------

  /**
   * @returns {string}
   */
  #myPeerId() {
    return usePeerStore().myId;
  }

  /**
   * @returns {string[]}
   */
  #peerIds() {
    return usePeerStore().connectedIds;
  }

  // ------------------------------------------------------------------
  // ボイド
  // ------------------------------------------------------------------

  /**
   * 共有シードに基づいてボイドノードを全配置し直す。
   * @returns {void}
   */
  #rebuildVoidLayout() {
    this.voids.clear(true, true);
    const layout = voidLayout(this.worldSeed, VOID_NODE_COUNT, WORLD_WIDTH, WORLD_HEIGHT);
    layout.forEach((p, i) => {
      const node = this.voids.create(p.x, p.y, 'tex-void');
      node.setData('voidIndex', i);
      node.refreshBody();
      this.tweens.add({
        targets: node,
        scale: { from: 0.85, to: 1.15 },
        duration: 900 + Math.random() * 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    });
  }

  /**
   * @param {number} index
   * @returns {Phaser.Physics.Arcade.Sprite | null}
   */
  #voidNodeAt(index) {
    for (const node of this.voids.getChildren()) {
      const s = /** @type {Phaser.Physics.Arcade.Sprite} */ (node);
      if (s.getData('voidIndex') === index) return s;
    }
    return null;
  }

  /**
   * ボイドを採取する。
   * @param {Phaser.Physics.Arcade.Sprite} node
   * @param {boolean} broadcast - 自分/仲間の採取なら true（ピアへ通知）
   * @returns {void}
   */
  #takeVoid(node, broadcast) {
    const index = /** @type {number} */ (node.getData('voidIndex') ?? -1);
    node.disableBody(true, true);
    this.voidCount += 1;
    this.voidSeq += 1;
    const seq = this.voidSeq;
    playSfx('pickup');
    this.#emitVitals();
    if (broadcast && index >= 0) {
      p2pSession.sendVoidTake(index);
    }
    // ドロップ産ノード（index<0）は共有しない。通常ノードは決定論的位置に復活
    if (index >= 0) {
      this.time.delayedCall(VOID_RESPAWN_MS, () => {
        const p = voidRespawn(this.worldSeed, seq, WORLD_WIDTH, WORLD_HEIGHT);
        node.enableBody(false, p.x, p.y, true, true);
      });
    }
  }

  /**
   * クリーチャー討伐時のドロップノード（ローカルのみ、共有対象外）。
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  #dropVoid(x, y) {
    const node = this.voids.create(x, y, 'tex-void');
    node.setData('voidIndex', -1);
    node.refreshBody();
    this.time.delayedCall(20000, () => {
      if (node.active) node.disableBody(true, true);
    });
  }

  // ------------------------------------------------------------------
  // 戦闘
  // ------------------------------------------------------------------

  /**
   * SPACE 近接攻撃。クリーチャーとピアの両方に判定する。
   * @returns {void}
   */
  #tryAttack() {
    if (this.scene.isPaused() || this.time.now < this.attackReadyAt) return;
    if (this.time.now < this.deadUntil) return;
    this.attackReadyAt = this.time.now + ATTACK_COOLDOWN_MS;
    playSfx('attack');

    const { x, y } = this.player;
    const flash = this.add.circle(x, y, ATTACK_RANGE, 0xffffff, 0.18).setDepth(50);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 140,
      onComplete: () => flash.destroy(),
    });

    // クリーチャーへの命中
    for (const c of this.creatures) {
      if (!c.sprite.active) continue;
      if (Phaser.Math.Distance.Between(x, y, c.sprite.x, c.sprite.y) <= ATTACK_RANGE) {
        this.#damageCreature(c, 1);
      }
    }

    // ピアへの攻撃通知（被弾判定は相手側が行う）
    if (this.peerSprites.size > 0) {
      p2pSession.sendAttack(x, y, ATTACK_RANGE);
    }
  }

  /**
   * @param {import('@/game/entities/Creature.js').Creature} c
   * @param {number} amount
   * @returns {void}
   */
  #damageCreature(c, amount) {
    const died = c.damage(amount);
    if (!died) return;
    this.creatures = this.creatures.filter((x) => x !== c);
    if (Math.random() < VOID_DROP_CHANCE) {
      this.#dropVoid(c.sprite.x, c.sprite.y);
    }
    this.time.delayedCall(CREATURE_RESPAWN_MS, () => this.#spawnCreature());
  }

  /**
   * @param {import('@/game/entities/Creature.js').Creature} c
   * @returns {void}
   */
  #onCreatureTouch(c) {
    if (this.time.now < this.deadUntil) return;
    if (!c.tryAttack(this.time.now)) return;
    this.hp = Math.max(0, this.hp - CREATURE_TOUCH_DAMAGE);
    playSfx('hit');
    this.cameras.main.shake(120, 0.004);
    if (this.hp <= 0) this.#onDeath();
  }

  /**
   * ピアからの攻撃を受けた。範囲内なら被弾→ボイド略奪。
   * @param {import('@/types.js').PeerAttack} e
   * @returns {void}
   */
  #onIncomingAttack(e) {
    if (this.time.now < this.deadUntil) return;
    const d = Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y);
    if (d > e.r) return;

    this.hp = Math.max(0, this.hp - PEER_HIT_DAMAGE);
    const stolen = Math.min(PEER_STEAL_MAX, Math.floor(this.voidCount));
    if (stolen > 0) {
      this.voidCount -= stolen;
      p2pSession.sendStolen(e.peerId, stolen);
    }
    playSfx('hit');
    this.cameras.main.shake(150, 0.006);
    this.#emitVitals();
    if (this.hp <= 0) this.#onDeath();
  }

  /**
   * @returns {void}
   */
  #onDeath() {
    const lost = Math.ceil(this.voidCount * 0.3);
    this.voidCount -= lost;
    this.hp = 0.5;
    this.pollution = 0.3;
    this.deadUntil = this.time.now + DEATH_INVULNERABLE_MS;
    playSfx('death');
    eventBus.emit(GAME_EVENTS.PLAYER_DEATH, { lostVoid: lost });
    this.cameras.main.flash(400, 120, 20, 30);
    this.player.setPosition(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.#emitVitals();
  }

  // ------------------------------------------------------------------
  // 仲間
  // ------------------------------------------------------------------

  /**
   * @param {string} npcId
   * @param {string} name
   * @returns {void}
   */
  #spawnCompanion(npcId, name) {
    this.#despawnCompanion();
    const def = NPC_DEFS.find((n) => n.id === npcId);
    const x = def?.x ?? this.player.x + 40;
    const y = def?.y ?? this.player.y;
    this.companion = new Companion(this, { id: npcId, name }, x, y);
    if (this.obstacleLayer) {
      this.physics.add.collider(this.companion.sprite, this.obstacleLayer);
    }
  }

  /**
   * @returns {void}
   */
  #despawnCompanion() {
    this.companion?.destroy();
    this.companion = null;
  }

  // ------------------------------------------------------------------
  // NPC 対話
  // ------------------------------------------------------------------

  /**
   * @returns {void}
   */
  #tryInteract() {
    if (this.scene.isPaused()) return;
    const npc = this.#findNearestNpc(INTERACT_DISTANCE);
    if (!npc) return;
    const def = /** @type {import('@/game/npcs.js').NpcDef} */ (npc.getData('npc'));
    playSfx('dialog');
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

  // ------------------------------------------------------------------
  // バイタル/位置送出
  // ------------------------------------------------------------------

  /**
   * @returns {void}
   */
  #emitVitals() {
    // 最寄り脅威（クリーチャー）までの距離
    let threat = -1;
    for (const c of this.creatures) {
      if (!c.sprite.active) continue;
      const d = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, c.sprite.x, c.sprite.y,
      );
      if (threat < 0 || d < threat) threat = d;
    }

    /** @type {import('@/types.js').VitalUpdate} */
    const vital = {
      pollution: this.pollution,
      hp: this.hp,
      voidCount: this.voidCount,
      nearestThreatDistance: threat,
    };
    eventBus.emit(GAME_EVENTS.VITAL_UPDATE, vital);
  }

  // ------------------------------------------------------------------
  // update
  // ------------------------------------------------------------------

  /**
   * @param {number} time
   * @param {number} delta - ms
   * @returns {void}
   */
  update(time, delta) {
    const dt = delta / 1000;
    this.#updateMovement();
    this.#updatePollution(dt);
    this.#updatePrompt();
    this.#updateCreatures(time);
    this.#updateCompanion(time);

    this.vitalTimer += delta;
    if (this.vitalTimer >= VITAL_EMIT_MS) {
      this.vitalTimer = 0;
      this.#emitVitals();
    }

    this.positionTimer += delta;
    if (this.positionTimer >= POSITION_EMIT_MS) {
      this.positionTimer = 0;
      eventBus.emit(GAME_EVENTS.PLAYER_POSITION, {
        x: this.player.x,
        y: this.player.y,
      });
    }
  }

  /**
   * @returns {void}
   */
  #updateMovement() {
    if (this.time.now < this.deadUntil - DEATH_INVULNERABLE_MS + 300) {
      // 死亡直後の硬直
      this.player.setVelocity(0, 0);
      return;
    }
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
    if (this.pollution >= HP_DRAIN_POLLUTION && this.time.now >= this.deadUntil) {
      this.hp = Math.max(0, this.hp - HP_DRAIN_RATE * dt);
      if (this.hp <= 0) this.#onDeath();
    }
  }

  /**
   * @param {number} time
   * @returns {void}
   */
  #updateCreatures(time) {
    const targets = [this.player];
    if (this.companion) targets.push(this.companion.sprite);
    for (const c of this.creatures) c.update(time, targets);
  }

  /**
   * @param {number} time
   * @returns {void}
   */
  #updateCompanion(time) {
    if (!this.companion) return;
    this.companion.update(time, this.player, {
      voids: this.voids,
      creatures: this.creatures,
      onCollect: (node) => {
        if (node.active) this.#takeVoid(node, true);
      },
      onAssist: (c) => this.#damageCreature(c, 1),
    });
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
