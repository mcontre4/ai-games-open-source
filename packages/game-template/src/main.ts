import Phaser from 'phaser';
import { GameScene } from './Game';
import './sdk';
import './style.css';
new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game',
  backgroundColor: '#070b19',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, // Phaser assigns this value to HTMLImageElement.crossOrigin; null removes CORS mode for scoped file images.
  loader: { imageLoadType: 'HTMLImageElement', crossOrigin: null as unknown as string },
  render: { antialias: true, powerPreference: 'low-power' },
  audio: { disableWebAudio: false },
  scene: [GameScene],
});
document.addEventListener('visibilitychange', () => {
  window.dispatchEvent(new CustomEvent(document.hidden ? 'hostPause' : 'hostResume'));
});
