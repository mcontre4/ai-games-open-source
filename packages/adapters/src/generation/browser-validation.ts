import type { GameVisualSnapshot } from '../../../application/src/ports.ts';
import { gameReviewPreview } from './visual-preview.ts';
import sharp from 'sharp';
import { chromium, errors as playwrightErrors } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameView } from '../../../domain/src/index.ts';
import { prepareLocalGameFiles } from '../local-game-files.ts';
import { strFromU8 } from 'fflate';
export async function validateGameInBrowser(
  input: Record<string, Uint8Array>,
  screenshotFile?: string,
  view: GameView = '2d',
): Promise<GameVisualSnapshot[]> {
  const errors: string[] = [];
  const visuals: GameVisualSnapshot[] = [];
  const files = prepareLocalGameFiles(input, view);
  const workspace = await mkdtemp(join(tmpdir(), 'ai-games-browser-'));
  const rootUrl = pathToFileURL(workspace + '/').href;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (const [path, bytes] of Object.entries(files)) {
      const file = join(workspace, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes, { mode: 0o600 });
    }
    browser = await chromium.launch({ headless: true });
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      const context = await browser.newContext({ viewport, offline: true });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' || /Texture key.*not found/.test(m.text()))
          errors.push(m.text().slice(0, 200));
      });
      await page.route('**/*', (route) => {
        const requestUrl = route.request().url();
        if (requestUrl.startsWith(rootUrl) || requestUrl.startsWith('data:image/'))
          return route.continue();
        errors.push('External network request.');
        return route.abort();
      });
      await page.addInitScript(
        `let state=null; window.ReactNativeWebView={postMessage:function(raw){const r=JSON.parse(raw);if(r.type==='saveState')state=r.state;const value=r.type==='loadState'?state:r.type==='getPlayer'?{name:'Test Player'}:r.type==='getGameInfo'?{id:'game_test',versionId:'ver_test',title:'Test'}:null;setTimeout(function(){window.__gameSDKReceive({protocol:1,id:r.id,ok:true,value:value})},0);}};`,
      );
      if (files['assets/sprites.png']) {
        // Observe actual Canvas texture draws: bundling or loading an unused sheet
        // must not allow a background-only primitive game to pass publication.
        const spriteSource = `data:image/png;base64,${Buffer.from(files['assets/sprites.png']).toString('base64')}`;
        await page.addInitScript(`window.__gameSpriteDraws = 0;
          const spriteImages = new WeakMap();
          const spriteSource = ${JSON.stringify(spriteSource)};
          const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
          CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
            if (image instanceof HTMLImageElement && !spriteImages.has(image))
              spriteImages.set(image, image.src === spriteSource || /\\/assets\\/sprites\\.png(?:$|\\?)/.test(image.src));
            if (spriteImages.get(image)
                && this.canvas.isConnected && this.globalAlpha > 0 && args.length >= 8
                && args[6] > 0 && args[7] > 0) window.__gameSpriteDraws++;
            return originalDrawImage.call(this, image, ...args);
          };`);
      }
      await page.goto(rootUrl + 'index.html', { waitUntil: 'networkidle' });
      await page.locator('canvas').waitFor();
      const orientation = viewport.width < viewport.height ? 'portrait' : 'landscape';
      const capture = async (phase: GameVisualSnapshot['phase']) => {
        visuals.push({
          orientation,
          phase,
          bytes: await gameReviewPreview(await page.screenshot()),
        });
      };
      await capture('menu');
      await page.locator('#play').click();
      await page.waitForTimeout(350);
      await capture('play');
      if (files['assets/sprites.png']) await page.evaluate('window.__gameSpriteDraws = 0');
      await page.mouse.move(viewport.width * 0.35, viewport.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(viewport.width * 0.65, viewport.height * 0.6, { steps: 12 });
      await page.mouse.up();
      // A smoke-test performance floor, not a promise about every physical device.
      // Sampling page frame cadence catches severe main-thread stalls in generated scenes.
      // Serialize plain browser JavaScript: tsx's keepNames transform otherwise
      // inserts a host-only __name helper around the nested frame callback.
      const frameTimes = await page.evaluate<number[]>(`new Promise((resolve) => {
        const times = [];
        let start = 0, previous = 0;
        function frame(time) {
          if (!start) start = time;
          if (previous) times.push(time - previous);
          previous = time;
          if (time - start >= 1800) resolve(times);
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      })`);
      const averageFrame = frameTimes.reduce((sum, ms) => sum + ms, 0) / frameTimes.length;
      const sortedFrames = [...frameTimes].sort((a, b) => a - b);
      const p95Frame = sortedFrames[Math.floor(sortedFrames.length * 0.95)] ?? Infinity;
      if (1000 / averageFrame < 45 || p95Frame > 50)
        errors.push(
          `Animation performance is below the validation floor (45 FPS average / 50ms p95): ${(1000 / averageFrame).toFixed(1)} FPS / ${p95Frame.toFixed(1)}ms p95. Reduce per-frame work and use smooth delta-based movement.`,
        );
      let score = Number(await page.locator('#score').textContent());
      if (score === 0) {
        for (const [x, y] of [
          [0.3, 0.55],
          [0.5, 0.55],
          [0.7, 0.55],
          [0.3, 0.7],
          [0.5, 0.7],
          [0.7, 0.7],
        ])
          await page.mouse.click(viewport.width * x!, viewport.height * y!);
        await page.waitForTimeout(1200);
        score = Number(await page.locator('#score').textContent());
      }
      if (!Number.isSafeInteger(score) || score < 0)
        errors.push('Score display must be a nonnegative integer.');
      if (files['assets/sprites.png'] && !(await page.evaluate<number>('window.__gameSpriteDraws')))
        errors.push(
          'The supplied sprites.png is not rendered during play. Load it as a 512x512 sprite sheet and use its illustrated frames for the main gameplay objects.',
        );
      // A universal random gesture cannot solve every puzzle or strategy game.
      // Positive-score gameplay remains a per-game acceptance check, while this
      // generic publication check validates the UI and bundled scoring contract.
      // Let a real gesture's travel/delivery animation finish before reviewing
      // progression. Never award points or mutate game state to manufacture it.
      if (score === 0) {
        try {
          await page.waitForFunction(
            () => Number(document.querySelector('#score')?.textContent) > 0,
            undefined,
            { timeout: 8000 },
          );
        } catch (error) {
          if (!(error instanceof playwrightErrors.TimeoutError)) throw error;
        }
      }
      // Scoring often precedes the stamp/window/reward fade. Review the settled
      // feedback, rather than its first frame; the game alone changes state.
      await page.waitForTimeout(1000);
      await capture('later-play');
      await page.locator('#pause').click();
      if (!(await page.locator('#paused').isVisible())) errors.push('Pause control failed.');
      await page.locator('#pause').click();
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      if (!box || box.width < 300 || box.height < 300)
        errors.push('Game does not fill the viewport.');
      const visual = await sharp(await canvas.screenshot()).stats();
      if (visual.channels.every((c) => c.stdev < 2))
        errors.push('Blank or visually incomplete rendering.');
      if (screenshotFile && viewport.width === 390) await page.screenshot({ path: screenshotFile });
      await context.close();
    }
    if (errors.length) throw new Error(errors.join('; '));
    if (!strFromU8(files['game.js'] ?? new Uint8Array()).includes('saveState'))
      throw new Error('SDK not bundled.');
    return visuals;
  } finally {
    await browser?.close();
    await rm(workspace, { recursive: true, force: true });
  }
}
