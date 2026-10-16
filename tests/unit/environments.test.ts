import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { configSchema, runtimeConfig } from '../../packages/config/src/index.ts';
import { appIntegrityMode, validateEndpoint } from '../../packages/config/src/environment.ts';
import {
  cleanEnvironment,
  loadEnvironment,
  loadDevelopmentTestEnvironment,
} from '../../scripts/environment.ts';
import appConfig from '../../apps/mobile/app.config.ts';

const roots: string[] = [];
function root() {
  const path = mkdtempSync(join(tmpdir(), 'ai-games-env-'));
  roots.push(path);
  mkdirSync(join(path, 'apps/mobile'), { recursive: true });
  mkdirSync(join(path, 'environments'), { recursive: true });
  return path;
}
// Explicit public test configuration; no connection to a deployed service.
const publicProduction = `EXPO_PUBLIC_APP_ENV=production
EXPO_PUBLIC_APP_INTEGRITY_MODE=required
EXPO_PUBLIC_API_URL=https://api.example.com
EXPO_PUBLIC_SUPABASE_URL=https://auth.example.com
EXPO_PUBLIC_SUPABASE_ANON_KEY=explicit-public-test-fixture
EXPO_PUBLIC_PACKAGE_SIGNING_KEY=${'ab'.repeat(32)}
EXPO_PUBLIC_POSTHOG_ENABLED=false
EXPO_PUBLIC_ANALYTICS_ENVIRONMENT=production
`;
const productionValues = parseEnv(publicProduction);
afterEach(() => {
  roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});

