/**
 * @fileoverview Howler.js による効果音・環境音の管理。
 * ブラウザの自動再生制約に配慮し、初回ユーザー操作でアンロックする。
 */

import { Howl } from 'howler';

/** @type {Record<string, Howl>} */
const sounds = {};
let initialized = false;
let ambientStarted = false;

/** 効果音の既定音量。 */
const SFX_VOLUME = 0.6;

/**
 * 音声リソースを初期化し、初回操作時に環境音を開始する。
 * main.js で一度だけ呼ぶ。
 * @returns {void}
 */
export function initAudio() {
  if (initialized) return;
  initialized = true;

  sounds.wind = new Howl({
    src: ['/audio/wind.wav'],
    loop: true,
    volume: 0.32,
  });
  sounds.pickup = new Howl({ src: ['/audio/pickup.wav'], volume: SFX_VOLUME });
  sounds.attack = new Howl({ src: ['/audio/attack.wav'], volume: SFX_VOLUME });
  sounds.hit = new Howl({ src: ['/audio/hit.wav'], volume: SFX_VOLUME });
  sounds.dialog = new Howl({ src: ['/audio/dialog.wav'], volume: 0.5 });
  sounds.death = new Howl({ src: ['/audio/death.wav'], volume: 0.6 });

  const unlock = () => {
    if (ambientStarted) return;
    ambientStarted = true;
    sounds.wind.play();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
}

/**
 * 効果音を再生する。
 * @param {string} name - pickup / attack / hit / dialog / death
 * @returns {void}
 */
export function playSfx(name) {
  sounds[name]?.play();
}
