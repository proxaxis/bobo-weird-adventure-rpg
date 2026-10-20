<script setup>
/**
 * @fileoverview VRM アバター表示コンポーネント。
 * - GLTFLoader + VRMLoaderPlugin で .vrm を読み込み、上半身をフレーミング
 * - 表情プリセット・瞬き・テキスト駆動リップシンク・思考中の目線逸らし
 * - モデル未配置/読込失敗時はフォールバックアバター（プリミティブ組立）を表示
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMUtils, VRMLoaderPlugin } from '@pixiv/three-vrm';

import { charToVowel, VOWEL_ALIASES } from '@/dialog/lipSync.js';
import { GESTURES } from '@/dialog/motions.js';
import {
  EXPRESSION_PRESETS,
  resolveExpressionName,
} from '@/dialog/vrmExpressions.js';

const props = defineProps({
  /** .vrm ファイルのURL（未配置でもフォールバックで動作） */
  modelUrl: { type: String, default: '' },
  /** 表情プリセット */
  expression: { type: String, default: 'neutral' },
  /** 応答待ち中（視線逸らし・首かしげ演出） */
  thinking: { type: Boolean, default: false },
  /**
   * 内面パラメータ由来の気分。姿勢・揺れ・視線を変調する。
   * { trust:0..1, fear:0..1, joy:0..1, aggression:0..1 }
   */
  mood: {
    type: Object,
    default: () => ({ trust: 0.3, fear: 0.2, joy: 0.3, aggression: 0.3 }),
  },
});

const emit = defineEmits(['ready', 'fallback', 'error']);

const container = ref(null);
const loadFailed = ref(false);

/** @type {THREE.WebGLRenderer | null} */
let renderer = null;
/** @type {THREE.Scene | null} */
let scene = null;
/** @type {THREE.PerspectiveCamera | null} */
let camera = null;
/** @type {import('@pixiv/three-vrm').VRM | null} */
let vrm = null;
/** @type {THREE.Group | null} */
let fallbackAvatar = null;
/** @type {THREE.Mesh | null} */
let fallbackMouth = null;
/** @type {THREE.Object3D | null} */
let fallbackHead = null;
/** @type {THREE.Object3D | null} */
let lookTarget = null;

let rafId = 0;
let lastTime = 0;
let blinkAt = 0;
let blinkPhase = -1;
/** 視線ターゲットの基準高さ（モデルの目線レベル） */
let lookBaseY = 1.4;
/** アイドルモーション用: 基準姿勢を保持するボーン一覧 */
const idleBones = /** @type {Array<{name: string, bone: THREE.Object3D, base: THREE.Euler, baseY: number}>} */ ([]);
/** VRMモデルが実装する口形状名への解決キャッシュ（aa→'aa' or 'a' 等） */
const resolvedVowels = /** @type {Record<string, string | null>} */ ({});
/** @type {ResizeObserver | null} */
let resizeObserver = null;

/** 表情の現在値（プリセット名→0..1、リープで滑らかに遷移） */
const exprWeights = /** @type {Record<string, number>} */ ({});
/** 再生中のジェスチャ（name + 開始時刻sec） */
let activeGesture = /** @type {{name: string, start: number} | null} */ (null);
/** ストリーミング文字の消費キュー */
const speechQueue = /** @type {string[]} */ ([]);
let speechAccum = 0;
let mouthTarget = /** @type {string | null} */ (null);
const mouthValue = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

const VOWEL_KEYS = ['aa', 'ih', 'ou', 'ee', 'oh'];
const CHARS_PER_SECOND = 14;
const BLINK_DURATION = 0.14;

/**
 * ストリーミング文字をリップシンクキューへ追加する。
 * @param {string} text
 * @returns {void}
 */
function feedSpeech(text) {
  for (const ch of text) speechQueue.push(ch);
}

/**
 * 会話内容に応じた身振りを再生する。
 * @param {string} name - motions.js のプリセット名
 * @returns {void}
 */
