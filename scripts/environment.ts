import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { configSchema } from '../packages/config/src/index.ts';
import {
  mobilePublicKeys,
  validateMobileEnvironment,
  validateEndpoint,
  type AppEnvironment,
  type EnvironmentValues,
} from '../packages/config/src/environment.ts';

export function readEnvironmentFile(path: string): EnvironmentValues {
  return parseEnv(readFileSync(path, 'utf8'));
}

// Remove all application configuration inherited from another terminal/mode.
// Keep OS tooling variables (PATH, HOME, etc.) without forwarding server secrets to Expo.
export function cleanEnvironment(inherited: EnvironmentValues): EnvironmentValues {
  const tooling = new Set([
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'TERM',
    'COLORTERM',
    'CI',
    'FORCE_COLOR',
    'NO_COLOR',
    'PNPM_HOME',
    'ANDROID_HOME',
    'ANDROID_SDK_ROOT',
    'JAVA_HOME',
    'DEVELOPER_DIR',
    'SDKROOT',
    'EXPO_NO_TYPESCRIPT_SETUP',
  ]);
  return Object.fromEntries(Object.entries(inherited).filter(([key]) => tooling.has(key)));
}

export function loadEnvironment(
  environment: AppEnvironment,
  target: 'server' | 'mobile',
  root = process.cwd(),
  inherited: EnvironmentValues = process.env,
): EnvironmentValues {
  const specific = resolve(root, target === 'mobile' ? 'apps/mobile' : '.', `.env.${environment}`);
  // Only development accepts the old file, and only after verifying its local targets.
  const legacy = resolve(root, target === 'mobile' ? 'apps/mobile/.env' : '.env');
  const path = existsSync(specific) ? specific : environment === 'development' ? legacy : specific;
  if (!existsSync(path)) throw new Error(`Missing ${specific}. See docs/ENVIRONMENTS.md.`);
  const file = readEnvironmentFile(path);
  if (target === 'mobile') {
    const unexpected = Object.keys(file).filter(
      (key) => !mobilePublicKeys.includes(key as (typeof mobilePublicKeys)[number]),
    );
    if (unexpected.length)
      throw new Error(
        `Mobile configuration contains unsupported variables: ${unexpected.join(', ')}.`,
      );
    const values = {
      ...file,
      EXPO_PUBLIC_APP_ENV: file.EXPO_PUBLIC_APP_ENV || 'development',
      EXPO_PUBLIC_ANALYTICS_ENVIRONMENT: file.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT || 'development',
    };
    validateMobileEnvironment(values, environment);
    const build: EnvironmentValues = {};
    build.APPLE_APP_ATTEST_ENVIRONMENT =
      environment === 'production'
        ? 'production'
        : inherited.APPLE_APP_ATTEST_ENVIRONMENT || 'development';
    if (inherited.POSTHOG_UPLOAD_SOURCEMAPS === 'true') {
      for (const key of [
        'POSTHOG_UPLOAD_SOURCEMAPS',
        'POSTHOG_CLI_HOST',
        'POSTHOG_CLI_PROJECT_ID',
        'POSTHOG_CLI_API_KEY',
      ])
        build[key] = inherited[key];
    }
    return {
      ...cleanEnvironment(inherited),
      ...build,
      ...values,
      APP_ENV: environment,
      NODE_ENV: environment,
      EXPO_NO_DOTENV: '1',
    };
  }
  const values = { ...file, APP_ENV: file.APP_ENV || 'development' };
  if (values.APP_ENV !== environment)
    throw new Error('Server environment marker does not match the selected mode.');
  if (environment === 'development') {
    if (file.EXPO_PUBLIC_API_URL)
      validateEndpoint(file.EXPO_PUBLIC_API_URL, environment, 'EXPO_PUBLIC_API_URL');
    validateEndpoint(file.SUPABASE_URL, environment, 'SUPABASE_URL');
    const database = new URL(file.DATABASE_URL || '');
    validateEndpoint(`http://${database.host}`, environment, 'DATABASE_URL host');
  }
  // Validate before starting services; avoid printing credential-bearing Zod inputs.
  if (!configSchema.safeParse(values).success)
    throw new Error(`Invalid ${environment} server configuration. Check docs/ENVIRONMENTS.md.`);
  return { ...cleanEnvironment(inherited), ...values, NODE_ENV: environment };
}

export function loadDevelopmentTestEnvironment(root = process.cwd()): void {
  if (process.env.APP_ENV === 'production')
    throw new Error('Tests cannot run with production configuration.');
  const path = resolve(
    root,
    existsSync(resolve(root, '.env.development')) ? '.env.development' : '.env',
  );
  const values = existsSync(path) ? readEnvironmentFile(path) : { ...process.env };
  if (values.APP_ENV && values.APP_ENV !== 'development')
    throw new Error('Tests require development configuration.');
  if (values.SUPABASE_URL) validateEndpoint(values.SUPABASE_URL, 'development', 'SUPABASE_URL');
  if (values.EXPO_PUBLIC_API_URL)
    validateEndpoint(values.EXPO_PUBLIC_API_URL, 'development', 'EXPO_PUBLIC_API_URL');
  if (values.DATABASE_URL) {
    const database = new URL(values.DATABASE_URL);
    validateEndpoint(`http://${database.host}`, 'development', 'DATABASE_URL host');
  }
  for (const key of Object.keys(process.env)) {
    if (key in configSchema.shape || key.startsWith('EXPO_PUBLIC_')) delete process.env[key];
  }
  Object.assign(process.env, values, {
    APP_ENV: 'development',
    POSTHOG_ENABLED: 'false',
    EXPO_PUBLIC_APP_ENV: 'development',
    EXPO_PUBLIC_POSTHOG_ENABLED: 'false',
    EXPO_NO_DOTENV: '1',
    OPENROUTER_API_KEY: '',
  });
}