describe('environment isolation', () => {
  it('enables protective limits by default and accepts independent explicit opt-outs', () => {
    const keys = [
      'GENERATION_DAILY_LIMIT_ENABLED',
      'MODIFICATION_DAILY_LIMIT_ENABLED',
      'GENERATION_CONCURRENT_LIMIT_ENABLED',
      'OPENROUTER_JOB_COST_LIMIT_ENABLED',
      'OPENROUTER_DAILY_COST_LIMIT_ENABLED',
      'API_RATE_LIMIT_ENABLED',
      'APP_INTEGRITY_CHALLENGE_LIMIT_ENABLED',
      'GENERATION_CREDITS_ENABLED',
      'OPENROUTER_ESTIMATED_COST_ENABLED',
    ] as const;
    const credentials = {
      SUPABASE_ANON_KEY: 'fixture-public',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-private',
    };
    const defaults = configSchema.parse(credentials);
    for (const key of keys) {
      expect(defaults[key]).toBe('true');
      const enabled = configSchema.parse({ ...credentials, [key]: 'false' });
      expect(enabled[key]).toBe('false');
      for (const other of keys.filter((candidate) => candidate !== key))
        expect(enabled[other]).toBe('true');
      expect(configSchema.safeParse({ ...credentials, [key]: 'yes' }).success).toBe(false);
    }
    for (const path of ['.env.example', '.env.production.example']) {
      const example = parseEnv(readFileSync(path, 'utf8'));
      for (const key of keys) expect(example[key]).toBe('true');
    }
  });

  it('rejects an implicit development server in a production Node process', () => {
    expect(() => runtimeConfig({ NODE_ENV: 'production' })).toThrow('explicit APP_ENV');
  });
  it('loads contributor-owned production settings and never forwards inherited secrets to Expo', () => {
    const path = root();
    writeFileSync(join(path, 'apps/mobile/.env.production'), publicProduction);
    writeFileSync(join(path, 'apps/mobile/.env'), 'EXPO_PUBLIC_API_URL=http://localhost:4100');
    const env = loadEnvironment('production', 'mobile', path, {
      PATH: '/bin',
      OPENROUTER_API_KEY: 'secret',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
      DATABASE_URL: 'secret',
      AWS_SECRET_ACCESS_KEY: 'secret',
      EXPO_PUBLIC_API_URL: 'http://localhost:4100',
      POSTHOG_CLI_API_KEY: 'secret',
    });
    expect(env.EXPO_PUBLIC_API_URL).toBe('https://api.example.com');
    expect(env.APP_ENV).toBe('production');
    expect(env.EXPO_NO_DOTENV).toBe('1');
    expect(Object.values(env)).not.toContain('secret');
    expect(env.PATH).toBe('/bin');
  });

  it('rejects private configuration in a mobile file', () => {
    const path = root();
    writeFileSync(
      join(path, 'apps/mobile/.env.production'),
      publicProduction + 'OPENROUTER_API_KEY=secret\n',
    );
    expect(() => loadEnvironment('production', 'mobile', path, {})).toThrow(
      'unsupported variables',
    );
  });

  it('refuses missing production server configuration instead of using the local file', () => {
    const path = root();
    writeFileSync(join(path, '.env'), 'DATABASE_URL=postgresql://localhost/dev');
    expect(() => loadEnvironment('production', 'server', path, {})).toThrow('Missing');
  });

  it('refuses production destinations and mismatched markers in development', () => {
    const path = root();
    writeFileSync(
      join(path, 'apps/mobile/.env.development'),
      publicProduction.replaceAll('=production', '=development'),
    );
    expect(() => loadEnvironment('development', 'mobile', path, {})).toThrow('development host');
    writeFileSync(join(path, 'apps/mobile/.env.development'), publicProduction);
    expect(() => loadEnvironment('development', 'mobile', path, {})).toThrow('marker');
  });

  it.each([
    'http://api.example.com',
    'https://localhost',
    'https://127.1',
    'https://10.0.2.2',
    'https://192.168.1.2',
    'https://[::1]',
    'https://[fd00::1]',
    'https://creation-api.invalid',
    'https://user:secret@example.com',
  ])('rejects unsafe production endpoint %s', (value) => {
    expect(() => validateEndpoint(value, 'production', 'API')).toThrow();
  });

  it('requires independent database credentials, production storage paths and a live provider in prod', () => {
    expect(
      configSchema.safeParse({
        APP_ENV: 'production',
        SUPABASE_ANON_KEY: 'public',
        SUPABASE_SERVICE_ROLE_KEY: 'private',
      }).success,
    ).toBe(false);
    expect(
      configSchema.safeParse({
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://service:private@localhost/prod',
        SUPABASE_ANON_KEY: 'public',
        SUPABASE_SERVICE_ROLE_KEY: 'private',
        ARTIFACT_ROOT: '/srv/data/artifacts',
        PACKAGE_SIGNING_KEY_FILE: '/srv/data/private.pem',
        PACKAGE_PUBLIC_KEY_FILE: '/srv/data/public.pem',
        ANALYTICS_ENVIRONMENT: 'production',
        OPENROUTER_API_KEY: 'private-provider',
      }).success,
    ).toBe(true);
  });

  it('refuses destructive test harnesses when inherited configuration is production', () => {
    vi.stubEnv('APP_ENV', 'production');
    expect(() => loadDevelopmentTestEnvironment(root())).toThrow('Tests cannot run');
  });

  it('reserves estimated costs by default and accepts an explicit opt-out in production', () => {
    const values = {
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://service:private@localhost/prod',
      SUPABASE_ANON_KEY: 'public',
      SUPABASE_SERVICE_ROLE_KEY: 'private',
      ARTIFACT_ROOT: '/srv/data/artifacts',
      PACKAGE_SIGNING_KEY_FILE: '/srv/data/private.pem',
      PACKAGE_PUBLIC_KEY_FILE: '/srv/data/public.pem',
      ANALYTICS_ENVIRONMENT: 'production',
      OPENROUTER_API_KEY: 'private-provider',
    };
    expect(configSchema.parse(values).OPENROUTER_ESTIMATED_COST_ENABLED).toBe('true');
    expect(
      configSchema.parse({ ...values, OPENROUTER_ESTIMATED_COST_ENABLED: 'false' })
        .OPENROUTER_ESTIMATED_COST_ENABLED,
    ).toBe('false');
    expect(
      configSchema.safeParse({ ...values, OPENROUTER_ESTIMATED_COST_ENABLED: 'off' }).success,
    ).toBe(false);
  });

  it('only retains OS and native build tooling from the parent environment', () => {
    expect(
      cleanEnvironment({
        PATH: '/bin',
        ANDROID_HOME: '/sdk',
        APP_ENV: 'production',
        EXPO_PUBLIC_UNKNOWN: 'secret',
        CUSTOM_CREDENTIAL: 'secret',
      }),
    ).toEqual({ PATH: '/bin', ANDROID_HOME: '/sdk' });
  });
});

