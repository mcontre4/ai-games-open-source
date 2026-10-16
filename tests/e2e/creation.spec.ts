import { test, expect, type Page } from '@playwright/test';
import type { Game, Generation, Stage } from '../../packages/domain/src/index.ts';

// These explicit UI fixtures exercise the Expo app with mocked APIs, never live AI generation.
const uiUrl = `http://127.0.0.1:${process.env.CREATION_UI_PORT || 8094}`;
const prompt = 'UI test fixture: a cozy forest puzzle game with a fox collecting acorns';
const modification = 'UI test fixture: add flying squirrels to the forest game';
const account = 'ui-test-player';
const createdAt = '2026-10-11T12:00:00Z';
const game: Game = {
  id: 'ui-test-game',
  ownerId: account,
  title: 'Your new game',
  description: prompt,
  orientation: 'portrait',
  currentVersionId: null,
  public: false,
  fixture: false,
  createdAt,
};
const generation: Generation = {
  id: 'ui-test-generation',
  gameId: game.id,
  userId: account,
  prompt,
  kind: 'create',
  stage: 'queued',
  error: null,
  baseVersionId: null,
  createdAt,
};
async function fixtureApi(
  page: Page,
  initial?: Stage,
  availableCredits: number | null = 15,
  creditsEnabled = true,
) {
  let job: Generation | undefined = initial ? { ...generation, stage: initial } : undefined;
  let published = initial === 'ready';
  let metadata: { title: string; description: string } | undefined;
  const catalogGames: Game[] = [];
  const otherJobs: Generation[] = [];
  let unavailable = false;
  let polls = 0;
  let resumes = 0;
  let retryBlocked = false;
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === uiUrl ||
      url.origin === 'https://creation-api.invalid' ||
      url.origin === 'https://creation-auth.invalid'
    )
      return route.continue();
    return route.abort();
  });
  await page.addInitScript(
    ({ account, createdAt }) => {
      localStorage.setItem(
        'sb-creation-auth-auth-token',
        JSON.stringify({
          access_token: 'explicit-ui-fixture-token',
          refresh_token: 'explicit-ui-fixture-refresh',
          token_type: 'bearer',
          expires_at: 4_000_000_000,
          user: {
            id: account,
            email: 'ui-fixture@example.com',
            aud: 'authenticated',
            created_at: createdAt,
            user_metadata: {},
          },
        }),
      );
    },
    { account, createdAt },
  );
  await page.route('https://creation-auth.invalid/**', (route) => route.fulfill({ json: {} }));
  await page.route('https://creation-api.invalid/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/health') return route.fulfill({ json: { aiAvailable: true } });
    if (pathname === '/me/credits')
      if (availableCredits === null)
        return route.fulfill({ status: 503, json: { message: 'Explicit credit fixture outage' } });
      else
        return route.fulfill({
          json: {
            enabled: creditsEnabled,
            dailyAllowance: 15,
            available: availableCredits,
            spent: 15 - availableCredits,
            held: 0,
            resetsAt: '2026-10-12T00:00:00Z',
          },
        });
    if (pathname === '/me/profile')
      return route.fulfill({
        json: {
          id: account,
          username: 'fixture_creator',
          displayName: 'UI Fixture Creator',
          avatarId: 'blob',
          bio: '',
          createdAt,
          profileVisible: true,
          autoSync: true,
          leaderboardVisible: true,
        },
      });
    if ((pathname === '/games' || pathname === `/games/${game.id}/modify`) && method === 'POST') {
      const input = route.request().postDataJSON();
      job = {
        ...generation,
        prompt: input.prompt,
        speed: input.speed,
        ...(pathname.endsWith('/modify')
          ? { kind: 'modify', baseVersionId: 'ui-test-version' }
          : {}),
      };
      return route.fulfill({
        status: 202,
        json: { gameId: game.id, generationId: job.id, generation: job },
      });
    }
    if (pathname === `/games/${game.id}`) {
      if (method === 'PATCH') metadata = route.request().postDataJSON();
      return route.fulfill({
        json: {
          ...game,
          title: 'Forest Puzzle',
          currentVersionId: 'ui-test-version',
          ...metadata,
          versions: [],
          leaderboard: [],
        },
      });
    }
    if (pathname === '/games')
      return route.fulfill({
        json: job
          ? [
              {
                ...game,
                ...(published
                  ? { title: 'Forest Puzzle', currentVersionId: 'ui-test-version' }
                  : {}),
                ...metadata,
              },
              ...catalogGames,
            ]
          : [],
      });
    if (pathname === '/generations')
      return route.fulfill({ json: [...(job ? [job] : []), ...otherJobs] });
    if (pathname === `/generations/${job?.id}/retry` && method === 'POST') {
      if (retryBlocked)
        return route.fulfill({
          status: 409,
          json: { message: 'Provider bill is still being reconciled. Try again later.' },
        });
      resumes++;
      job = {
        ...job!,
        id: 'ui-test-resumed-generation',
        retryOf: job!.id,
        stage: 'queued',
        error: null,
        progressSaved: true,
      };
      return route.fulfill({
        status: 202,
        json: { gameId: game.id, generationId: job.id, generation: job },
      });
    }
    if (pathname === `/generations/${job?.id}`) {
      if (method === 'DELETE') {
        job = { ...job!, stage: 'cancelled' };
        return route.fulfill({ status: 204 });
      }
      polls++;
      return unavailable
        ? route.fulfill({ status: 503, json: { message: 'Explicit test outage' } })
        : route.fulfill({ json: job });
    }
    throw new Error(`Unexpected fixture API request: ${method} ${pathname}`);
  });
  return {
    retainProgress() {
      job = { ...job!, progressSaved: true };
    },
    blockRetry(value: boolean) {
      retryBlocked = value;
    },
    resumes: () => resumes,
    addSharedGame() {
      for (let index = 1; index <= 2; index++)
        catalogGames.push({
          ...game,
          id: `ui-owned-${index}`,
          title: `Owned game ${index}`,
          currentVersionId: `ui-version-${index}`,
        });
      catalogGames.push({
        ...game,
        id: 'ui-shared-game',
        ownerId: 'someone-else',
        title: 'Shared Moon Race',
        currentVersionId: 'ui-shared-version',
      });
    },
    anotherCreation() {
      otherJobs.push({
        ...generation,
        id: 'ui-test-second-generation',
        gameId: 'ui-test-second-game',
        prompt: 'UI test fixture: a dragon racing game on the moon',
        stage: 'artwork',
      });
    },
    setStage(stage: Stage, error = 'Explicit UI fixture failure') {
      job = { ...job!, stage, error: stage === 'failed' ? error : null };
      published = stage === 'ready';
    },
    modify() {
      published = true;
      job = {
        ...generation,
        kind: 'modify',
        prompt: modification,
        stage: 'coding',
        baseVersionId: 'ui-test-version',
      };
    },
    outage(value: boolean) {
      unavailable = value;
    },
    polls: () => polls,
  };
}

