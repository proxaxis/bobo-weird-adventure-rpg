/**
 * @fileoverview 探索フェーズのメインシーン（無限ワールド版）。
 * - マップ: int32 全域をマルチノイズ・バイオームで手続き生成（描画半径±1024）
 * - スポーン: crypto.getRandomValues による安全な乱数座標
 * - P2P: router へ座標を定期申告 → 近接ピア(±2048)と自動接続
 * - ボイド: チャンク単位(512px)の決定論配置、生成重複は router レジストリで防止
 * - WASD/矢印移動、SPACE 攻撃、E 対話、クリーチャー、仲間、汚染、死亡
 */

import Phaser from 'phaser';

import { playSfx } from '@/audio/audioManager.js';
import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { Companion } from '@/game/entities/Companion.js';
import { Creature, CREATURE_TOUCH_DAMAGE } from '@/game/entities/Creature.js';
import {
  biomeAt,
  CHUNK_SIZE,
  chunkPoints,
  secureRandomCoord,
} from '@/game/noise.js';
import { NPC_DEFS } from '@/game/npcs.js';
import { ensureFieldTextures } from '@/game/textures.js';
import { p2pSession } from '@/net/p2pSync.js';
import {
  getEntities,
  queryChunk,
  registerChunk,
  reportEntities,
  reportPresence,
} from '@/net/routerClient.js';
import { useBaseStore } from '@/stores/baseStore.js';
import { useGearStore } from '@/stores/gearStore.js';
import { useCompanionStore } from '@/stores/companionStore.js';
import { useParameterStore } from '@/stores/parameterStore.js';
import { usePeerStore } from '@/stores/peerStore.js';

const TILE = 32;
// 描画半径 ±1024 + マージン96px
const RENDER_PX = 1120;
const RENDER_TILES = 2 * Math.ceil(RENDER_PX / TILE) + 2; // 72
const RENDER_W = RENDER_TILES * TILE;
const VOIDS_PER_CHUNK = 3;
const CHUNK_VIEW = 1; // 自チャンク±1 = ±1024px のボイドを管理
const PLAYER_SPEED = 200;
const INTERACT_DISTANCE = 56;
const ATTACK_RANGE = 72;
const ATTACK_COOLDOWN_MS = 450;
const PEER_HIT_DAMAGE = 0.15;
const PEER_STEAL_MAX = 2;
const CREATURE_COUNT = 6;
const CREATURE_RESPAWN_MS = 12000;
const VOID_RESPAWN_MS = 6000;
const VOID_DROP_CHANCE = 0.4;
const POLLUTION_RATE = 0.12;
const POLLUTION_DECAY = 0.02;
const HP_DRAIN_POLLUTION = 0.8;
const HP_DRAIN_RATE = 0.04;
const DEATH_INVULNERABLE_MS = 2500;
const VITAL_EMIT_MS = 250;
const POSITION_EMIT_MS = 100;
const PRESENCE_EMIT_MS = 2000;
const ENTITY_EMIT_MS = 2000;
const NPC_WANDER_SPEED = 26;
const NPC_WANDER_RADIUS = 256;
const NPC_ATTRACT_TRUST = 0.5;
const NPC_ATTRACT_RANGE = 500;
// 拠点
const BASE_TILES = 6;
const BASE_EXPAND_COST = 3;
// 全クライアント共通の世界種（同一マップを見せるため固定）
const WORLD_SEED = 0xb0b0aa;

const GROUND_COLORS = ['#232a20', '#2b3a26', '#38333c', '#3b3c46'];
const OBSTACLE_COLOR = '#10131c';
const TOXIC_OVERLAY = 'rgba(90,220,140,0.18)';

/**
 * ボイドノードの共有キー（チャンク座標+スロットから int32 化）。
 * @param {number} cx
 * @param {number} cy
 * @param {number} i
 * @returns {number}
 */
