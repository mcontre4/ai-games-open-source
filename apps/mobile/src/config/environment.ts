import { validateMobileEnvironment } from '../../../../packages/config/src/environment.ts';

export const mobileEnvironment = process.env.EXPO_PUBLIC_APP_ENV || 'development';
if (!['development', 'production', 'test'].includes(mobileEnvironment))
  throw new Error('Invalid mobile environment.');
if (mobileEnvironment === 'production') {
  // Keep static property access: Expo inlines these values at bundle time.
  validateMobileEnvironment(
    {
      EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
      EXPO_PUBLIC_APP_INTEGRITY_MODE: process.env.EXPO_PUBLIC_APP_INTEGRITY_MODE,
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      EXPO_PUBLIC_PACKAGE_SIGNING_KEY: process.env.EXPO_PUBLIC_PACKAGE_SIGNING_KEY,
      EXPO_PUBLIC_ANALYTICS_ENVIRONMENT: process.env.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT,
    },
    'production',
  );
}
export const appScheme = mobileEnvironment === 'production' ? 'aigames' : 'aigames-dev';
export const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:4100';
export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
