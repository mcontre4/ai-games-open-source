import type { ConfigContext, ExpoConfig } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.APP_ENV || 'development';
  if (!['development', 'production', 'test'].includes(environment))
    throw new Error('Invalid APP_ENV.');
  if (environment === 'test' && process.env.CI !== '1')
    throw new Error('Test builds require CI=1.');
  const production = environment === 'production';
  // Expo evaluates this config independently of the application's TypeScript loader.
  const integrityMode = process.env.EXPO_PUBLIC_APP_INTEGRITY_MODE || 'required';
  if (!['required', 'local-development', 'disabled'].includes(integrityMode))
    throw new Error('Invalid app attestation mode.');
  const entitlements = { ...config.ios?.entitlements };
  const appAttestEntitlement = 'com.apple.developer.devicecheck.appattest-environment';
  delete entitlements[appAttestEntitlement];
  if (integrityMode === 'required')
    entitlements[appAttestEntitlement] = production
      ? 'production'
      : process.env.APPLE_APP_ATTEST_ENVIRONMENT || 'development';
  if (process.env.EXPO_PUBLIC_APP_ENV && process.env.EXPO_PUBLIC_APP_ENV !== environment)
    throw new Error('APP_ENV and EXPO_PUBLIC_APP_ENV must match.');
  if (production) {
    if (integrityMode === 'local-development')
      throw new Error('Production rejects local-development app attestation bypass.');
    for (const key of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_URL']) {
      const url = new URL(process.env[key] || '');
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host.endsWith('.invalid') ||
        host === '::1' ||
        host === '0.0.0.0' ||
        /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
        (host.includes(':') && /^(fc|fd|fe80:|::ffff:)/.test(host))
      )
        throw new Error(`${key} requires a public production HTTPS endpoint.`);
    }
    if (
      !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      !/^[a-f0-9]{64}$/i.test(process.env.EXPO_PUBLIC_PACKAGE_SIGNING_KEY || '') ||
      process.env.EXPO_PUBLIC_APP_ENV !== 'production' ||
      process.env.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT !== 'production'
    )
      throw new Error(
        'Production builds require explicit public Auth, signing key and environment configuration.',
      );
  }
  if (
    process.env.POSTHOG_UPLOAD_SOURCEMAPS === 'true' &&
    (!process.env.POSTHOG_CLI_API_KEY || !process.env.POSTHOG_CLI_PROJECT_ID)
  ) {
    throw new Error(
      'Source map uploads require private POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID build variables.',
    );
  }
  return {
    ...config,
    name: production ? 'AI Games' : 'AI Games Dev',
    slug: config.slug ?? 'ai-games',
    scheme: production ? 'aigames' : 'aigames-dev',
    ios: {
      ...config.ios,
      bundleIdentifier: production ? 'com.aigames.creator' : 'com.aigames.creator.dev',
      entitlements,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: production
          ? { NSAllowsArbitraryLoads: false }
          : { NSAllowsLocalNetworking: true },
      },
    },
    android: {
      ...config.android,
      package: production ? 'com.aigames.creator' : 'com.aigames.creator.dev',
    },
    // Public runtime keys stay in EXPO_PUBLIC_*; build-upload credentials are never extras.
    plugins: [
      ...(config.plugins ?? []),
      './plugins/with-ios-scene-lifecycle.cjs',
      ['expo-dev-client', { addGeneratedScheme: !production }],
      ...(process.env.POSTHOG_UPLOAD_SOURCEMAPS === 'true'
        ? [
            [
              'posthog-react-native/expo',
              { uploadNativeSymbols: true, skipOnConflict: true, disableSandboxing: false },
            ] as [string, Record<string, unknown>],
          ]
        : []),
    ],
  };
};
