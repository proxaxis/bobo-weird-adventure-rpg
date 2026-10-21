/**
 * @fileoverview VRM プロシージャル生体モーション。
 * - 呼吸連動: Chest 周期 ~3.5s、Spine が位相差 -0.4rad で微小追従
 * - 体幹ゆらぎ: 素数比サイン波(0.7/1.3/0.5Hz) による首・頭の無意識な微傾き
 * - サッカード視線: 0.3〜1.5s ごとに相手の顔領域へ注視点をランダム跳躍
 * - 非対称まばたき: 0.07s で急閉 → 0.11s で緩開（計 0.18s）
 * - 思考演出: setThinking(true) で視線を斜め下へ落とし首を傾げ瞬きを発火
 * GC 対策として update 内でオブジェクトを新規生成しない。
 */

/** 呼吸周期（秒）。 */
const BREATH_PERIOD = 3.5;
const BREATH_W = (Math.PI * 2) / BREATH_PERIOD;
/** Spine が Chest に対して遅れる位相(rad)。 */
const SPINE_BREATH_PHASE = -0.4;
/** まばたき: 閉じる 0.07s + 開く 0.11s = 0.18s。 */
const BLINK_CLOSE = 0.07;
const BLINK_OPEN = 0.11;
const BLINK_TOTAL = BLINK_CLOSE + BLINK_OPEN;

export class ProceduralMotion {
  constructor() {
    /** 思考中（LLM応答待ち）か。 */
    this.thinking = false;
    /** サッカード視線の現在注視点（lookTarget ローカル基準のオフセット）。 */
    this.saccadeX = 0;
    this.saccadeY = 0;
    /** 視線の実表示位置（注視点へ緩やかに追従）。 */
    this.gazeX = 0;
    this.gazeY = 0;
    this.nextSaccadeAt = 0;
    this.blinkPhase = -1;
    this.blinkAt = 0;
  }

  /**
   * 思考演出の切替。開始時に瞬きをトリガーする。
   * @param {boolean} v
   * @returns {void}
   */
  setThinking(v) {
    if (v && !this.thinking) {
      // 思考開始で瞬き（人間的な「考え込み」の合図）
      this.blinkPhase = 0;
    }
    this.thinking = v;
  }

  /**
   * まばたき値を評価する。非対称カーブ（急閉→緩開）。
   * @param {number} now - 秒
   * @param {number} dt - 秒
   * @returns {number} 0..1
   */
  updateBlink(now, dt) {
    if (this.blinkPhase < 0 && now >= this.blinkAt) {
      this.blinkPhase = 0;
    }
    if (this.blinkPhase < 0) return 0;
    this.blinkPhase += dt;
    const t = this.blinkPhase;
    if (t >= BLINK_TOTAL) {
      this.blinkPhase = -1;
      this.blinkAt = now + 2 + Math.random() * 3.5;
      return 0;
    }
    if (t < BLINK_CLOSE) {
      // 急激に閉じる（イーズイン）
      const u = t / BLINK_CLOSE;
      return u * u;
    }
    // 緩やかに開く（イーズアウト）
    const u = (t - BLINK_CLOSE) / BLINK_OPEN;
    return (1 - u) * (1 - u * 0.4);
  }

  /**
   * サッカード視線: 相手の顔領域（目元〜口元）へ注視点をランダム跳躍。
   * 0.3〜1.5s 間隔。実位置は緩やかに追従する。
   * @param {number} now
   * @param {number} dt
   * @param {number} driftX - 大域的な漂い量（mood由来）
   * @returns {void}
   */
  updateGaze(now, dt, driftX) {
    if (now >= this.nextSaccadeAt) {
      this.nextSaccadeAt = now + 0.3 + Math.random() * 1.2;
      // 顔の範囲（両目・口元）内で跳躍
      this.saccadeX = (Math.random() - 0.5) * 0.14;
      this.saccadeY = (Math.random() - 0.4) * 0.1;
    }
    const k = Math.min(1, dt * 12);
    this.gazeX += (this.saccadeX + driftX - this.gazeX) * k;
    this.gazeY += (this.saccadeY - this.gazeY) * k;
  }

