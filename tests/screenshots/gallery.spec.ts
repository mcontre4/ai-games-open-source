import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(await readFile('apps/mobile/assets/fixture.json', 'utf8'));
import { verifyPackage } from '../../packages/game-sdk/src/package.ts';
import { HandleGameMessage } from '../../packages/application/src/bridge.ts';
import type { Game, Generation } from '../../packages/domain/src/index.ts';
import { threeFixture } from '../three-fixture.ts';
import { signing, game as runtimeGame } from '../helpers.ts';

// Synthetic documentation data only. All screenshots render the actual app/runtime.
const account = 'documentation-player';
const createdAt = '2026-10-15T12:00:00Z';
const profile = {
  id: account,
  username: 'demo_creator',
  displayName: 'Demo Creator',
  avatarId: 'sprout',
  bio: 'Small worlds, big adventures. This is a documentation demo profile.',
  createdAt,
  profileVisible: true,
  leaderboardVisible: true,
  autoSync: true,
};
const game: Game = {
  id: 'game_documentation',
  ownerId: account,
  title: 'Forest Puzzle · Demo',
  description: 'Documentation fixture: a cozy woodland puzzle with a fox collecting acorns.',
  orientation: 'portrait',
  view: '2d',
  currentVersionId: 'ver_documentation',
  public: false,
  fixture: false,
  createdAt,
};
const job: Generation = {
  id: 'gen_documentation',
  gameId: 'game_in_progress',
  userId: account,
  prompt: 'Documentation demo: a tiny dragon exploring a watercolor moon garden.',
  kind: 'create',
  stage: 'coding',
  error: null,
  baseVersionId: null,
  createdAt,
};

async function documentationApi(page: Page) {
  let stage = job.stage;
  let library = false;
  const unexpected: string[] = [];
  await page.addInitScript(
    ({ account, createdAt }) => {
      localStorage.setItem(
        'sb-creation-auth-auth-token',
        JSON.stringify({
          access_token: 'explicit-documentation-token',
          refresh_token: 'explicit-documentation-refresh',
          token_type: 'bearer',
          expires_at: 4_000_000_000,
          user: {
            id: account,
            email: 'demo@example.com',
            aud: 'authenticated',
            created_at: createdAt,
            user_metadata: {},
          },
        }),
      );
    },
    { account, createdAt },
  );
  await page.route('**/*', async (route) => {
    const { hostname, pathname } = new URL(route.request().url());
    if (hostname === '127.0.0.1') return route.continue();
    if (hostname === 'creation-auth.invalid') return route.fulfill({ json: {} });
    if (hostname !== 'creation-api.invalid') {
      unexpected.push(hostname);
      return route.abort();
    }
    if (pathname === '/health') return route.fulfill({ json: { aiAvailable: true } });
    if (pathname === '/me/profile') return route.fulfill({ json: profile });
    if (pathname === '/me/credits')
      return route.fulfill({
        json: {
          enabled: true,
          dailyAllowance: 15,
          available: 12.5,
          spent: 2.5,
          held: 0,
          resetsAt: '2026-10-16T00:00:00Z',
        },
      });
    if (pathname === '/games') return route.fulfill({ json: library ? [game] : [] });
    if (pathname === '/generations')
      return route.fulfill({ json: library ? [{ ...job, stage }] : [] });
    if (pathname === `/generations/${job.id}`)
      return route.fulfill({
        json: {
          ...job,
          stage,
          progressSaved: true,
          error:
            stage === 'failed'
              ? 'Demo: the provider stopped responding. Your progress is saved.'
              : null,
        },
      });
    if (pathname.startsWith('/profiles/'))
      return route.fulfill({ json: { profile, games: [game] } });
    if (pathname === `/games/${fixture.game.id}`)
      return route.fulfill({
        json: {
          ...fixture.game,
          versions: [{ id: fixture.versionId, number: 1, packageBytes: fixture.bytes }],
          leaderboard: [{ player: 'Demo Pilot', score: 2064 }],
        },
      });
    if (pathname === `/games/${game.id}`)
      return route.fulfill({ json: { ...game, versions: [], leaderboard: [] } });
    unexpected.push(pathname);
    return route.fulfill({ status: 404, json: { message: 'Unknown documentation fixture route' } });
  });
  return {
    showLibrary() {
      library = true;
    },
    fail() {
      stage = 'failed';
    },
    unexpected,
  };
}

