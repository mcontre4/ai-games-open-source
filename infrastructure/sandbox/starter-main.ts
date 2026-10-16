import Phaser from 'phaser';
import metadata from '../public/game.json';
import { GameScene } from './Game';
import './sdk';
import './style.css';

const direction = metadata.artDirection;
const fonts = {
  rounded: 'ui-rounded, system-ui, sans-serif',
  serif: 'Georgia, serif',
  sans: 'system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
};
for (const [key, value] of Object.entries(direction.palette))
  document.documentElement.style.setProperty(`--${key}`, value);
document.documentElement.style.setProperty('--corner-radius', `${direction.cornerRadius}px`);
document.documentElement.style.setProperty(
  '--game-font',
  fonts[direction.typography as keyof typeof fonts],
);
document.title = metadata.title;
document.querySelector('h1')!.textContent = metadata.title;
document.querySelector('#game-title')!.textContent = metadata.title;
document.querySelector('#game-theme')!.textContent = direction.theme;
document.querySelector('#menu p')!.textContent = metadata.description;
new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game',
  backgroundColor: direction.palette.background,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  loader: { imageLoadType: 'HTMLImageElement', crossOrigin: null as unknown as string },
  render: {
    antialias: !direction.pixelArt,
    pixelArt: direction.pixelArt,
    roundPixels: direction.pixelArt,
  },
  fps: { target: 60, smoothStep: true },
  audio: { disableWebAudio: false },
  scene: [GameScene],
});
document.addEventListener('visibilitychange', () => {
  window.dispatchEvent(new CustomEvent(document.hidden ? 'hostPause' : 'hostResume'));
});
