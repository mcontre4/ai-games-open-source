import Phaser from 'phaser';
import { GameSDK } from './sdk';
// The coding agent replaces this scene. It deliberately cannot pass publication tests.
// The offline fixture is separate from the production generation starter.
export class GameScene extends Phaser.Scene {
  constructor() {
    super('GeneratedGame');
  }
  create() {
    this.add.text(20, 160, 'Create an original game here', { fontSize: '24px', color: '#444444' });
    void GameSDK.getGameInfo();
  }
}