function triggerMotion(name) {
  if (!GESTURES[/** @type {keyof typeof GESTURES} */ (name)]) return;
  activeGesture = { name, start: performance.now() / 1000 };
}
defineExpose({ feedSpeech, triggerMotion });

/**
 * @returns {void}
 */
function initThree() {
  const el = container.value;
  if (!el) return;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  el.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.35, 1.1);
  camera.lookAt(0, 1.3, 0);

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x30241f, 1.2);
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(1, 1.6, 1.2);
  scene.add(hemi, dir);

  lookTarget = new THREE.Object3D();
  lookTarget.position.set(0, 1.35, 1.1);
  scene.add(lookTarget);

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(el);
  resize();

  for (const p of EXPRESSION_PRESETS) exprWeights[p] = 0;
  exprWeights.neutral = 1;
  blinkAt = performance.now() / 1000 + 2;
}

/**
 * @returns {void}
 */
function resize() {
  const el = container.value;
  if (!el || !renderer || !camera) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/**
 * VRM を読み込む。失敗時はフォールバックアバターを表示。
 * @param {string} url
 * @returns {Promise<void>}
 */
async function loadModel(url) {
  disposeAvatar();
  if (!scene || !url) {
    buildFallbackAvatar();
    return;
  }
  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const loaded = /** @type {import('@pixiv/three-vrm').VRM} */ (gltf.userData.vrm);
    VRMUtils.rotateVRM0(loaded);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    scene.add(loaded.scene);
    if (loaded.lookAt && lookTarget) {
      loaded.lookAt.target = lookTarget;
    }
    vrm = loaded;
    applyRestPose(loaded);
    resolveVowelNames(loaded.expressionManager);
    captureIdleBones(loaded);
    frameCameraTo(loaded.scene);
    emit('ready');
  } catch (err) {
    console.warn('[VrmCanvas] VRM load failed, using fallback avatar:', err);
    loadFailed.value = true;
    buildFallbackAvatar();
    emit('fallback');
  }
}

/**
 * モデルのバウンディングボックスから上半身が収まるようカメラを配置する。
 * @param {THREE.Object3D} object
 * @returns {void}
 */
function frameCameraTo(object) {
  if (!camera) return;
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, 0.5);
  // 全身（+頭上マージン8%）を縦方向に収める距離をfovから計算
  const fitHeight = height * 1.08;
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const dist = Math.max(
    (fitHeight * 0.5) / Math.tan(fovRad / 2),
    height * 0.5,
  );
  const focusY = center.y;
  camera.position.set(center.x, focusY, center.z + dist);
  camera.lookAt(center.x, focusY, center.z);
  lookBaseY = box.max.y - height * 0.1;
  if (lookTarget) {
    lookTarget.position.set(center.x, lookBaseY, center.z + dist);
  }
}

/**
 * アイドルモーション対象ボーンの基準姿勢を記録する。
 * @param {import('@pixiv/three-vrm').VRM} v
 * @returns {void}
 */
/**
 * Tポーズを自然な立ち姿へ（腕を下げる）。基準姿勢記録の前に適用する。
 * @param {import('@pixiv/three-vrm').VRM} v
 * @returns {void}
 */
function applyRestPose(v) {
  /** @param {string} n @param {'x'|'y'|'z'} a @param {number} val */
  const set = (n, a, val) => {
    const b = v.humanoid?.getNormalizedBoneNode(n);
    if (b) b.rotation[a] = val;
  };
  // 上腕を体側へ下ろす（±Z、正規化ボーンならモデル非依存）
  set('leftUpperArm', 'z', 1.15);
  set('rightUpperArm', 'z', -1.15);
  // 肘をごく少しだけ前へ曲げる（自然な脱力感）
  set('leftLowerArm', 'x', 0.08);
  set('rightLowerArm', 'x', 0.08);
}

