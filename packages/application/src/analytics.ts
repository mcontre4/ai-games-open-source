/** Telemetry carries metadata only; never prompts, credentials, saves or game source. */
export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;
export interface AnalyticsPort {
  capture(event: string, distinctId: string, properties?: AnalyticsProperties): void;
  identify(distinctId: string, properties?: AnalyticsProperties): void;
  exception(error: unknown, distinctId: string, properties?: AnalyticsProperties): void;
  flush(): Promise<boolean>;
  shutdown(): Promise<void>;
}
export const noAnalytics: AnalyticsPort = {
  capture() {},
  identify() {},
  exception() {},
  async flush() {
    return false;
  },
  async shutdown() {},
};
/** Also protects application code from a faulty/custom adapter. */
export function safeAnalytics(port: AnalyticsPort = noAnalytics): AnalyticsPort {
  return {
    capture(...args) {
      try {
        port.capture(...args);
      } catch {
        /* Telemetry is best effort. */
      }
    },
    identify(...args) {
      try {
        port.identify(...args);
      } catch {
        /* Telemetry is best effort. */
      }
    },
    exception(...args) {
      try {
        port.exception(...args);
      } catch {
        /* Telemetry is best effort. */
      }
    },
    async flush() {
      try {
        return await port.flush();
      } catch {
        return false;
      }
    },
    async shutdown() {
      try {
        await port.shutdown();
      } catch {
        /* Bounded by the adapter. */
      }
    },
  };
}
const keys = new Set([
  'event_id',
  'service',
  'environment',
  'release',
  'platform',
  'request_id',
  'method',
  'route',
  'status_code',
  'duration_ms',
  'error_code',
  'operation',
  'game_id',
  'version_id',
  'generation_id',
  'kind',
  'stage',
  'previous_stage',
  'stage_duration_ms',
  'queue_wait_ms',
  'total_duration_ms',
  'attempt',
  'orientation',
  'fixture',
  'package_bytes',
  'version_number',
  'revision',
  'schema_version',
  'score',
  'share_id',
  'creator_id',
  'source',
  'success',
  'first_play',
  'play_session_id',
  'active_duration_ms',
  'end_reason',
  'authenticated',
  'count',
  'email_confirmed',
]);
export function analyticsProperties(
  properties: AnalyticsProperties = {},
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        keys.has(key) &&
        value !== undefined &&
        (value === null ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && value.length <= 200)),
    ),
  ) as Record<string, string | number | boolean | null>;
}
/** Preserve stack locations and error type, but never send untrusted error messages. */
export function analyticsError(error: unknown): Error {
  const name =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_.]{0,80}$/.test(error.name)
      ? error.name
      : 'Error';
  const result = new Error(`${name}: details withheld`);
  result.name = name;
  if (error instanceof Error && error.stack) {
    const frames = error.stack
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .map((line) => line.replace(/https?:\/\/[^\s)]+/g, '[remote]').replace(/\?.*/g, ''));
    result.stack = `${name}: details withheld\n${frames.join('\n')}`;
  }
  return result;
}
/** SDKs enrich exceptions with source context after captureException; redact that too. */
export function redactExceptionProperties(properties: Record<string, unknown>): void {
  const list = properties.$exception_list;
  if (Array.isArray(list))
    properties.$exception_list = list.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return { type: 'Error', value: 'Details withheld' };
      const stacktrace = item.stacktrace;
      const frames =
        stacktrace && typeof stacktrace === 'object' && !Array.isArray(stacktrace)
          ? stacktrace.frames
          : undefined;
      return {
        type:
          typeof item.type === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,80}$/.test(item.type)
            ? item.type
            : 'Error',
        value: 'Details withheld',
        ...(Array.isArray(frames)
          ? {
              stacktrace: {
                type: 'raw',
                frames: frames.map((frame) => {
                  if (!frame || typeof frame !== 'object' || Array.isArray(frame))
                    return { filename: null, function: null, lineno: null, colno: null };
                  return {
                    filename:
                      typeof frame.filename === 'string'
                        ? (frame.filename
                            .split('?')[0]
                            ?.replace(/https?:\/\/[^/]+/g, '[remote]')
                            .replace(/\/Users\/[^/]+\//g, '~/') ?? null)
                        : null,
                    function:
                      typeof frame.function === 'string' ? frame.function.slice(0, 100) : null,
                    lineno: typeof frame.lineno === 'number' ? frame.lineno : null,
                    colno: typeof frame.colno === 'number' ? frame.colno : null,
                    ...(typeof frame.in_app === 'boolean' ? { in_app: frame.in_app } : {}),
                    ...(typeof frame.platform === 'string' ? { platform: frame.platform } : {}),
                  };
                }),
              },
            }
          : {}),
      };
    });
  for (const key of Object.keys(properties)) {
    if (key.startsWith('$exception') && !['$exception_list', '$exception_level'].includes(key))
      delete properties[key];
  }
}
