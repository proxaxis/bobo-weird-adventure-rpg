/**
 * @fileoverview 永続的プレイヤー同一性。
 * 初回起動時に IndexedDB へ UUIDv4 を生成・保存し、
 * PeerJS 接続 / Router ハンドシェイクで送信する。
 * 再接続・リロード後も NPC 好感度・拠点ドア許可を維持する。
 */

const DB_NAME = 'bobo-identity';
const STORE = 'kv';
const UUID_KEY = 'uuid';

/** @type {Promise<string> | null} */
let cached = null;

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 * @returns {Promise<string | undefined>}
 */
function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * プレイヤー UUID を返す。未発行なら生成して IndexedDB に保存する。
 * IndexedDB が使えない環境ではセッション限りの UUID を返す。
 * @returns {Promise<string>}
 */
export function getPlayerUuid() {
  if (!cached) {
    cached = (async () => {
      try {
        const db = await openDb();
        const existing = await idbGet(db, UUID_KEY);
        if (existing) return existing;
        const uuid = crypto.randomUUID();
        await idbPut(db, UUID_KEY, uuid);
        return uuid;
      } catch (err) {
        console.warn('[identity] IndexedDB unavailable, session uuid only:', err);
        return crypto.randomUUID();
      }
    })();
  }
  return cached;
}
