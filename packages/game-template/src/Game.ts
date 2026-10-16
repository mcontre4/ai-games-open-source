import Phaser from 'phaser';
import { GameSDK } from './sdk';
type Entity = { image: Phaser.GameObjects.Image; kind: 'obstacle' | 'crystal' };
export class GameScene extends Phaser.Scene {
  private ship!: Phaser.GameObjects.Image;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;
  private layers: Phaser.GameObjects.TileSprite[] = [];
  private entities: Entity[] = [];
  private playing = false;
  private paused = false;
  private elapsed = 0;
  private points = 0;
  private best = 0;
  private crystals = 0;
  private targetY = 300;
  private spawnTimer = 0;
  private saveTimer = 0;
  private seed = 142;
  private audio?: AudioContext;
  private muted = false;
  private nodes: AudioNode[] = [];
  constructor() {
    super('NeonComet');
  }
  preload() {
    this.load.image('sky', 'assets/background.png');
    this.load.image('city', 'assets/city.png');
    this.load.image('near', 'assets/near.png');
    this.load.image('craft', 'assets/hovercraft.png');
    this.load.image('crystal', 'assets/crystal.png');
    this.load.image('obstacle', 'assets/obstacle.png');
  }
  create() {
    const { width: w, height: h } = this.scale;
    this.layers = [
      this.add.tileSprite(0, 0, w, h, 'sky').setOrigin(0).setDepth(0),
      this.add
        .tileSprite(0, h * 0.22, w, h * 0.78, 'city')
        .setOrigin(0)
        .setDepth(1),
      this.add
        .tileSprite(0, h * 0.65, w, h * 0.35, 'near')
        .setOrigin(0)
        .setDepth(2),
    ];
    this.layers[0]!.setTileScale(h / 720);
    this.layers[1]!.setTileScale((h * 0.78) / 720);
    this.layers[2]!.setTileScale((h * 0.35) / 360);
    this.ship = this.add
      .image(w * 0.24, h * 0.52, 'craft')
      .setDisplaySize(88, 46)
      .setDepth(6);
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0x9cffe6);
    g.fillCircle(4, 4, 4);
    g.generateTexture('spark', 8, 8);
    g.destroy();
    this.trail = this.add
      .particles(0, 0, 'spark', {
        speed: { min: 35, max: 90 },
        angle: { min: 160, max: 200 },
        lifespan: 500,
        frequency: 25,
        scale: { start: 0.7, end: 0 },
        alpha: { start: 0.9, end: 0 },
        blendMode: 'ADD',
        tint: [0x7affe0, 0x99d7ff],
      })
      .setDepth(5);
    this.targetY = h * 0.52;
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.targetY = Phaser.Math.Clamp(p.y, 130, this.scale.height - 75);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.targetY = Phaser.Math.Clamp(p.y, 130, this.scale.height - 75);
    });
    const start = () => this.startRun();
    document.getElementById('play')!.onclick = start;
    document.getElementById('restart')!.onclick = start;
    document.getElementById('pause')!.onclick = () => this.togglePause();
    document.getElementById('mute')!.onclick = () => {
      this.muted = !this.muted;
      document.getElementById('mute')!.textContent = this.muted ? '×' : '♪';
      void (this.muted ? this.audio?.suspend() : this.audio?.resume());
    };
    window.addEventListener('hostPause', () => {
      if (this.playing && !this.paused) this.togglePause();
      void this.persist();
    });
    window.addEventListener('hostMute', () => {
      this.muted = true;
      void this.audio?.suspend();
    });
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.layers[0]!.setSize(size.width, size.height);
      this.layers[1]!.setPosition(0, size.height * 0.22).setSize(size.width, size.height * 0.78);
      this.layers[2]!.setPosition(0, size.height * 0.65).setSize(size.width, size.height * 0.35);
      this.ship.x = size.width * 0.24;
      this.targetY = Phaser.Math.Clamp(this.targetY, 130, size.height - 75);
    });
    void GameSDK.loadState()
      .then((state) => {
        if (state && typeof state === 'object' && !Array.isArray(state)) {
          this.best = typeof state.best === 'number' ? state.best : 0;
          this.crystals = typeof state.crystals === 'number' ? state.crystals : 0;
          this.display();
        }
      })
      .catch(() => {});
    this.tweens.add({
      targets: this.ship,
      y: h * 0.52 + 12,
      angle: 2,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.display();
  }
  private random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private startRun() {
    this.tweens.killTweensOf(this.ship);
    for (const e of this.entities) e.image.destroy();
    this.entities = [];
    this.playing = true;
    this.paused = false;
    this.elapsed = 0;
    this.points = 0;
    this.spawnTimer = 0;
    this.seed = 142;
    this.ship.setAlpha(1).setAngle(0);
    this.ship.y = this.scale.height * 0.5;
    this.targetY = this.ship.y;
    document.getElementById('menu')!.hidden = true;
    document.getElementById('over')!.hidden = true;
    document.getElementById('paused')!.hidden = true;
    document.getElementById('phase')!.textContent = 'FLYING';
    this.music();
    this.tone(420, 0.08);
    this.display();
  }
  private togglePause() {
    if (!this.playing) return;
    this.paused = !this.paused;
    document.getElementById('paused')!.hidden = !this.paused;
    document.getElementById('phase')!.textContent = this.paused ? 'PAUSED' : 'FLYING';
    if (this.paused) void this.persist();
  }
  private tone(frequency: number, duration: number) {
    if (this.muted || !this.audio) return;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.06, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.audio.destination);
    osc.start();
    osc.stop(this.audio.currentTime + duration);
  }
  private music() {
    if (this.audio) return;
    try {
      this.audio = new AudioContext();
      const gain = this.audio.createGain();
      gain.gain.value = 0.018;
      gain.connect(this.audio.destination);
      for (const frequency of [110, 164.81, 220]) {
        const osc = this.audio.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        osc.connect(gain);
        osc.start();
        this.nodes.push(osc);
      }
      this.nodes.push(gain);
    } catch {
      /* Sound remains optional on devices that cannot create an audio context. */
    }
  }
  private display() {
    document.getElementById('score')!.textContent = String(Math.floor(this.points));
    document.getElementById('best')!.textContent = String(Math.floor(this.best));
  }
  private async persist() {
    this.best = Math.max(this.best, Math.floor(this.points));
    this.display();
    try {
      await GameSDK.saveState({ best: this.best, crystals: this.crystals, runs: 1 });
      await GameSDK.submitScore(this.best);
    } catch {
      /* The host reports persistence errors; gameplay continues locally. */
    }
  }
  private gameOver() {
    if (!this.playing) return;
    this.playing = false;
    this.cameras.main.shake(200, 0.009);
    this.cameras.main.flash(120, 114, 255, 218);
    this.tone(100, 0.3);
    this.ship.setAlpha(0.35);
    document.getElementById('phase')!.textContent = 'FINISHED';
    document.getElementById('result')!.textContent =
      `${Math.floor(this.points)} points · ${this.crystals} energy crystals`;
    document.getElementById('over')!.hidden = false;
    void this.persist();
  }
  update(_time: number, delta: number) {
    const dt = Math.min(delta, 40) / 1000;
    const speed = this.playing ? 150 + Math.min(250, this.elapsed * 4) : 35;
    if (!this.paused) {
      this.layers.forEach((layer, i) => {
        layer.tilePositionX += speed * dt * (0.07 + i * 0.24);
      });
    }
    this.trail.setPosition(this.ship.x - 37, this.ship.y + 6);
    this.trail.emitting = !this.paused;
    if (!this.playing || this.paused) return;
    this.elapsed += dt;
    this.points += dt * 12;
    this.saveTimer += dt;
    this.spawnTimer += dt;
    this.ship.y = Phaser.Math.Linear(this.ship.y, this.targetY, Math.min(1, dt * 9));
    this.ship.angle = Phaser.Math.Clamp((this.targetY - this.ship.y) * 0.12, -14, 14);
    if (this.spawnTimer > Math.max(0.6, 1.35 - this.elapsed * 0.005)) {
      this.spawnTimer = 0;
      const kind = this.random() > 0.4 ? 'crystal' : 'obstacle';
      const y = 150 + this.random() * (this.scale.height - 245);
      const image = this.add
        .image(this.scale.width + 60, y, kind)
        .setDisplaySize(kind === 'crystal' ? 32 : 62, kind === 'crystal' ? 48 : 100)
        .setDepth(4);
      this.entities.push({ image, kind });
      if (kind === 'crystal')
        this.tweens.add({
          targets: image,
          scaleX: image.scaleX * 0.8,
          alpha: 0.65,
          duration: 400,
          yoyo: true,
          repeat: -1,
        });
    }
    for (const entity of [...this.entities]) {
      entity.image.x -= speed * dt;
      if (entity.image.x < -80) {
        entity.image.destroy();
        this.entities = this.entities.filter((e) => e !== entity);
        continue;
      }
      if (
        Math.abs(entity.image.x - this.ship.x) < (entity.kind === 'crystal' ? 42 : 47) &&
        Math.abs(entity.image.y - this.ship.y) < (entity.kind === 'crystal' ? 34 : 57)
      ) {
        if (entity.kind === 'crystal') {
          this.points += 40;
          this.crystals++;
          this.tone(880, 0.12);
          this.trail.explode(12, this.ship.x, this.ship.y);
          entity.image.destroy();
          this.entities = this.entities.filter((e) => e !== entity);
        } else {
          this.gameOver();
          break;
        }
      }
    }
    if (this.saveTimer > 3) {
      this.saveTimer = 0;
      void this.persist();
    }
    this.display();
  }
}
