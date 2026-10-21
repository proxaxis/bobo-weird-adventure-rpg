/**
 * @fileoverview Phaser ゲームインスタンスの生成。
 * Canvas レンダラは Phaser 4 で非推奨のため AUTO（=WebGL優先）を使用。
 */

import Phaser from 'phaser';

import { WorldScene } from '@/game/scenes/WorldScene.js';

/**
 * Phaser.Game を生成する。
 * @param {HTMLElement} parent - マウント先コンテナ
 * @returns {Phaser.Game}
 */
export function createGame(parent) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#07090c',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
      },
    },
    scene: [WorldScene],
  });
}
