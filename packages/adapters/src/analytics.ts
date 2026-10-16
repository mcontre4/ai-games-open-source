import { PostHog } from 'posthog-node';
import type { Config } from '../../config/src/index.ts';
import {
  analyticsError,
  analyticsProperties,
  redactExceptionProperties,
  noAnalytics,
  safeAnalytics,
  type AnalyticsPort,
  type AnalyticsProperties,
} from '../../application/src/analytics.ts';

export function createAnalytics(
  config: Config,
  service: string,
  transport: typeof fetch = fetch,
  durable = false,
): AnalyticsPort {
  if (!config.POSTHOG_API_KEY || config.POSTHOG_ENABLED === 'false') return noAnalytics;
  let client: PostHog;
  try {
    client = new PostHog(config.POSTHOG_API_KEY, {
      fetch: transport,
      host: config.POSTHOG_HOST,
      flushAt: durable ? 101 : 20,
      flushInterval: durable ? 0 : 10000,
      requestTimeout: 5000,
      fetchRetryCount: 2,
      maxQueueSize: 1000,
      before_send(event) {
        if (event?.event === '$exception' && event.properties)
          redactExceptionProperties(event.properties);
        return event;
      },
      enableExceptionAutocapture: false,
      disableGeoip: true,
    });
  } catch {
    console.warn(JSON.stringify({ event: 'analytics_initialization_failed', service }));
    return noAnalytics;
  }
  client.on('error', () =>
    console.warn(JSON.stringify({ event: 'analytics_delivery_failed', service })),
  );
  const metadata = (properties?: AnalyticsProperties) =>
    analyticsProperties({
      ...properties,
      service,
      environment: config.ANALYTICS_ENVIRONMENT,
      release: config.APP_RELEASE,
    });
  return safeAnalytics({
    capture(event, distinctId, properties) {
      client.capture({
        event,
        distinctId,
        ...(typeof properties?.occurred_at === 'string' &&
        Number.isFinite(Date.parse(properties.occurred_at))
          ? { timestamp: new Date(properties.occurred_at) }
          : {}),
        ...(typeof properties?.event_id === 'string' ? { uuid: properties.event_id } : {}),
        properties: {
          ...metadata(properties),
          ...(distinctId.startsWith('anonymous:') || distinctId.startsWith('system:')
            ? { $process_person_profile: false }
            : {}),
          ...(properties?.event_id ? { $insert_id: properties.event_id } : {}),
        },
      });
    },
    identify(distinctId, properties) {
      client.identify({ distinctId, properties: metadata(properties) });
    },
    exception(error, distinctId, properties) {
      client.captureException(analyticsError(error), distinctId, {
        ...metadata(properties),
        ...(distinctId.startsWith('anonymous:') || distinctId.startsWith('system:')
          ? { $process_person_profile: false }
          : {}),
      });
    },
    async flush() {
      await client.flush();
      return true;
    },
    async shutdown() {
      await client.shutdown(5000);
    },
  });
}
/** Fatal errors are flushed without swallowing the process failure. */
export function installFatalAnalytics(analytics: AnalyticsPort, service: string) {
  const fatal = (error: unknown) => {
    analytics.exception(error, `system:${service}`, { operation: 'process_fatal' });
    void analytics.shutdown().finally(() => process.exit(1));
  };
  process.once('uncaughtException', fatal);
  process.once('unhandledRejection', fatal);
}
