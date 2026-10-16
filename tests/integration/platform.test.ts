import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { configSchema } from '../../packages/config/src/index.ts';
import { compose } from '../../packages/adapters/src/composition.ts';
import { createServer } from '../../apps/api/src/server.ts';
import { GenerateGame } from '../../packages/application/src/generate.ts';
import { activeStages } from '../../packages/domain/src/index.ts';
import { SignedPackager } from '../../packages/adapters/src/packager.ts';
import { verifyPackage } from '../../packages/game-sdk/src/package.ts';
import { createPublicKey } from 'node:crypto';
import { fixtureModeration } from '../moderation-fixture.ts';
import type { SandboxPort, ModerationPort } from '../../packages/application/src/ports.ts';
import { safePromptAssessment } from '../moderation-fixture.ts';
import { InferenceBudget, OpenRouterClient } from '../../packages/adapters/src/ai/openrouter.ts';
import { PostgresQueue } from '../../packages/adapters/src/queue.ts';
const config = configSchema.parse(process.env);
const services = compose(config);
const users: { id: string; token: string; client: SupabaseClient }[] = [];
let app: Awaited<ReturnType<typeof createServer>>;
let gameId: string, versionId: string, shareId: string, shareToken: string;
let fixtureDailyCap = 100;
const auth = (index = 0) => ({ authorization: `Bearer ${users[index]!.token}` });
async function files(dir: string, path = ''): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const item of await readdir(join(dir, path), { withFileTypes: true })) {
    const rel = path ? `${path}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(out, await files(dir, rel));
    else out[rel] = new Uint8Array(await readFile(join(dir, rel)));
  }
  return out;
}
const fixtureSandbox: SandboxPort = {
  create: async () => ({
    endpoint: 'test-fixture://explicit',
    generate: async () => {},
    build: async () => {},
    artwork: async () => {},
    destroy: async () => {},
    validate: async () => ({
      files: await files('packages/game-template/dist'),
      source: new Uint8Array([1, 2, 3]),
      title: 'Fixture Neon Comet',
      description: 'Explicit deterministic fixture integration.',
    }),
  }),
};
async function runFixture(generationId: string, moderation: ModerationPort = fixtureModeration) {
  const usecase = new GenerateGame(
    services.generations,
    services.games,
    fixtureSandbox,
    {
      register: async () => ({
        url: 'fixture://gateway',
        token: 'fixture-only',
        model: 'fixture-only',
      }),
      revoke: () => {},
    },
    { create: async () => new Uint8Array() },
    services.storage,
    new SignedPackager(await readFile(config.PACKAGE_SIGNING_KEY_FILE, 'utf8')),
    services.ids,
    services.clock,
    30_000,
    0,
    moderation,
  );
  await usecase.execute(generationId);
}
beforeAll(async () => {
  // Preserve the existing development ledger. Unbilled fixtures need their own
  // allowance above recorded local spending, without changing production limits.
  const budget = await services.db.pool.query<{ cost: string }>(
    "select coalesce(sum(case when stage=any($1) then reserved_cost else charged_cost end),0)::text as cost from generation_jobs where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'",
    [activeStages],
  );
  fixtureDailyCap = Number(budget.rows[0]!.cost) + 100;
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  for (let i = 0; i < 3; i++) {
    const email = `test-${Date.now()}-${i}@example.com`,
      password = 'Games-test-Password-2048!';
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `Player ${i}`, age_confirmed: true },
    });
    if (created.error) throw created.error;
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    users.push({ id: created.data.user!.id, token: signed.data.session!.access_token, client });
  }
  app = await createServer(
    { ...services, policy: { ...services.policy, available: true, dailyCap: fixtureDailyCap } },
    false,
  );
});
afterAll(async () => {
  await app?.close();
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
  await services.db.pool.query('delete from analytics_outbox where user_id=any($1::uuid[])', [
    users.map((user) => user.id),
  ]);
  await services.db.close();
});
describe('real local Supabase/Postgres platform with explicit fixture generation', () => {
  it('stores creature identity and settings with case-insensitive unique usernames', async () => {
    const original = (await app.inject({ url: '/me/profile', headers: auth() })).json();
    expect(original.username).toMatch(/^[a-z0-9_]{4,25}$/);
    expect(original.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const payload = {
      username: `blob_${users[0]!.id.slice(0, 8)}`,
      displayName: 'Creature Creator',
      bio: 'Making tiny worlds.',
      avatarId: 'fizz',
      profileVisible: true,
      autoSync: false,
      leaderboardVisible: true,
    };
    const updated = await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: auth(),
      payload,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ ...payload, id: users[0]!.id });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/me/profile',
          headers: auth(1),
          payload: { ...payload, username: payload.username.toUpperCase() },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/me/profile',
          headers: auth(),
          payload: { ...payload, id: users[1]!.id },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/me/profile',
          headers: auth(),
          payload: { ...payload, username: 'admin' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ url: '/me/profile' })).statusCode).toBe(401);
  });
  it('authenticates real Supabase sessions and rejects forged tokens', async () => {
    expect((await app.inject({ url: '/me', headers: auth() })).statusCode).toBe(200);
    expect((await app.inject({ url: '/me' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/me', headers: { authorization: 'Bearer forged' } })).statusCode,
    ).toBe(401);
  });
  it('creates a persistent job and publishes a signed fixture package', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/games',
      headers: auth(),
      payload: { prompt: 'Create a Neon Comet futuristic runner game.', orientation: 'portrait' },
    });
    expect(result.statusCode).toBe(202);
    const body = result.json();
    gameId = body.gameId;
    expect(body.generation).toMatchObject({
      id: body.generationId,
      gameId,
      prompt: 'Create a Neon Comet futuristic runner game.',
      stage: 'queued',
      kind: 'create',
      speed: 'regular',
    });
    await runFixture(body.generationId);
    const detail = await app.inject({ url: `/games/${gameId}`, headers: auth() });
    expect(detail.json().title).toBe('Fixture Neon Comet');
    expect(detail.json().creator).toMatchObject({
      displayName: 'Creature Creator',
      avatarId: 'fizz',
    });
    versionId = detail.json().currentVersionId;
    expect((await services.generations.get(body.generationId)).stage).toBe('ready');
    const download = await app.inject({
      url: `/games/${gameId}/versions/${versionId}/download`,
      headers: auth(),
    });
    expect(download.statusCode).toBe(200);
    const key = createPublicKey(await readFile(config.PACKAGE_PUBLIC_KEY_FILE))
      .export({ type: 'spki', format: 'der' })
      .subarray(-32)
      .toString('hex');
    expect(verifyPackage(new Uint8Array(download.rawPayload), key).manifest.gameId).toBe(gameId);
  });
  it('protects private games and rejects supplied user identities', async () => {
    const own = (await app.inject({ url: '/me/profile', headers: auth() })).json();
    const catalogue = await app.inject({ url: `/profiles/${own.username}`, headers: auth(1) });
    expect(catalogue.statusCode).toBe(200);
    expect(catalogue.json().games).toHaveLength(0);
    expect(catalogue.json().profile).not.toHaveProperty('autoSync');
    expect(catalogue.json().profile).not.toHaveProperty('email');
    const owned = await app.inject({ url: `/profiles/${own.username}`, headers: auth() });
    expect(owned.json().games.map((g: { id: string }) => g.id)).toContain(gameId);
    const { id: _id, createdAt: _createdAt, ...input } = own;
    await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: auth(),
      payload: { ...input, profileVisible: false },
    });
    expect(
      (await app.inject({ url: `/profiles/${own.username}`, headers: auth(1) })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/profiles/${own.username}`, headers: auth() })).statusCode,
    ).toBe(200);
    await app.inject({ method: 'PUT', url: '/me/profile', headers: auth(), payload: input });
    expect((await app.inject({ url: `/games/${gameId}`, headers: auth(1) })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/games/${gameId}/versions/${versionId}/download` })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/games',
          headers: auth(),
          payload: { prompt: 'Create an arcade game for me.', userId: users[1]!.id },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('synchronizes saves with revisions and rejects stale overwrites', async () => {
    const url = `/games/${gameId}/save`;
    const first = await app.inject({
      method: 'PUT',
      url,
      headers: auth(),
      payload: { versionId, schemaVersion: 1, baseRevision: 0, state: { coins: 5, best: 120 } },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().revision).toBe(1);
    const second = await app.inject({
      method: 'PUT',
      url,
      headers: auth(),
      payload: { versionId, schemaVersion: 1, baseRevision: 1, state: { coins: 9, best: 200 } },
    });
    expect(second.json().revision).toBe(2);
    const stale = await app.inject({
      method: 'PUT',
      url,
      headers: auth(),
      payload: { versionId, schemaVersion: 1, baseRevision: 1, state: { coins: 1 } },
    });
    expect(stale.statusCode).toBe(409);
    expect((await app.inject({ url, headers: auth() })).json().state.coins).toBe(9);
  });
  it('shares, accepts and isolates independent player saves and scores', async () => {
    const shared = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/share`,
      headers: auth(),
    });
    shareId = shared.json().id;
    shareToken = shared.json().token;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/shares/accept',
          headers: auth(1),
          payload: { token: shareToken },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/games/${gameId}/save`,
          headers: auth(1),
          payload: { versionId, schemaVersion: 1, baseRevision: 0, state: { coins: 80 } },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/games/${gameId}/save`, headers: auth() })).json().state.coins,
    ).toBe(9);
    expect(
      (await app.inject({ url: `/games/${gameId}/save`, headers: auth(1) })).json().state.coins,
    ).toBe(80);
    for (const [index, score] of [
      [0, 100],
      [1, 250],
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/games/${gameId}/score`,
            headers: auth(index),
            payload: { versionId, score },
          })
        ).statusCode,
      ).toBe(204);
    expect(
      (await app.inject({ url: `/games/${gameId}`, headers: auth() })).json().leaderboard[0].score,
    ).toBe(250);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/games/${gameId}/modify`,
          headers: auth(1),
          payload: { prompt: 'Add flying enemies to the game.' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('allows owner metadata edits, validates input and rejects shared-player edits', async () => {
    const payload = { title: '  My custom game  ', description: '  A custom description.  ' };
    expect(
      (await app.inject({ method: 'PATCH', url: `/games/${gameId}`, headers: auth(1), payload }))
        .statusCode,
    ).toBe(403);
    for (const invalid of [
      { ...payload, title: ' ' },
      { ...payload, description: 'x'.repeat(1001) },
      { ...payload, ownerId: users[1]!.id },
    ]) {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/games/${gameId}`,
            headers: auth(),
            payload: invalid,
          })
        ).statusCode,
      ).toBe(400);
    }
    const edited = await app.inject({
      method: 'PATCH',
      url: `/games/${gameId}`,
      headers: auth(),
      payload,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      title: 'My custom game',
      description: 'A custom description.',
    });
    const listed = (await app.inject({ url: '/games', headers: auth() })).json();
    expect(listed.find((game: { id: string }) => game.id === gameId)).toMatchObject({
      title: 'My custom game',
      description: 'A custom description.',
    });
  });
  it('preserves immutable versions on fixture modification', async () => {
    const result = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/modify`,
      headers: auth(),
      payload: { prompt: 'Add a new level with flying enemies.', speed: 'fast' },
    });
    expect(result.statusCode).toBe(202);
    await runFixture(result.json().generationId);
    expect((await services.generations.get(result.json().generationId)).speed).toBe('fast');
    const detail = (await app.inject({ url: `/games/${gameId}`, headers: auth() })).json();
    expect(detail).toMatchObject({ title: 'My custom game', description: 'A custom description.' });
    expect(detail.versions).toHaveLength(2);
    expect(detail.currentVersionId).not.toBe(versionId);
    expect(
      (
        await app.inject({
          url: `/games/${gameId}/versions/${versionId}/download`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/games/${gameId}/save`, headers: auth() })).json().state.coins,
    ).toBe(9);
  });
  it('persists a rejected modification with useful reasons and preserves playable versions (explicit moderation fixture)', async () => {
    const result = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/modify`,
      headers: auth(),
      payload: { prompt: 'Add a credit card checkout connected to my external payment account.' },
    });
    expect(result.statusCode).toBe(202);
    const before = await services.games.versions(gameId);
    await expect(
      runFixture(result.json().generationId, {
        check: async () => ({ ...safePromptAssessment(), payments: 0.99, external_services: 0.99 }),
      }),
    ).rejects.toThrow('Games cannot charge players');
    const failed = await app.inject({
      url: `/generations/${result.json().generationId}`,
      headers: auth(),
    });
    expect(failed.json()).toMatchObject({ stage: 'failed', kind: 'modify' });
    expect(failed.json().error).toContain('Games cannot charge players');
    expect(failed.json().error).toContain('Remove external services');
    expect(await services.games.versions(gameId)).toEqual(before);
  });
  it('revokes invitations and online download access', async () => {
    expect(
      (await app.inject({ method: 'DELETE', url: `/shares/${shareId}`, headers: auth(1) }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/shares/${shareId}`, headers: auth() }))
        .statusCode,
    ).toBe(204);
    expect((await app.inject({ url: `/games/${gameId}`, headers: auth(1) })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/shares/accept',
          headers: auth(2),
          payload: { token: shareToken },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('atomically enforces quotas under concurrent requests', async () => {
    const create = (await import('../../packages/application/src/games.ts')).CreateGame;
    const usecase = new create(services.games, services.generations, services.ids, services.clock, {
      ...services.policy,
      available: true,
      dailyCap: fixtureDailyCap,
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        usecase.execute(users[2]!.id, {
          prompt: 'Create an arcade puzzle game.',
          orientation: 'portrait',
        }),
      ),
    );
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const all = await services.generations.list(users[2]!.id);
    expect(all).toHaveLength(1);
    await services.generations.stage(all[0]!.id, 'cancelled');
  });
  it('persists queue jobs and inference reservations without overspending', async () => {
    const usecase = new (await import('../../packages/application/src/games.ts')).CreateGame(
      services.games,
      services.generations,
      services.ids,
      services.clock,
      { ...services.policy, available: true, dailyCap: fixtureDailyCap, jobCap: 1 },
    );
    const job = await usecase.execute(users[2]!.id, {
      prompt: 'Create a space adventure game.',
      orientation: 'portrait',
    });
    const budget = new InferenceBudget(services.db);
    const reservations = await Promise.allSettled(
      Array.from({ length: 8 }, () => budget.reserve(job.generationId, 'test-model', 0.3)),
    );
    expect(reservations.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const queue = new PostgresQueue(services.db, config.DATABASE_URL);
    await queue.start();
    try {
      // Dispatch is batched: a reused development DB can have older outbox entries.
      await expect
        .poll(
          async () => {
            const entries = await services.db.pool.query(
              'select dispatched_at from generation_outbox where generation_id=$1',
              [job.generationId],
            );
            return entries.rows[0].dispatched_at;
          },
          { timeout: 15_000 },
        )
        .not.toBeNull();
    } finally {
      await queue.stop();
      await services.generations.stage(job.generationId, 'cancelled');
    }
  });
  it('validates OpenRouter coding-model discovery with injected transport', async () => {
    const client = new OpenRouterClient(
      'test-only',
      new InferenceBudget(services.db),
      (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'model',
                architecture: { output_modalities: ['text'] },
                supported_parameters: ['tools'],
                pricing: { prompt: '0.000001', completion: '0.000001' },
              },
            ],
          }),
          { status: 200 },
        )) as typeof fetch,
    );
    expect((await client.codingModel('model', AbortSignal.timeout(1000))).id).toBe('model');
    await expect(client.codingModel('missing', AbortSignal.timeout(1000))).rejects.toThrow(
      'available',
    );
  });
  it('tests RLS as authenticated user, independently of API authorization', async () => {
    await services.db.transaction(async (c) => {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [users[1]!.id]);
      const rows = await c.query('select id from games where id=$1', [gameId]);
      expect(rows.rows).toHaveLength(0);
      const saves = await c.query('select user_id from player_saves where game_id=$1', [gameId]);
      expect(saves.rows).toHaveLength(0);
    });
  });
  it('records reports and blocks creators', async () => {
    const profile = (await app.inject({ url: '/me/profile', headers: auth() })).json();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/blocks',
          headers: auth(2),
          payload: { creatorId: users[0]!.id },
        })
      ).statusCode,
    ).toBe(204);
    expect((await app.inject({ url: '/blocks', headers: auth(2) })).json()).toEqual([
      expect.objectContaining({ id: users[0]!.id, avatarId: 'fizz' }),
    ]);
    expect(
      (await app.inject({ url: `/profiles/${profile.username}`, headers: auth(2) })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/blocks/${users[0]!.id}`, headers: auth(1) }))
        .statusCode,
    ).toBe(204);
    expect((await app.inject({ url: '/blocks', headers: auth(2) })).json()).toHaveLength(1);
    expect(
      (await app.inject({ method: 'DELETE', url: `/blocks/${users[0]!.id}`, headers: auth(2) }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: `/profiles/${profile.username}`, headers: auth(2) })).statusCode,
    ).toBe(200);
    const exportData = (await app.inject({ url: '/me/export', headers: auth() })).json();
    expect(exportData.profile.id).toBe(users[0]!.id);
    expect(exportData.games.every((g: { owner_id: string }) => g.owner_id === users[0]!.id)).toBe(
      true,
    );
    expect((await app.inject({ url: '/me/export' })).statusCode).toBe(401);
    const { id: _id, createdAt: _createdAt, ...input } = profile;
    await services.progress.score(users[0]!.id, gameId, versionId, 123);
    expect(
      (await services.progress.leaderboard(gameId)).some((r) => r.player === profile.displayName),
    ).toBe(true);
    await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: auth(),
      payload: { ...input, leaderboardVisible: false },
    });
    expect(
      (await services.progress.leaderboard(gameId)).some((r) => r.player === profile.displayName),
    ).toBe(false);
    await app.inject({ method: 'PUT', url: '/me/profile', headers: auth(), payload: input });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/games/${gameId}/report`,
          headers: auth(),
          payload: { reason: 'broken', detail: 'Testing the report workflow.' },
        })
      ).statusCode,
    ).toBe(204);
    const report = await services.db.pool.query(
      'select reason from game_reports where game_id=$1',
      [gameId],
    );
    expect(report.rows[0].reason).toBe('broken');
  });
  it('reconciles an abandoned persistent generation and releases its active slot', async () => {
    const usecase = new (await import('../../packages/application/src/games.ts')).CreateGame(
      services.games,
      services.generations,
      services.ids,
      services.clock,
      { ...services.policy, available: true, dailyCap: fixtureDailyCap },
    );
    const job = await usecase.execute(users[2]!.id, {
      prompt: 'Create a small puzzle game.',
      orientation: 'portrait',
    });
    await services.db.pool.query(
      "update generation_jobs set updated_at=now()-interval '2 hours' where id=$1",
      [job.generationId],
    );
    const { ReapAbandonedGenerations } =
      await import('../../packages/adapters/src/generation/maintenance.ts');
    expect(
      await new ReapAbandonedGenerations(services.db, services.clock).execute(),
    ).toBeGreaterThan(0);
    expect((await services.generations.get(job.generationId)).stage).toBe('failed');
  });
  it('allows five daily creations and rejects the sixth after completed/cancelled jobs', async () => {
    const usecase = new (await import('../../packages/application/src/games.ts')).CreateGame(
      services.games,
      services.generations,
      services.ids,
      services.clock,
      { ...services.policy, available: true, newLimit: 5, dailyCap: fixtureDailyCap },
    );
    while (
      (await services.generations.list(users[2]!.id)).filter((j) => j.kind === 'create').length < 5
    ) {
      const job = await usecase.execute(users[2]!.id, {
        prompt: 'Create a watercolor forest puzzle game.',
        orientation: 'portrait',
      });
      await services.generations.stage(job.generationId, 'cancelled');
    }
    await expect(
      usecase.execute(users[2]!.id, {
        prompt: 'Create a clay island racing game.',
        orientation: 'portrait',
      }),
    ).rejects.toThrow('daily');
  });
  it.each(['3d', 'isometric'] as const)(
    'stores %s in Postgres and retains it when modifying a game',
    async (view) => {
      // A separate policy prevents this persistence check from depending on the quota test above.
      const usecase = new (await import('../../packages/application/src/games.ts')).CreateGame(
        services.games,
        services.generations,
        services.ids,
        services.clock,
        {
          ...services.policy,
          available: true,
          newLimit: 20,
          modifyLimit: 20,
          dailyCap: fixtureDailyCap,
        },
      );
      const job = await usecase.execute(users[2]!.id, {
        prompt: 'Create a forest adventure game.',
        orientation: 'landscape',
        view,
      });
      try {
        expect(await services.games.accessible(job.gameId, users[2]!.id)).toMatchObject({
          view,
          orientation: 'landscape',
        });
        expect(
          (await services.games.list(users[2]!.id)).find((g) => g.id === job.gameId)?.view,
        ).toBe(view);
        await services.generations.stage(job.generationId, 'cancelled');
        const change = await usecase.execute(users[2]!.id, {
          gameId: job.gameId,
          prompt: 'Add more collectible forest gems.',
          orientation: 'portrait',
          view: '2d',
        });
        expect((await services.games.accessible(job.gameId, users[2]!.id)).view).toBe(view);
        await services.generations.stage(change.generationId, 'cancelled');
      } finally {
        await services.generations.stage(job.generationId, 'cancelled');
      }
    },
  );
  it('atomically resumes a failed creation once, preserves checkpoints/costs, and blocks unresolved bills and other users', async () => {
    const { CreateGame } = await import('../../packages/application/src/games.ts');
    const create = new CreateGame(
      services.games,
      services.generations,
      services.ids,
      services.clock,
      {
        ...services.policy,
        available: true,
        newLimit: 100,
        modifyLimit: 100,
        dailyCap: fixtureDailyCap,
      },
    );
    const parent = await create.execute(users[1]!.id, {
      prompt: 'Explicit unbilled retry accounting fixture.',
      orientation: 'portrait',
      speed: 'ultra-fast',
    });
    await services.checkpoints.save(parent.generationId, {
      attempts: 3,
      moderationComplete: true,
      codingComplete: true,
      sourceKey: `${parent.gameId}/checkpoints/${parent.generationId}/fixture-source.zip`,
      contextKey: `${parent.gameId}/checkpoints/${parent.generationId}/fixture-context.zip`,
      artworkKey: `${parent.gameId}/checkpoints/${parent.generationId}/fixture-artwork.png`,
    });
    await services.generations.stage(parent.generationId, 'failed', 'Explicit interrupted fixture');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/generations/${parent.generationId}/retry`,
          headers: auth(0),
        })
      ).statusCode,
    ).toBe(404);
    const budget = new InferenceBudget(services.db);
    // Temporarily reactivate solely for this unbilled accounting fixture.
    await services.db.pool.query("update generation_jobs set stage='coding' where id=$1", [
      parent.generationId,
    ]);
    const usage = await budget.reserve(parent.generationId, 'explicit-unbilled-fixture', 0.05);
    await services.generations.stage(parent.generationId, 'failed');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/generations/${parent.generationId}/retry`,
          headers: auth(1),
        })
      ).statusCode,
    ).toBe(409);
    await budget.settle(usage, 0.02); // Explicit fixture ledger amount, no provider call.
    const requests = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'POST',
          url: `/generations/${parent.generationId}/retry`,
          headers: auth(1),
        }),
      ),
    );
    expect(requests.map((r) => r.statusCode)).toEqual([202, 202]);
    const next = requests[0]!.json();
    expect(requests[1]!.json().generationId).toBe(next.generationId);
    expect(next.generation).toMatchObject({
      retryOf: parent.generationId,
      speed: 'ultra-fast',
      progressSaved: true,
      stage: 'queued',
    });
    expect(await services.checkpoints.load(next.generationId)).toMatchObject({
      attempts: 0,
      codingComplete: true,
      sourceKey: `${parent.gameId}/checkpoints/${parent.generationId}/fixture-source.zip`,
    });
    const costs = await services.db.pool.query(
      'select charged_cost::text as cost from generation_jobs where id=$1',
      [parent.generationId],
    );
    expect(Number(costs.rows[0].cost)).toBe(0.02);
    expect((await services.generations.get(parent.generationId)).stage).toBe('failed');
    const outbox = await services.db.pool.query(
      'select count(*)::int as count from generation_outbox where generation_id=$1',
      [next.generationId],
    );
    expect(outbox.rows[0].count).toBe(1);
    await services.checkpoints.record(
      parent.generationId,
      { input: 'explicit private prompt fixture' },
      {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Saved provider response before CLI receipt' }],
          },
        ],
      },
    );
    expect(
      JSON.stringify(
        (await app.inject({ url: `/generations/${parent.generationId}`, headers: auth(1) })).json(),
      ),
    ).not.toContain('sourceKey');
    expect(await services.checkpoints.resumeContext(next.generationId)).toContain(
      'Saved provider response before CLI receipt',
    );
    const allowance = await services.db.pool.query(
      'select reserved_cost::text as cost from generation_jobs where id=$1',
      [next.generationId],
    );
    expect(Number(allowance.rows[0].cost)).toBeCloseTo(services.policy.jobCap - 0.02, 6);
    for (const table of ['generation_checkpoints', 'generation_calls']) {
      const denied = await users[1]!.client.from(table).select('*');
      expect(denied.error).toBeTruthy();
    }
    await services.generations.stage(next.generationId, 'cancelled');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/generations/${next.generationId}/retry`,
          headers: auth(1),
        })
      ).statusCode,
    ).toBe(409);
  });
  it('grants private checkpoint storage access to the dedicated production role while excluding browser roles', async () => {
    const c = await services.db.pool.connect();
    try {
      await c.query('begin');
      if (!(await c.query("select 1 from pg_roles where rolname='ai_games_app'")).rowCount)
        await c.query('create role ai_games_app nologin bypassrls');
      await c.query(
        await readFile(
          'infrastructure/supabase/migrations/202610120002_checkpoint_worker_access.sql',
          'utf8',
        ),
      );
      for (const [table, privilege] of [
        ['generation_checkpoints', 'SELECT'],
        ['generation_checkpoints', 'INSERT'],
        ['generation_checkpoints', 'UPDATE'],
        ['generation_calls', 'SELECT'],
        ['generation_calls', 'INSERT'],
      ]) {
        const allowed = await c.query('select has_table_privilege($1,$2,$3) as allowed', [
          'ai_games_app',
          table,
          privilege,
        ]);
        expect(allowed.rows[0].allowed).toBe(true);
      }
      expect(
        (
          await c.query(
            "select has_sequence_privilege('ai_games_app','generation_calls_id_seq','USAGE') as allowed",
          )
        ).rows[0].allowed,
      ).toBe(true);
      for (const role of ['anon', 'authenticated']) {
        for (const table of ['generation_checkpoints', 'generation_calls']) {
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
            const allowed = await c.query('select has_table_privilege($1,$2,$3) as allowed', [
              role,
              table,
              privilege,
            ]);
            expect(allowed.rows[0].allowed).toBe(false);
          }
        }
      }
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
  it('rejects a signed-out session immediately', async () => {
    expect((await app.inject({ url: '/me', headers: auth(2) })).statusCode).toBe(200);
    await users[2]!.client.auth.signOut();
    expect((await app.inject({ url: '/me', headers: auth(2) })).statusCode).toBe(401);
  });
});