for (const option of [
  { speed: 'regular', label: 'Regular' },
  { speed: 'fast', label: 'Fast' },
  { speed: 'ultra-fast', label: 'Ultra fast' },
] as const) {
  test(`creation submits ${option.speed} speed with its cost explanation`, async ({ page }) => {
    await fixtureApi(page);
    await page.goto(`${uiUrl}/create`);
    await expect(page.getByRole('radio', { name: 'Regular', exact: true })).toBeChecked();
    await expect(page.getByText('Faster AI responses · About 2× AI cost (+100%)')).toBeVisible();
    await expect(page.getByText('Fastest AI responses · About 6× AI cost (+500%)')).toBeVisible();
    await page.getByRole('radio', { name: option.label, exact: true }).click();
    await expect(page.getByRole('radio', { name: option.label, exact: true })).toBeChecked();
    if (option.speed === 'ultra-fast')
      await page.screenshot({
        path: test.info().outputPath('creation-speeds.png'),
        fullPage: true,
      });
    await page.getByTestId('game-prompt').fill(prompt);
    const request = page.waitForRequest((r) => r.url().endsWith('/games') && r.method() === 'POST');
    await page.getByRole('button', { name: 'Create my game', exact: true }).click();
    expect((await request).postDataJSON()).toMatchObject({ prompt, speed: option.speed });
  });
}

