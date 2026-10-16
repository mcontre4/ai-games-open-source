import { expect, it, vi } from 'vitest';
import { createServer, type ServerDependencies } from '../../apps/api/src/server.ts';
import { DomainError } from '../../packages/domain/src/index.ts';
import { integrityIds } from '../integrity-fixture.ts';

it('accepts the installed native client’s empty JSON guest claim without weakening authentication or JSON validation', async () => {
  const issue = vi.fn(async () => {});
  const app = await createServer({
    integrity: { enabled: false }, // Explicit HTTP fixture, not native attestation.
    auth: {
      authenticate: async (token: string) => {
        if (token !== 'guest') throw new DomainError('UNAUTHENTICATED', 'Sign in.', 401);
        return { id: 'guest-id', anonymous: true, ageConfirmed: true };
      },
    },
    guests: { issue },
    ids: integrityIds,
    clock: { now: () => '2026-10-11T23:00:00.000Z' },
  } as unknown as ServerDependencies);
  try {
    for (const payload of [undefined, '', {}]) {
      const response = await app.inject({
        method: 'POST',
        url: '/guest/claim-token',
        headers: { authorization: 'Bearer guest', 'content-type': 'application/json' },
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ guestId: 'guest-id' });
    }
    expect(issue).toHaveBeenCalledTimes(3);
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/guest/claim-token',
      headers: { 'content-type': 'application/json' },
    });
    expect(unauthenticated.statusCode).toBe(401);
    const malformed = await app.inject({
      method: 'POST',
      url: '/guest/claim-token',
      headers: { authorization: 'Bearer guest', 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    const emptyCreation = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { authorization: 'Bearer guest', 'content-type': 'application/json' },
    });
    expect(emptyCreation.statusCode).toBe(400);
    expect(issue).toHaveBeenCalledTimes(3);
  } finally {
    await app.close();
  }
});