  /**
   * アイドル姿勢 + パラメータ駆動の警戒/開放 + ジェスチャ加算を
   * 正規化ボーンへ適用する。
   * @param {number} now - 秒
   * @param {{
   *   idleBones: Array<{name: string, bone: {rotation: any, position: any}, base: any, baseY: number}>,
   *   mood: {trust?: number, fear?: number, joy?: number, aggression?: number},
   *   gesture: {curves: Record<string, Record<string, (t:number)=>number>>} | null,
   *   gestureT: number,
   *   fallbackAvatar: {position: any, rotation: any} | null,
   *   fallbackHead: {rotation: any} | null,
   * }} ctx
   * @returns {void}
   */
  updateMotion(now, ctx) {
    const m = ctx.mood;
    const guard = Math.min(1, Math.max(0, (m.fear ?? 0) * 0.7 + (1 - (m.trust ?? 0.3)) * 0.5));
    const open = Math.min(1, Math.max(0, ((m.trust ?? 0.3) - 0.55) * 1.8)) * (1 - guard);
    const amp = (1 - guard * 0.55) * (1 + open * 0.4);
    const aggr = Math.min(1, Math.max(0, m.aggression ?? 0));

    // 呼吸: Chest 基準波と、位相 -0.4rad で遅れる Spine 追従波
    const breathChest = Math.sin(now * BREATH_W) * amp;
    const breathSpine = Math.sin(now * BREATH_W + SPINE_BREATH_PHASE) * amp;
    const sway = Math.sin(now * 0.55) * amp;
    // 体幹ゆらぎ: 素数比サイン波の合成（周期性を感じさせない微傾き）
    const driftX =
      Math.sin(now * 0.7 * Math.PI * 2) * 0.012 +
      Math.sin(now * 1.3 * Math.PI * 2) * 0.006 +
      Math.sin(now * 0.5 * Math.PI * 2) * 0.009;
    const driftZ =
      Math.sin(now * 1.1 * Math.PI * 2 + 1.7) * 0.008 +
      Math.sin(now * 0.6 * Math.PI * 2 + 0.4) * 0.01;

    const g = ctx.gesture;
    const gt = ctx.gestureT;

    for (const b of ctx.idleBones) {
      const r = b.bone.rotation;
      r.x = b.base.x;
      r.y = b.base.y;
      r.z = b.base.z;
      if (b.name === 'hips') {
        b.bone.position.y = b.baseY + breathChest * 0.004;
        r.z += sway * 0.012;
      } else if (b.name === 'spine') {
        // Spine は Chest 呼吸に -0.4rad の位相差で微小追従
        r.x += 0.015 + breathSpine * 0.01 - guard * 0.045 + open * 0.04 + aggr * 0.02;
      } else if (b.name === 'chest') {
        r.x += breathChest * 0.008 - guard * 0.03;
        r.y += sway * 0.04 + guard * 0.12;
      } else if (b.name === 'head') {
        r.y += Math.sin(now * 0.45) * 0.03 * amp + guard * 0.14;
        r.x += guard * 0.06;
        r.z += (this.thinking ? 0.1 : 0) + driftZ * amp + open * 0.08;
        // 体幹ゆらぎの素数比サインを首・頭の微傾きへ
        r.x += driftX * amp;
      } else if (b.name === 'leftUpperArm') {
        r.z += guard * 0.08 + Math.sin(now * 0.5) * 0.02 * amp;
      } else if (b.name === 'rightUpperArm') {
        r.z -= guard * 0.08 + Math.sin(now * 0.5 + 0.6) * 0.02 * amp;
      }
      if (g && gt < 1) {
        const c = g.curves[b.name];
        if (c) {
          r.x += c.x?.(gt) ?? 0;
          r.y += c.y !== undefined && b.name !== 'hips' ? c.y(gt) : 0;
          r.z += c.z?.(gt) ?? 0;
          if (b.name === 'hips' && c.y !== undefined) {
            b.bone.position.y += c.y(gt);
          }
        }
      }
    }

    if (ctx.fallbackAvatar) {
      ctx.fallbackAvatar.position.y = breathChest * 0.012;
      ctx.fallbackAvatar.rotation.y = Math.sin(now * 0.3) * 0.05;
      if (g && gt < 1 && ctx.fallbackHead) {
        const hc = g.curves.head ?? {};
        ctx.fallbackAvatar.position.y += g.curves.hips?.y?.(gt) ?? 0;
        ctx.fallbackAvatar.rotation.x += (g.curves.spine?.x?.(gt) ?? 0) * 0.6;
        ctx.fallbackHead.rotation.x += hc.x?.(gt) ?? 0;
        ctx.fallbackHead.rotation.y += hc.y?.(gt) ?? 0;
        ctx.fallbackHead.rotation.z += hc.z?.(gt) ?? 0;
      }
    }
  }
}
