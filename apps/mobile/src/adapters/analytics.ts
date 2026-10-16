import { PostHog } from 'posthog-react-native';
import { Platform } from 'react-native';
import {
  analyticsError,
  analyticsProperties,
  redactExceptionProperties,
  noAnalytics,
  safeAnalytics,
  type AnalyticsProperties,
} from '../../../../packages/application/src/analytics.ts';
const key = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const enabled = Boolean(key) && process.env.EXPO_PUBLIC_POSTHOG_ENABLED !== 'false';
const metadata = (properties: AnalyticsProperties = {}) =>
  analyticsProperties({
    ...properties,
    service: 'mobile',
    platform: Platform.OS,
    environment: process.env.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT || 'development',
    release: process.env.EXPO_PUBLIC_APP_RELEASE || '0.1.0',
  });
function createPostHog() {
  if (!enabled) return undefined;
  try {
    const client = new PostHog(key!, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      flushAt: 20,
      flushInterval: 10000,
      maxQueueSize: 1000,
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      errorTracking: {
        exceptionSteps: { enabled: false },
        autocapture: {
          uncaughtExceptions: true,
          unhandledRejections: true,
          console: false,
          nativeCrashes: true,
          androidNdkCrashes: true,
        },
      },
      before_send(event) {
        if (!event) return event;
        if (event.event === '$exception' && event.properties) {
          redactExceptionProperties(event.properties);
          Object.assign(event.properties, metadata());
        }
        return event;
      },
    });
    // Clear a persisted identity before resolving the current Supabase session.
    // SDK reset preserves queued events with their original captured identities.
    client.reset();
    return client;
  } catch {
    return undefined;
  }
}
export const posthog = createPostHog();
export const mobileAnalytics = posthog
  ? safeAnalytics({
      capture(event, distinctId, properties) {
        if (distinctId !== currentAccount) return;
        posthog.capture(event, metadata(properties));
      },
      identify(distinctId, properties) {
        posthog.identify(distinctId, metadata(properties));
      },
      exception(error, distinctId, properties) {
        if (distinctId !== currentAccount) return;
        posthog.captureException(analyticsError(error), metadata(properties));
      },
      async flush() {
        await posthog.flush();
        return true;
      },
      async shutdown() {
        await posthog.shutdown();
      },
    })
  : noAnalytics;
let currentAccount = 'guest';
export function analyticsAccount(account: string) {
  if (account === currentAccount) return;
  // Queued events retain their captured identity; the next guest gets a fresh anonymous ID.
  try {
    if (currentAccount !== 'guest') posthog?.reset();
  } catch {
    /* Analytics must not block authentication. */
  }
  currentAccount = account;
  if (account !== 'guest') mobileAnalytics.identify(account);
}
export function captureMobile(event: string, properties: AnalyticsProperties = {}) {
  mobileAnalytics.capture(event, currentAccount, properties);
}
export function captureMobileError(error: unknown, properties: AnalyticsProperties = {}) {
  mobileAnalytics.exception(error, currentAccount, properties);
}
export function flushMobile() {
  void mobileAnalytics.flush();
}
