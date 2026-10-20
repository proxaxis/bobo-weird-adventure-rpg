/**
 * @fileoverview AI サーバ未接続時のモック応答ジェネレータ。
 * 仕様のストリーミング形式（t/e/u の JSON-Lines チャンク）を模倣する。
 * フィラー挿入・思考遅延・パラメータ差分の演出確認に使う。
 */

import { P_INDEX } from '@/constants/parameters.js';

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * メッセージ内容に応じたモックスクリプトを選ぶ。
 * @param {import('@/types.js').DialogRequest} request
 * @returns {import('@/types.js').StreamChunk[]}
 */
function pickScript(request) {
  const msg = request.message;
  const p = request.environment;

  const trustUp = [{ index: P_INDEX.TRUST_PLAYER, delta: 0.02 }];
  const trustDown = [
    { index: P_INDEX.TRUST_PLAYER, delta: -0.04 },
    { index: P_INDEX.TRUST_FEAR, delta: 0.05 },
    { index: P_INDEX.EMO_FEAR, delta: 0.06 },
  ];

  if (/奪|殺|敵|攻撃/.test(msg)) {
    return /** @type {import('@/types.js').StreamChunk[]} */ ([
      { t: '……えっと、', e: 'surprised', u: [{ index: P_INDEX.EMO_SURPRISE, delta: 0.1 }] },
      { t: 'そういうこと、言わないで。', e: 'sad', u: [] },
      { t: 'わたし、あなたを信じたいの。', e: 'sad', u: trustDown },
    ]);
  }
  if (/ありがと|助か|感謝/.test(msg)) {
    return /** @type {import('@/types.js').StreamChunk[]} */ ([
      { t: 'えへへ……、', e: 'happy', u: [{ index: P_INDEX.EMO_JOY, delta: 0.08 }] },
      { t: 'どういたしまして。', e: 'happy', u: trustUp },
      { t: 'あなたのためなら、頑張れるよ。', e: 'relaxed', u: trustUp },
    ]);
  }
  if (/ボイド|集め|行こ|一緒/.test(msg)) {
    const warn = p.pollutionLevel > 0.5;
    return /** @type {import('@/types.js').StreamChunk[]} */ ([
      { t: '……うん、', e: 'relaxed', u: [] },
      { t: 'わかった、一緒に行こう。', e: 'happy', u: trustUp },
      ...(warn
        ? [{ t: 'でも今、汚染がひどいから気をつけてね。', e: 'sad', u: [] }]
        : [{ t: '無理はしないでね。', e: 'relaxed', u: [] }]),
    ]);
  }
  return /** @type {import('@/types.js').StreamChunk[]} */ ([
    { t: '……あのね、', e: 'neutral', u: [] },
    { t: '外は危ないから、あまり離れないで。', e: 'relaxed', u: [] },
    { t: '一緒なら、きっと生き延びられるよ。', e: 'happy', u: trustUp },
  ]);
}

/**
 * モックのストリーミング応答。チャンクごとに小さな遅延を挟む。
 * @param {import('@/types.js').DialogRequest} request
 * @returns {AsyncGenerator<import('@/types.js').StreamChunk, void, unknown>}
 */
export async function* mockStreamDialog(request) {
  const script = pickScript(request);
  await sleep(500 + Math.random() * 600); // 思考中ディレイ
  for (const chunk of script) {
    yield chunk;
    await sleep(120 + Math.random() * 160);
  }
}
