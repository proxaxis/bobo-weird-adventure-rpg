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
/** VRMモデルが実装する口形状名への解決キャッシュ（aa→'aa' or 'a' 等） */
const resolvedVowels = /** @type {Record<string, string | null>} */ ({});
/** @type {ResizeObserver | null} */
let resizeObserver = null;

/** 表情の現在値（プリセット名→0..1、リープで滑らかに遷移） */
const exprWeights = /** @type {Record<string, number>} */ ({});
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
defineExpose({ feedSpeech });

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
    resolveVowelNames(loaded.expressionManager);
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
  const height = Math.max(box.max.y - box.min.y, 0.5);
  const headY = box.max.y - height * 0.12;
  camera.position.set(0, headY + height * 0.04, height * 0.55);
  camera.lookAt(0, headY - height * 0.02, 0);
  if (lookTarget) lookTarget.position.set(0, headY, 1.2);
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
 * 思考中の目線逸らし・首かしげ。
 * @param {number} now - 秒
 * @returns {void}
 */
function updateThinkingPose(now) {
  const sway = Math.sin(now * 0.8);
  if (lookTarget && camera) {
    const baseZ = camera.position.z + 0.2;
    const x = props.thinking ? 0.35 + sway * 0.05 : sway * 0.02;
    lookTarget.position.x = x;
    lookTarget.position.z = baseZ;
  }
  const head = vrm?.humanoid?.getNormalizedBoneNode('head') ?? fallbackHead;
  if (head) {
    head.rotation.z = (props.thinking ? 0.1 : 0) + sway * 0.015;
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
  updateThinkingPose(now);
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
