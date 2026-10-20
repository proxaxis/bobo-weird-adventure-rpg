/**
 * @fileoverview PeerJS による P2P 位置同期（Phase 5）。
 *
 * 設計メモ:
 * - PeerJS の DataConnection は信頼型(ordered)のみ対応するため、
 *   仕様の「Unreliable チャネル」は直接サポート不可。
 *   代替として送信を ~80ms に間引き、受信側は単調増加 seq で
 *   古いパケットを捨てることで同等の効果を近似する。
 *   真の unreliable 化が必要になったら RTCPeerConnection 直実装に差し替える。
 * - シグナリングは PeerJS クラウド(0.peerjs.com)が既定。
 *   自前ブローカーは VITE_PEERJS_HOST/PORT で切替可能。
 */

import Peer from 'peerjs';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { usePeerStore } from '@/stores/peerStore.js';

const SEND_INTERVAL_MS = 80;

/**
 * ピア間でやり取りするメッセージ。
 * - pos:       位置同期（間引き+単調seq）
 * - void-take: ボイド採取通知（index=レイアウト上のノード番号）
 * - attack:    攻撃範囲通知（x,y,r）
 * - stolen:    略奪ボイド返報（被弾側→攻撃側）
 * @typedef {{type: 'pos', seq: number, x: number, y: number}
 *         | {type: 'void-take', index: number}
 *         | {type: 'attack', x: number, y: number, r: number}
 *         | {type: 'stolen', amount: number}} PeerMessage
 */

class P2PSession {
  constructor() {
    /** @type {Peer | null} */
    this.peer = null;
    /** @type {Map<string, import('peerjs').DataConnection>} */
    this.conns = new Map();
    /** @type {Map<string, number>} ピアごとの最新受信 seq */
    this.seenSeq = new Map();
    this.seq = 0;
    this.lastSentAt = 0;
    /** @type {{x: number, y: number} | null} */
    this.pendingPos = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.sendTimer = null;
    /** @type {string} 自分の PeerId（open 確定後に入る） */
    this.peerId = '';
  }

