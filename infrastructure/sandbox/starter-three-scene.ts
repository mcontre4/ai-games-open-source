import * as THREE from 'three';
import { GameSDK } from './sdk';
import type { ThreeGameContext } from './runtime';

// Deliberately incomplete generation starter. The agent must replace it;
// deterministic playable examples live under tests/fixtures, never in live generation.
export class GameScene {
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private material = new THREE.MeshStandardMaterial({ color: '#709682' });
  constructor(private context: ThreeGameContext) {}
  start() {
    this.context.scene.add(new THREE.HemisphereLight('#ffffff', '#4c6155', 2));
    this.context.scene.add(new THREE.Mesh(this.geometry, this.material));
    void GameSDK.getGameInfo();
  }
  update(_deltaSeconds: number) {}
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
