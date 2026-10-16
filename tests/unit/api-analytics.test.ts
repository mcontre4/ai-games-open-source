import { it, expect } from 'vitest';
import { createServer, type ServerDependencies } from '../../apps/api/src/server.ts';
import { DomainError } from '../../packages/domain/src/index.ts';
import { noAnalytics } from '../../packages/application/src/analytics.ts';
import { game } from '../helpers.ts';

function dependencies() {
  const events: { event: string; distinctId: string; properties: Record<string, unknown> }[] = [];
  const errors: unknown[] = [];
  let identity = 0;
  const d = {
    analytics: {
      ...noAnalytics,
      capture(event: string, distinctId: string, properties: Record<string, unknown> = {}) {
        events.push({ event, distinctId, properties });
      },
      exception(error: unknown) {
        errors.push(error);
      },
    },
    integrity: { enabled: false }, // Explicit analytics fixture, never a live attestation verdict.
    auth: {
      authenticate: async (token: string) => {
        if (token !== 'valid') throw new DomainError('UNAUTHENTICATED', 'No', 401);
        return {
          id: 'user-one',
          email: 'private@example.com',
          createdAt: game.createdAt,
          ageConfirmed: true,
        };
      },
    },
    games: { list: async () => [game], accessible: async () => game },
    generations: { reserve: async () => {} },
    clock: { now: () => new Date().toISOString() },
    ids: { next: (prefix: string) => `${prefix}_testing${++identity}` },
    policy: { available: true, newLimit: 5, modifyLimit: 5, jobCap: 1, dailyCap: 100 },
  } as unknown as ServerDependencies;
  return { d, events, errors };
}
it('tracks profile updates without copying profile contents into analytics', async () => {
  const { d, events } = dependencies();
  d.profiles = {
    update: async (_id, input) => ({ ...input, id: 'user-one', createdAt: game.createdAt }),
  } as ServerDependencies['profiles'];
  const app = await createServer(d);
  try {
    const response = await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: { authorization: 'Bearer valid' },
      payload: {
        username: 'private_username',
        displayName: 'Private Person',
        bio: 'Private biography',
        avatarId: 'blob',
        profileVisible: true,
        autoSync: true,
        leaderboardVisible: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(events.find((event) => event.event === 'account_profile_updated')).toMatchObject({
      distinctId: 'user-one',
    });
    expect(JSON.stringify(events)).not.toContain('private_username');
    expect(JSON.stringify(events)).not.toContain('Private');
  } finally {
    await app.close();
  }
});
it('captures every endpoint and latency, attributes only authenticated identities, and never leaks URLs/bodies', async () => {
  const { d, events } = dependencies();
  const app = await createServer(d);
  try {
    await app.inject({ url: '/health' });
    await app.inject({ url: '/me?token=private', headers: { authorization: 'Bearer valid' } });
    await app.inject({ url: '/me?token=private', headers: { authorization: 'Bearer forged' } });
    await app.inject({ url: '/secret-token-in-path' });
    const completed = events.filter((e) => e.event === 'api_request_completed');
    expect(completed).toHaveLength(4);
    expect(completed[1]).toMatchObject({
      distinctId: 'user-one',
      properties: { route: '/me', method: 'GET', status_code: 200 },
    });
    expect(completed[2]!.distinctId).toMatch(/^anonymous:/);
    expect(completed[3]!.properties.route).toBe('unmatched');
    for (const event of completed) expect(event.properties.duration_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(events)).not.toContain('private');
    expect(JSON.stringify(events)).not.toContain('secret-token');
    expect(events.filter((e) => e.event === 'api_request_failed')).toHaveLength(2);
  } finally {
    await app.close();
  }
});
it('emits successful mutation events with resource IDs, and does not claim failed mutations succeeded', async () => {
  const { d, events } = dependencies();
  const app = await createServer(d);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { authorization: 'Bearer valid' },
      payload: {
        prompt: 'Private game idea to exclude from all analytics.',
        orientation: 'portrait',
      },
    });
    expect(response.statusCode).toBe(202);
    expect(events.find((e) => e.event === 'game_creation_requested')).toMatchObject({
      distinctId: 'user-one',
      properties: { game_id: response.json().gameId, generation_id: response.json().generationId },
    });
    await app.inject({
      method: 'POST',
      url: '/games',
      headers: { authorization: 'Bearer valid' },
      payload: { prompt: 'invalid' },
    });
    expect(events.filter((e) => e.event === 'game_creation_requested')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('Private game');
  } finally {
    await app.close();
  }
});
it('reports unexpected errors and keeps requests successful when telemetry throws', async () => {
  const { d, events, errors } = dependencies();
  d.games.list = async () => {
    throw new Error('internal secret');
  };
  const app = await createServer(d);
  try {
    expect(
      (await app.inject({ url: '/games', headers: { authorization: 'Bearer valid' } })).statusCode,
    ).toBe(500);
    expect(errors).toHaveLength(1);
    expect(events.some((e) => e.event === 'api_request_failed')).toBe(true);
  } finally {
    await app.close();
  }
  d.analytics!.capture = () => {
    throw new Error('telemetry down');
  };
  d.analytics!.identify = () => {
    throw new Error('telemetry down');
  };
  const another = await createServer(d);
  try {
    expect(
      (await another.inject({ url: '/me', headers: { authorization: 'Bearer valid' } })).statusCode,
    ).toBe(200);
  } finally {
    await another.close();
  }
});

it.each([true, false])(
  'switches global and endpoint throttles together (enabled=%s)',
  async (enabled) => {
    const { d } = dependencies();
    const app = await createServer({ ...d, apiRateLimitEnabled: enabled });
    try {
      for (let request = 0; request < 120; request++) {
        expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
      }
      expect((await app.inject({ url: '/health' })).statusCode).toBe(enabled ? 429 : 200);
      for (let request = 0; request < 11; request++) {
        const response = await app.inject({
          method: 'POST',
          url: '/games',
          remoteAddress: '127.0.0.2',
          payload: {},
          headers: { authorization: 'Bearer valid' },
        });
        // The malformed creation still fails validation while throttling is off.
        expect(response.statusCode).toBe(enabled && request === 10 ? 429 : 400);
      }
    } finally {
      await app.close();
    }
  },
);
