import { createAnalytics } from './analytics.ts';
import type { Config } from '../../config/src/index.ts';
import { Database } from './postgres/db.ts';
import { PgGames } from './postgres/games.ts';
import { PgProfiles } from './postgres/profiles.ts';
import { PgGenerationCheckpoints } from './postgres/checkpoints.ts';
import { PgGenerations } from './postgres/generations.ts';
import { PgCredits } from './postgres/credits.ts';
import { PgProgress } from './postgres/progress.ts';
import { PgSharing } from './postgres/sharing.ts';
import { LocalStorage } from './storage.ts';
import { SupabaseAuth } from './auth.ts';
import { SystemClock, RandomIdentity } from './identity.ts';
import { PgIntegrity } from './postgres/integrity.ts';
import { PgGuestAccounts } from './postgres/guests.ts';
import { GooglePlayIntegrityDecoder, PlatformIntegrityVerifier } from './integrity.ts';
export function compose(config: Config, service = 'api') {
  const db = new Database(config.DATABASE_URL);
  const storage = new LocalStorage(config.ARTIFACT_ROOT);
  return {
    db,
    checkpoints: new PgGenerationCheckpoints(db),
    guests: new PgGuestAccounts(db),
    integrity: {
      enabled: config.APP_INTEGRITY_MODE === 'required',
      repository: new PgIntegrity(db, config.APP_INTEGRITY_CHALLENGE_LIMIT_ENABLED === 'true'),
      verifier: new PlatformIntegrityVerifier(
        {
          teamId: config.APPLE_TEAM_ID,
          bundleId: config.APPLE_BUNDLE_ID,
          packageName: config.ANDROID_PACKAGE_NAME,
          certificateDigests: config.ANDROID_CERTIFICATE_SHA256_DIGESTS.split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          allowDevelopment: config.APPLE_APP_ATTEST_ENVIRONMENT === 'development',
        },
        new GooglePlayIntegrityDecoder(config.ANDROID_PACKAGE_NAME),
      ),
    },
    analytics: createAnalytics(config, service),
    games: new PgGames(db),
    profiles: new PgProfiles(db),
    generations: new PgGenerations(db, config.GENERATION_CREDITS_ENABLED === 'true', {
      dailyGeneration: config.GENERATION_DAILY_LIMIT_ENABLED === 'true',
      dailyModification: config.MODIFICATION_DAILY_LIMIT_ENABLED === 'true',
      concurrent: config.GENERATION_CONCURRENT_LIMIT_ENABLED === 'true',
      jobCost: config.OPENROUTER_JOB_COST_LIMIT_ENABLED === 'true',
      dailyCost: config.OPENROUTER_DAILY_COST_LIMIT_ENABLED === 'true',
    }),
    apiRateLimitEnabled: config.API_RATE_LIMIT_ENABLED === 'true',
    credits: new PgCredits(db, config.GENERATION_CREDITS_ENABLED === 'true'),
    progress: new PgProgress(db),
    shares: new PgSharing(db),
    storage,
    auth: new SupabaseAuth(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, db, storage),
    ids: new RandomIdentity(),
    clock: new SystemClock(),
    policy: {
      available: Boolean(config.OPENROUTER_API_KEY),
      newLimit: config.GENERATION_DAILY_LIMIT,
      modifyLimit: config.MODIFICATION_DAILY_LIMIT,
      jobCap: config.OPENROUTER_MAX_JOB_COST_USD,
      dailyCap: config.OPENROUTER_MAX_DAILY_COST_USD,
    },
  };
}
