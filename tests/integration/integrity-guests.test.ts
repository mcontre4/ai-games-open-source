import { beforeAll, afterAll, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { configSchema } from '../../packages/config/src/index.ts';
import { compose } from '../../packages/adapters/src/composition.ts';
import { createServer } from '../../apps/api/src/server.ts';
import { PlatformIntegrityVerifier } from '../../packages/adapters/src/integrity.ts';
import { integrityPayload } from '../../packages/application/src/integrity.ts';
import { assertionFixture, integritySettings } from '../integrity-fixture.ts';
import { smallFiles, signing } from '../helpers.ts';
import { CreateGame } from '../../packages/application/src/games.ts';
import { InferenceBudget } from '../../packages/adapters/src/ai/openrouter.ts';

// Real Postgres/Supabase/API authorization with explicitly test-enrolled Apple keys.
// The guest flag is set on isolated Auth test users because the shared local Auth daemon
// predates enable_anonymous_sign_ins; this does not verify native or live attestation.
const config = configSchema.parse(process.env);
const services = compose(config);
const budget = new InferenceBudget(services.db);
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users: {
  id: string;
  token: string;
  client: SupabaseClient;
  keys: ReturnType<typeof assertionFixture>;
  counter: number;
}[] = [];
let app: Awaited<ReturnType<typeof createServer>>;
let gameId: string;
let versionId: string;
let claimToken: string;
beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    const email = `integrity-fixture-${Date.now()}-${i}@example.com`;
    const password = 'Integrity-test-Password-2048!';
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { age_confirmed: true },
    });
    if (created.error) throw created.error;
    const id = created.data.user!.id;
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;
    const keys = assertionFixture(id);
    users.push({ id, client, token: session.data.session!.access_token, keys, counter: 0 });
    if (i === 0)
      await services.db.pool.query('update auth.users set is_anonymous=true where id=$1', [id]);
    await services.db.pool.query(
      'insert into app_integrity_instances(key_id,user_id,public_key) values($1,$2,$3)',
      [keys.instance.keyId, id, keys.instance.publicKey],
    );
  }
  app = await createServer({
    ...services,
    integrity: {
      ...services.integrity,
      enabled: true,
      verifier: new PlatformIntegrityVerifier(integritySettings, {
        decode: async () => {
          throw new Error('No live Google fixture');
        },
      }),
    },
    policy: { ...services.policy, available: true, newLimit: 5, dailyCap: 1000 },
  });
});
afterAll(async () => {
  await app?.close();
  for (const user of users) {
    await services.auth.deleteAccount(user.id);
    await services.db.pool.query('delete from analytics_outbox where user_id=$1', [user.id]);
  }
  await services.db.close();
});
async function headers(
  index: number,
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
) {
  const user = users[index]!;
  const authorization = `Bearer ${user.token}`;
  const challenge = await app.inject({
    method: 'POST',
    url: '/integrity/challenges',
    headers: { authorization },
    payload: { purpose: 'request' },
  });
  expect(challenge.statusCode).toBe(200);
  const { nonce } = challenge.json();
  const payload = integrityPayload({
    nonce,
    userId: user.id,
    sessionHash: services.ids.hash(user.token),
    path,
    method,
    body,
  });
  return {
    authorization,
    'x-app-integrity-nonce': nonce,
    'x-app-integrity-platform': 'ios',
    'x-app-integrity-key': user.keys.instance.keyId,
    'x-app-integrity-proof': user.keys.proof(payload, ++user.counter),
  };
}
async function request(
  index: number,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
) {
  return app.inject({
    url: path,
    method,
    headers: await headers(index, path, method, body),
    ...(body === undefined ? {} : { payload: body }),
  });
}
it('allows an attested guest to generate with no registered account and protects the private package', async () => {
  const body = { prompt: 'Create an explicit fixture forest puzzle game', orientation: 'portrait' };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/games',
        headers: { authorization: `Bearer ${users[0]!.token}` },
        payload: body,
      })
    ).statusCode,
  ).toBe(403);
  const created = await request(0, '/games', 'POST', body);
  expect(created.statusCode).toBe(202);
  gameId = created.json().gameId;
  const guest = await services.auth.authenticate(users[0]!.token);
  expect(guest.anonymous).toBe(true);
  const game = await services.games.accessible(gameId, guest.id);
  expect(game.ownerId).toBe(guest.id);
  expect(game.public).toBe(false);
  versionId = services.ids.next('ver');
  const packed = await signing().packager.package(game, versionId, smallFiles);
  const artifactKey = `${gameId}/${versionId}.zip`;
  await services.storage.put(artifactKey, packed.bytes);
  const usage = await budget.reserve(created.json().generationId, 'explicit-unbilled-fixture', 1);
  await budget.settle(usage, 0.25);
  await services.generations.stage(created.json().generationId, 'packaging');
  await services.generations.publish(
    created.json().generationId,
    {
      id: versionId,
      gameId,
      number: 1,
      artifactKey,
      sourceKey: `${gameId}/fixture-source.zip`,
      packageBytes: packed.bytes.length,
      checksum: packed.checksum,
      stateSchemaVersion: 1,
      createdAt: services.clock.now(),
    },
    'Explicit fixture game',
    'Security integration fixture',
  );
  const download = `/games/${gameId}/versions/${versionId}/download`;
  expect((await app.inject({ url: download })).statusCode).toBe(401);
  expect((await request(2, download)).statusCode).toBe(404);
  const proof = await headers(0, download);
  const outcomes = await Promise.all([
    app.inject({ url: download, headers: proof }),
    app.inject({ url: download, headers: proof }),
  ]);
  expect(outcomes.map((response) => response.statusCode).sort()).toEqual([200, 403]);
  const accepted = outcomes.find((response) => response.statusCode === 200)!;
  expect(accepted.headers['cache-control']).toBe('private, no-store');
  expect(accepted.rawPayload.equals(Buffer.from(packed.bytes))).toBe(true);
  expect((await request(0, `/games/${gameId}/versions/ver_missing/download`)).statusCode).toBe(404);
});
it('links ownership, queued/completed generation history, progress and quota to the registered account atomically', async () => {
  const save = { versionId, schemaVersion: 1, baseRevision: 0, state: { coins: 42 } };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/games/${gameId}/save`,
        headers: await headers(0, `/games/${gameId}/save`, 'PUT', save),
        payload: save,
      })
    ).statusCode,
  ).toBe(200);
  const queued = await request(0, '/games', 'POST', {
    prompt: 'Create another explicit fixture puzzle game',
    orientation: 'portrait',
  });
  expect(queued.statusCode).toBe(202);
  // Match the installed native client's empty JSON request, retaining the signed
  // absent-body payload so compatibility cannot invalidate app attestation.
  const credential = await app.inject({
    method: 'POST',
    url: '/guest/claim-token',
    headers: {
      ...(await headers(0, '/guest/claim-token', 'POST')),
      'content-type': 'application/json',
    },
  });
  expect(credential.statusCode).toBe(200);
  claimToken = credential.json().token;
  const claimBody = { token: claimToken };
  const queuedUsage = await budget.reserve(
    queued.json().generationId,
    'explicit-unbilled-fixture',
    0.5,
  );
  const day = services.clock.now().slice(0, 10);
  await services.db.pool.query(
    'insert into daily_credits(user_id,day,spent_cost) values($1,$3,1),($1,$4,3),($2,$4,2)',
    [users[1]!.id, users[0]!.id, day, '2000-01-01'],
  );
  expect(await services.credits.balance(users[0]!.id, services.clock.now())).toMatchObject({
    spent: 0.75,
    held: 9.5,
  });
  const grantId = services.ids.next('grant');
  await services.db.pool.query(
    'insert into credit_grants(id,user_id,amount,reason) values($1,$2,1000,$3)',
    [grantId, users[0]!.id, 'Explicit unbilled guest transfer fixture'],
  );
  const firstClaim = await request(1, '/me/claim-guest', 'POST', claimBody);
  const retry = await request(1, '/me/claim-guest', 'POST', claimBody);
  const claims = [firstClaim, retry];
  const concurrentRetries = await Promise.all([
    services.guests.claim(services.ids.hash(claimToken), users[1]!.id),
    services.guests.claim(services.ids.hash(claimToken), users[1]!.id),
  ]);
  expect(concurrentRetries[0]).toEqual(concurrentRetries[1]);
  expect(claims.every((response) => response.statusCode === 200)).toBe(true);
  expect(claims[0]!.json().gameIds).toContain(gameId);
  expect((await services.games.accessible(gameId, users[1]!.id)).ownerId).toBe(users[1]!.id);
  expect((await services.generations.get(queued.json().generationId)).userId).toBe(users[1]!.id);
  expect((await services.progress.load(users[1]!.id, gameId))?.state).toEqual({ coins: 42 });
  expect(await services.generations.list(users[0]!.id)).toHaveLength(0);
  expect(await services.generations.list(users[1]!.id)).toHaveLength(2);
  expect(await services.credits.balance(users[1]!.id, services.clock.now())).toMatchObject({
    spent: 1.75,
    held: 9.5,
    available: 1003.75,
  });
  expect(await services.credits.balance(users[1]!.id, '2000-01-01T12:00:00Z')).toMatchObject({
    spent: 5,
    available: 1010,
  });
  expect(
    (await services.db.pool.query('select * from daily_credits where user_id=$1', [users[0]!.id]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await services.db.pool.query('select user_id,amount::text from credit_grants where id=$1', [
        grantId,
      ])
    ).rows,
  ).toEqual([{ user_id: users[1]!.id, amount: '1000.000000' }]);
  expect((await request(1, `/games/${gameId}/versions/${versionId}/download`)).statusCode).toBe(
    200,
  );
  expect((await request(2, '/me/claim-guest', 'POST', claimBody)).statusCode).toBe(403);
  expect(
    (await request(2, '/me/claim-guest', 'POST', { token: services.ids.token() })).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url: '/games', headers: { authorization: `Bearer ${users[0]!.token}` } }))
      .statusCode,
  ).toBe(401);
  await expect(
    new CreateGame(services.games, services.generations, services.ids, services.clock, {
      ...services.policy,
      available: true,
      dailyCap: 1000,
    }).execute(users[0]!.id, { prompt: 'Create a puzzle after transfer', orientation: 'portrait' }),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    new CreateGame(services.games, services.generations, services.ids, services.clock, {
      ...services.policy,
      available: true,
      dailyCap: 1000,
    }).execute(users[1]!.id, {
      prompt: 'Create a puzzle while already queued',
      orientation: 'portrait',
    }),
  ).rejects.toMatchObject({ code: 'CONCURRENT_LIMIT' });
  await services.generations.stage(queued.json().generationId, 'cancelled');
  // A worker finishing an already-started request after linking charges the new owner once.
  await budget.settle(queuedUsage, 0.125);
  expect(await services.credits.balance(users[1]!.id, services.clock.now())).toMatchObject({
    spent: 1.375,
    held: 0,
    available: 1013.625,
  });
  await expect(
    new CreateGame(services.games, services.generations, services.ids, services.clock, {
      ...services.policy,
      available: true,
      newLimit: 2,
      dailyCap: 1000,
    }).execute(users[1]!.id, {
      prompt: 'Create a puzzle past the merged quota',
      orientation: 'portrait',
    }),
  ).rejects.toMatchObject({ code: 'DAILY_QUOTA' });
  await services.db.transaction(async (c) => {
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [users[0]!.id]);
    expect((await c.query('select id from games where id=$1', [gameId])).rowCount).toBe(0);
    expect(
      (await c.query('select game_id from player_saves where game_id=$1', [gameId])).rowCount,
    ).toBe(0);
    await expect(c.query('select token_hash from guest_account_claims')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
