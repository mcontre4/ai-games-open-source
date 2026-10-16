import { defineConfig } from '@playwright/test';

const port = Number(process.env.SCREENSHOT_UI_PORT || 8294);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid SCREENSHOT_UI_PORT');

// Standalone public documentation harness: no database, real account or provider key.
export default defineConfig({
  testDir: 'tests/screenshots',
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    headless: true,
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `pnpm --filter @ai-games/mobile exec expo export --platform web --output-dir ../../work/screenshots-ui-${port} --max-workers 2 && pnpm exec vite preview --outDir work/screenshots-ui-${port} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      CI: '1',
      EXPO_NO_DOTENV: '1',
      EXPO_NO_TYPESCRIPT_SETUP: '1',
      EXPO_PUBLIC_APP_ENV: 'test',
      EXPO_PUBLIC_APP_INTEGRITY_MODE: 'local-development',
      EXPO_PUBLIC_API_URL: 'https://creation-api.invalid',
      EXPO_PUBLIC_SUPABASE_URL: 'https://creation-auth.invalid',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'explicit-screenshot-fixture',
      EXPO_PUBLIC_PACKAGE_SIGNING_KEY: '',
      EXPO_PUBLIC_POSTHOG_ENABLED: 'false',
      EXPO_PUBLIC_POSTHOG_API_KEY: '',
      EXPO_PUBLIC_ANALYTICS_ENVIRONMENT: 'test',
      POSTHOG_UPLOAD_SOURCEMAPS: 'false',
    },
  },
});
