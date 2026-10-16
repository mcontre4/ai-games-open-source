export type AppEnvironment = 'development' | 'production';
export type EnvironmentValues = Record<string, string | undefined>;

export function appIntegrityMode(value: string | undefined) {
  const mode = value || 'required';
  if (!['required', 'local-development', 'disabled'].includes(mode))
    throw new Error('Invalid app attestation mode.');
  return mode;
}

export function appEnvironment(value: string | undefined): AppEnvironment {
  if (value !== 'development' && value !== 'production')
    throw new Error('Select APP_ENV=development or APP_ENV=production explicitly.');
  return value;
}

export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '10.0.2.2' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    (host.includes(':') && /^(fc|fd|fe80:|::ffff:)/.test(host))
  );
}

export function validateEndpoint(
  value: string | undefined,
  environment: AppEnvironment,
  key: string,
) {
  let url: URL;
  try {
    url = new URL(value || '');
  } catch {
    throw new Error(`Set a valid ${key} for ${environment}.`);
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`${key} must not contain credentials, a query or a fragment.`);
  if (environment === 'production') {
    if (url.protocol !== 'https:' || isLocalHost(url.hostname) || url.hostname.endsWith('.invalid'))
      throw new Error(`${key} must use a public production HTTPS endpoint.`);
  } else if (!['http:', 'https:'].includes(url.protocol) || !isLocalHost(url.hostname)) {
    throw new Error(`${key} must point to localhost or a private development host.`);
  }
}

export const mobilePublicKeys = [
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_APP_INTEGRITY_MODE',
  'EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_PACKAGE_SIGNING_KEY',
  'EXPO_PUBLIC_POSTHOG_API_KEY',
  'EXPO_PUBLIC_POSTHOG_HOST',
  'EXPO_PUBLIC_POSTHOG_ENABLED',
  'EXPO_PUBLIC_ANALYTICS_ENVIRONMENT',
  'EXPO_PUBLIC_APP_RELEASE',
] as const;

export function validateMobileEnvironment(values: EnvironmentValues, environment: AppEnvironment) {
  if (values.EXPO_PUBLIC_APP_ENV !== environment)
    throw new Error('Mobile environment marker does not match the selected mode.');
  if (
    environment === 'production' &&
    appIntegrityMode(values.EXPO_PUBLIC_APP_INTEGRITY_MODE) === 'local-development'
  )
    throw new Error('Production rejects local-development app attestation bypass.');
  appIntegrityMode(values.EXPO_PUBLIC_APP_INTEGRITY_MODE);
  for (const key of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_URL'])
    validateEndpoint(values[key], environment, key);
  if (!values.EXPO_PUBLIC_SUPABASE_ANON_KEY)
    throw new Error('Set the public Supabase anonymous key.');
  if (!/^[a-f0-9]{64}$/i.test(values.EXPO_PUBLIC_PACKAGE_SIGNING_KEY || ''))
    throw new Error('Set the 32-byte public package signing key as hex.');
  if (values.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT !== environment)
    throw new Error('Mobile analytics environment does not match the selected mode.');
}