function voidKey(cx, cy, i) {
  return Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ (i * 2654435761);
}

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
    /** @type {Map<string, Phaser.GameObjects.Text>} */
    this.npcLabels = new Map();

    // 無限マップ描画（CanvasTexture 1枚でビューポート周辺を覆う）
    /** @type {Phaser.Textures.CanvasTexture | null} */
    this.mapTex = null;
    /** @type {CanvasRenderingContext2D | null} */
    this.mapCtx = null;
    /** @type {Phaser.GameObjects.Image | null} */
    this.mapImage = null;
    this.mapTileX = NaN;
    this.mapTileY = NaN;
    /** 再描画の遅延タイマ（ms累積） */
    this.mapRedrawDelay = 0;

    // ワールド状態
    this.spawnX = 0;
    this.spawnY = 0;
    this.pollution = 0;
    this.hp = 1;
    this.voidCount = 0;
    this.vitalTimer = 0;
    this.positionTimer = 0;
    this.presenceTimer = 0;
    this.attackReadyAt = 0;
    this.deadUntil = 0;
    this.voidSeq = 0;
    this.lastChunkX = NaN;
    this.lastChunkY = NaN;
    /** @type {Set<number>} 採取済みボイドキー */
    this.takenVoidKeys = new Set();
    /** @type {Map<string, number>} チャンクキー→解決済みseed */
    this.chunkSeeds = new Map();
    /** @type {Map<string, string>} チャンクキー→所有者peerId */
    this.chunkOwners = new Map();

    // 拠点（セーフエリア）
    /** @type {Phaser.Physics.Arcade.StaticGroup | null} */
    this.baseGroup = null;
    /** タイル矩形 {x0,y0,x1,y1}（内部=床含む） */
    this.baseBounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
    /** @type {Set<number>} 壁/ドアブロックのタイルキー(tx*1e6+ty相当) */
    this.baseBlocks = new Set();
    /** ドアのワールド座標矩形 */
    this.doorRect = { x: 0, y: 0, w: 0, h: 0 };
    /** @type {Set<string>} ドア通過を許可したpeerId（自分は常時許可） */
    this.basePermitted = new Set();

    // NPC徘徊状態
    /** @type {Map<string, {sprite: Phaser.GameObjects.Sprite, homeX: number, homeY: number, tx: number, ty: number, waitUntil: number}>} */
    this.npcStates = new Map();

    // リモートエンティティ描画（他クライアントのchunk所有エンティティ）
    /** @type {Map<string, Phaser.GameObjects.Sprite>} */
    this.remoteEntities = new Map();
    /** @type {Map<string, {sx:number, sy:number, tx:number, ty:number, vx:number, vy:number, lastT:number}>} 補完状態（目標+推定速度） */
    this.remoteTargets = new Map();
    /** @type {Map<string, {sx:number, sy:number, tx:number, ty:number, vx:number, vy:number, lastT:number}>} ピア補完状態 */
    this.peerTargets = new Map();
    this.entityTimer = 0;
    /** リモート拠点ブロック用の静的衝突グループ */
    /** @type {Phaser.Physics.Arcade.StaticGroup | null} */
    this.remoteBaseGroup = null;
  }

  /**
   * @returns {void}
   */
  preload() {
    this.load.image('spr-player', '/sprites/player.png');
    this.load.image('spr-peer', '/sprites/peer.png');
    this.load.image('spr-creature', '/sprites/creature.png');
    this.load.image('spr-npc-yui', '/sprites/npc-yui.png');
    this.load.image('spr-npc-nagi', '/sprites/npc-nagi.png');
  }

  /**
   * @returns {void}
   */
  create() {
    ensureFieldTextures(this);

    // int32 全域ワールド + 安全乱数スポーン
    this.physics.world.setBounds(-2147483647, -2147483647, 4294967294, 4294967294);
    this.spawnX = secureRandomCoord();
    this.spawnY = secureRandomCoord();

    this.cameras.main.setBackgroundColor('#07090c');

    // Peer を自動起動（router presence 申告のため）
    void p2pSession.ensurePeer();

    this.#createMapView();
    this.#createPlayer();
    this.#createBase();
    // リモート拠点ブロック: ドアは meta.permitted 外の自分をブロック
    this.remoteBaseGroup = this.physics.add.staticGroup();
    const myId = this.#myPeerId() || 'me';
    this.physics.add.collider(this.player, this.remoteBaseGroup, undefined,
      (_p, block) => {
        const meta = /** @type {any} */ (
          /** @type {Phaser.Physics.Arcade.Sprite} */ (block).getData('meta') ?? {}
        );
        return !(meta.door === true && (meta.permitted ?? []).includes(myId));
      });
    this.#createVoidSystem();
    this.#createNpcs();
    this.#createCreatures();
    this.#createInput();
    this.#createPrompt();
    this.#bindBusEvents();
  }

  // ------------------------------------------------------------------
  // マップ描画（マルチノイズ・バイオーム、プレイヤー周辺 ±1024 を即時生成）
  // ------------------------------------------------------------------

  /**
   * @returns {void}
   */
  #createMapView() {
    const tex = /** @type {Phaser.Textures.CanvasTexture} */ (
      this.textures.createCanvas('mapview', RENDER_W, RENDER_W)
    );
    this.mapTex = tex;
    this.mapCtx = tex.getContext();
    this.mapImage = this.add
      .image(0, 0, 'mapview')
      .setOrigin(0.5)
      .setDepth(-20);
  }

  /**
   * 現在タイルを中心に RENDER_TILES×RENDER_TILES を再描画する。
   * @param {boolean} [force]
   * @returns {void}
   */
  #redrawMap(force = false) {
    const cTx = Math.floor(this.player.x / TILE);
    const cTy = Math.floor(this.player.y / TILE);
    if (!force && cTx === this.mapTileX && cTy === this.mapTileY) return;
    this.mapTileX = cTx;
    this.mapTileY = cTy;
    const ctx = this.mapCtx;
    if (!ctx || !this.mapTex || !this.mapImage) return;

    const half = Math.floor(RENDER_TILES / 2);
    const x0 = cTx - half;
    const y0 = cTy - half;
    for (let ty = y0; ty < y0 + RENDER_TILES; ty++) {
      for (let tx = x0; tx < x0 + RENDER_TILES; tx++) {
        const px = (tx - x0) * TILE;
        const py = (ty - y0) * TILE;
        const b = biomeAt(tx * TILE + TILE / 2, ty * TILE + TILE / 2, WORLD_SEED);
        ctx.fillStyle = b.obstacle
          ? OBSTACLE_COLOR
          : GROUND_COLORS[b.ground];
        ctx.fillRect(px, py, TILE, TILE);
        if (b.toxic) {
          ctx.fillStyle = TOXIC_OVERLAY;
          ctx.fillRect(px, py, TILE, TILE);
        }
      }
    }
    this.mapTex.refresh();
    this.mapImage.setPosition(cTx * TILE + TILE / 2, cTy * TILE + TILE / 2);
  }

  /**
   * マップ再描画の遅延バッチ。
   * - タイルを跨ぐたびに即時再描画せず、300ms 経過か
   *   8タイル以上移動（テクスチャ端接近）のどちらかでまとめて更新する。
   * @param {number} delta - ms
   * @returns {void}
   */
  #scheduleRedraw(delta) {
    const cTx = Math.floor(this.player.x / TILE);
    const cTy = Math.floor(this.player.y / TILE);
    if (cTx === this.mapTileX && cTy === this.mapTileY) {
      this.mapRedrawDelay = Math.max(0, this.mapRedrawDelay - delta);
      return;
    }
    this.mapRedrawDelay += delta;
    const movedFar =
      Math.abs(cTx - this.mapTileX) >= 8 || Math.abs(cTy - this.mapTileY) >= 8;
    if (movedFar || this.mapRedrawDelay >= 300) {
      this.mapRedrawDelay = 0;
      this.#redrawMap(true);
    }
  }

  /**
   * 座標が障害物タイルか。
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  #blockedAt(x, y) {
    return biomeAt(x, y, WORLD_SEED).obstacle;
  }

  // ------------------------------------------------------------------
  // 生成系
  // ------------------------------------------------------------------

  /**
   * @returns {void}
   */
  #createPlayer() {
    this.player = this.physics.add.sprite(this.spawnX, this.spawnY, 'spr-player');
    this.player.setScale(0.4);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.#redrawMap(true);
  }

  // ------------------------------------------------------------------
  // 拠点（セーフエリア）
  // ------------------------------------------------------------------

  /**
   * タイル座標→ブロックキー。
   * @param {number} tx
   * @param {number} ty
   * @returns {number}
   */
  #blockKey(tx, ty) {
    return Math.imul(tx, 100000) + ty;
  }

  /**
   * 壁/ドアブロックを配置する。
   * @param {number} tx
   * @param {number} ty
   * @param {'tex-block'|'tex-door'} tex
   * @returns {Phaser.Physics.Arcade.Sprite | null}
   */
  #placeBaseBlock(tx, ty, tex) {
    const key = this.#blockKey(tx, ty);
    if (this.baseBlocks.has(key)) return null;
    const wx = tx * TILE + TILE / 2;
    const wy = ty * TILE + TILE / 2;
    const s = /** @type {Phaser.Physics.Arcade.Sprite} */ (
      /** @type {any} */ (this.baseGroup).create(wx, wy, tex)
    );
    s.refreshBody();
    this.baseBlocks.add(key);
    return s;
  }

  /**
   * 初期拠点: スポーン位置を含む 6x6 外周壁 + 左辺中央ドア。
   * @returns {void}
   */
  #createBase() {
    this.baseGroup = this.physics.add.staticGroup();
    const stx = Math.floor(this.spawnX / TILE);
    const sty = Math.floor(this.spawnY / TILE);
    const x0 = stx - Math.floor(BASE_TILES / 2);
    const y0 = sty - Math.floor(BASE_TILES / 2);
    this.baseBounds = { x0, y0, x1: x0 + BASE_TILES - 1, y1: y0 + BASE_TILES - 1 };
    const doorTy = y0 + Math.floor(BASE_TILES / 2);
    for (let ty = y0; ty <= this.baseBounds.y1; ty++) {
      for (let tx = x0; tx <= this.baseBounds.x1; tx++) {
        const edge = tx === x0 || tx === this.baseBounds.x1 || ty === y0 || ty === this.baseBounds.y1;
        if (!edge) continue;
        if (tx === x0 && ty === doorTy) {
          // ドア: 所有者（自分）は通過可、他者はブロックされる
          this.doorRect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
          this.#placeBaseBlock(tx, ty, 'tex-door');
          continue;
        }
        this.#placeBaseBlock(tx, ty, 'tex-block');
      }
    }
    // 壁は全員ブロック。ドアは許可者（自分）のみ通過可
    this.physics.add.collider(
      this.player,
      this.baseGroup,
      undefined,
      (_p, block) => {
        const b = /** @type {Phaser.Physics.Arcade.Sprite} */ (block);
        return !this.#isDoorTile(b.x, b.y);
      },
    );
    this.basePermitted.add(this.#myPeerId() || 'me');
  }

  /**
   * 座標が拠点内部（床）にあるか。セーフエリア判定。
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  #insideBase(x, y) {
    const b = this.baseBounds;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return tx > b.x0 && tx < b.x1 && ty > b.y0 && ty < b.y1;
  }

  /**
   * 座標が自拠点のドアタイルか（本人なら通過可）。
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  #isDoorTile(x, y) {
    const d = this.doorRect;
    return x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h;
  }

  /**
   * Bキー: ボイド消費で壁ブロックを拡大追加する。
   * @returns {void}
   */
  #tryExpandBase() {
    if (this.voidCount < BASE_EXPAND_COST) return;
    const b = this.baseBounds;
    // 既存ブロックに隣接する空きタイルを外側から探す
    outer: for (let ring = 1; ring <= 4; ring++) {
      for (let ty = b.y0 - ring; ty <= b.y1 + ring; ty++) {
        for (let tx = b.x0 - ring; tx <= b.x1 + ring; tx++) {
          const onRing = tx === b.x0 - ring || tx === b.x1 + ring ||
            ty === b.y0 - ring || ty === b.y1 + ring;
          if (!onRing) continue;
          if (this.baseBlocks.has(this.#blockKey(tx, ty))) continue;
          const wx = tx * TILE + TILE / 2;
          const wy = ty * TILE + TILE / 2;
          if (this.#blockedAt(wx, wy)) continue;
          // 隣接タイルにブロックがあるか
          let near = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.baseBlocks.has(this.#blockKey(tx + dx, ty + dy))) { near = true; break; }
          }
          if (!near) continue;
          if (!this.#placeBaseBlock(tx, ty, 'tex-block')) continue;
          this.voidCount -= BASE_EXPAND_COST;
          this.baseBounds = {
            x0: Math.min(b.x0, tx), y0: Math.min(b.y0, ty),
            x1: Math.max(b.x1, tx), y1: Math.max(b.y1, ty),
          };
          playSfx('pickup');
          this.#emitVitals();
          break outer;
        }
      }
    }
  }

  /**
   * @returns {void}
   */
  #createVoidSystem() {
    this.voids = this.physics.add.staticGroup();
    this.#rebuildVoidLayout();
    this.physics.add.overlap(this.player, this.voids, (_p, node) => {
      this.#takeVoid(/** @type {Phaser.Physics.Arcade.Sprite} */ (node), true);
    });
  }

  /**
   * NPC をスポーン地点基準の相対座標に配置する。
   * @param {number} offX
   * @param {number} offY
   * @returns {{x: number, y: number}}
   */
  #relToSpawn(offX, offY) {
    return { x: this.spawnX + (offX - 800), y: this.spawnY + (offY - 608) };
  }

  /**
   * @returns {void}
   */
  #createNpcs() {
    const store = useCompanionStore();
    for (const def of NPC_DEFS) {
      const { x, y } = this.#relToSpawn(def.x, def.y);
      const sprite = this.add.sprite(x, y, def.texture);
      sprite.setScale(0.4);
      sprite.setData('npc', def);
      this.tweens.add({
        targets: sprite,
        y: y - 6,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      const label = this.add
        .text(x, y - 30, store.isKnown(def.id) ? def.name : '？？？', {
          color: '#ffb7d5',
          fontSize: '12px',
        })
        .setOrigin(0.5);
      this.npcLabels.set(def.id, label);
      this.npcStates.set(def.id, {
        sprite,
        homeX: x,
        homeY: y,
        tx: x,
        ty: y,
        waitUntil: this.time.now + Phaser.Math.Between(800, 3000),
      });
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
   * プレイヤー周辺 ±1024 の非障害タイルにスポーン。
   * @returns {void}
   */
  #spawnCreature() {
    let x = this.player.x;
    let y = this.player.y;
    for (let tries = 0; tries < 30; tries++) {
      x = this.player.x + Phaser.Math.Between(-1024, 1024);
      y = this.player.y + Phaser.Math.Between(-1024, 1024);
      const far = Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) >= 240;
      if (far && !this.#blockedAt(x, y) && !this.#insideBase(x, y)) break;
    }
    const c = new Creature(this, x, y);
    this.creatures.push(c);
    this.physics.add.overlap(this.player, c.sprite, () => this.#onCreatureTouch(c));
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
        expand: 'B',
      })
    );
    kb.on('keydown-E', () => this.#tryInteract());
    kb.on('keydown-SPACE', () => this.#tryAttack());
    kb.on('keydown-B', () => this.#tryExpandBase());
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
        sprite = this.add.sprite(p.x, p.y, 'spr-peer');
        sprite.setScale(0.4);
        this.peerSprites.set(p.peerId, sprite);
      }
      // 実座標は目標として保持し、update で補完する
      this.#pushTarget(this.peerTargets, p.peerId, p.x, p.y);
    };
    this.onPeerStatus = (/** @type {import('@/types.js').PeerStatus} */ s) => {
      if (s.state === 'left') {
        const sprite = this.peerSprites.get(s.peerId);
        if (sprite) {
          sprite.destroy();
          this.peerSprites.delete(s.peerId);
        }
        this.peerTargets.delete(s.peerId);
      }
      this.#rebuildVoidLayout();
    };
    this.onPeerVoidTake = (/** @type {import('@/types.js').PeerVoidTake} */ e) => {
      const node = this.#voidNodeAt(e.index);
      if (node?.active) this.#takeVoid(node, false);
      this.takenVoidKeys.add(e.index);
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
    this.onNameRevealed = (
      /** @type {import('@/types.js').CompanionJoinPayload} */ p,
    ) => {
      this.npcLabels.get(p.npcId)?.setText(p.name);
    };
    this.onSpendVoid = (/** @type {{amount: number}} */ p) => {
      this.voidCount = Math.max(0, this.voidCount - p.amount);
      this.#emitVitals();
    };

    const E = GAME_EVENTS;
    eventBus.on(E.PEER_POSITION, this.onPeerPosition);
    eventBus.on(E.PEER_STATUS, this.onPeerStatus);
    eventBus.on(E.PEER_VOID_TAKE, this.onPeerVoidTake);
    eventBus.on(E.PEER_ATTACK, this.onPeerAttack);
    eventBus.on(E.PEER_STOLEN, this.onPeerStolen);
    eventBus.on(E.COMPANION_JOIN, this.onCompanionJoin);
    eventBus.on(E.COMPANION_LEAVE, this.onCompanionLeave);
    eventBus.on(E.NPC_NAME_REVEALED, this.onNameRevealed);
    eventBus.on(E.PLAYER_SPEND_VOID, this.onSpendVoid);

    this.events.once('shutdown', () => {
      eventBus.off(E.PEER_POSITION, this.onPeerPosition);
      eventBus.off(E.PEER_STATUS, this.onPeerStatus);
      eventBus.off(E.PEER_VOID_TAKE, this.onPeerVoidTake);
      eventBus.off(E.PEER_ATTACK, this.onPeerAttack);
      eventBus.off(E.PEER_STOLEN, this.onPeerStolen);
      eventBus.off(E.COMPANION_JOIN, this.onCompanionJoin);
      eventBus.off(E.COMPANION_LEAVE, this.onCompanionLeave);
      eventBus.off(E.NPC_NAME_REVEALED, this.onNameRevealed);
      eventBus.off(E.PLAYER_SPEND_VOID, this.onSpendVoid);
      this.peerSprites.clear();
      this.creatures.forEach((c) => c.destroy());
      this.companion?.destroy();
    });
  }

  // ------------------------------------------------------------------
  // presence / チャンクレジストリ
  // ------------------------------------------------------------------

  /**
   * router へ座標を申告し、近接ピアとの接続を同期する。
   * @returns {Promise<void>}
   */
  async #emitPresence() {
    const id = await p2pSession.ensurePeer();
    if (!id) return;
    try {
      const peers = await reportPresence(id, this.player.x, this.player.y);
      p2pSession.syncPeers(peers.map((p) => p.peerId));
    } catch {
      // router 未起動など：単独プレイとして継続
    }
    void this.#syncEntities();
  }

  /**
   * エンティティ同期。自分が所有するチャンクは NPC/エネミー位置を
   * router へ報告し、他者所有チャンクは取得してリモート描画する。
   * @returns {Promise<void>}
   */
  async #syncEntities() {
    const myId = p2pSession.peerId || 'me';
    const ccx = Math.floor(this.player.x / CHUNK_SIZE);
    const ccy = Math.floor(this.player.y / CHUNK_SIZE);
    for (let cy = ccy - CHUNK_VIEW; cy <= ccy + CHUNK_VIEW; cy++) {
      for (let cx = ccx - CHUNK_VIEW; cx <= ccx + CHUNK_VIEW; cx++) {
        const key = `${cx},${cy}`;
        const owner = this.chunkOwners.get(key);
        if (owner === myId || owner === 'me') {
          // 所有チャンク: NPC・クリーチャー位置 + 拠点ブロックを報告
          const entities = [
            ...[...this.npcStates.entries()].map(([id, s]) => ({
              id: `npc:${id}`,
              type: 'npc',
              x: Math.round(s.sprite.x),
              y: Math.round(s.sprite.y),
            })),
            ...this.creatures.map((c, i) => ({
              id: `mob:${key}:${i}`,
              type: 'creature',
              x: Math.round(c.sprite.x),
              y: Math.round(c.sprite.y),
            })),
            ...[...this.baseBlocks].map((bk) => {
              const wx = Math.floor(bk % 100000) * TILE + TILE / 2;
              const wy = Math.floor(bk / 100000) * TILE + TILE / 2;
              return {
                id: `base:${myId}:${bk}`,
                type: 'base',
                x: wx,
                y: wy,
                meta: {
                  door: this.#isDoorTile(wx, wy),
                  permitted: [
                    ...new Set([
                      ...this.basePermitted,
                      ...useBaseStore().permittedIds,
                    ]),
                  ],
                },
              };
            }),
          ];
          try {
            await reportEntities(key, myId, entities);
          } catch {
            /* router未起動 */
          }
        } else {
          try {
            const r = await getEntities(cx, cy);
            if (r.owner && r.owner !== myId) {
              this.chunkOwners.set(key, r.owner);
              this.#syncRemoteEntities(key, r.entities);
            }
          } catch {
            /* router未起動 */
          }
        }
      }
    }
  }

  /**
   * 他クライアント所有チャンクのエンティティをスプライト描画する。
   * @param {string} chunkKey
   * @param {Array<{id: string, type: string, x: number, y: number, meta?: object}>} entities
   * @returns {void}
   */
  #syncRemoteEntities(chunkKey, entities) {
    const seen = new Set();
    const TEX = /** @type {Record<string, string>} */ ({
      npc: 'spr-npc-nagi',
      creature: 'spr-creature',
      base: 'tex-block',
    });
    for (const e of entities) {
      const key = `${chunkKey}:${e.id}`;
      seen.add(key);
      let s = this.remoteEntities.get(key);
      if (!s) {
        if (e.type === 'base' && this.remoteBaseGroup) {
          // 拠点ブロックは静的衝突体として配置（ドア許可判定はcollider側）
          const bs = /** @type {Phaser.Physics.Arcade.Sprite} */ (
            this.remoteBaseGroup.create(e.x, e.y, 'tex-block')
          );
          bs.setData('meta', e.meta ?? {});
          bs.refreshBody();
          s = /** @type {Phaser.GameObjects.Sprite} */ (bs);
        } else {
          s = this.add.sprite(e.x, e.y, TEX[e.type] ?? 'spr-peer');
          s.setScale(0.4);
          s.setAlpha(0.85);
        }
        this.remoteEntities.set(key, s);
      } else if (e.type === 'base') {
        /** @type {any} */ (s).setData('meta', e.meta ?? {});
      }
      this.#pushTarget(this.remoteTargets, key, e.x, e.y);
    }
    // 消えたエンティティを破棄
    for (const [key, s] of this.remoteEntities) {
      if (key.startsWith(`${chunkKey}:`) && !seen.has(key)) {
        s.destroy();
        this.remoteEntities.delete(key);
        this.remoteTargets.delete(key);
      }
    }
  }

  /**
   * チャンクの生成 seed を解決する（router レジストリで重複生成を防止）。
   * @param {number} cx
   * @param {number} cy
   * @returns {number}
   */
  #resolveChunkSeed(cx, cy) {
    const key = `${cx},${cy}`;
    const cached = this.chunkSeeds.get(key);
    if (cached !== undefined) return cached;
    const local = (Math.imul(cx, 2654435761) ^ Math.imul(cy, 40503) ^ WORLD_SEED) | 0;
    this.chunkSeeds.set(key, local);
    this.chunkOwners.set(key, p2pSession.peerId || 'me');
    void (async () => {
      try {
        const r = await queryChunk(cx, cy);
        if (r.exists && r.owner !== p2pSession.peerId && r.seed !== undefined) {
          this.chunkSeeds.set(key, r.seed);
          this.chunkOwners.set(key, r.owner ?? '');
        } else {
          await registerChunk(cx, cy, local, p2pSession.peerId || 'anon');
        }
      } catch {
        // router 不在でもローカル決定論生成で動く
      }
    })();
    return local;
  }

  /**
   * @returns {string}
   */
  #myPeerId() {
    return usePeerStore().myId;
  }

  // ------------------------------------------------------------------
  // ボイド（チャンク単位の決定論配置）
  // ------------------------------------------------------------------

  /**
   * プレイヤー周辺チャンク（±1）のボイドを再配置する。
   * @returns {void}
   */
  #rebuildVoidLayout() {
    this.voids.clear(true, true);
    const ccx = Math.floor(this.player.x / CHUNK_SIZE);
    const ccy = Math.floor(this.player.y / CHUNK_SIZE);
    for (let cy = ccy - CHUNK_VIEW; cy <= ccy + CHUNK_VIEW; cy++) {
      for (let cx = ccx - CHUNK_VIEW; cx <= ccx + CHUNK_VIEW; cx++) {
        const seed = this.#resolveChunkSeed(cx, cy);
        const pts = chunkPoints(cx, cy, seed, VOIDS_PER_CHUNK);
        pts.forEach((p, i) => {
          const key = voidKey(cx, cy, i);
          if (this.takenVoidKeys.has(key)) return;
          if (this.#blockedAt(p.x, p.y)) return;
          const node = this.voids.create(p.x, p.y, 'tex-void');
          node.setData('voidIndex', key);
          node.setData('cx', cx);
          node.setData('cy', cy);
          node.setData('slot', i);
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
    }
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
   * @param {Phaser.Physics.Arcade.Sprite} node
   * @param {boolean} broadcast
   * @returns {void}
   */
  #takeVoid(node, broadcast) {
    const index = /** @type {number} */ (node.getData('voidIndex') ?? -1);
    const cx = /** @type {number} */ (node.getData('cx') ?? 0);
    const cy = /** @type {number} */ (node.getData('cy') ?? 0);
    node.disableBody(true, true);
    this.voidCount += 1;
    this.voidSeq += 1;
    const seq = this.voidSeq;
    playSfx('pickup');
    this.#emitVitals();
    if (broadcast && index >= 0) {
      p2pSession.sendVoidTake(index);
    }
    if (index >= 0) {
      this.takenVoidKeys.add(index);
      this.time.delayedCall(VOID_RESPAWN_MS, () => {
        this.takenVoidKeys.delete(index);
        const seed = this.#resolveChunkSeed(cx, cy) ^ (seq * 97);
        const pts = chunkPoints(cx, cy, seed, VOIDS_PER_CHUNK);
        const slot = /** @type {number} */ (node.getData('slot') ?? 0);
        const p = pts[slot % pts.length];
        if (p && !this.#blockedAt(p.x, p.y)) {
          node.enableBody(false, p.x, p.y, true, true);
        }
      });
    }
  }

  /**
   * 討伐ドロップ（ローカルのみ）。
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

    for (const c of this.creatures) {
      if (!c.sprite.active) continue;
      if (Phaser.Math.Distance.Between(x, y, c.sprite.x, c.sprite.y) <= ATTACK_RANGE) {
        this.#damageCreature(c, 1);
      }
    }

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
    this.player.setPosition(this.spawnX, this.spawnY);
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
    const p = def ? this.#relToSpawn(def.x, def.y) : { x: this.player.x + 40, y: this.player.y };
    const texture = def?.texture ?? 'spr-npc-yui';
    this.companion = new Companion(this, { id: npcId, name }, p.x, p.y, texture);
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
    this.#updateNpcs(time, dt);
    this.#updateInterpolation(dt);

    // マップ再描画は遅延バッチ（移動中はテクスチャ端接近時のみ即時更新）
    this.#scheduleRedraw(delta);

    // チャンク移動でボイドを更新
    const ccx = Math.floor(this.player.x / CHUNK_SIZE);
    const ccy = Math.floor(this.player.y / CHUNK_SIZE);
    if (ccx !== this.lastChunkX || ccy !== this.lastChunkY) {
      this.lastChunkX = ccx;
      this.lastChunkY = ccy;
      this.#rebuildVoidLayout();
    }

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

    this.presenceTimer += delta;
    if (this.presenceTimer >= PRESENCE_EMIT_MS) {
      this.presenceTimer = 0;
      void this.#emitPresence();
    }
  }

  /**
   * @returns {void}
   */
  #updateMovement() {
    if (this.time.now < this.deadUntil - DEATH_INVULNERABLE_MS + 300) {
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
    // 障害タイルへの侵入を予測して軸ごとブロック
    const step = (PLAYER_SPEED / 60) + 4;
    if (vx !== 0 && this.#blockedAt(this.player.x + vx * step, this.player.y)) vx = 0;
    if (vy !== 0 && this.#blockedAt(this.player.x, this.player.y + vy * step)) vy = 0;
    this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
  }

  /**
   * ネットワークサンプルを補完状態へ反映する。
   * 連続2サンプルから平均速度を推定し、定速補間に使う。
   * @param {Map<string, {sx:number,sy:number,tx:number,ty:number,vx:number,vy:number,lastT:number}>} map
   * @param {string} key
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  #pushTarget(map, key, x, y) {
    const now = this.time.now;
    const s = map.get(key);
    if (!s) {
      map.set(key, { sx: x, sy: y, tx: x, ty: y, vx: 0, vy: 0, lastT: now });
      return;
    }
    const dt = Math.max((now - s.lastT) / 1000, 0.05);
    s.vx = (x - s.tx) / dt;
    s.vy = (y - s.ty) / dt;
    s.tx = x;
    s.ty = y;
    s.lastT = now;
  }

  /**
   * リモートスプライトを推定速度の定速移動で補完する。
   * 更新間隔が粗くても平均速度で動き続けるため自然に見える。
   * 距離が大きすぎる場合は瞬時移動（テレポート扱い）。
   * @param {number} dt - 秒
   * @returns {void}
   */
  #updateInterpolation(dt) {
    const moveTo = (/** @type {Phaser.GameObjects.Sprite} */ s, /** @type {{tx:number,ty:number,vx:number,vy:number}} */ t) => {
      const dx = t.tx - s.x;
      const dy = t.ty - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 300 || dist < 0.4) {
        s.setPosition(t.tx, t.ty);
        return;
      }
      // 推定速度×1.2（追いつき補正）で定速移動
      const speed = Math.max(Math.hypot(t.vx, t.vy) * 1.2, 30);
      const step = Math.min(dist, speed * dt);
      s.setPosition(s.x + (dx / dist) * step, s.y + (dy / dist) * step);
    };
    for (const [id, sprite] of this.peerSprites) {
      const t = this.peerTargets.get(id);
      if (t && sprite.active) moveTo(sprite, t);
    }
    for (const [key, sprite] of this.remoteEntities) {
      const t = this.remoteTargets.get(key);
      if (t && sprite.active && !(sprite instanceof Phaser.Physics.Arcade.Sprite)) {
        moveTo(sprite, t);
      }
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  #updatePollution(dt) {
    const inside =
      biomeAt(this.player.x, this.player.y, WORLD_SEED).toxic &&
      !this.#insideBase(this.player.x, this.player.y);
    const gear = useGearStore();
    if (inside) {
      this.pollution = Math.min(
        1,
        this.pollution + POLLUTION_RATE * gear.pollutionMul * dt,
      );
    } else {
      this.pollution = Math.max(0, this.pollution - POLLUTION_DECAY * dt);
    }
    if (this.pollution >= gear.drainThreshold && this.time.now >= this.deadUntil) {
      const rate = HP_DRAIN_RATE * gear.radiationMul * gear.maskDrainMul;
      this.hp = Math.max(0, this.hp - rate * dt);
      if (this.hp <= 0) this.#onDeath();
    }
  }

  /**
   * NPC 徘徊: ホーム周辺ランダム散策 + 高信頼時はプレイヤーへ寄る。
   * @param {number} time
   * @returns {void}
   */
  #updateNpcs(time, dt) {
    const companion = useCompanionStore();
    for (const [npcId, st] of this.npcStates) {
      // NPC個別の信頼度（対話差分で蓄積）
      const trust = companion.trustOf(npcId);
      const s = st.sprite;
      if (!s.active) continue;
      if (time < st.waitUntil) continue;
      const dx = st.tx - s.x;
      const dy = st.ty - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6) {
        st.waitUntil = time + Phaser.Math.Between(1500, 5000);
        // 次の目的地: 高信頼＆近距離ならプレイヤー付近、通常はホーム周辺
        const pd = Phaser.Math.Distance.Between(s.x, s.y, this.player.x, this.player.y);
        if (trust >= NPC_ATTRACT_TRUST && pd < NPC_ATTRACT_RANGE) {
          st.tx = this.player.x + Phaser.Math.Between(-80, 80);
          st.ty = this.player.y + Phaser.Math.Between(-80, 80);
        } else {
          st.tx = st.homeX + Phaser.Math.Between(-NPC_WANDER_RADIUS, NPC_WANDER_RADIUS);
          st.ty = st.homeY + Phaser.Math.Between(-NPC_WANDER_RADIUS, NPC_WANDER_RADIUS);
        }
      } else {
        const step = NPC_WANDER_SPEED * dt;
        s.x += (dx / dist) * Math.min(step, dist);
        s.y += (dy / dist) * Math.min(step, dist);
      }
      // ラベル追従
      const label = this.npcLabels.get(
        /** @type {any} */ (s.getData('npc'))?.id ?? '',
      );
      if (label) label.setPosition(s.x, s.y - 30);
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
