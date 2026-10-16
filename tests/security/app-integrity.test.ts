import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { configSchema } from '../../packages/config/src/index.ts';
import { DomainError } from '../../packages/domain/src/index.ts';
import { PlatformIntegrityVerifier } from '../../packages/adapters/src/integrity.ts';
import {
  IssueIntegrityChallenge,
  RegisterAppInstance,
  VerifyAppRequest,
  integrityPayload,
} from '../../packages/application/src/integrity.ts';
import { createServer, type ServerDependencies } from '../../apps/api/src/server.ts';
import {
  assertionFixture,
  fixtureUser,
  integrityClock,
  integrityIds,
  integritySettings,
  MemoryIntegrityRepository,
} from '../integrity-fixture.ts';

function setup() {
  const repository = new MemoryIntegrityRepository();
  const keys = assertionFixture();
  repository.instances.set(keys.instance.keyId, keys.instance);
  const verifier = new PlatformIntegrityVerifier(integritySettings, {
    decode: async () => {
      throw new Error('No live Google verdict in this fixture.');
    },
  });
  const issue = new IssueIntegrityChallenge(repository, integrityIds, integrityClock);
  const verify = new VerifyAppRequest(repository, verifier, integrityIds, integrityClock);
  let counter = 0;
  async function request(path = '/games', method = 'GET', body?: unknown) {
    const { nonce } = await issue.execute(fixtureUser, 'request');
    const payload = integrityPayload({
      nonce,
      userId: fixtureUser,
      sessionHash: integrityIds.hash('valid-session'),
      path,
      method,
      body,
    });
    return {
      nonce,
      platform: 'ios' as const,
      proof: keys.proof(payload, ++counter),
      keyId: keys.instance.keyId,
      token: 'valid-session',
      method,
      path,
      body,
    };
  }
  return { repository, keys, verifier, issue, verify, request };
}
it('verifies a real P-256 assertion and rejects concurrent replay', async () => {
  const fixture = setup();
  const input = await fixture.request();
  const outcomes = await Promise.allSettled([
    fixture.verify.execute(fixtureUser, input),
    fixture.verify.execute(fixtureUser, input),
  ]);
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  await expect(fixture.verify.execute(fixtureUser, input)).rejects.toMatchObject({
    code: 'APP_INTEGRITY_REQUIRED',
  });
});
it.each([
  { path: '/games/other' },
  { method: 'DELETE' },
  { body: { prompt: 'tampered' } },
  { token: 'stolen-other-session' },
  { platform: 'android' },
])('rejects changed request details %j', async (change) => {
  const fixture = setup();
  const input = await fixture.request('/games', 'POST', { prompt: 'Create a forest puzzle' });
  await expect(
    fixture.verify.execute(fixtureUser, { ...input, ...change } as typeof input),
  ).rejects.toBeDefined();
});
it('rejects the wrong user, expired challenges, stale counters, and wrong app identity', async () => {
  const fixture = setup();
  const input = await fixture.request();
  await expect(fixture.verify.execute('another-user', input)).rejects.toMatchObject({
    status: 403,
  });
  const stored = fixture.repository.challenges.get(input.nonce)!;
  fixture.repository.challenges.set(input.nonce, { ...stored, expiresAt: integrityClock.now() });
  await expect(fixture.verify.execute(fixtureUser, input)).rejects.toMatchObject({ status: 403 });
  const fresh = await fixture.request();
  const payload = integrityPayload({
    ...fresh,
    userId: fixtureUser,
    sessionHash: integrityIds.hash(fresh.token),
  });
  await expect(
    fixture.verify.execute(fixtureUser, { ...fresh, proof: fixture.keys.proof(payload, 0) }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    fixture.verify.execute(fixtureUser, {
      ...fresh,
      proof: fixture.keys.proof(payload, 3, 'OTHERTEAM.com.other.app'),
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it('rejects forged Apple enrollment and cannot reuse a request challenge for enrollment', async () => {
  const fixture = setup();
  const { nonce } = await fixture.issue.execute(fixtureUser, 'register');
  const register = new RegisterAppInstance(fixture.repository, fixture.verifier, integrityClock);
  await expect(
    register.execute(fixtureUser, {
      nonce,
      keyId: fixture.keys.instance.keyId,
      proof: 'forged-attestation',
    }),
  ).rejects.toMatchObject({ status: 403 });
  const request = await fixture.request();
  await expect(
    register.execute(fixtureUser, {
      nonce: request.nonce,
      keyId: request.keyId,
      proof: request.proof,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(fixture.repository.instances.get(request.keyId)?.counter).toBe(0);
});
it('normalizes object key order but binds array order and query strings', () => {
  const input = {
    nonce: 'nonce',
    userId: fixtureUser,
    sessionHash: 'hash',
    method: 'POST',
    path: '/games?x=1',
  };
  expect(integrityPayload({ ...input, body: { b: 2, a: { z: 1, c: 2 } } })).toBe(
    integrityPayload({ ...input, body: { a: { c: 2, z: 1 }, b: 2 } }),
  );
  expect(integrityPayload({ ...input, body: [1, 2] })).not.toBe(
    integrityPayload({ ...input, body: [2, 1] }),
  );
  expect(integrityPayload(input)).not.toBe(integrityPayload({ ...input, path: '/games?x=2' }));
});
it('requires matching Google app, certificate, device, license, request hash and freshness (explicit provider fixture)', async () => {
  const payload = 'bound-request';
  const verdict = {
    requestDetails: {
      requestPackageName: integritySettings.packageName,
      requestHash: createHash('sha256').update(payload).digest('base64url'),
      timestampMillis: String(Date.parse(integrityClock.now())),
    },
    appIntegrity: {
      appRecognitionVerdict: 'PLAY_RECOGNIZED',
      packageName: integritySettings.packageName,
      certificateSha256Digest: ['test-certificate'],
    },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    accountDetails: { appLicensingVerdict: 'LICENSED' },
  };
  let current: unknown = verdict;
  const verifier = new PlatformIntegrityVerifier(integritySettings, {
    decode: async () => current,
  });
  const input = { proof: 'explicit-provider-fixture', payload, now: integrityClock.now() };
  await verifier.verifyAndroid(input);
  for (const bad of [
    null,
    {},
    { ...verdict, requestDetails: { ...verdict.requestDetails, requestHash: 'wrong' } },
    { ...verdict, requestDetails: { ...verdict.requestDetails, timestampMillis: '0' } },
    {
      ...verdict,
      requestDetails: { ...verdict.requestDetails, requestPackageName: 'another.app' },
    },
    { ...verdict, appIntegrity: { ...verdict.appIntegrity, certificateSha256Digest: ['other'] } },
    { ...verdict, appIntegrity: { ...verdict.appIntegrity, certificateSha256Digest: 'malformed' } },
    { ...verdict, deviceIntegrity: { deviceRecognitionVerdict: 'MEETS_DEVICE_INTEGRITY' } },
    {
      ...verdict,
      appIntegrity: { ...verdict.appIntegrity, appRecognitionVerdict: 'UNRECOGNIZED_VERSION' },
    },
    { ...verdict, deviceIntegrity: {} },
    { ...verdict, accountDetails: { appLicensingVerdict: 'UNLICENSED' } },
  ]) {
    current = bad;
    await expect(verifier.verifyAndroid(input)).rejects.toMatchObject({ status: 403 });
  }
});
it('defaults to enforcement and rejects production or non-loopback development bypass', () => {
  const basic = { SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
  expect(configSchema.parse(basic).APP_INTEGRITY_MODE).toBe('required');
  expect(() =>
    configSchema.parse({
      ...basic,
      APP_ENV: 'production',
      APP_INTEGRITY_MODE: 'local-development',
    }),
  ).toThrow();
  expect(() =>
    configSchema.parse({
      ...basic,
      APP_ENV: 'development',
      API_HOST: '0.0.0.0',
      APP_INTEGRITY_MODE: 'local-development',
    }),
  ).toThrow();
  expect(() =>
    configSchema.parse({
      ...basic,
      APP_ENV: 'production',
      APPLE_APP_ATTEST_ENVIRONMENT: 'development',
    }),
  ).toThrow();
});
it('accepts only an explicit disabled production switch without relaxing production configuration', () => {
  const values = {
    APP_ENV: 'production',
    APP_INTEGRITY_MODE: 'disabled',
    DATABASE_URL: 'postgresql://service:fixture@localhost/prod',
    SUPABASE_ANON_KEY: 'fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    ARTIFACT_ROOT: '/srv/data/artifacts',
    PACKAGE_SIGNING_KEY_FILE: '/srv/data/private.pem',
    PACKAGE_PUBLIC_KEY_FILE: '/srv/data/public.pem',
    ANALYTICS_ENVIRONMENT: 'production',
    OPENROUTER_API_KEY: 'fixture',
  };
  expect(configSchema.parse(values).APP_INTEGRITY_MODE).toBe('disabled');
  expect(configSchema.safeParse({ ...values, APP_INTEGRITY_MODE: 'false' }).success).toBe(false);
  expect(configSchema.safeParse({ ...values, ARTIFACT_ROOT: './work' }).success).toBe(false);
});
it('blocks unverified API generation and downloads before expensive work; accepts verified requests', async () => {
  const fixture = setup();
  const reserve = vi.fn();
  const storage = vi.fn(async () => new Uint8Array([1]));
  const games = {
    list: async () => [],
    accessible: async () => ({ id: 'game_fixture', ownerId: fixtureUser }),
    version: async () => ({
      gameId: 'game_fixture',
      artifactKey: 'private',
      packageBytes: 1,
      checksum: 'fixture',
    }),
  };
  const dependencies = {
    auth: { authenticate: async () => ({ id: fixtureUser, ageConfirmed: true }) },
    integrity: { enabled: true, repository: fixture.repository, verifier: fixture.verifier },
    games,
    generations: { reserve },
    storage: { get: storage },
    clock: integrityClock,
    ids: integrityIds,
    policy: { available: true, newLimit: 5, modifyLimit: 5, jobCap: 1, dailyCap: 100 },
  } as unknown as ServerDependencies;
  const app = await createServer(dependencies);
  const auth = { authorization: 'Bearer valid-session' };
  try {
    for (const path of ['/games/game_fixture/versions/ver_fixture/download', '/me'])
      expect((await app.inject({ url: path, headers: auth })).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/games',
          headers: auth,
          payload: { prompt: 'Create a forest puzzle' },
        })
      ).statusCode,
    ).toBe(403);
    expect(reserve).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/games' })).statusCode).toBe(401);
    const input = await fixture.request('/games/game_fixture/versions/ver_fixture/download');
    const headers = {
      ...auth,
      'x-app-integrity-nonce': input.nonce,
      'x-app-integrity-platform': input.platform,
      'x-app-integrity-key': input.keyId,
      'x-app-integrity-proof': input.proof,
    };
    const response = await app.inject({ url: input.path, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect((await app.inject({ url: input.path, headers })).statusCode).toBe(403);
    expect(storage).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

it('explicitly disables proofs while retaining authentication and reports the inactive state', async () => {
  const fixture = setup();
  const authenticate = vi.fn(async (token: string) => {
    if (token !== 'valid-session')
      throw new DomainError('UNAUTHENTICATED', 'Invalid session.', 401);
    return { id: fixtureUser, ageConfirmed: true };
  });
  const list = vi.fn(async () => []);
  const app = await createServer({
    auth: { authenticate },
    integrity: { enabled: false, repository: fixture.repository, verifier: fixture.verifier },
    games: { list },
    clock: integrityClock,
    ids: integrityIds,
    policy: { available: true },
  } as unknown as ServerDependencies);
  try {
    expect((await app.inject({ url: '/health' })).json().appIntegrityRequired).toBe(false);
    for (const headers of [{}, { authorization: 'Bearer invalid-session' }])
      expect((await app.inject({ url: '/games', headers })).statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
    expect(
      (await app.inject({ url: '/games', headers: { authorization: 'Bearer valid-session' } }))
        .statusCode,
    ).toBe(200);
    expect(list).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