async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((image) => image.decode().catch(() => {})));
  });
  // React Native's entrance animation runs on requestAnimationFrame.
  await page.waitForTimeout(450);
  await page.screenshot({ path: `docs/images/${name}.png`, animations: 'disabled', caret: 'hide' });
}

test('capture app screens with synthetic documentation data and no external traffic', async ({
  page,
}) => {
  await mkdir('docs/images', { recursive: true });
  const api = await documentationApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play Neon Comet', exact: true })).toBeVisible();
  await capture(page, 'catalog');
  await page.goto('/create');
  await expect(page.getByTestId('game-prompt')).toBeVisible();
  await capture(page, 'create');
  await page
    .getByTestId('game-prompt')
    .fill(
      'A cozy forest puzzle in watercolor. Guide a fox through autumn leaves and collect acorns.',
    );
  await page.getByTestId('game-prompt').scrollIntoViewIfNeeded();
  await capture(page, 'create-prompt');
  await page.goto(`/game/${fixture.game.id}`);
  await expect(
    page.getByRole('button', { name: 'Download bundled sample', exact: true }),
  ).toBeVisible();
  await capture(page, 'game-details');
  api.showLibrary();
  await page.goto('/your-games');
  await expect(page.getByRole('button', { name: `Open ${game.title}`, exact: true })).toBeVisible();
  await capture(page, 'library');
  await page.goto(`/generation/${job.id}`);
  await expect(page.getByText('Creating mechanics', { exact: true }).first()).toBeVisible();
  await capture(page, 'generation');
  api.fail();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume creation', exact: true })).toBeVisible();
  await capture(page, 'resume');
  await page.goto(`/modify/${game.id}`);
  await page
    .getByTestId('game-prompt')
    .fill('Add a moonlit level with glowing mushrooms and a friendly owl.');
  await capture(page, 'modify');
  await page.goto('/settings');
  await expect(page.getByTestId('profile-username')).toHaveValue('demo_creator');
  await capture(page, 'settings');
  await page.getByText('PRIVACY & SAVES', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, 'privacy');
  await page.goto('/profile/demo_creator');
  await expect(page.getByRole('heading', { name: 'Demo Creator' })).toBeVisible();
  await capture(page, 'profile');
  await page.goto('/auth');
  await expect(page.getByText('Sign in', { exact: true }).first()).toBeVisible();
  await capture(page, 'authentication');
  expect(api.unexpected).toEqual([]);
});

for (const view of ['2d', '3d', 'isometric'] as const) {
  test(`capture real offline ${view} fixture gameplay`, async ({ browser }) => {
    const root = await mkdtemp(join(tmpdir(), 'ai-games-docs-'));
    const verified =
      view === '2d'
        ? verifyPackage(
            new Uint8Array(await readFile('apps/mobile/assets/neon-comet.zip')),
            fixture.publicKey,
          )
        : await (async () => {
            const { packager, publicKey } = signing();
            const { files } = await threeFixture(view);
            const packaged = await packager.package(
              { ...runtimeGame, view },
              'ver_documentation',
              files,
            );
            return verifyPackage(packaged.bytes, publicKey);
          })();
    for (const [path, bytes] of Object.entries(verified.files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes);
    }
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const host = new HandleGameMessage(
      { load: async () => null, save: async () => {}, score: async () => {} },
      { accountId: 'documentation-player', manifest: verified.manifest, playerName: 'Demo Pilot' },
      Date.now,
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.exposeBinding('nativeHost', async (_source, raw: string) => {
      const response = await host.execute(raw);
      await page.evaluate((value) => {
        (window as unknown as { __gameSDKReceive: (v: unknown) => void }).__gameSDKReceive(value);
      }, response);
    });
    await page.addInitScript(
      'window.ReactNativeWebView={postMessage:function(raw){window.nativeHost(raw)}};',
    );
    try {
      await page.goto(pathToFileURL(join(root, 'index.html')).href);
      await expect(page.locator('#play')).toBeEnabled();
      if (view === '2d') await capture(page, 'neon-comet-menu');
      await page.locator('#play').click();
      await expect
        .poll(async () => Number(await page.locator('#score').textContent()))
        .toBeGreaterThan(view === '2d' ? 10 : 0);
      await capture(page, `gameplay-${view}`);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
