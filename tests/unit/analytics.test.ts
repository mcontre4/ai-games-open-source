import { gunzipSync } from 'node:zlib';
import { it, expect, vi } from 'vitest';
import {
  analyticsError,
  analyticsProperties,
  noAnalytics,
  safeAnalytics,
  type AnalyticsPort,
} from '../../packages/application/src/analytics.ts';
import { playSession } from '../../packages/application/src/play-analytics.ts';
import { createAnalytics } from '../../packages/adapters/src/analytics.ts';
import { configSchema } from '../../packages/config/src/index.ts';

export function recorder() {
  return {
    ...noAnalytics,
    capture: vi.fn(),
    identify: vi.fn(),
    exception: vi.fn(),
    flush: vi.fn(async () => true),
  };
}
it('allowlists metadata and withholds secrets from exception messages and remote URL queries', () => {
  expect(
    analyticsProperties({
      game_id: 'game_test',
      prompt: 'secret',
      token: 'secret',
      state: 'secret',
      score: NaN,
      route: '/games/:id',
    }),
  ).toEqual({ game_id: 'game_test', route: '/games/:id' });
  const error = new Error('password=secret; prompt=private');
  error.stack =
    'Error: password=secret\n    at run (https://example.com/game.js?token=secret:1:1)\n    at local (/app/main.ts:10:2)';
  const clean = analyticsError(error);
  expect(clean.message).not.toContain('secret');
  expect(clean.stack).not.toContain('secret');
  expect(clean.stack).toContain('/app/main.ts:10:2');
});
it('does not let an unavailable analytics adapter fail the application', async () => {
  const fail = () => {
    throw new Error('PostHog unavailable');
  };
  const analytics = safeAnalytics({
    capture: fail,
    identify: fail,
    exception: fail,
    flush: async () => {
      fail();
      return true;
    },
    shutdown: async () => fail(),
  });
  expect(() => analytics.capture('event', 'user')).not.toThrow();
  expect(() => analytics.identify('user')).not.toThrow();
  expect(() => analytics.exception(new Error(), 'user')).not.toThrow();
  expect(await analytics.flush()).toBe(false);
  await expect(analytics.shutdown()).resolves.toBeUndefined();
});
it('records one real play per session, first/repeat metadata, and foreground time only', () => {
  const analytics = recorder();
  let now = 1000;
  const play = playSession(
    analytics,
    {
      accountId: 'user-one',
      gameId: 'game_test',
      versionId: 'ver_test',
      ownerId: 'creator',
      fixture: false,
      firstPlay: false,
      sessionId: 'session',
    },
    () => now,
  );
  now = 2000;
  play.ready();
  play.ready();
  now = 5000;
  play.activity(false);
  now = 15000;
  play.activity(true);
  now = 17000;
  play.end();
  play.end();
  expect(analytics.capture.mock.calls.map((c) => c[0])).toEqual([
    'game_play_started',
    'game_play_paused',
    'game_play_resumed',
    'game_play_ended',
  ]);
  expect(analytics.capture).toHaveBeenLastCalledWith(
    'game_play_ended',
    'user-one',
    expect.objectContaining({
      active_duration_ms: 5000,
      first_play: false,
      creator_id: 'creator',
      fixture: false,
    }),
  );
});
it('does not count a failed launch as a play and bounds hostile runtime error floods', () => {
  const analytics = recorder();
  const play = playSession(
    analytics,
    {
      accountId: 'guest',
      gameId: 'game_fixture',
      versionId: 'ver_fixture',
      ownerId: 'fixture',
      fixture: true,
      firstPlay: true,
      sessionId: 'session',
    },
    () => 0,
  );
  for (let i = 0; i < 100; i++) play.error(new Error('untrusted'));
  play.end();
  play.ready();
  expect(analytics.exception).toHaveBeenCalledTimes(5);
  expect(analytics.capture.mock.calls.some((c) => c[0] === 'game_play_started')).toBe(false);
});
it('uses the actual Node SDK to send sanitized events, identity, and PostHog exceptions', async () => {
  const bodies: string[] = [];
  const transport = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    if (options?.body) {
      const body = options.body;
      bodies.push(body instanceof Uint8Array ? gunzipSync(body).toString('utf8') : String(body));
    }
    return new Response('{"status":1}', { status: 200 });
  }) as typeof fetch;
  const config = configSchema.parse({
    SUPABASE_ANON_KEY: 'test',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    POSTHOG_API_KEY: 'phc_test',
    POSTHOG_ENABLED: 'true',
    ANALYTICS_ENVIRONMENT: 'test',
  });
  const analytics = createAnalytics(config, 'api', transport);
  analytics.capture('game_created', 'user-one', {
    game_id: 'game_test',
    prompt: 'private-prompt',
    token: 'secret-token',
  });
  analytics.identify('user-one');
  analytics.exception(new Error('secret-token private-prompt'), 'user-one', {
    route: '/games/:id',
    state: 'private-state',
  });
  expect(await analytics.flush()).toBe(true);
  await analytics.shutdown();
  const sent = bodies.join('');
  expect(sent).toContain('game_created');
  expect(sent).toContain('$identify');
  expect(sent).toContain('$exception');
  expect(sent).toContain('user-one');
  expect(sent).toContain('environment');
  expect(sent).not.toContain('private-prompt');
  expect(sent).not.toContain('secret-token');
  expect(sent).not.toContain('private-state');
});
it('disables capture entirely when explicitly disabled or no project key exists', async () => {
  const transport = vi.fn();
  const config = configSchema.parse({
    SUPABASE_ANON_KEY: 'test',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    POSTHOG_ENABLED: 'false',
    POSTHOG_API_KEY: 'phc_test',
  });
  const analytics: AnalyticsPort = createAnalytics(config, 'api', transport);
  analytics.capture('event', 'user');
  expect(await analytics.flush()).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});