function captureIdleBones(v) {
  idleBones.length = 0;
  const names = /** @type {const} */ ([
    'hips',
    'spine',
    'chest',
    'head',
    'leftUpperArm',
    'rightUpperArm',
  ]);
  for (const name of names) {
    const bone = v.humanoid?.getNormalizedBoneNode(name);
    if (bone) {
      idleBones.push({
        name,
        bone,
        base: bone.rotation.clone(),
        baseY: bone.position.y,
      });
    }
  }
}

/**
 * モデルが持つ口形状表情名を VOWEL_KEYS ぶん解決してキャッシュする。
 * @param {import('@pixiv/three-vrm').VRMExpressionManager | undefined} manager
 * @returns {void}
 */
function resolveVowelNames(manager) {
  const available = new Set(
    manager ? Object.keys(manager.expressionMap ?? {}) : [],
  );
  for (const key of VOWEL_KEYS) {
    resolvedVowels[key] =
      (VOWEL_ALIASES[key] ?? []).find((n) => available.has(n)) ?? null;
  }
}

/**
 * プリミティブ組立のフォールバックアバターを生成する。
 * @returns {void}
 */
function buildFallbackAvatar() {
  if (!scene) return;
  const group = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xf3d6c9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x3a2f3d });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x4d6b8a });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 6, 16), cloth);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 24), skin);
  head.position.y = 1.5;
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.185, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hair,
  );
  hairCap.position.y = 0.02;
  head.add(hairCap);

  const eyeGeo = new THREE.SphereGeometry(0.018, 8, 8);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x241d28 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.06, 0.01, 0.15);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.06;
  head.add(eyeL, eyeR);

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.008, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x8a4a52 }),
  );
  mouth.position.set(0, -0.06, 0.155);
  head.add(mouth);

  group.add(body, head);
  scene.add(group);
  fallbackAvatar = group;
  fallbackMouth = mouth;
  fallbackHead = head;
  vrm = null;

  if (camera) {
    camera.position.set(0, 1.42, 1.0);
    camera.lookAt(0, 1.38, 0);
  }
  if (lookTarget) lookTarget.position.set(0, 1.45, 1.0);
}

/**
 * アバターを破棄する。
 * @returns {void}
 */
