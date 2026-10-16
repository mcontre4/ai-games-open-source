import * as THREE from 'three';

export interface ThreeGameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  artwork: THREE.Texture;
  view: '3d' | 'isometric';
  signal: AbortSignal;
}
interface ThreeGame {
  start(): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

/** Trusted local-file runtime; no remote loaders or credentials. */
export async function mountThreeGame(
  GameScene: new (context: ThreeGameContext) => ThreeGame,
  view: '3d' | 'isometric',
  background: string,
): Promise<void> {
  const host = document.querySelector<HTMLElement>('#game')!;
  const lifecycle = new AbortController();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    document.querySelector('#instructions')!.textContent =
      'This device cannot start the 3D renderer. Try a device with WebGL 2 support.';
    (document.querySelector('#play') as HTMLButtonElement).disabled = true;
    throw new Error('3D games require WebGL 2 support.');
  }
  const gl = renderer.getContext();
  const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = rendererInfo
    ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL))
    : '';
  // CPU rasterizers need a smaller drawing buffer; CSS size and camera framing stay intact.
  const softwareGraphics = /swiftshader|llvmpipe|softpipe|software/i.test(rendererName);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, softwareGraphics ? 0.5 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const camera =
    view === 'isometric'
      ? new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 150)
      : new THREE.PerspectiveCamera(55, 1, 0.1, 150);
  camera.position.set(
    view === 'isometric' ? 12 : 0,
    view === 'isometric' ? 12 : 5,
    view === 'isometric' ? 12 : 10,
  );
  camera.lookAt(0, 0, 0);
  const resize = () => {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    const aspect = width / Math.max(height, 1);
    renderer.setSize(width, height);
    if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
    else {
      camera.left = -8 * aspect;
      camera.right = 8 * aspect;
      camera.top = 8;
      camera.bottom = -8;
    }
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize, { signal: lifecycle.signal });
  // The signer embeds an origin-clean data image for scoped native file URLs.
  // Unsigned build validation uses the same-origin local file on its HTTP harness.
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Missing bundled 3D artwork.'));
  });
  image.src =
    document.querySelector<HTMLImageElement>('#game-artwork')?.getAttribute('src') ??
    'assets/background.png';
  try {
    await loaded;
  } catch (error) {
    lifecycle.abort();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
  const artwork = new THREE.Texture(image);
  artwork.colorSpace = THREE.SRGBColorSpace;
  artwork.needsUpdate = true;
  const game = new GameScene({ scene, camera, renderer, artwork, view, signal: lifecycle.signal });
  let previous: number | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    lifecycle.abort();
    game.dispose();
    artwork.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  document.addEventListener(
    'visibilitychange',
    () => {
      previous = undefined;
      window.dispatchEvent(new CustomEvent(document.hidden ? 'hostPause' : 'hostResume'));
    },
    { signal: lifecycle.signal },
  );
  renderer.domElement.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('hostPause'));
      const paused = document.querySelector<HTMLElement>('#paused')!;
      paused.textContent = '3D graphics were interrupted. Reopen the game to continue.';
      paused.hidden = false;
      (document.querySelector('#pause') as HTMLButtonElement).disabled = true;
      dispose();
    },
    { signal: lifecycle.signal },
  );
  window.addEventListener('pagehide', dispose, { once: true, signal: lifecycle.signal });
  try {
    game.start();
    renderer.setAnimationLoop((time: number) => {
      const delta =
        previous === undefined ? 0 : Math.min(Math.max((time - previous) / 1000, 0), 0.05);
      previous = time;
      if (!document.hidden) game.update(delta);
      renderer.render(scene, camera);
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
