import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadDevelopmentTestEnvironment } from '../../scripts/environment.ts';
import { Pool } from 'pg';
loadDevelopmentTestEnvironment();
const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const profileUrl = `http://127.0.0.1:${process.env.PROFILE_UI_PORT || 4173}`;
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
test('real account saves a creature profile and navigates to creator games', async ({ page }) => {
  const email = `profile-web-${Date.now()}@example.com`,
    password = 'Profile-test-2048!';
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Browser Creator', age_confirmed: true },
  });
  if (created.error) throw created.error;
  try {
    await page.goto(`${profileUrl}/auth`);
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Account', { exact: true }).click();
    await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
    await expect(page.getByTestId('credit-balance')).toHaveText('15 credits available');
    await expect(page.getByRole('radio')).toHaveCount(10);
    await page.getByRole('radio', { name: 'Choose pip', exact: true }).click();
    const username = `web_${created.data.user!.id.slice(0, 8)}`;
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Display name', { exact: true }).fill('Tiny Dragon');
    await page.getByLabel('Bio', { exact: true }).fill('I make little games.');
    await page.getByRole('switch', { name: 'Automatically sync saves' }).click();
    await page.getByRole('button', { name: 'Save profile & preferences' }).click();
    await expect(page.getByText('Profile and preferences saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Username', { exact: true })).toHaveValue(username);
    await expect(page.getByRole('radio', { name: 'Choose pip', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: 'Automatically sync saves' })).not.toBeChecked();
    await page.getByRole('button', { name: 'View my profile' }).click();
    await expect(page.getByRole('heading', { name: 'Tiny Dragon', exact: true })).toBeVisible();
    await expect(
      page.getByText('I make little games.', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText('No games available to you yet.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.screenshot({ path: 'work/profile-settings-web.png', fullPage: true });
  } finally {
    await admin.auth.admin.deleteUser(created.data.user!.id);
    const database = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await database.query('delete from analytics_outbox where user_id=$1', [
        created.data.user!.id,
      ]);
    } finally {
      await database.end();
    }
  }
});