test('modification submits the selected creation speed', async ({ page }) => {
  await fixtureApi(page, 'ready');
  await page.goto(`${uiUrl}/modify/${game.id}`);
  await page.getByRole('radio', { name: 'Fast', exact: true }).click();
  await page.getByTestId('game-prompt').fill(modification);
  const request = page.waitForRequest(
    (r) => r.url().endsWith(`/games/${game.id}/modify`) && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create new version', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ prompt: modification, speed: 'fast' });
});

test('submitted idea remains visible while queued, building, and ready', async ({ page }) => {
  const api = await fixtureApi(page);
  await page.goto(`${uiUrl}/create`);
  await page.getByTestId('game-prompt').fill(prompt);
  api.outage(true);
  await page.getByRole('button', { name: 'Create my game', exact: true }).click();
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Queued · Waiting to start', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to library' }).click();
  const creation = page.getByRole('button', {
    name: `View creation progress: ${prompt}`,
    exact: true,
  });
  await expect(creation).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Your new game' })).toHaveCount(0);
  api.outage(false);
  await creation.click();
  api.setStage('artwork');
  await expect(
    page.getByText('Creating artwork', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText('Working', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('creation-progress.png') });
  api.outage(true);
  await expect(page.getByText('Couldn’t update progress. Reconnecting…')).toBeVisible();
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
  api.outage(false);
  api.setStage('ready');
  await expect(page.getByRole('button', { name: 'Open my game' })).toBeVisible();
  await expect(page.getByText('Couldn’t update progress. Reconnecting…')).toHaveCount(0);
  const polls = api.polls();
  await page.waitForTimeout(3500);
  expect(api.polls()).toBe(polls);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.getByRole('button', { name: 'Play Forest Puzzle' })).toBeVisible();
  await expect(page.getByRole('button', { name: `View creation progress: ${prompt}` })).toHaveCount(
    0,
  );
});

