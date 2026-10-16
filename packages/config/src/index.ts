import { z } from 'zod';
export const configSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_INTEGRITY_MODE: z.enum(['required', 'local-development', 'disabled']).default('required'),
    APPLE_TEAM_ID: z
      .string()
      .regex(/^[A-Z0-9]{10}$/)
      .or(z.literal(''))
      .default(''),
    APPLE_BUNDLE_ID: z.string().default('com.aigames.creator'),
    APPLE_APP_ATTEST_ENVIRONMENT: z.enum(['production', 'development']).default('production'),
    ANDROID_PACKAGE_NAME: z
      .string()
      .regex(/^[a-zA-Z0-9_.]+$/)
      .default('com.aigames.creator'),
    ANDROID_CERTIFICATE_SHA256_DIGESTS: z.string().default(''),
    POSTHOG_API_KEY: z.string().default(''),
    POSTHOG_HOST: z.url().default('https://us.i.posthog.com'),
    POSTHOG_ENABLED: z.enum(['true', 'false']).default('false'),
    ANALYTICS_ENVIRONMENT: z.string().default('development'),
    APP_RELEASE: z.string().default('0.1.0'),
    DATABASE_URL: z.string().default('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),
    SUPABASE_URL: z.url().default('http://127.0.0.1:54321'),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    API_PORT: z.coerce.number().default(4100),
    API_HOST: z.string().default('127.0.0.1'),
    ARTIFACT_ROOT: z.string().default('./work/artifacts'),
    PACKAGE_SIGNING_KEY_FILE: z.string().default('./work/keys/private.pem'),
    PACKAGE_PUBLIC_KEY_FILE: z.string().default('./work/keys/public.pem'),
    OPENROUTER_API_KEY: z.string().default(''),
    OPENROUTER_CODING_MODEL: z.string().default('openai/gpt-6.1-sol'),
    OPENROUTER_MODERATION_MODEL: z
      .string()
      .regex(/^typesafe\/jev-\d+(?:\.\d+)*(?:-\d{8})?$/)
      .default('typesafe/jev-1.13'),
    OPENROUTER_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
    OPENROUTER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(32768).default(16384),
    OPENROUTER_IMAGE_MODEL: z.string().default('meta/muse-image'),
    OPENROUTER_MAX_JOB_COST_USD: z.coerce.number().positive().max(20).default(10),
    OPENROUTER_MAX_DAILY_COST_USD: z.coerce.number().positive().max(1000).default(100),
    OPENROUTER_ESTIMATED_COST_ENABLED: z.enum(['true', 'false']).default('true'),
    GENERATION_CREDITS_ENABLED: z.enum(['true', 'false']).default('true'),
    GENERATION_DAILY_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
    MODIFICATION_DAILY_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
    GENERATION_CONCURRENT_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
    OPENROUTER_JOB_COST_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
    OPENROUTER_DAILY_COST_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
    API_RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
    APP_INTEGRITY_CHALLENGE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
    GENERATION_DAILY_LIMIT: z.coerce.number().int().min(1).default(5),
    MODIFICATION_DAILY_LIMIT: z.coerce.number().int().min(1).default(5),
    GENERATION_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(1800).default(1800),
    GENERATION_REPAIR_LIMIT: z.coerce.number().int().min(0).max(3).default(3),
    GENERATION_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
    GATEWAY_PORT: z.coerce.number().default(4101),
    SANDBOX_IMAGE: z.string().default('ai-games-sandbox:1'),
  })
  .superRefine((config, ctx) => {
    if (
      config.APP_INTEGRITY_MODE === 'local-development' &&
      (config.APP_ENV === 'production' ||
        !['127.0.0.1', '::1', 'localhost'].includes(config.API_HOST))
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'App attestation can only be bypassed in explicit local development on a loopback API host.',
      });
    if (config.APP_ENV === 'production' && config.APPLE_APP_ATTEST_ENVIRONMENT === 'development')
      ctx.addIssue({
        code: 'custom',
        message: 'Production rejects development Apple attestations.',
      });
    if (config.APP_ENV !== 'production') return;
    const reject = (key: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [key], message });
    if (config.DATABASE_URL === 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
      reject('DATABASE_URL', 'Production requires its own database credentials.');
    if (!config.ARTIFACT_ROOT.startsWith('/'))
      reject('ARTIFACT_ROOT', 'Production requires an absolute persistent artifact path.');
    for (const key of ['PACKAGE_SIGNING_KEY_FILE', 'PACKAGE_PUBLIC_KEY_FILE'] as const) {
      if (!config[key].startsWith('/'))
        reject(key, 'Production requires an absolute production key path.');
    }
    if (config.ANALYTICS_ENVIRONMENT !== 'production')
      reject('ANALYTICS_ENVIRONMENT', 'Production analytics must be labelled production.');
    // Auth may use private loopback ingress on a private server; public mobile URLs require HTTPS separately.
    if (!config.OPENROUTER_API_KEY)
      reject('OPENROUTER_API_KEY', 'Production generation requires its own provider key.');
  });
export type Config = z.infer<typeof configSchema>;

export function runtimeConfig(environment: Record<string, string | undefined>): Config {
  if (environment.NODE_ENV === 'production' && environment.APP_ENV !== 'production')
    throw new Error('Production servers require explicit APP_ENV=production.');
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid server configuration: ${keys.join(', ')}. See docs/ENVIRONMENTS.md.`);
  }
  return result.data;
}