function disposeAvatar() {
  if (!scene) return;
  if (vrm) {
    scene.remove(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
    vrm = null;
  }
  if (fallbackAvatar) {
    scene.remove(fallbackAvatar);
    fallbackAvatar = null;
    fallbackMouth = null;
    fallbackHead = null;
  }
  idleBones.length = 0;
}

/**
 * 表情ウェイトを目標へリープし、VRM/フォールバックへ適用する。
 * @param {number} dt
 * @returns {void}
 */
function updateExpressions(dt) {
  const speed = 6;
  for (const p of EXPRESSION_PRESETS) {
    const target = p === props.expression ? 1 : 0;
    const cur = exprWeights[p] ?? 0;
    exprWeights[p] = cur + (target - cur) * Math.min(1, speed * dt);
  }

  const mgr = vrm?.expressionManager;
  if (mgr) {
    for (const p of EXPRESSION_PRESETS) {
      const name = resolveExpressionName(mgr, p);
      if (name) mgr.setValue(name, exprWeights[p] ?? 0);
    }
  } else if (fallbackMouth && fallbackHead) {
    const joy = exprWeights.happy ?? 0;
    const sad = exprWeights.sad ?? 0;
    fallbackHead.rotation.z = joy * 0.06 - sad * 0.04;
    (/** @type {THREE.MeshStandardMaterial} */ (fallbackMouth.material)).color.set(
      joy > 0.4 ? 0xc46a7a : sad > 0.4 ? 0x6a4a5a : 0x8a4a52,
    );
  }
}

/**
 * 瞬きを適用する。
 * @param {number} now - 秒
 * @param {number} dt - 秒
 * @returns {void}
 */
function updateBlink(now, dt) {
  if (blinkPhase < 0 && now >= blinkAt) {
    blinkPhase = 0;
  }
  let blink = 0;
  if (blinkPhase >= 0) {
    blinkPhase += dt;
    const t = blinkPhase / BLINK_DURATION;
    if (t >= 1) {
      blinkPhase = -1;
      blinkAt = now + 2 + Math.random() * 3.5;
    } else {
      blink = t < 0.5 ? t * 2 : (1 - t) * 2;
    }
  }
  vrm?.expressionManager?.setValue('blink', blink);
}

/**
 * リップシンクキューを消費して口形状を更新する。
 * @param {number} dt
 * @returns {void}
 */
function updateMouth(dt) {
  speechAccum += dt * CHARS_PER_SECOND;
  if (speechAccum >= 1) {
    speechAccum = 0;
    const ch = speechQueue.shift();
    mouthTarget = ch ? charToVowel(ch) : null;
  }
  if (speechQueue.length === 0 && speechAccum === 0) mouthTarget = null;

  const mgr = vrm?.expressionManager;
  for (const k of VOWEL_KEYS) {
    const key = /** @type {'aa'|'ih'|'ou'|'ee'|'oh'} */ (k);
    const target = mouthTarget === key ? 0.9 : 0;
    mouthValue[key] += (target - mouthValue[key]) * Math.min(1, 18 * dt);
    const v = mouthValue[key];
    const resolved = resolvedVowels[key];
    if (mgr && resolved) mgr.setValue(resolved, v);
    if (key === 'aa' && fallbackMouth) {
      fallbackMouth.scale.y = 1 + v * 6;
      fallbackMouth.scale.x = 1 + v * 0.5;
    }
  }
}

/**
 * 自然なアイドルモーション＋思考中の目線逸らし・首かしげ。
 * - 呼吸: hips の微少な上下・spine/chest の前傾揺れ
 * - 揺れ: chest/head の緩やかな周期的ロール・ヨー
 * - 視線: 常時ゆるく漂い、思考中は横へ逸らす
 * @param {number} now - 秒
 * @returns {void}
 */
function updateMotion(now) {
  const m = props.mood;
  // 警戒度: 恐怖と不信（低信頼）で高まる
  const guard = Math.min(1, Math.max(0, (m.fear ?? 0) * 0.7 + (1 - (m.trust ?? 0.3)) * 0.5));
  // 開放度: 高信頼・低恐怖で上がる（警戒と相殺）
  const open = Math.min(1, Math.max(0, ((m.trust ?? 0.3) - 0.55) * 1.8)) * (1 - guard);
  // 揺れ振幅: 警戒で硬直、心を開くと大きく
  const amp = (1 - guard * 0.55) * (1 + open * 0.4);
  const aggr = Math.min(1, Math.max(0, m.aggression ?? 0));

  const breath = Math.sin(now * 2.0) * amp; // 呼吸 ~0.32Hz
  const drift = Math.sin(now * 0.37); // 視線のゆるい漂い
  const sway = Math.sin(now * 0.55) * amp; // 体の揺れ

  // 視線ターゲット: 警戒時は目を逸らす
  if (lookTarget && camera) {
    lookTarget.position.x =
      (props.thinking ? 0.35 : 0) + drift * 0.08 + guard * 0.3;
    lookTarget.position.y = lookBaseY + Math.sin(now * 0.6) * 0.03 - guard * 0.1;
    lookTarget.position.z = camera.position.z + 0.2;
  }

  // 会話ジェスチャの評価（アイドル揺れへ加算）
  const g = activeGesture
    ? GESTURES[/** @type {keyof typeof GESTURES} */ (activeGesture.name)]
    : null;
  const gt = g ? (now - /** @type {{start: number}} */ (activeGesture).start) / g.duration : 1;
  if (gt >= 1) activeGesture = null;

  // VRM ボーンへアイドル姿勢を適用（基準姿勢 + 微振動 + ジェスチャ）
  for (const b of idleBones) {
    const r = b.bone.rotation;
    r.x = b.base.x;
    r.y = b.base.y;
    r.z = b.base.z;
    if (b.name === 'hips') {
      b.bone.position.y = b.baseY + breath * 0.004;
      r.z += sway * 0.012;
    } else if (b.name === 'spine') {
      // 警戒→僅かに後傾、心を開く→前傾、攻撃的→わずかに前のめり
      r.x += 0.015 + breath * 0.01 - guard * 0.045 + open * 0.04 + aggr * 0.02;
    } else if (b.name === 'chest') {
      r.x += breath * 0.008 - guard * 0.03;
      // 警戒時は体を少し逸らす（半身になる）
      r.y += sway * 0.04 + guard * 0.12;
    } else if (b.name === 'head') {
      r.y += Math.sin(now * 0.45) * 0.03 * amp + guard * 0.14;
      r.x += guard * 0.06; // やや俯き加減
      r.z += (props.thinking ? 0.1 : 0) + Math.sin(now * 0.7) * 0.012 * amp + open * 0.08;
    } else if (b.name === 'leftUpperArm') {
      // 警戒時は腕を体へ引き寄せる
      r.z += guard * 0.08 + Math.sin(now * 0.5) * 0.02 * amp;
    } else if (b.name === 'rightUpperArm') {
      r.z -= guard * 0.08 + Math.sin(now * 0.5 + 0.6) * 0.02 * amp;
    }
    // ジェスチャ差分（hips.y は位置、他は回転へ加算）
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

  // フォールバックアバターはグループごと揺らす（ジェスチャも近似適用）
  if (fallbackAvatar) {
    fallbackAvatar.position.y = breath * 0.012;
    fallbackAvatar.rotation.y = Math.sin(now * 0.3) * 0.05;
    if (g && gt < 1) {
      const hc = g.curves.head ?? {};
      fallbackAvatar.position.y += g.curves.hips?.y?.(gt) ?? 0;
      fallbackAvatar.rotation.x += (g.curves.spine?.x?.(gt) ?? 0) * 0.6;
      if (fallbackHead) {
        fallbackHead.rotation.x += hc.x?.(gt) ?? 0;
        fallbackHead.rotation.y += hc.y?.(gt) ?? 0;
        fallbackHead.rotation.z += hc.z?.(gt) ?? 0;
      }
    }
  }
}

/**
 * @param {number} timeMs
 * @returns {void}
 */
function animate(timeMs) {
  rafId = requestAnimationFrame(animate);
  const now = timeMs / 1000;
  const dt = Math.min(now - lastTime || 0.016, 0.1);
  lastTime = now;
  if (!renderer || !scene || !camera) return;

  updateExpressions(dt);
  updateBlink(now, dt);
  updateMouth(dt);
  updateMotion(now);
  vrm?.update(dt);

  renderer.render(scene, camera);
}

watch(
  () => props.modelUrl,
  (url) => {
    loadFailed.value = false;
    void loadModel(url);
  },
);

onMounted(() => {
  initThree();
  void loadModel(props.modelUrl);
  rafId = requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  resizeObserver?.disconnect();
  disposeAvatar();
  renderer?.dispose();
  renderer?.domElement.remove();
  renderer = null;
  scene = null;
  camera = null;
});
</script>

<template>
  <div ref="container" class="vrm-canvas">
    <div v-if="loadFailed" class="fallback-note">
      VRMモデル未配置（フォールバック表示）
    </div>
  </div>
</template>

<style scoped>
.vrm-canvas {
  position: relative;
  width: 100%;
  height: 100%;
}

.vrm-canvas :deep(canvas) {
  display: block;
}

.fallback-note {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 11px;
  color: #8a9bad;
  background: rgba(0, 0, 0, 0.5);
  padding: 3px 8px;
  border-radius: 4px;
}
</style>
