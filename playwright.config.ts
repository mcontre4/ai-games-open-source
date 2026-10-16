import { defineConfig } from '@playwright/test';
import { loadDevelopmentTestEnvironment } from './scripts/environment.ts';
loadDevelopmentTestEnvironment();
const uiPort = Number(process.env.CREATION_UI_PORT || 8094);
const profilePort = Number(process.env.PROFILE_UI_PORT || 4173);
if (!Number.isInteger(uiPort) || uiPort < 1024 || uiPort > 65535)
  throw new Error('Invalid CREATION_UI_PORT');
if (!Number.isInteger(profilePort) || profilePort < 1024 || profilePort > 65535)
  throw new Error('Invalid PROFILE_UI_PORT');
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60_000,
  use: { headless: true, viewport: { width: 390, height: 844 } },
  reporter: 'list',
  webServer: [
    {
      command: `pnpm --filter @ai-games/mobile exec expo export --platform web --output-dir ../../work/creation-ui-${uiPort} --max-workers 2 && pnpm exec vite preview --outDir work/creation-ui-${uiPort} --host 127.0.0.1 --port ${uiPort} --strictPort`,
      url: `http://127.0.0.1:${uiPort}`,
      timeout: 120_000,
      env: {
        APP_ENV: 'test',
        CI: '1',
        EXPO_PUBLIC_POSTHOG_ENABLED: 'false',
        EXPO_NO_DOTENV: '1',
        EXPO_NO_TYPESCRIPT_SETUP: '1',
        EXPO_PUBLIC_APP_ENV: 'test',
        EXPO_PUBLIC_APP_INTEGRITY_MODE: 'local-development',
        EXPO_PUBLIC_API_URL: 'https://creation-api.invalid',
        EXPO_PUBLIC_SUPABASE_URL: 'https://creation-auth.invalid',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'explicit-ui-test-only',
      },
    },
    {
      command: 'pnpm exec tsx scripts/test-web-server.ts',
      url: `http://127.0.0.1:${profilePort}`,
      env: { PROFILE_UI_PORT: String(profilePort) },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
