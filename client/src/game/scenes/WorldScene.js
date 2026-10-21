/**
 * @fileoverview 探索フェーズのメインシーン（Floating Origin 版）。
 * - 座標: 世界は int32 絶対座標。描画/物理はセクタ原点からのローカル座標。
 *   プレイヤーがセクタ境界(2048px)を越えると全オブジェクトを反転オフセット
 *   して原点を進め、WebGL 頂点を常に小さく保つ（float32 量子化防止）。
 * - マップ: DeltaMap.get(key) ?? ProceduralNoise(tx,ty)（整地/建築スタンプ優先）
 * - 背景: CanvasTexture 差分スクロール（露出行/列のみ描画）
 * - 通信: NetworkWorker 経由で presence/リース/エンティティ同期
 * - 所有権: チャンクリース(TTL5s)保持者がそのチャンクのエンティティを報告
 * - NPC: チャンク決定論的配置 npc_{cx}_{cy}_{i}（全クライアントで同一）
 */

import Phaser from 'phaser';

import { playSfx } from '@/audio/audioManager.js';
import { deltaMap } from '@/core/DeltaMap.js';
import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { FloatingOrigin, SECTOR_SIZE } from '@/core/FloatingOrigin.js';
import { chunkKey, tileKey } from '@/core/spatial.js';
import { Companion } from '@/game/entities/Companion.js';
import { Creature, CREATURE_TOUCH_DAMAGE } from '@/game/entities/Creature.js';
import { CHUNK_SIZE, chunkPoints, secureRandomCoord } from '@/game/noise.js';
import { NPC_DEFS } from '@/game/npcs.js';
import { ensureFieldTextures } from '@/game/textures.js';
import { network } from '@/net/network.js';
import { p2pSession } from '@/net/p2pSync.js';
import {
  fetchDelta,
  queryChunk,
  registerChunk,
  stampDelta,
} from '@/net/routerClient.js';
import { useBaseStore } from '@/stores/baseStore.js';
import { useGearStore } from '@/stores/gearStore.js';
import { useCompanionStore } from '@/stores/companionStore.js';
import { usePeerStore } from '@/stores/peerStore.js';

const TILE = 32;
// 描画半径 ±1024 + マージン96px
const RENDER_PX = 1120;
const RENDER_TILES = 2 * Math.ceil(RENDER_PX / TILE) + 2; // 72
const RENDER_W = RENDER_TILES * TILE;
const VOIDS_PER_CHUNK = 3;
const CHUNK_VIEW = 1; // 自チャンク±1 = ±1024px の管理範囲
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
// チャンクにNPCが生成される確率（決定論的）。約1/8チャンク。
const NPC_CHUNK_PROB = 0.125;
const NPC_SALT = 0x5eed;
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

/**
 * チャンクに生成されるNPC定義（決定論的）。
 * @param {number} cx
 * @param {number} cy
 * @returns {import('@/game/npcs.js').NpcDef[]}
 */
function npcsInChunk(cx, cy) {
  const h = Math.imul(cx, 374761393) ^ Math.imul(cy, 668265263) ^ NPC_SALT;
  const roll = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  if (roll >= NPC_CHUNK_PROB) return [];
  const def = NPC_DEFS[Math.abs(Math.imul(cx ^ cy, 97)) % NPC_DEFS.length];
  return def ? [def] : [];
}

/**
 * NPC の決定論的配置位置（チャンク内、絶対座標）。
 * @param {number} cx
 * @param {number} cy
 * @param {number} index
 * @returns {{x: number, y: number}}
 */
