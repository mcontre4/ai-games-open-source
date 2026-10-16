// Explicit deterministic gameplay fixture for runtime tests, never live generation.
import * as THREE from 'three';
import { GameSDK } from '../../packages/game-template/src/sdk';
import type { ThreeGameContext } from '../../infrastructure/sandbox/three-runtime';

const element = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!;
export class GameScene {
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private coinGeometry = new THREE.IcosahedronGeometry(0.3, 0);
  private groundMaterial = new THREE.MeshStandardMaterial({ color: '#356858', roughness: 0.9 });
  private playerMaterial = new THREE.MeshStandardMaterial({ color: '#fff2c9' });
  private coinMaterial = new THREE.MeshStandardMaterial({ color: '#ffd16d', metalness: 0.4 });
  private obstacleMaterial = new THREE.MeshStandardMaterial({ color: '#d87550' });
  private player = new THREE.Mesh(this.geometry, this.playerMaterial);
  private objects: { mesh: THREE.Mesh; obstacle: boolean; x: number; z: number }[] = [];
  private phase: 'ready' | 'playing' | 'paused' | 'over' = 'ready';
  private lane = 0;
  private score = 0;
  private best = 0;
  private savedAt = 0;
  private muted = false;
  private pointerX = 0;
  constructor(private context: ThreeGameContext) {}
  start() {
    const { scene, artwork, signal, renderer } = this.context;
    scene.background = artwork;
    scene.add(new THREE.HemisphereLight('#ffffff', '#254636', 2.5));
    const light = new THREE.DirectionalLight('#fff0cd', 3);
    light.position.set(4, 9, 6);
    scene.add(light);
    const ground = new THREE.Mesh(this.geometry, this.groundMaterial);
    ground.scale.set(8, 0.3, 65);
    ground.position.set(0, -0.4, -20);
    scene.add(ground);
    this.player.scale.set(0.6, 1.2, 0.6);
    this.player.position.set(0, 0.5, 2);
    scene.add(this.player);
    for (let i = 0; i < 12; i++) {
      const obstacle = i === 4 || i === 9;
      const mesh = new THREE.Mesh(
        obstacle ? this.geometry : this.coinGeometry,
        obstacle ? this.obstacleMaterial : this.coinMaterial,
      );
      const x = i === 0 || obstacle ? 0 : ((i % 3) - 1) * 2;
      const z = -4 - i * 4;
      mesh.position.set(x, 0.6, z);
      scene.add(mesh);
      this.objects.push({ mesh, obstacle, x, z });
    }
    element('instructions').textContent =
      'Explicit offline test fixture · Swipe left/right or use arrow keys. Collect gems; dodge terracotta blocks.';
    const play = element('play') as HTMLButtonElement;
    play.disabled = true;
    void GameSDK.loadState().then((state) => {
      if (
        state &&
        typeof state === 'object' &&
        !Array.isArray(state) &&
        typeof state.best === 'number'
      )
        this.best = state.best;
      element('best').textContent = String(this.best);
      play.disabled = false;
    });
    play.addEventListener('click', () => this.reset(), { signal });
    element('restart').addEventListener('click', () => this.reset(), { signal });
    element('pause').addEventListener(
      'click',
      () => {
        if (this.phase === 'playing') this.pause();
        else if (this.phase === 'paused') {
          this.phase = 'playing';
          element('paused').hidden = true;
          element('phase').textContent = 'PLAYING';
        }
      },
      { signal },
    );
    element('mute').addEventListener(
      'click',
      () => {
        this.muted = !this.muted;
        element('mute').textContent = this.muted ? '×' : '♪';
        element('mute').setAttribute('aria-pressed', String(this.muted));
      },
      { signal },
    );
    window.addEventListener('hostPause', () => this.pause(), { signal });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'ArrowLeft') this.lane = Math.max(-1, this.lane - 1);
        if (event.key === 'ArrowRight') this.lane = Math.min(1, this.lane + 1);
      },
      { signal },
    );
    renderer.domElement.addEventListener(
      'pointerdown',
      (event) => {
        this.pointerX = event.clientX;
      },
      { signal },
    );
    renderer.domElement.addEventListener(
      'pointerup',
      (event) => {
        const dx = event.clientX - this.pointerX;
        if (Math.abs(dx) > 20) this.lane = Math.max(-1, Math.min(1, this.lane + Math.sign(dx)));
      },
      { signal },
    );
  }
  private reset() {
    this.score = 0;
    this.savedAt = 0;
    this.lane = 0;
    this.player.position.x = 0;
    this.phase = 'playing';
    element('menu').hidden = true;
    element('over').hidden = true;
    element('paused').hidden = true;
    element('score').textContent = '0';
    element('phase').textContent = 'PLAYING';
    for (const object of this.objects) {
      object.mesh.position.set(object.x, 0.6, object.z);
      object.mesh.visible = true;
    }
  }
  private save() {
    this.best = Math.max(this.best, this.score);
    element('best').textContent = String(this.best);
    void GameSDK.saveState({ best: this.best });
  }
  private pause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    element('paused').hidden = false;
    element('phase').textContent = 'PAUSED';
    this.save();
  }
  update(delta: number) {
    if (this.phase !== 'playing') return;
    this.player.position.x = THREE.MathUtils.damp(this.player.position.x, this.lane * 2, 14, delta);
    this.savedAt += delta;
    for (const object of this.objects) {
      if (!object.mesh.visible) continue;
      object.mesh.position.z += delta * 5;
      if (!object.obstacle) object.mesh.rotation.y += delta * 2;
      if (
        Math.abs(object.mesh.position.z - 2) < 0.55 &&
        Math.abs(object.mesh.position.x - this.player.position.x) < 0.65
      ) {
        object.mesh.visible = false;
        if (object.obstacle) {
          this.phase = 'over';
          this.save();
          void GameSDK.submitScore(this.score);
          element('phase').textContent = 'OVER';
          element('over').hidden = false;
          element('result').textContent = `You collected ${this.score} gems.`;
          break;
        }
        this.score++;
        element('score').textContent = String(this.score);
      }
      if (object.mesh.position.z > 7) object.mesh.position.z -= 54;
    }
    if (this.savedAt > 2) {
      this.save();
      this.savedAt = 0;
    }
  }
  dispose() {
    this.geometry.dispose();
    this.coinGeometry.dispose();
    for (const material of [
      this.groundMaterial,
      this.playerMaterial,
      this.coinMaterial,
      this.obstacleMaterial,
    ])
      material.dispose();
    this.context.scene.clear();
  }
}
