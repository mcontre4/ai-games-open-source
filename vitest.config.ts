import { defineConfig } from 'vitest/config';
import { loadDevelopmentTestEnvironment } from './scripts/environment.ts';
loadDevelopmentTestEnvironment();
// Tests never send local fixture data to the live PostHog project.
process.env.POSTHOG_ENABLED = 'false';
// Metered fixtures remain explicit even when local runtime credit charging is paused.
process.env.GENERATION_CREDITS_ENABLED = 'true';
process.env.OPENROUTER_ESTIMATED_COST_ENABLED = 'true';
// Enforcement fixtures explicitly enable the limits that runtime defaults disable.
process.env.GENERATION_DAILY_LIMIT_ENABLED = 'true';
process.env.MODIFICATION_DAILY_LIMIT_ENABLED = 'true';
process.env.GENERATION_CONCURRENT_LIMIT_ENABLED = 'true';
process.env.OPENROUTER_JOB_COST_LIMIT_ENABLED = 'true';
process.env.OPENROUTER_DAILY_COST_LIMIT_ENABLED = 'true';
process.env.API_RATE_LIMIT_ENABLED = 'true';
process.env.APP_INTEGRITY_CHALLENGE_LIMIT_ENABLED = 'true';

// Explicit local fixture mode; native app attestation is tested separately on real devices.
process.env.APP_ENV = 'test';
process.env.APP_INTEGRITY_MODE = 'local-development';
process.env.API_HOST = '127.0.0.1';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    maxWorkers: 2,
    fileParallelism: false,
  },
});
