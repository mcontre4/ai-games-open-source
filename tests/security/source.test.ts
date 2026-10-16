import { describe, it, expect } from 'vitest';
import { analyzeGameSource } from '../../packages/adapters/src/generation/static-analysis.ts';
const base =
  "import Phaser from 'phaser';import {GameSDK} from './sdk';export class GameScene extends Phaser.Scene {create(){GameSDK.saveState({});GameSDK.submitScore(1);}}";
describe('generated source analysis', () => {
  it('allows approved Phaser and SDK source', () => analyzeGameSource(base));
  it.each(['3d', 'isometric'] as const)(
    'allows only the approved %s engine and trusted runtime',
    (view) => {
      const source = base.replace(
        "import Phaser from 'phaser';",
        "import * as THREE from 'three'; import type { ThreeGameContext } from './runtime';",
      );
      expect(() => analyzeGameSource(source, view)).not.toThrow();
      expect(() => analyzeGameSource(base, view)).toThrow('Unsupported import');
      expect(() => analyzeGameSource(source, '2d')).toThrow('Unsupported import');
      for (const suffix of [
        'fetch("https://evil.test")',
        "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
        'eval("bad")',
      ])
        expect(() => analyzeGameSource(source + suffix, view)).toThrow();
    },
  );
  it.each([
    'fetch("https://evil.test")',
    'eval("bad")',
    'new WebSocket("wss://evil.test")',
    'navigator.geolocation',
    'localStorage.getItem("secret")',
    'document.cookie',
    'import("./evil.js")',
    "import x from 'express';",
  ])('rejects unsupported code: %s', (source) =>
    expect(() => analyzeGameSource(base + source)).toThrow(),
  );
  it('rejects unchanged non-playable starter', () =>
    expect(() => analyzeGameSource('export class GameScene {}')).toThrow('contract'));
});