function npcHomePos(cx, cy, index) {
  const pts = chunkPoints(cx, cy, WORLD_SEED ^ NPC_SALT, 4);
  const p = pts[index % pts.length];
  return { x: p.x, y: p.y };
}

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
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

    // Floating Origin: 絶対座標 = ローカル + origin
    /** @type {FloatingOrigin} */
    this.origin = /** @type {any} */ (null);

    // 無限マップ描画（CanvasTexture 1枚でビューポート周辺を覆う）
    /** @type {Phaser.Textures.CanvasTexture | null} */
    this.mapTex = null;
    /** @type {CanvasRenderingContext2D | null} */
    this.mapCtx = null;
    /** @type {Phaser.GameObjects.Image | null} */
    this.mapImage = null;
    /** 現在の背景アンカー（絶対タイル座標） */
    this.mapTileX = NaN;
    this.mapTileY = NaN;

    // ワールド状態（スポーン地点は絶対座標で保持）
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
    /** @type {Map<bigint, number>} チャンクキー→解決済みseed */
    this.chunkSeeds = new Map();
    /** @type {Map<bigint, {owner: string, at: number}>} チャンクキー→リース所有者 */
    this.chunkLeases = new Map();

    // 拠点（セーフエリア。座標系は絶対タイル、スプライトはローカル）
    /** @type {Phaser.Physics.Arcade.StaticGroup | null} */
    this.baseGroup = null;
    /** タイル矩形 {x0,y0,x1,y1}（内部=床含む、絶対タイル座標） */
    this.baseBounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
    /** @type {Set<bigint>} 壁/ドアブロックのタイルキー */
    this.baseBlocks = new Set();
    /** ドアの絶対タイル座標 */
    this.doorTile = { tx: 0, ty: 0 };
    /** @type {Set<string>} ドア通過を許可したプレイヤーUUID（自分は常時許可） */
    this.basePermitted = new Set();

    // NPC徘徊状態（キーは決定論的 npc_{cx}_{cy}_{i}、座標はローカル）
    /** @type {Map<string, {sprite: Phaser.GameObjects.Sprite, homeX: number, homeY: number, tx: number, ty: number, waitUntil: number}>} */
    this.npcStates = new Map();

    // リモートエンティティ描画（他クライアントのリース所有エンティティ）
    /** @type {Map<string, Phaser.GameObjects.Sprite>} */
    this.remoteEntities = new Map();
    /** @type {Map<string, {sx:number, sy:number, tx:number, ty:number, vx:number, vy:number, lastT:number}>} 補完状態（ローカル座標） */
    this.remoteTargets = new Map();
    /** @type {Map<string, {sx:number, sy:number, tx:number, ty:number, vx:number, vy:number, lastT:number}>} ピア補完状態（ローカル座標） */
    this.peerTargets = new Map();
    this.entityTimer = 0;
    /** リモート拠点ブロック用の静的衝突グループ（DeltaMap駆動） */
    /** @type {Phaser.Physics.Arcade.StaticGroup | null} */
    this.remoteBaseGroup = null;
    /** @type {Map<string, Phaser.Physics.Arcade.Sprite>} DeltaMap由来ブロック */
    this.deltaBlocks = new Map();
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

    // ローカル座標は常にセクタ内に収まるため、物理境界は十分に広く取ればよい
    this.physics.world.setBounds(
      -SECTOR_SIZE * 4,
      -SECTOR_SIZE * 4,
      SECTOR_SIZE * 9,
      SECTOR_SIZE * 9,
    );

    // int32 全域ワールド + 安全乱数スポーン（障害/汚染タイルを回避）
    const sp = this.#safeSpawnCoord();
    this.spawnX = sp.x;
    this.spawnY = sp.y;
    this.origin = new FloatingOrigin(this.spawnX, this.spawnY);

    this.cameras.main.setBackgroundColor('#07090c');

    // ネットワーク層起動: UUID → Peer → Worker(router WS)
    void (async () => {
      await network.init();
      const peerId = await p2pSession.ensurePeer();
      network.setPeerId(peerId || '');
      // 自チャンクのリースを即時要求
      network.acquireLease(
        Math.floor(this.spawnX / CHUNK_SIZE),
        Math.floor(this.spawnY / CHUNK_SIZE),
      );
    })();

    this.#createMapView();
    this.#createPlayer();
    this.#createBase();
    // リモート拠点ブロック: ドアは meta.permitted 外の自分をブロック
    this.remoteBaseGroup = this.physics.add.staticGroup();
    this.physics.add.collider(this.player, this.remoteBaseGroup, undefined,
      (_p, block) => {
        const meta = /** @type {any} */ (
          /** @type {Phaser.Physics.Arcade.Sprite} */ (block).getData('meta') ?? {}
        );
        return !(
          meta.door === true && (meta.permitted ?? []).includes(network.uuid)
        );
      });
    this.#createVoidSystem();
    this.#createCreatures();
    this.#createInput();
    this.#createPrompt();
    this.#bindBusEvents();
  }

  // ------------------------------------------------------------------
  // 座標ヘルパ（ローカル ↔ 絶対）
  // ------------------------------------------------------------------

  /** @returns {number} プレイヤーの絶対X */
  #absX() {
    return this.origin.absX(this.player.x);
  }

  /** @returns {number} プレイヤーの絶対Y */
  #absY() {
    return this.origin.absY(this.player.y);
  }

  /**
   * 絶対X → ローカルX。
   * @param {number} ax
   * @returns {number}
   */
  #lx(ax) {
    return this.origin.toLocalX(ax);
  }

  /**
   * 絶対Y → ローカルY。
   * @param {number} ay
   * @returns {number}
   */
  #ly(ay) {
    return this.origin.toLocalY(ay);
  }

  /**
   * セクタ越境時の座標リベース。
   * 全表示オブジェクトとローカル座標で保持している状態を -dx,-dy ずらす。
   * @returns {void}
   */
  #applyRebase() {
    const r = this.origin.checkRebase(this.player.x, this.player.y);
    if (!r) return;
    const { dx, dy } = r;
    for (const obj of this.children.list) {
      const go = /** @type {any} */ (obj);
      go.x -= dx;
      go.y -= dy;
      const body = go.body;
      if (body) {
        body.position.x -= dx;
        body.position.y -= dy;
        if (body.prev) {
          body.prev.x -= dx;
          body.prev.y -= dy;
        }
      }
    }
    // ローカル座標で保持している移動目標・徘徊状態もずらす
    for (const st of this.npcStates.values()) {
      st.homeX -= dx;
      st.homeY -= dy;
      st.tx -= dx;
      st.ty -= dy;
    }
    for (const t of this.peerTargets.values()) {
      t.sx -= dx; t.sy -= dy; t.tx -= dx; t.ty -= dy;
    }
    for (const t of this.remoteTargets.values()) {
      t.sx -= dx; t.sy -= dy; t.tx -= dx; t.ty -= dy;
    }
  }

  // ------------------------------------------------------------------
  // マップ描画（差分スクロール + DeltaMap 優先）
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
   * 1タイル分だけ描画する共通処理。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} tx - 絶対タイルx
   * @param {number} ty - 絶対タイルy
   * @param {number} x0 - キャンバス左上の絶対タイルx
   * @param {number} y0 - キャンバス左上の絶対タイルy
   * @returns {void}
   */
  #drawMapTile(ctx, tx, ty, x0, y0) {
    const px = (tx - x0) * TILE;
    const py = (ty - y0) * TILE;
    const b = deltaMap.tileAt(tx * TILE + TILE / 2, ty * TILE + TILE / 2, WORLD_SEED);
    ctx.fillStyle = b.obstacle ? OBSTACLE_COLOR : GROUND_COLORS[b.ground];
    ctx.fillRect(px, py, TILE, TILE);
    if (b.toxic) {
      ctx.fillStyle = TOXIC_OVERLAY;
      ctx.fillRect(px, py, TILE, TILE);
    }
  }

  /**
   * キャンバス全領域を描画する（初期化・大幅移動時）。
   * @param {number} cTx - 中心の絶対タイルx
   * @param {number} cTy - 中心の絶対タイルy
   * @returns {void}
   */
  #fillMap(cTx, cTy) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const half = Math.floor(RENDER_TILES / 2);
    const x0 = cTx - half;
    const y0 = cTy - half;
    for (let ty = y0; ty < y0 + RENDER_TILES; ty++) {
      for (let tx = x0; tx < x0 + RENDER_TILES; tx++) {
        this.#drawMapTile(ctx, tx, ty, x0, y0);
      }
    }
  }

  /**
   * 差分スクロール更新。タイル境界を跨いだ分だけキャンバスをずらし、
   * 露出した列/行だけ塗る。
   * @returns {void}
   */
  #redrawMap() {
    const cTx = Math.floor(this.#absX() / TILE);
    const cTy = Math.floor(this.#absY() / TILE);
    if (cTx === this.mapTileX && cTy === this.mapTileY) return;
    const dx = cTx - this.mapTileX;
    const dy = cTy - this.mapTileY;
    this.mapTileX = cTx;
    this.mapTileY = cTy;
    const ctx = this.mapCtx;
    if (!ctx || !this.mapTex || !this.mapImage) return;

    const half = Math.floor(RENDER_TILES / 2);
    const x0 = cTx - half;
    const y0 = cTy - half;
    const x1 = x0 + RENDER_TILES - 1;
    const y1 = y0 + RENDER_TILES - 1;
    if (Math.abs(dx) >= RENDER_TILES || Math.abs(dy) >= RENDER_TILES) {
      this.#fillMap(cTx, cTy);
    } else {
      ctx.drawImage(this.mapTex.canvas, -dx * TILE, -dy * TILE);
      if (dx > 0) {
        for (let tx = x1 - dx + 1; tx <= x1; tx++) {
          for (let ty = y0; ty <= y1; ty++) this.#drawMapTile(ctx, tx, ty, x0, y0);
        }
      } else if (dx < 0) {
        for (let tx = x0; tx <= x0 - dx - 1; tx++) {
          for (let ty = y0; ty <= y1; ty++) this.#drawMapTile(ctx, tx, ty, x0, y0);
        }
      }
      if (dy > 0) {
        for (let ty = y1 - dy + 1; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) this.#drawMapTile(ctx, tx, ty, x0, y0);
        }
      } else if (dy < 0) {
        for (let ty = y0; ty <= y0 - dy - 1; ty++) {
          for (let tx = x0; tx <= x1; tx++) this.#drawMapTile(ctx, tx, ty, x0, y0);
        }
      }
    }
    this.mapTex.refresh();
    // 背景はローカル座標で配置（アンカーは絶対タイルの中央）
    this.mapImage.setPosition(
      this.#lx(cTx * TILE + TILE / 2),
      this.#ly(cTy * TILE + TILE / 2),
    );
  }

  /**
   * 座標が障害物タイルか（絶対座標で判定）。
   * @param {number} absX
   * @param {number} absY
   * @returns {boolean}
   */
  #blockedAt(absX, absY) {
    return deltaMap.tileAt(absX, absY, WORLD_SEED).obstacle;
  }

  // ------------------------------------------------------------------
  // 生成系
  // ------------------------------------------------------------------

  /**
   * @returns {void}
   */
  #createPlayer() {
    this.player = this.physics.add.sprite(
      this.#lx(this.spawnX),
      this.#ly(this.spawnY),
      'spr-player',
    );
    this.player.setScale(0.4);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.mapTileX = Math.floor(this.spawnX / TILE);
    this.mapTileY = Math.floor(this.spawnY / TILE);
    this.#fillMap(this.mapTileX, this.mapTileY);
    if (this.mapTex && this.mapImage) {
      this.mapTex.refresh();
      this.mapImage.setPosition(
        this.#lx(this.mapTileX * TILE + TILE / 2),
        this.#ly(this.mapTileY * TILE + TILE / 2),
      );
    }
  }

  // ------------------------------------------------------------------
  // 拠点（セーフエリア + DeltaMap 整地/建築スタンプ）
  // ------------------------------------------------------------------

  /**
   * 壁/ドアブロックを配置する。
   * @param {number} tx - 絶対タイルx
   * @param {number} ty - 絶対タイルy
   * @param {'tex-block'|'tex-door'} tex
   * @returns {Phaser.Physics.Arcade.Sprite | null}
   */
  #placeBaseBlock(tx, ty, tex) {
    const key = tileKey(tx, ty);
    if (this.baseBlocks.has(key)) return null;
    const wx = tx * TILE + TILE / 2;
    const wy = ty * TILE + TILE / 2;
    const s = /** @type {Phaser.Physics.Arcade.Sprite} */ (
      /** @type {any} */ (this.baseGroup).create(this.#lx(wx), this.#ly(wy), tex)
    );
    s.refreshBody();
    this.baseBlocks.add(key);
    return s;
  }

  /**
   * DeltaMap へスタンプを書き込み、ローカルキャッシュにも即時反映する。
   * @param {Array<{tx: number, ty: number, v: object}>} tiles
   * @returns {void}
   */
  #stampDelta(tiles) {
    deltaMap.applyLocal(tiles);
    const uuid = network.uuid;
    if (uuid) void stampDelta(uuid, tiles).catch(() => {});
  }

  /**
   * 初期拠点: スポーン位置を含む 6x6 外周壁 + 左辺中央ドア。
   * DeltaMap へ「整地スタンプ」を打って山岳/汚染へのめり込みを防ぐ。
   * @returns {void}
   */
  #createBase() {
    this.baseGroup = this.physics.add.staticGroup();
    const stx = Math.floor(this.spawnX / TILE);
    const sty = Math.floor(this.spawnY / TILE);
    const x0 = stx - Math.floor(BASE_TILES / 2);
    const y0 = sty - Math.floor(BASE_TILES / 2);
    this.baseBounds = { x0, y0, x1: x0 + BASE_TILES - 1, y1: y0 + BASE_TILES - 1 };

    // 整地スタンプ: 拠点範囲+1タイルの外縁を「平地・非汚染・障害なし」に
    const flat = [];
    for (let ty = y0 - 1; ty <= this.baseBounds.y1 + 1; ty++) {
      for (let tx = x0 - 1; tx <= this.baseBounds.x1 + 1; tx++) {
        flat.push({ tx, ty, v: { kind: 'flat' } });
      }
    }
    this.#stampDelta(flat);

    const doorTy = y0 + Math.floor(BASE_TILES / 2);
    /** @type {Array<{tx:number, ty:number, v:object}>} */
    const blockStamps = [];
    for (let ty = y0; ty <= this.baseBounds.y1; ty++) {
      for (let tx = x0; tx <= this.baseBounds.x1; tx++) {
        const edge = tx === x0 || tx === this.baseBounds.x1 || ty === y0 || ty === this.baseBounds.y1;
        if (!edge) continue;
        if (tx === x0 && ty === doorTy) {
          this.doorTile = { tx, ty };
          this.#placeBaseBlock(tx, ty, 'tex-door');
          blockStamps.push({ tx, ty, v: this.#doorStampValue() });
          continue;
        }
        this.#placeBaseBlock(tx, ty, 'tex-block');
        blockStamps.push({ tx, ty, v: { kind: 'block', owner: network.uuid || 'me' } });
      }
    }
    this.#stampDelta(blockStamps);

    // 壁は全員ブロック。ドアは許可者（自分）のみ通過可
    this.physics.add.collider(
      this.player,
      this.baseGroup,
      undefined,
      (_p, block) => {
        const b = /** @type {Phaser.Physics.Arcade.Sprite} */ (block);
        const wx = this.origin.absX(b.x);
        const wy = this.origin.absY(b.y);
        return !this.#isDoorTile(wx, wy);
      },
    );
    this.basePermitted.add('me');
  }

  /**
   * ドアブロックの DeltaMap スタンプ値。
   * @returns {object}
   */
  #doorStampValue() {
    return {
      kind: 'door',
      door: true,
      owner: network.uuid || 'me',
      permitted: [
        ...new Set([...this.basePermitted, ...useBaseStore().permittedIds]),
      ],
    };
  }

  /**
   * 座標が拠点内部（床）にあるか。セーフエリア判定（絶対座標）。
   * @param {number} absX
   * @param {number} absY
   * @returns {boolean}
   */
  #insideBase(absX, absY) {
    const b = this.baseBounds;
    const tx = Math.floor(absX / TILE);
    const ty = Math.floor(absY / TILE);
    return tx > b.x0 && tx < b.x1 && ty > b.y0 && ty < b.y1;
  }

  /**
   * 座標が自拠点のドアタイルか（絶対座標・本人なら通過可）。
   * @param {number} absX
   * @param {number} absY
   * @returns {boolean}
   */
  #isDoorTile(absX, absY) {
    const tx = Math.floor(absX / TILE);
    const ty = Math.floor(absY / TILE);
    return tx === this.doorTile.tx && ty === this.doorTile.ty;
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
          if (this.baseBlocks.has(tileKey(tx, ty))) continue;
          const wx = tx * TILE + TILE / 2;
          const wy = ty * TILE + TILE / 2;
          if (this.#blockedAt(wx, wy)) continue;
          let near = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.baseBlocks.has(tileKey(tx + dx, ty + dy))) { near = true; break; }
          }
          if (!near) continue;
          if (!this.#placeBaseBlock(tx, ty, 'tex-block')) continue;
          this.voidCount -= BASE_EXPAND_COST;
          this.baseBounds = {
            x0: Math.min(b.x0, tx), y0: Math.min(b.y0, ty),
            x1: Math.max(b.x1, tx), y1: Math.max(b.y1, ty),
          };
          this.#stampDelta([
            { tx, ty, v: { kind: 'flat' } },
            { tx, ty, v: { kind: 'block', owner: network.uuid || 'me' } },
          ]);
          playSfx('pickup');
          this.#emitVitals();
          break outer;
        }
      }
    }
  }

  /**
   * ドア許可変更時にドアスタンプを再送信する。
   * @returns {void}
   */
  #restampDoor() {
    this.#stampDelta([
      { tx: this.doorTile.tx, ty: this.doorTile.ty, v: this.#doorStampValue() },
    ]);
  }

  /**
   * @returns {void}
   */
  #createVoidSystem() {
    this.voids = this.physics.add.staticGroup();
    this.#rebuildWorldLayout();
    this.physics.add.overlap(this.player, this.voids, (_p, node) => {
      this.#takeVoid(/** @type {Phaser.Physics.Arcade.Sprite} */ (node), true);
    });
  }

  /**
   * 安全な乱数スポーン座標（絶対座標）。障害物・汚染タイルを避ける。
   * @returns {{x: number, y: number}}
   */
  #safeSpawnCoord() {
    for (let i = 0; i < 60; i++) {
      const x = secureRandomCoord();
      const y = secureRandomCoord();
      const b = deltaMap.tileAt(x, y, WORLD_SEED);
      if (!b.obstacle && !b.toxic) return { x, y };
    }
    return { x: 0, y: 0 };
  }

  /**
   * 絶対座標が障害物なら近傍スパイラルで空きを探す。
   * @param {number} absX
   * @param {number} absY
   * @returns {{x: number, y: number}}
   */
  #findFreeAbs(absX, absY) {
    if (!this.#blockedAt(absX, absY)) return { x: absX, y: absY };
    for (let r = 1; r <= 10; r++) {
      for (let a = 0; a < 8; a++) {
        const x = absX + Math.round(Math.cos(a * Math.PI / 4) * r * TILE);
        const y = absY + Math.round(Math.sin(a * Math.PI / 4) * r * TILE);
        if (!this.#blockedAt(x, y)) return { x, y };
      }
    }
    return { x: absX, y: absY };
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
    const ax = this.#absX();
    const ay = this.#absY();
    let x = ax;
    let y = ay;
    for (let tries = 0; tries < 30; tries++) {
      x = ax + Phaser.Math.Between(-1024, 1024);
      y = ay + Phaser.Math.Between(-1024, 1024);
      const far = Phaser.Math.Distance.Between(x, y, ax, ay) >= 240;
      if (far && !this.#blockedAt(x, y) && !this.#insideBase(x, y)) break;
    }
    const c = new Creature(this, this.#lx(x), this.#ly(y));
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
        sprite = this.add.sprite(this.#lx(p.x), this.#ly(p.y), 'spr-peer');
        sprite.setScale(0.4);
        this.peerSprites.set(p.peerId, sprite);
      }
      // 絶対座標で届くのでローカルへ変換して目標として保持
      this.#pushTarget(this.peerTargets, p.peerId, this.#lx(p.x), this.#ly(p.y));
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
      this.#rebuildWorldLayout();
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
    this.onBasePermChanged = () => this.#restampDoor();
    this.onRouterPeers = (/** @type {{peers: Array<{uuid:string,peerId:string,x:number,y:number}>}} */ ev) => {
      // peerId→uuid 対応表を更新（拠点ドア許可はUUID単位）
      const store = usePeerStore();
      for (const p of ev.peers) store.mapPeerUuid(p.peerId, p.uuid);
      p2pSession.syncPeers(ev.peers.map((p) => p.peerId));
    };
    this.onRouterLease = (/** @type {import('@/types.js').RouterLease} */ ev) => {
      this.chunkLeases.set(chunkKey(ev.cx, ev.cy), {
        owner: ev.owner,
        at: this.time.now,
      });
    };
    this.onRouterEntities = (/** @type {import('@/types.js').RouterEntities} */ ev) => {
      const ck = chunkKey(ev.cx, ev.cy);
      if (ev.owner && ev.owner !== network.uuid) {
        this.chunkLeases.set(ck, { owner: ev.owner, at: this.time.now });
        this.#syncRemoteEntities(`${ev.cx},${ev.cy}`, ev.entities);
      }
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
    eventBus.on(E.BASE_PERM_CHANGED, this.onBasePermChanged);
    eventBus.on(E.ROUTER_PEERS, this.onRouterPeers);
    eventBus.on(E.ROUTER_LEASE, this.onRouterLease);
    eventBus.on(E.ROUTER_ENTITIES, this.onRouterEntities);

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
      eventBus.off(E.BASE_PERM_CHANGED, this.onBasePermChanged);
      eventBus.off(E.ROUTER_PEERS, this.onRouterPeers);
      eventBus.off(E.ROUTER_LEASE, this.onRouterLease);
      eventBus.off(E.ROUTER_ENTITIES, this.onRouterEntities);
      this.peerSprites.clear();
      this.creatures.forEach((c) => c.destroy());
      this.companion?.destroy();
    });
  }

  // ------------------------------------------------------------------
  // presence / チャンクリース / エンティティ同期
  // ------------------------------------------------------------------

  /**
   * router へ絶対座標を申告し、自チャンクのリースを要求する。
   * @returns {void}
   */
  #emitPresence() {
    network.sendPos(this.#absX(), this.#absY());
    network.acquireLease(
      Math.floor(this.#absX() / CHUNK_SIZE),
      Math.floor(this.#absY() / CHUNK_SIZE),
    );
  }

  /**
   * エンティティ同期。リース保持チャンクは位置を報告し、
   * 他者所有チャンクは取得してリモート描画する。
   * @returns {void}
   */
  #syncEntities() {
    const uuid = network.uuid || 'me';
    const ccx = Math.floor(this.#absX() / CHUNK_SIZE);
    const ccy = Math.floor(this.#absY() / CHUNK_SIZE);
    const hbChunks = /** @type {Array<[number, number]>} */ ([]);
    for (let cy = ccy - CHUNK_VIEW; cy <= ccy + CHUNK_VIEW; cy++) {
      for (let cx = ccx - CHUNK_VIEW; cx <= ccx + CHUNK_VIEW; cx++) {
        const ck = chunkKey(cx, cy);
        const lease = this.chunkLeases.get(ck);
        if (lease?.owner === uuid) {
          hbChunks.push([cx, cy]);
          network.reportEntities(`${cx},${cy}`, this.#entitiesInChunk(cx, cy));
        } else {
          network.fetchEntities(cx, cy);
        }
      }
    }
    network.leaseHeartbeat(hbChunks);
  }

  /**
   * チャンク内の自軍エンティティ報告ペイロードを組み立てる（絶対座標）。
   * @param {number} cx
   * @param {number} cy
   * @returns {Array<{id: string, type: string, x: number, y: number, meta?: object}>}
   */
  #entitiesInChunk(cx, cy) {
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    const inChunk = (/** @type {number} */ lx, /** @type {number} */ ly) => {
      const ax = this.origin.absX(lx);
      const ay = this.origin.absY(ly);
      return ax >= x0 && ax < x0 + CHUNK_SIZE && ay >= y0 && ay < y0 + CHUNK_SIZE;
    };
    const out = [];
    for (const [id, s] of this.npcStates) {
      if (!inChunk(s.sprite.x, s.sprite.y)) continue;
      out.push({
        id: `npc:${id}`,
        type: 'npc',
        x: Math.round(this.origin.absX(s.sprite.x)),
        y: Math.round(this.origin.absY(s.sprite.y)),
      });
    }
    this.creatures.forEach((c, i) => {
      if (!c.sprite.active || !inChunk(c.sprite.x, c.sprite.y)) return;
      out.push({
        id: `mob:${cx},${cy}:${i}`,
        type: 'creature',
        x: Math.round(this.origin.absX(c.sprite.x)),
        y: Math.round(this.origin.absY(c.sprite.y)),
      });
    });
    return out;
  }

  /**
   * 他クライアント所有チャンクのエンティティをスプライト描画する。
   * 受信座標は絶対 → ローカルへ変換して目標として保持。
   * @param {string} chunkKeyStr - "cx,cy"
   * @param {Array<{id: string, type: string, x: number, y: number, meta?: object}>} entities
   * @returns {void}
   */
  #syncRemoteEntities(chunkKeyStr, entities) {
    const seen = new Set();
    const TEX = /** @type {Record<string, string>} */ ({
      npc: 'spr-npc-nagi',
      creature: 'spr-creature',
    });
    for (const e of entities) {
      const key = `${chunkKeyStr}:${e.id}`;
      seen.add(key);
      let s = this.remoteEntities.get(key);
      if (!s) {
        s = this.add.sprite(this.#lx(e.x), this.#ly(e.y), TEX[e.type] ?? 'spr-peer');
        s.setScale(0.4);
        s.setAlpha(0.85);
        this.remoteEntities.set(key, s);
      }
      this.#pushTarget(this.remoteTargets, key, this.#lx(e.x), this.#ly(e.y));
    }
    // 消えたエンティティを破棄
    for (const [key, s] of this.remoteEntities) {
      if (key.startsWith(`${chunkKeyStr}:`) && !seen.has(key)) {
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
    const ck = chunkKey(cx, cy);
    const cached = this.chunkSeeds.get(ck);
    if (cached !== undefined) return cached;
    const local = (Math.imul(cx, 2654435761) ^ Math.imul(cy, 40503) ^ WORLD_SEED) | 0;
    this.chunkSeeds.set(ck, local);
    void (async () => {
      try {
        const r = await queryChunk(cx, cy);
        if (r.exists && r.owner !== network.uuid && r.seed !== undefined) {
          this.chunkSeeds.set(ck, r.seed);
          this.chunkLeases.set(ck, { owner: r.owner ?? '', at: this.time.now });
        } else {
          await registerChunk(cx, cy, local, network.uuid || 'anon');
        }
      } catch {
        // router 不在でもローカル決定論生成で動く
      }
    })();
    return local;
  }

  // ------------------------------------------------------------------
  // ワールドレイアウト（チャンクごと: ボイド・NPC・DeltaMap）
  // ------------------------------------------------------------------

  /**
   * プレイヤー周辺チャンク（±1）のレイアウトを再構築する。
   * ボイド再配置・決定論的NPCの出現/消滅・DeltaMap取得をまとめて行う。
   * @returns {void}
   */
  #rebuildWorldLayout() {
    if (!this.origin) return;
    this.voids.clear(true, true);
    const ccx = Math.floor(this.#absX() / CHUNK_SIZE);
    const ccy = Math.floor(this.#absY() / CHUNK_SIZE);
    const liveNpc = new Set();
    for (let cy = ccy - CHUNK_VIEW; cy <= ccy + CHUNK_VIEW; cy++) {
      for (let cx = ccx - CHUNK_VIEW; cx <= ccx + CHUNK_VIEW; cx++) {
        this.#loadChunkDelta(cx, cy);
        const seed = this.#resolveChunkSeed(cx, cy);
        this.#layoutVoids(cx, cy, seed);
        this.#layoutNpcs(cx, cy, liveNpc);
      }
    }
    // 視界外のNPCを消す
    for (const [id, st] of this.npcStates) {
      if (!liveNpc.has(id)) {
        st.sprite.destroy();
        this.npcLabels.get(id)?.destroy();
        this.npcLabels.delete(id);
        this.npcStates.delete(id);
      }
    }
  }

  /**
   * チャンクの DeltaMap を未取得なら router から読み込む。
   * @param {number} cx
   * @param {number} cy
   * @returns {void}
   */
  #loadChunkDelta(cx, cy) {
    if (deltaMap.hasChunk(cx, cy)) return;
    deltaMap.loadChunk(cx, cy, {}); // 二重取得防止のプレースホルダ
    void fetchDelta(cx, cy)
      .then((tiles) => {
        deltaMap.loadChunk(cx, cy, tiles);
        this.#spawnDeltaBlocks(cx, cy);
        this.#fillMap(this.mapTileX, this.mapTileY);
        this.mapTex?.refresh();
      })
      .catch(() => {
        // 失敗時はプレースホルダを消して次回リトライ可能にする
        deltaMap.chunks.delete(chunkKey(cx, cy));
      });
  }

  /**
   * DeltaMap の block/door スタンプをリモート拠点ブロックとして描画する。
   * 自拠点(owner===自分)はローカルの baseGroup が担当するので除外。
   * @param {number} cx
   * @param {number} cy
   * @returns {void}
   */
  #spawnDeltaBlocks(cx, cy) {
    const myUuid = network.uuid || 'me';
    for (const { tx, ty, v } of deltaMap.entriesOfChunk(cx, cy)) {
      const d = /** @type {any} */ (v);
      if (d.kind !== 'block' && d.kind !== 'door') continue;
      if (d.owner === myUuid) continue;
      const key = `db:${cx},${cy}:${tx},${ty}`;
      if (this.deltaBlocks.has(key)) {
        // 既存ブロックはメタだけ更新（許可変更の反映）
        this.deltaBlocks.get(key)?.setData('meta', {
          door: d.kind === 'door',
          permitted: d.permitted ?? [],
        });
        continue;
      }
      const s = /** @type {Phaser.Physics.Arcade.Sprite} */ (
        /** @type {any} */ (this.remoteBaseGroup).create(
          this.#lx(tx * TILE + TILE / 2),
          this.#ly(ty * TILE + TILE / 2),
          d.kind === 'door' ? 'tex-door' : 'tex-block',
        )
      );
      s.setData('meta', {
        door: d.kind === 'door',
        permitted: d.permitted ?? [],
      });
      s.refreshBody();
      this.deltaBlocks.set(key, s);
    }
  }

  /**
   * チャンク内ボイドを配置する。
   * @param {number} cx
   * @param {number} cy
   * @param {number} seed
   * @returns {void}
   */
  #layoutVoids(cx, cy, seed) {
    const pts = chunkPoints(cx, cy, seed, VOIDS_PER_CHUNK);
    pts.forEach((p, i) => {
      const key = voidKey(cx, cy, i);
      if (this.takenVoidKeys.has(key)) return;
      if (this.#blockedAt(p.x, p.y)) return;
      const node = this.voids.create(this.#lx(p.x), this.#ly(p.y), 'tex-void');
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

  /**
   * チャンクの決定論的NPCを出現させる（既出なら維持）。
   * @param {number} cx
   * @param {number} cy
   * @param {Set<string>} liveNpc - 生存IDの集合（呼び出し側で消去判定）
   * @returns {void}
   */
  #layoutNpcs(cx, cy, liveNpc) {
    const defs = npcsInChunk(cx, cy);
    const companion = useCompanionStore();
    defs.forEach((def, i) => {
      const id = `npc_${cx}_${cy}_${i}`;
      liveNpc.add(id);
      if (this.npcStates.has(id)) return;
      const hp = npcHomePos(cx, cy, i);
      const home = this.#findFreeAbs(hp.x, hp.y);
      const lx = this.#lx(home.x);
      const ly = this.#ly(home.y);
      const sprite = this.add.sprite(lx, ly, def.texture);
      sprite.setScale(0.4);
      sprite.setData('npc', { ...def, id });
      const label = this.add
        .text(lx, ly - 30, companion.isKnown(id) ? def.name : '？？？', {
          color: '#ffb7d5',
          fontSize: '12px',
        })
        .setOrigin(0.5);
      this.npcLabels.set(id, label);
      this.npcStates.set(id, {
        sprite,
        homeX: lx,
        homeY: ly,
        tx: lx,
        ty: ly,
        waitUntil: this.time.now + Phaser.Math.Between(800, 3000),
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
          node.enableBody(false, this.#lx(p.x), this.#ly(p.y), true, true);
        }
      });
    }
  }

  /**
   * 討伐ドロップ（ローカルのみ）。
   * @param {number} lx
   * @param {number} ly
   * @returns {void}
   */
  #dropVoid(lx, ly) {
    const node = this.voids.create(lx, ly, 'tex-void');
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
      p2pSession.sendAttack(this.#absX(), this.#absY(), ATTACK_RANGE);
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
   * @param {import('@/types.js').PeerAttack} e - 絶対座標で届く
   * @returns {void}
   */
  #onIncomingAttack(e) {
    if (this.time.now < this.deadUntil) return;
    const d = Phaser.Math.Distance.Between(
      e.x, e.y, this.#absX(), this.#absY(),
    );
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
    this.player.setPosition(this.#lx(this.spawnX), this.#ly(this.spawnY));
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
    // フィールド上の同名NPCがいればその隣、いなければプレイヤー脇に出す
    const st = this.npcStates.get(npcId);
    const x = st ? st.sprite.x + 24 : this.player.x + 40;
    const y = st ? st.sprite.y : this.player.y;
    const def = NPC_DEFS.find((n) => n.id === npcId);
    const texture = def?.texture
      ?? /** @type {any} */ (st?.sprite.getData('npc'))?.texture
      ?? 'spr-npc-yui';
    this.companion = new Companion(this, { id: npcId, name }, x, y, texture);
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
    for (const st of this.npcStates.values()) {
      const obj = st.sprite;
      if (!obj.active) continue;
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
    if (!this.origin) return;
    const dt = delta / 1000;
    this.#updateMovement();
    this.#applyRebase();
    this.#updatePollution(dt);
    this.#updatePrompt();
    this.#updateCreatures(time);
    this.#updateCompanion(time);
    this.#updateNpcs(time, dt);
    this.#updateInterpolation(dt);

    // 背景はタイル跨ぎごとに差分スクロール（常時世界座標と同期）
    this.#redrawMap();

    // チャンク移動でボイド/NPC/DeltaMapを更新
    const ccx = Math.floor(this.#absX() / CHUNK_SIZE);
    const ccy = Math.floor(this.#absY() / CHUNK_SIZE);
    if (ccx !== this.lastChunkX || ccy !== this.lastChunkY) {
      this.lastChunkX = ccx;
      this.lastChunkY = ccy;
      this.#rebuildWorldLayout();
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
        x: this.#absX(),
        y: this.#absY(),
      });
    }

    this.presenceTimer += delta;
    if (this.presenceTimer >= PRESENCE_EMIT_MS) {
      this.presenceTimer = 0;
      this.#emitPresence();
      this.#syncEntities();
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
    // 障害タイルへの侵入を予測して軸ごとブロック（絶対座標で判定）
    const step = (PLAYER_SPEED / 60) + 4;
    if (vx !== 0 && this.#blockedAt(this.#absX() + vx * step, this.#absY())) vx = 0;
    if (vy !== 0 && this.#blockedAt(this.#absX(), this.#absY() + vy * step)) vy = 0;
    this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
  }

  /**
   * ネットワークサンプルを補完状態へ反映する（ローカル座標で保持）。
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
    const a = 0.35;
    s.vx = s.vx * (1 - a) + ((x - s.tx) / dt) * a;
    s.vy = s.vy * (1 - a) + ((y - s.ty) / dt) * a;
    s.tx = x;
    s.ty = y;
    s.lastT = now;
  }

  /**
   * リモートスプライトを推定速度の定速移動で補完する。
   * @param {number} dt - 秒
   * @returns {void}
   */
  #updateInterpolation(dt) {
    const now = this.time.now;
    const moveTo = (/** @type {Phaser.GameObjects.Sprite} */ s, /** @type {{tx:number,ty:number,vx:number,vy:number,lastT:number}} */ t) => {
      const elapsed = Math.min((now - t.lastT) / 1000, 1.5);
      const ex = t.tx + t.vx * elapsed;
      const ey = t.ty + t.vy * elapsed;
      const dx = ex - s.x;
      const dy = ey - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 300) {
        s.setPosition(t.tx, t.ty);
        return;
      }
      if (dist < 0.4) return;
      const speed = Math.max(Math.hypot(t.vx, t.vy) * 1.15, 20);
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
      deltaMap.tileAt(this.#absX(), this.#absY(), WORLD_SEED).toxic &&
      !this.#insideBase(this.#absX(), this.#absY());
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
   * @param {number} dt - 秒
   * @returns {void}
   */
  #updateNpcs(time, dt) {
    const companion = useCompanionStore();
    for (const [npcId, st] of this.npcStates) {
      const trust = companion.trustOf(npcId);
      const s = st.sprite;
      if (!s.active) continue;
      if (time < st.waitUntil) continue;
      const dx = st.tx - s.x;
      const dy = st.ty - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6) {
        st.waitUntil = time + Phaser.Math.Between(1500, 5000);
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
      const label = this.npcLabels.get(npcId);
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
