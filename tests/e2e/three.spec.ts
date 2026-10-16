import { test, expect } from '@playwright/test';
import { HandleGameMessage } from '../../packages/application/src/bridge.ts';
import { verifyPackage, CSP } from '../../packages/game-sdk/src/package.ts';
import type { Json, Save } from '../../packages/domain/src/index.ts';
import { signing, game } from '../helpers.ts';
import { threeFixture } from '../three-fixture.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const view of ['3d', 'isometric'] as const) {
  test(`explicit ${view} fixture uses actual file URLs with networking disabled`, async ({
    browser,
  }) => {
    const { packager, publicKey } = signing();
    const { files } = await threeFixture(view);
    const packed = await packager.package({ ...game, view }, 'ver_three_fixture', files);
    const verified = verifyPackage(packed.bytes, publicKey);
    const root = resolve('work/three-file-fixtures', view);
    for (const [path, bytes] of Object.entries(verified.files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes);
    }
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(
      `window.ReactNativeWebView={postMessage:function(raw){const r=JSON.parse(raw);setTimeout(function(){window.__gameSDKReceive({protocol:1,id:r.id,ok:true,value:r.type==='loadState'?{best:7}:null})},0)}};`,
    );
    try {
      await page.goto(pathToFileURL(join(root, 'index.html')).href);
      await expect(page.locator('#play')).toBeEnabled();
      await expect(page.locator('#best')).toHaveText('7');
      await page.locator('#play').click();
      await expect
        .poll(async () => Number(await page.locator('#score').textContent()))
        .toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    test(`explicit ${view} fixture: signed offline WebGL gameplay and save/reload ${viewport.width}`, async ({
      browser,
    }) => {
      const { packager, publicKey } = signing();
      const { files } = await threeFixture(view);
      const packed = await packager.package({ ...game, view }, 'ver_three_fixture', files);
      const verified = verifyPackage(packed.bytes, publicKey);
      expect(verified.manifest).toMatchObject({ view, engineVersion: '0.180.0' });
      const context = await browser.newContext({ viewport, offline: true });
      const errors: string[] = [];
      let state: Json = null;
      const scores: number[] = [];
      const createBridge = () =>
        new HandleGameMessage(
          {
            load: async () => (state === null ? null : ({ state, schemaVersion: 1 } as Save)),
            save: async (_account, _manifest, value) => {
              state = value;
            },
            score: async (_account, _manifest, value) => {
              scores.push(value);
            },
          },
          {
            accountId: 'fixture-player',
            manifest: verified.manifest,
            playerName: 'Fixture Player',
          },
          Date.now,
        );
      const open = async () => {
        const page = await context.newPage();
        const bridge = createBridge();
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await page.exposeBinding('nativeHost', async (_source, raw: string) => {
          const response = await bridge.execute(raw);
          await page.evaluate(
            (value) =>
              (window as unknown as { __gameSDKReceive: (r: unknown) => void }).__gameSDKReceive(
                value,
              ),
            response,
          );
        });
        await page.addInitScript(
          'window.ReactNativeWebView={postMessage:function(raw){window.nativeHost(raw)}};',
        );
        await page.route('**/*', (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== 'https://three-fixture.invalid') {
            errors.push('External request');
            return route.abort();
          }
          const path = url.pathname.slice(1) || 'index.html';
          const body = verified.files[path];
          return body
            ? route.fulfill({
                body: Buffer.from(body),
                headers: { 'Content-Security-Policy': CSP },
                contentType: path.endsWith('.html')
                  ? 'text/html'
                  : path.endsWith('.js')
                    ? 'application/javascript'
                    : path.endsWith('.css')
                      ? 'text/css'
                      : 'image/png',
              })
            : route.abort();
        });
        await page.goto('https://three-fixture.invalid');
        await expect(page.locator('#play')).toBeEnabled();
        return page;
      };
      try {
        let page = await open();
        await expect(page.locator('#instructions')).toContainText('Explicit offline test fixture');
        expect(
          await page
            .locator('canvas')
            .evaluate((canvas) => !!(canvas as HTMLCanvasElement).getContext('webgl2')),
        ).toBe(true);
        await page.locator('#play').click();
        await expect
          .poll(async () => Number(await page.locator('#score').textContent()))
          .toBeGreaterThan(0);
        await page.locator('#pause').click();
        await expect(page.locator('#paused')).toBeVisible();
        const score = await page.locator('#score').textContent();
        await page.waitForTimeout(300);
        await expect(page.locator('#score')).toHaveText(score!);
        await expect.poll(() => state).toMatchObject({ best: Number(score) });
        await page.screenshot({ path: test.info().outputPath(`${view}-paused.png`) });
        await page.close();
        page = await open();
        await expect(page.locator('#best')).toHaveText(score!);
        await page.locator('#play').click();
        // Real coin collision, then central obstacle collision ends the run.
        await expect(page.locator('#over')).toBeVisible({ timeout: 10000 });
        await expect.poll(() => scores.length).toBe(1);
        expect(scores[0]).toBeGreaterThan(0);
        await page.locator('#restart').click();
        await expect(page.locator('#over')).toBeHidden();
        await page.locator('#mute').click();
        await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
        // Touch gestures control the lane; returning to the center collects the first gem.
        await page.mouse.move(viewport.width * 0.35, viewport.height * 0.7);
        await page.mouse.down();
        await page.mouse.move(viewport.width * 0.65, viewport.height * 0.7);
        await page.mouse.up();
        await page.keyboard.press('ArrowLeft');
        await expect
          .poll(async () => Number(await page.locator('#score').textContent()))
          .toBeGreaterThan(0);
        await page.evaluate('window.dispatchEvent(new Event("hostPause"))');
        await expect(page.locator('#paused')).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`${view}-gameplay.png`) });
        await page.locator('canvas').dispatchEvent('webglcontextlost', { cancelable: true });
        await expect(page.locator('#paused')).toContainText('Reopen the game to continue.');
        await expect(page.locator('#pause')).toBeDisabled();
        await expect(page.locator('canvas')).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
