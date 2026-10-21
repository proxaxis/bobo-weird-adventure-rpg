/**
 * @fileoverview NetworkWorker のメインスレッド側ファサード。
 * - router WS（presence/lease/push）とエンティティ REST を Worker へ委譲
 * - Worker イベントは GAME_EVENTS として eventBus に流す
 * - 接続不能時は単独プレイとして静かに継続する
 */

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { getPlayerUuid } from '@/core/Identity.js';

const BASE = import.meta.env?.VITE_ROUTER_URL ?? '/rtr';

class NetworkLink {
  constructor() {
    /** @type {Worker | null} */
    this.worker = null;
    /** @type {string} */
    this.uuid = '';
    /** @type {string} */
    this.peerId = '';
    /** @type {boolean} */
    this.wsOpen = false;
    this._reqSeq = 0;
    /** @type {Map<number, {cx:number, cy:number}>} */
    this._pending = new Map();
    /** @type {Promise<void> | null} */
    this._ready = null;
  }

  /**
   * Worker を起動し router WS へ接続する。複数回呼んでも1度だけ初期化。
   * @param {string} [peerId]
   * @returns {Promise<void>}
   */
  init(peerId = '') {
    if (!this._ready) {
      this._ready = (async () => {
        this.uuid = await getPlayerUuid();
        this.peerId = peerId;
        this.worker = new Worker(
          new URL('../workers/NetworkWorker.js', import.meta.url),
          { type: 'module' },
        );
        this.worker.onmessage = (e) => this.#onMessage(e.data);
        this.worker.onerror = (e) => console.warn('[network] worker error', e);
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        this.worker.postMessage({
          cmd: 'init',
          uuid: this.uuid,
          peerId: this.peerId,
          wsUrl: `${proto}://${location.host}${BASE}/ws`,
          httpBase: BASE,
        });
      })();
    } else if (peerId && peerId !== this.peerId) {
      this.peerId = peerId;
      this.worker?.postMessage({ cmd: 'peer-id', peerId });
    }
    return this._ready;
  }

  /**
   * PeerJS ID が後から確定した際に呼ぶ。
   * @param {string} peerId
   * @returns {void}
   */
  setPeerId(peerId) {
    this.peerId = peerId;
    this.worker?.postMessage({ cmd: 'peer-id', peerId });
  }

  /**
   * 絶対座標を router へ申告する（応答は ROUTER_PEERS イベント）。
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  sendPos(x, y) {
    this.worker?.postMessage({ cmd: 'pos', x, y });
  }

  /**
   * 自チャンクのリースを要求する（応答は ROUTER_LEASE イベント）。
   * @param {number} cx
   * @param {number} cy
   * @returns {void}
   */
  acquireLease(cx, cy) {
    this.worker?.postMessage({ cmd: 'lease', cx, cy });
  }

  /**
   * 保持中リースの TTL を延長する。
   * @param {Array<[number, number]>} chunks
   * @returns {void}
   */
  leaseHeartbeat(chunks) {
    if (chunks.length === 0) return;
    this.worker?.postMessage({ cmd: 'lease-hb', chunks });
  }

  /**
   * 所有チャンクのエンティティを報告する。
   * @param {string} chunk - "cx,cy"
   * @param {Array<object>} entities
   * @returns {void}
   */
  reportEntities(chunk, entities) {
    this.worker?.postMessage({
      cmd: 'report-entities',
      chunk,
      owner: this.uuid,
      entities,
    });
  }

  /**
   * チャンク内エンティティを取得する（結果は ROUTER_ENTITIES イベント）。
   * @param {number} cx
   * @param {number} cy
   * @returns {void}
   */
  fetchEntities(cx, cy) {
    const reqId = ++this._reqSeq;
    this._pending.set(reqId, { cx, cy });
    this.worker?.postMessage({ cmd: 'fetch-entities', reqId, cx, cy });
  }

  /**
   * @param {any} msg
   * @returns {void}
   */
  #onMessage(msg) {
    switch (msg.ev) {
      case 'ws-state':
        this.wsOpen = msg.state === 'open';
        break;
      case 'peers':
        eventBus.emit(GAME_EVENTS.ROUTER_PEERS, { peers: msg.peers });
        break;
      case 'lease':
        eventBus.emit(GAME_EVENTS.ROUTER_LEASE, {
          cx: msg.cx,
          cy: msg.cy,
          owner: msg.owner,
          granted: msg.granted,
        });
        break;
      case 'entities': {
        const p = this._pending.get(msg.reqId);
        this._pending.delete(msg.reqId);
        eventBus.emit(GAME_EVENTS.ROUTER_ENTITIES, {
          cx: p?.cx ?? msg.cx,
          cy: p?.cy ?? msg.cy,
          owner: msg.owner,
          entities: msg.entities,
        });
        break;
      }
      case 'push':
        eventBus.emit(GAME_EVENTS.ROUTER_PUSH, { payload: msg.payload });
        break;
      default:
        break;
    }
  }
}

export const network = new NetworkLink();
