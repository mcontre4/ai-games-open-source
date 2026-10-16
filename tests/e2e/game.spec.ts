import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { verifyPackage } from '../../packages/game-sdk/src/package.ts';
import { HandleGameMessage } from '../../packages/application/src/bridge.ts';
import type { Save } from '../../packages/domain/src/index.ts';
const fixture = JSON.parse(await readFile('apps/mobile/assets/fixture.json', 'utf8'));
const verified = verifyPackage(
  new Uint8Array(await readFile('apps/mobile/assets/neon-comet.zip')),
  fixture.publicKey,
  { gameId: fixture.game.id, versionId: fixture.versionId, checksum: fixture.checksum },
);
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`signed offline game, SQLite save/reload, pause/restart ${viewport.width}`, async ({
    browser,
  }) => {
    const db = new DatabaseSync(':memory:');
    db.exec('create table saves(account text, game text, state text, primary key(account,game))');
    const context = await browser.newContext({ viewport, offline: true });
    const errors: string[] = [];
    let account = 'player-one';
    async function open() {
      const page = await context.newPage();
      const host = new HandleGameMessage(
        {
          load: async (a, g) => {
            const row = db
              .prepare('select state from saves where account=? and game=?')
              .get(a, g) as { state: string } | undefined;
            return row
              ? ({
                  gameId: g,
                  versionId: fixture.versionId,
                  schemaVersion: 1,
                  revision: 1,
                  state: JSON.parse(row.state),
                } as Save)
              : null;
          },
          save: async (a, m, state) => {
            db.prepare(
              'insert into saves values(?,?,?) on conflict(account,game) do update set state=excluded.state',
            ).run(a, m.gameId, JSON.stringify(state));
          },
          score: async () => {},
        },
        { accountId: account, manifest: verified.manifest, playerName: 'Offline Player' },
        Date.now,
      );
      page.on('pageerror', (e) => errors.push(e.message));
      await page.exposeBinding('nativeHost', async (_source, raw: string) => {
        const response = await host.execute(raw);
        await page.evaluate(
          (r) =>
            (window as unknown as { __gameSDKReceive: (v: unknown) => void }).__gameSDKReceive(r),
          response,
        );
      });
      await page.addInitScript(
        'window.ReactNativeWebView={postMessage:function(raw){window.nativeHost(raw)}};',
      );
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://package.invalid') throw new Error('External request attempted');
        const path = url.pathname.substring(1) || 'index.html';
        const data = verified.files[path];
        return data
          ? route.fulfill({
              body: Buffer.from(data),
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
      await page.goto('https://package.invalid/index.html');
      await page.locator('canvas').waitFor();
      return page;
    }
    try {
      let page = await open();
      await page.locator('#play').click();
      await expect
        .poll(async () => Number(await page.locator('#score').textContent()))
        .toBeGreaterThan(15);
      await page.locator('#pause').click();
      await expect(page.locator('#paused')).toBeVisible();
      await expect.poll(() => db.prepare('select count(*) n from saves').get()!.n).toBe(1);
      const best = Number(await page.locator('#best').textContent());
      expect(best).toBeGreaterThan(0);
      await page.close();
      page = await open();
      await expect(page.locator('#best')).toHaveText(String(best));
      await page.locator('#play').click();
      await page.locator('#restart').evaluate((e: HTMLElement) => e.click());
      await expect(page.locator('#score')).toHaveText('0');
      await page.close();
      account = 'player-two';
      page = await open();
      await expect(page.locator('#best')).toHaveText('0');
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      db.close();
    }
  });

test('package loads from actual file URLs with network offline', async ({ browser }) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const root = await mkdtemp(join(tmpdir(), 'aig-files-'));
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    for (const [path, bytes] of Object.entries(verified.files)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      `window.ReactNativeWebView={postMessage:function(raw){const r=JSON.parse(raw);setTimeout(()=>window.__gameSDKReceive({protocol:1,id:r.id,ok:true,value:null}),0)}};`,
    );
    await page.goto(pathToFileURL(join(root, 'index.html')).href);
    await page.locator('canvas').waitFor();
    const sharp = (await import('sharp')).default;
    const pixels = await sharp(await page.locator('canvas').screenshot()).stats();
    expect(pixels.channels[2]!.mean).toBeGreaterThan(pixels.channels[1]!.mean);
    await page.locator('#play').click();
    await expect
      .poll(async () => Number(await page.locator('#score').textContent()))
      .toBeGreaterThan(10);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(root, { recursive: true, force: true });
  }
});
