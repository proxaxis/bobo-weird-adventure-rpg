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
 * @typedef {Object} PeerMessage
 * @property {'pos'} type
 * @property {number} seq - 送信側単調増加シーケンス
 * @property {number} x
 * @property {number} y
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
   * 指定ピアへ接続する。
   * @param {string} remoteId
   * @returns {void}
   */
  connect(remoteId) {
    if (!this.peer || this.conns.has(remoteId)) return;
    this.#bind(this.peer.connect(remoteId));
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
    if (msg?.type !== 'pos') return;
    const last = this.seenSeq.get(peerId) ?? -1;
    if (msg.seq <= last) return; // 古いパケットは捨てる
    this.seenSeq.set(peerId, msg.seq);
    eventBus.emit(GAME_EVENTS.PEER_POSITION, {
      peerId,
      x: msg.x,
      y: msg.y,
    });
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
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(msg);
    }
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
