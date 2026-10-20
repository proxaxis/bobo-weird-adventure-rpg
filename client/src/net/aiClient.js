/**
 * @fileoverview AI サーバとの対話ストリームクライアント。
 * - VITE_AI_BASE_URL 設定時: POST /dialog/stream に fetch し JSON-Lines を逐次パース
 * - 未設定時: モックストリームで代行（バックエンド Phase 4 完了までの開発用）
 */

import { mockStreamDialog } from '@/net/mockAiStream.js';

const BASE_URL = import.meta.env.VITE_AI_BASE_URL ?? '';

/**
 * 対話リクエストを送り、StreamChunk を逐次 yield する非同期ジェネレータ。
 * @param {import('@/types.js').DialogRequest} request
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {AsyncGenerator<import('@/types.js').StreamChunk, void, unknown>}
 */
export async function* streamDialogChunks(request, options = {}) {
  if (!BASE_URL) {
    yield* mockStreamDialog(request);
    return;
  }

  const res = await fetch(`${BASE_URL}/dialog/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: options.signal ?? null,
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI server responded ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      yield /** @type {import('@/types.js').StreamChunk} */ (JSON.parse(line));
    }
  }

  const tail = buffer.trim();
  if (tail) {
    yield /** @type {import('@/types.js').StreamChunk} */ (JSON.parse(tail));
  }
}