for (const [label, view] of [
  ['2D', '2d'],
  ['3D', '3d'],
  ['Isometric', 'isometric'],
]) {
  test(`illustrated ${label} choice reaches the create API`, async ({ page }) => {
    await fixtureApi(page);
    await page.goto(`${uiUrl}/create`);
    const radio = page.getByRole('radio', { name: label, exact: true });
    await expect(page.getByRole('radio', { name: '2D', exact: true })).toBeChecked();
    const images = page.getByRole('radiogroup', { name: 'Game view' }).locator('img');
    await expect(images).toHaveCount(3);
    await expect
      .poll(() =>
        images.evaluateAll((items) =>
          items.every(
            (item) =>
              (item as HTMLImageElement).complete && (item as HTMLImageElement).naturalWidth > 0,
          ),
        ),
      )
      .toBe(true);
    await radio.click();
    await expect(radio).toBeChecked();
    await page.getByRole('radio', { name: 'Landscape', exact: true }).click();
    await page.getByTestId('game-prompt').fill(prompt);
    await page.screenshot({ path: test.info().outputPath(`create-${view}.png`) });
    const request = page.waitForRequest(
      (request) =>
        request.url() === 'https://creation-api.invalid/games' && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create my game', exact: true }).click();
    expect((await request).postDataJSON()).toEqual({
      prompt,
      orientation: 'landscape',
      view,
      speed: 'regular',
    });
  });
}

test('daily credits explain the allowance and prevent generation when exhausted', async ({
  page,
}) => {
  await fixtureApi(page, undefined, 0);
  await page.goto(`${uiUrl}/create`);
  await expect(page.getByTestId('credit-balance')).toHaveText('0 credits available');
  await expect(
    page.getByText('Daily credits used. You can create again after the reset.'),
  ).toBeVisible();
  await page.getByTestId('game-prompt').fill(prompt);
  await expect(page.getByRole('button', { name: 'Create my game', exact: true })).toBeDisabled();
});

test('fractional credit balance is visible on creation and modification', async ({ page }) => {
  await fixtureApi(page, undefined, 14.123456);
  await page.goto(`${uiUrl}/create`);
  await expect(page.getByTestId('credit-balance')).toHaveText('14.123456 credits available');
  await page.goto(`${uiUrl}/modify/${game.id}`);
  await expect(page.getByTestId('credit-balance')).toHaveText('14.123456 credits available');
  await expect(page.getByText('15 free credits every day.', { exact: false })).toBeVisible();
});

test('paused credits permit creation and modification even with an exhausted display balance (explicit fixture)', async ({
  page,
}) => {
  await fixtureApi(page, undefined, 0, false);
  for (const [path, button] of [
    ['/create', 'Create my game'],
    [`/modify/${game.id}`, 'Create new version'],
  ]) {
    await page.goto(`${uiUrl}${path}`);
    await expect(page.getByTestId('credit-balance')).toHaveText('Credit charging is paused.');
    await expect(page.getByText('15 free credits every day.', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Resets', { exact: false })).toHaveCount(0);
    await page.getByTestId('game-prompt').fill(prompt);
    await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
  }
});

test('unavailable credits disable generation while the library still loads', async ({ page }) => {
  await fixtureApi(page, 'coding', null);
  await page.goto(`${uiUrl}/create`);
  await expect(page.getByTestId('credit-balance')).toHaveText('Balance unavailable');
  await page.getByTestId('game-prompt').fill(prompt);
  await expect(page.getByRole('button', { name: 'Create my game', exact: true })).toBeDisabled();
  await page.goto(uiUrl);
  await expect(
    page.getByRole('button', { name: `View creation progress: ${prompt}`, exact: true }),
  ).toBeVisible();
});

test('persisted creations identify different prompts and do not offer play before completion', async ({
  page,
}) => {
  const api = await fixtureApi(page, 'coding');
  api.anotherCreation();
  await page.goto(uiUrl);
  const creation = page.getByRole('button', { name: `View creation progress: ${prompt}` });
  await expect(creation).toBeVisible();
  await expect(creation.getByText('Creating mechanics')).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'View creation progress: UI test fixture: a dragon racing game on the moon',
    }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('creation-library.png') });
  await page.reload();
  await expect(creation).toBeVisible();
  await creation.click();
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  await expect(creation.getByText('Creation cancelled', { exact: true })).toBeVisible();
  await creation.click();
  await expect(page.getByRole('button', { name: 'Try another creation' })).toBeVisible();
  await expect(page.getByText('Working', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel generation' })).toHaveCount(0);
});

test('failed creation keeps its prompt and stops reporting work', async ({ page }) => {
  const api = await fixtureApi(page, 'building');
  await page.goto(`${uiUrl}/generation/${generation.id}`);
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
  api.setStage('failed');
  await expect(page.getByText('Creation failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Explicit UI fixture failure')).toBeVisible();
  await expect(page.getByText('Working', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open my game' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(
    page.getByText('Creation failed', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});

test('moderation rejection explains the issue and offers another creation (explicit UI fixture)', async ({
  page,
}) => {
  const api = await fixtureApi(page);
  const rejected = 'UI test fixture: create a racing game that charges players real money';
  const reason =
    'Games cannot charge players, collect payment details, or offer real-money gambling. Use fictional game currency.';
  await page.goto(`${uiUrl}/create`);
  await expect(
    page.getByText('Ideas are checked before creation.', { exact: false }),
  ).toBeVisible();
  await page.getByTestId('game-prompt').fill(rejected);
  await page.getByRole('button', { name: 'Create my game', exact: true }).click();
  await expect(page).toHaveURL(`${uiUrl}/generation/${generation.id}`);
  api.setStage('failed', reason);
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByText(rejected, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open my game' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try another creation' }).click();
  await expect(page.getByTestId('game-prompt').filter({ visible: true })).toBeVisible();
});

test('modification shows its requested change while the existing game remains playable', async ({
  page,
}) => {
  const api = await fixtureApi(page, 'coding');
  api.modify();
  await page.goto(uiUrl);
  await expect(page.getByRole('button', { name: 'Play Forest Puzzle' })).toBeVisible();
  await page.getByRole('button', { name: `View modification progress: ${modification}` }).click();
  await expect(
    page.getByText('YOUR MODIFICATION', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText(modification, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});

for (const width of [390, 900]) {
  test(`catalog, creator library and owner metadata editing ${width} (explicit UI fixtures)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const api = await fixtureApi(page, 'ready');
    api.addSharedGame();
    await page.goto(uiUrl);
    await expect(page.getByText('FEATURED GAME', { exact: true })).toBeVisible();
    await expect(page.getByText('New games', { exact: true })).toBeVisible();
    await expect(page.getByText('Offline samples', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open Shared Moon Race', exact: true }).first(),
    ).toBeVisible();
    await page.waitForTimeout(400); // Let the entrance animation finish before capturing evidence.
    await page.screenshot({
      path: test.info().outputPath(`all-games-${width}.png`),
      fullPage: true,
    });
    await page.goto(`${uiUrl}/your-games`);
    await expect(
      page.getByRole('button', { name: 'Open Forest Puzzle', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open Shared Moon Race', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('OFFLINE SAMPLE', { exact: true })).toHaveCount(0);
    const tiles = await page.getByRole('button', { name: /^Open / }).all();
    expect(tiles).toHaveLength(3);
    const positions = await Promise.all(tiles.map((tile) => tile.boundingBox()));
    expect(positions[0]!.y).toBe(positions[1]!.y);
    if (width >= 700) expect(positions[1]!.y).toBe(positions[2]!.y);
    else expect(positions[2]!.y).toBeGreaterThan(positions[1]!.y);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: test.info().outputPath(`your-games-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Open Forest Puzzle', exact: true }).click();
    await page.getByRole('button', { name: 'Edit title & description', exact: true }).click();
    await page.getByLabel('Game title', { exact: true }).fill('My Forest Adventure');
    await page
      .getByLabel('Game description', { exact: true })
      .fill('Collect acorns and solve cozy forest puzzles.');
    await page.getByRole('button', { name: 'Save game details', exact: true }).click();
    await expect(page.getByText('Game details saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('My Forest Adventure', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Collect acorns and solve cozy forest puzzles.', { exact: true }),
    ).toBeVisible();
    await page.goto(`${uiUrl}/your-games`);
    await expect(
      page.getByRole('button', { name: 'Open My Forest Adventure', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Search games', { exact: true }).fill('acorns');
    await expect(
      page.getByRole('button', { name: 'Open My Forest Adventure', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Search games', { exact: true }).fill('unmatched');
    await expect(page.getByText('No matching games', { exact: true })).toBeVisible();
  });
}

test('Your Games shows an in-progress tile and opens its status (explicit UI fixture)', async ({
  page,
}) => {
  const api = await fixtureApi(page, 'artwork');
  await page.goto(`${uiUrl}/your-games`);
  const tile = page.getByRole('button', { name: `View creation progress: ${prompt}`, exact: true });
  await expect(tile).toBeVisible();
  await expect(tile.getByTestId(`creation-loading-${game.id}`)).toBeVisible();
  await expect(tile.getByText('Creating artwork', { exact: true })).toBeVisible();
  await expect(page.getByText('Your library starts here', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search games', { exact: true }).fill('Your new game');
  await expect(tile).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('your-games-creating.png') });
  await tile.click();
  await expect(
    page.getByText('Creating artwork', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
  api.setStage('ready');
  await expect(page.getByRole('button', { name: 'Open my game', exact: true })).toBeVisible();
  await page.goto(`${uiUrl}/your-games`);
  await expect(page.getByRole('button', { name: 'Open Forest Puzzle', exact: true })).toBeVisible();
  await expect(page.getByTestId(`creation-loading-${game.id}`)).toHaveCount(0);
  await expect(tile).toHaveCount(0);
});

test('Your Games keeps failed creations accessible without a loading icon (explicit UI fixture)', async ({
  page,
}) => {
  await fixtureApi(page, 'failed');
  await page.goto(`${uiUrl}/your-games`);
  const tile = page.getByRole('button', { name: `View creation progress: ${prompt}`, exact: true });
  await expect(tile).toBeVisible();
  await expect(tile.getByText('Creation failed', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`creation-loading-${game.id}`)).toHaveCount(0);
  await tile.click();
  await expect(
    page.getByText('Creation failed', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});

test('resumes a saved failed creation and retains it when the resume request is rejected', async ({
  page,
}) => {
  const api = await fixtureApi(page, 'failed');
  api.retainProgress();
  api.blockRetry(true);
  await page.goto(`${uiUrl}/generation/${generation.id}`);
  await expect(page.getByRole('button', { name: 'Resume creation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume creation', exact: true }).click();
  await expect(
    page.getByText('Provider bill is still being reconciled. Try again later.'),
  ).toBeVisible();
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
  expect(api.resumes()).toBe(0);
  api.blockRetry(false);
  await page.getByRole('button', { name: 'Resume creation', exact: true }).click();
  await expect(page).toHaveURL(`${uiUrl}/generation/ui-test-resumed-generation`);
  await expect(page.getByText('Queued · Waiting to start', { exact: true })).toBeVisible();
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
  expect(api.resumes()).toBe(1);
});