describe('native app variants', () => {
  it.each(['required', 'disabled'] as const)(
    'builds production with attestation %s and preserves unrelated entitlements',
    (mode) => {
      for (const [key, value] of Object.entries(productionValues)) vi.stubEnv(key, value);
      vi.stubEnv('APP_ENV', 'production');
      vi.stubEnv('EXPO_PUBLIC_APP_INTEGRITY_MODE', mode);
      const entitlement = 'com.apple.developer.devicecheck.appattest-environment';
      const result = appConfig({
        config: {
          name: 'AI Games',
          slug: 'ai-games',
          ios: { entitlements: { [entitlement]: 'development', 'aps-environment': 'development' } },
        },
        projectRoot: '.',
        staticConfigPath: null,
        packageJsonPath: null,
      });
      expect(result.ios?.entitlements?.[entitlement]).toBe(
        mode === 'required' ? 'production' : undefined,
      );
      expect(result.ios?.entitlements?.['aps-environment']).toBe('development');
      expect(result.ios?.bundleIdentifier).toBe('com.aigames.creator');
    },
  );

  it('defaults to required and rejects unknown attestation switches', () => {
    expect(appIntegrityMode(undefined)).toBe('required');
    expect(() => appIntegrityMode('false')).toThrow('Invalid');
  });

  it('separates bundle IDs, schemes and local transport settings', () => {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development');
    const dev = appConfig({
      config: { name: 'AI Games', slug: 'ai-games' },
      projectRoot: '.',
      staticConfigPath: null,
      packageJsonPath: null,
    });
    expect(dev.name).toBe('AI Games Dev');
    expect(dev.ios?.bundleIdentifier).toBe('com.aigames.creator.dev');
    expect(dev.android?.package).toBe('com.aigames.creator.dev');
    expect(dev.scheme).toBe('aigames-dev');
    for (const [key, value] of Object.entries(productionValues)) vi.stubEnv(key, value);
    vi.stubEnv('APP_ENV', 'production');
    const prod = appConfig({
      config: { name: 'AI Games', slug: 'ai-games' },
      projectRoot: '.',
      staticConfigPath: null,
      packageJsonPath: null,
    });
    expect(prod.ios?.bundleIdentifier).toBe('com.aigames.creator');
    expect(prod.android?.package).toBe('com.aigames.creator');
    expect(prod.scheme).toBe('aigames');
    expect(prod.ios?.infoPlist?.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false });
  });

  it('validates production builds even if Expo is called without the launcher', () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_INTEGRITY_MODE', 'required');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://127.0.0.1:4100');
    expect(() =>
      appConfig({
        config: { name: 'AI Games', slug: 'ai-games' },
        projectRoot: '.',
        staticConfigPath: null,
        packageJsonPath: null,
      }),
    ).toThrow('HTTPS');
  });

  it('rejects an attestation bypass in a production native build', () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_INTEGRITY_MODE', 'local-development');
    expect(() =>
      appConfig({
        config: { name: 'AI Games', slug: 'ai-games' },
        projectRoot: '.',
        staticConfigPath: null,
        packageJsonPath: null,
      }),
    ).toThrow('attestation');
  });

  it('requires contributor-supplied production endpoints and keeps EAS profiles free of deployment keys', () => {
    const path = root();
    writeFileSync(join(path, 'environments/production.mobile.env'), publicProduction);
    expect(() => loadEnvironment('production', 'mobile', path, {})).toThrow('Missing');
    const eas = JSON.parse(readFileSync('apps/mobile/eas.json', 'utf8'));
    for (const profile of ['preview', 'production']) {
      expect(eas.build[profile].environment).toBe('production');
      expect(eas.build[profile].env.EXPO_PUBLIC_APP_INTEGRITY_MODE).toBe('required');
      for (const key of [
        'EXPO_PUBLIC_API_URL',
        'EXPO_PUBLIC_SUPABASE_URL',
        'EXPO_PUBLIC_SUPABASE_ANON_KEY',
        'EXPO_PUBLIC_PACKAGE_SIGNING_KEY',
      ])
        expect(eas.build[profile].env).not.toHaveProperty(key);
    }
    expect(eas.build.development.environment).toBe('development');
  });
});
