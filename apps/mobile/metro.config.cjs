const { getPostHogExpoConfig } = require('posthog-react-native/metro');
const path = require('path');
const config = getPostHogExpoConfig(__dirname);
// Public configuration is inlined into bundles; isolate caches across test/local exports.
config.cacheVersion = require('node:crypto')
  .createHash('sha256')
  .update(
    JSON.stringify([
      process.env.EXPO_PUBLIC_APP_ENV,
      process.env.EXPO_PUBLIC_API_URL,
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      process.env.EXPO_PUBLIC_PACKAGE_SIGNING_KEY,
      process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
      process.env.EXPO_PUBLIC_POSTHOG_HOST,
      process.env.EXPO_PUBLIC_POSTHOG_ENABLED,
      process.env.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT,
      process.env.EXPO_PUBLIC_APP_RELEASE,
    ]),
  )
  .digest('hex');
config.watchFolders = [path.resolve(__dirname, '../..')];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../../node_modules'),
];
config.resolver.assetExts.push('zip');
module.exports = config;
