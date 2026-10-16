import { test, expect, type Page } from '@playwright/test';
// Explicit UI/Auth/API fixtures. Native attestation and live AI are not simulated as passes.
const uiUrl = `http://127.0.0.1:${process.env.CREATION_UI_PORT || 8094}`;
const guestId = 'guest-ui-fixture';
const accountId = 'registered-ui-fixture';
const prompt = 'Explicit guest UI fixture: a fox collecting acorns in a cozy forest';
function session(id: string, anonymous: boolean) {
  return {
    access_token: `explicit-ui-fixture-${id}`,
    refresh_token: `explicit-ui-fixture-refresh-${id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4_000_000_000,
    user: {
      id,
      is_anonymous: anonymous,
      email: anonymous ? '' : 'fixture@example.com',
      aud: 'authenticated',
      created_at: '2026-10-11T12:00:00.000Z',
      user_metadata: { age_confirmed: true, display_name: 'Fixture Player' },
    },
  };
}
async function guestFixture(page: Page, failFirstClaim = false) {
  let userId = guestId;
  let created = false;
  let issued = 0;
  let claimed = 0;
  let anonymousSessions = 0;
  const token = 'explicit-guest-ownership-fixture';
  const game = () => ({
    id: 'game_guestfixture',
    ownerId: userId,
    title: 'Guest Forest',
    description: prompt,
    orientation: 'portrait',
    currentVersionId: null,
    public: false,
    fixture: false,
    createdAt: '2026-10-11T12:00:00.000Z',
  });
  const job = () => ({
    id: 'gen_guestfixture',
    gameId: 'game_guestfixture',
    userId,
    prompt,
    kind: 'create',
    stage: 'queued',
    error: null,
    baseVersionId: null,
    createdAt: '2026-10-11T12:00:00.000Z',
  });
  await page.route('https://creation-auth.invalid/**', async (route) => {
    const body = route.request().postDataJSON() as { email?: string };
    const anonymous = !body.email;
    if (anonymous) anonymousSessions++;
    return route.fulfill({ json: session(anonymous ? guestId : accountId, anonymous) });
  });
  await page.route('https://creation-api.invalid/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/health')
      return route.fulfill({ json: { aiAvailable: true, appIntegrityRequired: false } });
    if (pathname === '/me/credits')
      return route.fulfill({
        json: {
          dailyAllowance: 15,
          available: 15,
          spent: 0,
          held: 0,
          resetsAt: '2026-10-12T00:00:00.000Z',
        },
      });
    if (pathname === '/guest/claim-token') {
      issued++;
      return route.fulfill({ json: { guestId, token } });
    }
    if (pathname === '/me/claim-guest') {
      expect(request.headers().authorization).toBe(`Bearer explicit-ui-fixture-${accountId}`);
      expect(request.postDataJSON()).toEqual({ token });
      claimed++;
      if (failFirstClaim && claimed === 1)
        return route.fulfill({
          status: 503,
          json: { message: 'Explicit transfer fixture outage' },
        });
      userId = accountId;
      return route.fulfill({ json: { guestId, gameIds: ['game_guestfixture'] } });
    }
    if (pathname === '/me/profile')
      return route.fulfill({
        json: {
          id: userId,
          username: 'fixture_player',
          displayName: 'Fixture Player',
          avatarId: 'blob',
          bio: '',
          profileVisible: true,
          autoSync: true,
          leaderboardVisible: true,
          createdAt: '2026-10-11T12:00:00.000Z',
        },
      });
    if (pathname === '/games' && request.method() === 'POST') {
      expect(request.headers().authorization).toBe(`Bearer explicit-ui-fixture-${guestId}`);
      created = true;
      return route.fulfill({
        status: 202,
        json: { gameId: game().id, generationId: job().id, generation: job() },
      });
    }
    if (pathname === '/games') return route.fulfill({ json: created ? [game()] : [] });
    if (pathname === '/generations') return route.fulfill({ json: created ? [job()] : [] });
    if (pathname === '/generations/gen_guestfixture') return route.fulfill({ json: job() });
    throw new Error(`Unexpected guest UI fixture request: ${request.method()} ${pathname}`);
  });
  return {
    issued: () => issued,
    claimed: () => claimed,
    anonymousSessions: () => anonymousSessions,
    owner: () => userId,
  };
}
async function createAsGuest(page: Page) {
  await page.goto(`${uiUrl}/create`);
  await page.getByTestId('game-prompt').fill(prompt);
  const create = page.getByRole('button', { name: 'Create my game', exact: true });
  await expect(create).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I’m 16 or older', exact: true }).click();
  await create.click();
  await expect(page).toHaveURL(`${uiUrl}/generation/gen_guestfixture`);
  await expect(page.getByText(prompt, { exact: true }).filter({ visible: true })).toBeVisible();
}
for (const mode of ['signup', 'signin'] as const) {
  test(`guest generation survives ${mode} and app reload (explicit fixtures)`, async ({ page }) => {
    const fixture = await guestFixture(page);
    await createAsGuest(page);
    expect(fixture.anonymousSessions()).toBe(1);
    expect(fixture.issued()).toBe(1);
    await page.goto(`${uiUrl}/auth`);
    if (mode === 'signup') {
      await page.getByText('New here? Create an account').click();
      await page.getByRole('checkbox').click();
    }
    await page.getByTestId('email').fill('fixture@example.com');
    await page.getByTestId('password').fill('ExplicitFixturePassword!');
    await page.getByTestId('submit-auth').click();
    await expect(page).toHaveURL(`${uiUrl}/`);
    await expect.poll(fixture.owner).toBe(accountId);
    await expect(
      page.getByRole('button', { name: `View creation progress: ${prompt}`, exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('pending-guest-claim'))).toBeNull();
    await page.reload();
    await expect(
      page.getByRole('button', { name: `View creation progress: ${prompt}`, exact: true }),
    ).toBeVisible();
    expect(fixture.anonymousSessions()).toBe(1);
  });
}
test('a failed guest transfer retains its proof and completes after restarting (explicit fixtures)', async ({
  page,
}) => {
  const fixture = await guestFixture(page, true);
  await createAsGuest(page);
  await page.goto(`${uiUrl}/auth`);
  await page.getByTestId('email').fill('fixture@example.com');
  await page.getByTestId('password').fill('ExplicitFixturePassword!');
  await page.getByTestId('submit-auth').click();
  await expect(page.getByText('Explicit transfer fixture outage', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('pending-guest-claim')!).accountId),
  ).toBe(accountId);
  await page.goto(`${uiUrl}/`);
  await expect.poll(fixture.owner).toBe(accountId);
  await expect(
    page.getByRole('button', { name: `View creation progress: ${prompt}`, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pending-guest-claim'))).toBeNull();
});