  /**
   * PeerJS の設定を環境変数から組み立てる。
   * @returns {import('peerjs').PeerOptions | undefined}
   */
  static #peerOptions() {
    const host = import.meta.env.VITE_PEERJS_HOST;
    if (!host) return undefined; // PeerJS クラウドを使用
    return {
      host,
      port: Number(import.meta.env.VITE_PEERJS_PORT ?? 443),
      secure: import.meta.env.VITE_PEERJS_SECURE === 'true',
    };
  }

  /**
   * Peer を起動する。id 省略時はブローカー採番（ホスト側）。
   * @param {string} [remoteId] - 指定時はそのピアへ接続する
   * @returns {void}
   */
  start(remoteId) {
    const store = usePeerStore();
    this.destroy();
    const opts = P2PSession.#peerOptions();
    this.peer = opts ? new Peer(opts) : new Peer();

    this.peer.on('open', (id) => {
      this.peerId = id;
      store.myId = id;
      store.status = 'open';
      if (remoteId) this.connect(remoteId);
    });
    this.peer.on('connection', (conn) => this.#bind(conn));
    this.peer.on('error', (err) => {
      store.status = 'error';
      store.error = String(err?.type ?? err);
      console.error('[p2p]', err);
    });
    this.peer.on('disconnected', () => {
      if (this.peer && !this.peer.destroyed) this.peer.reconnect();
    });

    this.sendTimer = setInterval(() => this.#flushPosition(), SEND_INTERVAL_MS);
  }

  /**
   * Peer を未起動なら起動し、peerId を返す（router presence 用）。
   * @returns {Promise<string>}
   */
  ensurePeer() {
    if (this.peer && this.peerId) return Promise.resolve(this.peerId);
    return new Promise((resolve) => {
      if (!this.peer) this.start();
      /** @type {Peer} */ (this.peer).once('open', (id) => resolve(id));
    });
  }

  /**
   * 指定ピアへ接続する。
   * @param {string} remoteId
   * @returns {void}
   */
  connect(remoteId) {
    if (!this.peer || this.conns.has(remoteId) || remoteId === this.peerId) return;
    this.#bind(this.peer.connect(remoteId));
  }

  /**
   * router が返した近接ピア集合と接続状態を同期する。
   * 未知のピアへ接続し、範囲外になった接続を切断する。
   * @param {string[]} ids
   * @returns {void}
   */
  syncPeers(ids) {
    const desired = new Set(ids);
    for (const id of ids) this.connect(id);
    for (const [pid, conn] of this.conns) {
      if (!desired.has(pid)) conn.close();
    }
  }

  /**
   * @param {import('peerjs').DataConnection} conn
   * @returns {void}
   */
  #bind(conn) {
    const store = usePeerStore();
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      store.addPeer(conn.peer);
      eventBus.emit(GAME_EVENTS.PEER_STATUS, {
        peerId: conn.peer,
        state: 'connected',
      });
    });
    conn.on('data', (data) => this.#onData(conn.peer, data));
    conn.on('close', () => this.#drop(conn.peer));
    conn.on('error', () => this.#drop(conn.peer));
  }

  /**
   * @param {string} peerId
   * @param {unknown} data
   * @returns {void}
   */
  #onData(peerId, data) {
    const msg = /** @type {PeerMessage} */ (data);
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'pos': {
        const last = this.seenSeq.get(peerId) ?? -1;
        if (msg.seq <= last) return; // 古いパケットは捨てる
        this.seenSeq.set(peerId, msg.seq);
        eventBus.emit(GAME_EVENTS.PEER_POSITION, {
          peerId,
          x: msg.x,
          y: msg.y,
        });
        break;
      }
      case 'void-take':
        eventBus.emit(GAME_EVENTS.PEER_VOID_TAKE, { peerId, index: msg.index });
        break;
      case 'attack':
        eventBus.emit(GAME_EVENTS.PEER_ATTACK, {
          peerId,
          x: msg.x,
          y: msg.y,
          r: msg.r,
        });
        break;
      case 'stolen':
        eventBus.emit(GAME_EVENTS.PEER_STOLEN, { peerId, amount: msg.amount });
        break;
      default:
        break;
    }
  }

  /**
   * 全接続ピアへメッセージを送る。
   * @param {PeerMessage} msg
   * @returns {void}
   */
  #broadcast(msg) {
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(msg);
    }
  }

  /**
   * ボイド採取を全ピアへ通知する。
   * @param {number} index - レイアウト上のノード番号
   * @returns {void}
   */
  sendVoidTake(index) {
    this.#broadcast({ type: 'void-take', index });
  }

  /**
   * 攻撃範囲を全ピアへ通知する。
   * @param {number} x
   * @param {number} y
   * @param {number} r
   * @returns {void}
   */
  sendAttack(x, y, r) {
    this.#broadcast({ type: 'attack', x, y, r });
  }

  /**
   * 略奪されたボイド数を攻撃者へ返す。
   * @param {string} peerId - 攻撃してきた相手
   * @param {number} amount
   * @returns {void}
   */
  sendStolen(peerId, amount) {
    const conn = this.conns.get(peerId);
    if (conn?.open) conn.send({ type: 'stolen', amount });
  }

  /**
   * @param {string} peerId
   * @returns {void}
   */
  #drop(peerId) {
    if (!this.conns.delete(peerId)) return;
    usePeerStore().removePeer(peerId);
    eventBus.emit(GAME_EVENTS.PEER_STATUS, { peerId, state: 'left' });
  }

  /**
   * 自プレイヤー位置を記録する（実送信はタイマーで間引き）。
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  queuePosition(x, y) {
    this.pendingPos = { x, y };
  }

  /**
   * @returns {void}
   */
  #flushPosition() {
    if (!this.pendingPos || this.conns.size === 0) return;
    const msg = /** @type {PeerMessage} */ ({
      type: 'pos',
      seq: ++this.seq,
      x: this.pendingPos.x,
      y: this.pendingPos.y,
    });
    this.#broadcast(msg);
  }

  /**
   * @returns {void}
   */
  destroy() {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    this.seenSeq.clear();
    this.peer?.destroy();
    this.peer = null;
    this.pendingPos = null;
  }
}

/** アプリ共有の P2P セッション。 */
export const p2pSession = new P2PSession();

// フィールドが発行する位置イベントをそのまま送信キューに流す
eventBus.on(GAME_EVENTS.PLAYER_POSITION, ({ x, y }) => {
  p2pSession.queuePosition(x, y);
});
