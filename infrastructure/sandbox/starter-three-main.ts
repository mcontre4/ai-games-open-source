import metadata from '../public/game.json';
import { GameScene } from './Game';
import { mountThreeGame } from './runtime';
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
void mountThreeGame(
  GameScene,
  metadata.view === 'isometric' ? 'isometric' : '3d',
  direction.palette.background,
);
