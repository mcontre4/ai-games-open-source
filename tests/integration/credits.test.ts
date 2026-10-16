import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { configSchema } from '../../packages/config/src/index.ts';
import { compose } from '../../packages/adapters/src/composition.ts';
import { CreateGame } from '../../packages/application/src/games.ts';
import { InferenceBudget } from '../../packages/adapters/src/ai/openrouter.ts';
import { createServer } from '../../apps/api/src/server.ts';

// Real local PostgreSQL accounting with explicitly unbilled inference reservations.
const config = configSchema.parse(process.env);
const services = compose(config);
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const policy = { available: true, newLimit: 100, modifyLimit: 100, jobCap: 10, dailyCap: 1000 };
const budget = new InferenceBudget(services.db);
let now: string;
let userId: string;
let email: string;
const clock = { now: () => now };
const create = () =>
  new CreateGame(services.games, services.generations, services.ids, clock, policy);
const start = (gameId?: string) =>
  create().execute(userId, {
    prompt: 'Explicit unbilled credits test fixture: a forest puzzle game.',
    orientation: 'portrait',
    ...(gameId ? { gameId } : {}),
  });
const balance = () => services.credits.balance(userId, now);

beforeEach(async () => {
  now = '2040-01-01T12:00:00.000Z';
  email = `credits-${services.ids.token().slice(0, 12)}@example.com`;
  const created = await admin.auth.admin.createUser({
    email,
    password: 'Credits-fixture-2048!',
    email_confirm: true,
    user_metadata: { age_confirmed: true },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;
});
afterEach(async () => {
  await admin.auth.admin.deleteUser(userId);
  await services.db.pool.query('delete from analytics_outbox where user_id=$1', [userId]);
});
afterAll(() => services.db.close());

describe('daily credits in real PostgreSQL', () => {
  it('bypasses all disabled usage limits while preserving actual cost accounting', async () => {
    const unlimited = compose({
      ...config,
      GENERATION_CREDITS_ENABLED: 'false',
      GENERATION_DAILY_LIMIT_ENABLED: 'false',
      MODIFICATION_DAILY_LIMIT_ENABLED: 'false',
      GENERATION_CONCURRENT_LIMIT_ENABLED: 'false',
      OPENROUTER_JOB_COST_LIMIT_ENABLED: 'false',
      OPENROUTER_DAILY_COST_LIMIT_ENABLED: 'false',
    });
    const unlimitedCreate = new CreateGame(
      unlimited.games,
      unlimited.generations,
      unlimited.ids,
      clock,
      { ...policy, newLimit: 1, modifyLimit: 1, jobCap: 0.01, dailyCap: 0.01 },
    );
    const input = {
      prompt: 'Explicit unbilled unlimited quota fixture.',
      orientation: 'portrait' as const,
    };
    try {
      await services.db.pool.query(
        'insert into daily_credits(user_id,day,spent_cost) values($1,$2,15)',
        [userId, now.slice(0, 10)],
      );
      const first = await unlimitedCreate.execute(userId, input);
      await unlimitedCreate.execute(userId, input);
      await unlimitedCreate.execute(userId, { ...input, gameId: first.gameId });
      await unlimitedCreate.execute(userId, { ...input, gameId: first.gameId });
      for (const estimatedEnabled of [true, false]) {
        const uncapped = new InferenceBudget(unlimited.db, estimatedEnabled, false);
        const usage = await uncapped.reserve(first.generationId, 'explicit-unbilled-fixture', 20);
        await uncapped.settle(usage, 25);
      }
      const job = await unlimited.db.pool.query(
        'select charged_cost from generation_jobs where id=$1',
        [first.generationId],
      );
      expect(Number(job.rows[0].charged_cost)).toBe(50);
      expect(await unlimited.credits.balance(userId, now)).toMatchObject({
        enabled: false,
        held: 0,
      });
      // Enabling each quota restores its own check against the preserved jobs.
      for (const [key, gameId, code] of [
        ['GENERATION_DAILY_LIMIT_ENABLED', undefined, 'DAILY_QUOTA'],
        ['MODIFICATION_DAILY_LIMIT_ENABLED', first.gameId, 'DAILY_QUOTA'],
        ['GENERATION_CONCURRENT_LIMIT_ENABLED', undefined, 'CONCURRENT_LIMIT'],
        ['OPENROUTER_DAILY_COST_LIMIT_ENABLED', undefined, 'GLOBAL_BUDGET'],
      ] as const) {
        const enabled = compose({
          ...config,
          GENERATION_CREDITS_ENABLED: 'false',
          GENERATION_DAILY_LIMIT_ENABLED: 'false',
          MODIFICATION_DAILY_LIMIT_ENABLED: 'false',
          GENERATION_CONCURRENT_LIMIT_ENABLED: 'false',
          OPENROUTER_DAILY_COST_LIMIT_ENABLED: 'false',
          [key]: 'true',
        });
        try {
          await expect(
            new CreateGame(enabled.games, enabled.generations, enabled.ids, clock, {
              ...policy,
              newLimit: 1,
              modifyLimit: 1,
              dailyCap: 0.01,
            }).execute(userId, { ...input, gameId }),
          ).rejects.toMatchObject({ code });
        } finally {
          await enabled.db.close();
        }
      }
      await expect(
        new InferenceBudget(unlimited.db, true, true).reserve(
          first.generationId,
          'explicit-unbilled-fixture',
          1,
        ),
      ).rejects.toMatchObject({ code: 'JOB_BUDGET' });
    } finally {
      await unlimited.db.close();
    }
  });

  it('gives new accounts 15 credits and isolates the authenticated balance endpoint', async () => {
    expect(await balance()).toMatchObject({ available: 15, spent: 0, held: 0 });
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const signed = await client.auth.signInWithPassword({
      email,
      password: 'Credits-fixture-2048!',
    });
    if (signed.error) throw signed.error;
    const other = await admin.auth.admin.createUser({
      email: `credits-${services.ids.token().slice(0, 12)}@example.com`,
      password: 'Credits-fixture-2048!',
      email_confirm: true,
    });
    if (other.error) throw other.error;
    const otherId = other.data.user.id;
    await services.db.pool.query(
      'insert into daily_credits(user_id,day,spent_cost) values($1,$2,12)',
      [otherId, now.slice(0, 10)],
    );
    const app = await createServer({ ...services, clock });
    try {
      expect((await app.inject({ url: '/me/credits' })).statusCode).toBe(401);
      const reply = await app.inject({
        url: `/me/credits?userId=${otherId}`,
        headers: { authorization: `Bearer ${signed.data.session!.access_token}` },
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.headers['cache-control']).toBe('private, no-store');
      expect(reply.json()).toEqual(await balance());
      expect(
        (
          await app.inject({
            url: '/me/credits',
            headers: { authorization: 'Bearer forged-token' },
          })
        ).statusCode,
      ).toBe(401);
      await services.db.transaction(async (c) => {
        await c.query('set local role authenticated');
        await expect(c.query('update daily_credits set spent_cost=0')).rejects.toThrow(
          'permission denied',
        );
      });
    } finally {
      await app.close();
      await admin.auth.admin.deleteUser(otherId);
      await services.db.pool.query('delete from analytics_outbox where user_id=$1', [otherId]);
    }
  });
  it('charges create and modify at actual fractional costs and releases unused holds', async () => {
    const job = await start();
    expect(await balance()).toMatchObject({ available: 5, spent: 0, held: 10 });
    const usage = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 0.5);
    await budget.settle(usage, 0.123456);
    expect(await balance()).toMatchObject({ available: 5, spent: 0.123456, held: 9.876544 });
    await services.generations.stage(job.generationId, 'ready');
    expect(await balance()).toMatchObject({ available: 14.876544, spent: 0.123456, held: 0 });
    const modification = await start(job.gameId);
    expect(modification.generation.kind).toBe('modify');
    const modifiedUsage = await budget.reserve(
      modification.generationId,
      'explicit-unbilled-fixture',
      0.5,
    );
    await budget.settle(modifiedUsage, 0.25);
    await services.generations.stage(modification.generationId, 'failed');
    expect(await balance()).toMatchObject({ available: 14.626544, spent: 0.373456, held: 0 });
  });
  it('caps a new job at remaining credits and rejects creation and modification after exhaustion', async () => {
    const first = await start();
    const usage = await budget.reserve(first.generationId, 'explicit-unbilled-fixture', 10);
    await budget.settle(usage, 10);
    await services.generations.stage(first.generationId, 'ready');
    const second = await start(first.gameId);
    const row = await services.db.pool.query(
      'select reserved_cost from generation_jobs where id=$1',
      [second.generationId],
    );
    expect(Number(row.rows[0].reserved_cost)).toBe(5);
    await expect(
      budget.reserve(second.generationId, 'explicit-unbilled-fixture', 5.01),
    ).rejects.toMatchObject({ code: 'JOB_BUDGET' });
    const remaining = await budget.reserve(second.generationId, 'explicit-unbilled-fixture', 5);
    await budget.settle(remaining, 5);
    await services.generations.stage(second.generationId, 'ready');
    expect(await balance()).toMatchObject({ available: 0, spent: 15, held: 0 });
    await expect(start()).rejects.toMatchObject({ code: 'CREDITS_EXHAUSTED' });
    await expect(start(first.gameId)).rejects.toMatchObject({ code: 'CREDITS_EXHAUSTED' });
    expect(await services.generations.list(userId)).toHaveLength(2);
  });
  it('resets at midnight without a cron and keeps late settlement on the original job day', async () => {
    now = '2040-01-01T23:59:59.999Z';
    const job = await start();
    const usage = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1);
    now = '2040-01-02T00:00:00.000Z';
    expect(await balance()).toMatchObject({
      available: 15,
      spent: 0,
      held: 0,
      resetsAt: '2040-01-03T00:00:00.000Z',
    });
    await budget.settle(usage, 0.4);
    await services.generations.stage(job.generationId, 'failed');
    expect(await balance()).toMatchObject({ available: 15, spent: 0, held: 0 });
    expect(await services.credits.balance(userId, '2040-01-01T23:59:59Z')).toMatchObject({
      available: 14.6,
      spent: 0.4,
      held: 0,
    });
    const next = await start();
    await services.generations.stage(next.generationId, 'cancelled');
    expect(await balance()).toMatchObject({ available: 15, spent: 0, held: 0 });
  });
  it('settles once even concurrently and refunds only unused credits after cancellation', async () => {
    const job = await start();
    const usage = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1);
    await services.generations.stage(job.generationId, 'cancelled');
    expect(await balance()).toMatchObject({ available: 14, spent: 1, held: 0 });
    await Promise.all([budget.settle(usage, 0.25), budget.settle(usage, 0.25)]);
    await services.generations.stage(job.generationId, 'cancelled');
    expect(await balance()).toMatchObject({ available: 14.75, spent: 0.25, held: 0 });
    await expect(
      budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1),
    ).rejects.toMatchObject({ code: 'JOB_INACTIVE' });
  });
  it('retains costs after deleting games and releases active holds on deletion', async () => {
    const job = await start();
    const usage = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1);
    await budget.settle(usage, 0.75);
    await services.games.remove(job.gameId, userId);
    expect(await balance()).toMatchObject({ available: 14.25, spent: 0.75, held: 0 });
    await services.db.pool.query('delete from games where id=$1', [job.gameId]);
    expect(await balance()).toMatchObject({ available: 14.25, spent: 0.75, held: 0 });
    // setup:local/db:migrate can revisit SQL already applied by Supabase startup.
    await services.db.transaction(async (c) => {
      await c.query(
        await readFile('infrastructure/supabase/migrations/202610110004_daily_credits.sql', 'utf8'),
      );
      await c.query(
        await readFile(
          'infrastructure/supabase/migrations/202610110006_guest_credit_transfers.sql',
          'utf8',
        ),
      );
      await c.query(
        await readFile(
          'infrastructure/supabase/migrations/202610110008_optional_generation_credits.sql',
          'utf8',
        ),
      );
      await c.query(
        await readFile('infrastructure/supabase/migrations/202610110009_credit_grants.sql', 'utf8'),
      );
    });
    expect(await balance()).toMatchObject({ available: 14.25, spent: 0.75, held: 0 });
    const next = await start();
    await services.db.pool.query('delete from games where id=$1', [next.gameId]);
    expect(await balance()).toMatchObject({ available: 14.25, spent: 0.75, held: 0 });
  });
  it('reserves atomically under simultaneous create requests', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => start()));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await balance()).toMatchObject({ available: 5, spent: 0, held: 10 });
    const [job] = await services.generations.list(userId);
    await services.generations.stage(job!.id, 'cancelled');
    expect(await balance()).toMatchObject({ available: 15, spent: 0, held: 0 });
  });
  it('rejects invalid billed costs and retains a conservative charge when usage is unknown', async () => {
    const job = await start();
    const usage = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1);
    for (const cost of [NaN, Infinity, -1])
      await expect(budget.settle(usage, cost)).rejects.toMatchObject({ code: 'MODEL_PRICING' });
    await budget.settle(usage, undefined);
    await services.generations.stage(job.generationId, 'failed');
    expect(await balance()).toMatchObject({ available: 14, spent: 1, held: 0 });
  });
  it('handles exact fractional budgets without floating-point rejection or sub-microdollar holds', async () => {
    const usecase = new CreateGame(services.games, services.generations, services.ids, clock, {
      ...policy,
      jobCap: 0.3,
    });
    const job = await usecase.execute(userId, {
      prompt: 'Explicit unbilled decimal credit fixture game.',
      orientation: 'portrait',
    });
    await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 0.2);
    await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 0.1);
    await services.generations.stage(job.generationId, 'cancelled');
    expect(await balance()).toMatchObject({ available: 14.7, spent: 0.3, held: 0 });
    const next = await start();
    await budget.reserve(next.generationId, 'explicit-unbilled-fixture', 0.0000001);
    await services.generations.stage(next.generationId, 'failed');
    expect(await balance()).toMatchObject({ available: 14.699999, spent: 0.300001, held: 0 });
  });

  it('retains grants across daily resets, refunds unused holds and retains deleted-game costs', async () => {
    await services.db.pool.query(
      'insert into credit_grants(id,user_id,amount,reason) values($1,$2,30,$3)',
      [services.ids.next('grant'), userId, 'Explicit unbilled grant fixture'],
    );
    expect(await balance()).toMatchObject({ available: 45 });
    await services.db.pool.query(
      'insert into daily_credits(user_id,day,spent_cost) values($1,$2,15)',
      [userId, now.slice(0, 10)],
    );
    const first = await start();
    expect(await balance()).toMatchObject({ available: 20, held: 10 });
    const usage = await budget.reserve(first.generationId, 'explicit-unbilled-fixture', 5);
    now = '2040-01-02T12:00:00.000Z';
    expect(await balance()).toMatchObject({ available: 35, spent: 0, held: 0 });
    await budget.settle(usage, 2.5);
    await services.generations.stage(first.generationId, 'ready');
    expect(await services.credits.balance(userId, '2040-01-01T12:00:00.000Z')).toMatchObject({
      available: 27.5,
      spent: 17.5,
      held: 0,
    });
    expect(await balance()).toMatchObject({ available: 42.5, spent: 0, held: 0 });
    const next = await start();
    const nextUsage = await budget.reserve(next.generationId, 'explicit-unbilled-fixture', 1);
    await services.generations.stage(next.generationId, 'cancelled');
    await budget.settle(nextUsage, 0.4);
    expect(await balance()).toMatchObject({ available: 42.1, spent: 0.4, held: 0 });
    await services.db.pool.query('delete from games where id=$1', [first.gameId]);
    expect(await balance()).toMatchObject({ available: 42.1 });
  });
  it('shows a granted balance on installed clients while paused jobs leave the grant untouched', async () => {
    await services.db.pool.query(
      'insert into credit_grants(id,user_id,amount,reason) values($1,$2,1000,$3)',
      [services.ids.next('grant'), userId, 'Explicit unbilled grant fixture'],
    );
    const paused = compose({ ...config, GENERATION_CREDITS_ENABLED: 'false' });
    try {
      expect(await paused.credits.balance(userId, now)).toMatchObject({
        enabled: false,
        available: 1015,
      });
      const job = await new CreateGame(
        paused.games,
        paused.generations,
        paused.ids,
        clock,
        policy,
      ).execute(userId, {
        prompt: 'Explicit unbilled grant and paused-credit fixture.',
        orientation: 'portrait',
      });
      const usage = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1);
      await budget.settle(usage, 0.5);
      await paused.generations.stage(job.generationId, 'failed');
      expect(await paused.credits.balance(userId, now)).toMatchObject({ available: 1015 });
      expect(await balance()).toMatchObject({ available: 1015, spent: 0, held: 0 });
    } finally {
      await paused.db.close();
    }
  });
  it('caps reservations at remaining grants and denies direct client access to grant accounting', async () => {
    await services.db.pool.query(
      'insert into credit_grants(id,user_id,amount,reason) values($1,$2,3,$3)',
      [services.ids.next('grant'), userId, 'Explicit unbilled grant fixture'],
    );
    await services.db.pool.query(
      'insert into daily_credits(user_id,day,spent_cost) values($1,$2,15)',
      [userId, now.slice(0, 10)],
    );
    const job = await start();
    const row = await services.db.pool.query(
      'select reserved_cost from generation_jobs where id=$1',
      [job.generationId],
    );
    expect(Number(row.rows[0].reserved_cost)).toBe(3);
    const usage = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 3);
    await budget.settle(usage, 3);
    await services.generations.stage(job.generationId, 'ready');
    expect(await balance()).toMatchObject({ available: 0 });
    await expect(start()).rejects.toMatchObject({ code: 'CREDITS_EXHAUSTED' });
    for (const query of [
      'select * from credit_grants',
      'select public.generation_credit_bonus($1)',
    ]) {
      await services.db.transaction(async (c) => {
        await c.query('set local role authenticated');
        await expect(c.query(query, query.includes('$1') ? [userId] : [])).rejects.toThrow(
          'permission denied',
        );
      });
    }
  });

  it('bypasses oversized estimates, bills actual usage once and settles correctly after changing the switch', async () => {
    const actualOnly = new InferenceBudget(services.db, false);
    const job = await start();
    const usage = await actualOnly.reserve(job.generationId, 'explicit-unbilled-fixture', 25);
    expect(await balance()).toMatchObject({ spent: 0, held: 10 });
    expect(
      (
        await services.db.pool.query('select estimated_reserved from inference_usage where id=$1', [
          usage,
        ])
      ).rows[0].estimated_reserved,
    ).toBe(false);
    await Promise.all([budget.settle(usage, 2.5), actualOnly.settle(usage, 2.5)]);
    expect(await balance()).toMatchObject({ spent: 2.5, held: 7.5 });
    const next = await actualOnly.reserve(job.generationId, 'explicit-unbilled-fixture', 50);
    await actualOnly.settle(next, 0.5);
    // Re-enable estimates: an already-reserved call must still refund its reservation.
    const reserved = await budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1);
    await actualOnly.settle(reserved, 0.25);
    // An estimate smaller than the bill has no enforcement significance in actual-only mode.
    const underestimated = await actualOnly.reserve(
      job.generationId,
      'explicit-unbilled-fixture',
      0.01,
    );
    await actualOnly.settle(underestimated, 0.1);
    await services.generations.stage(job.generationId, 'ready');
    expect(await balance()).toMatchObject({ spent: 3.35, held: 0, available: 11.65 });
  });
  it('records actual cost overruns before stopping further calls when estimates are bypassed', async () => {
    const actualOnly = new InferenceBudget(services.db, false);
    const job = await start();
    const usage = await actualOnly.reserve(job.generationId, 'explicit-unbilled-fixture', 30);
    await expect(actualOnly.settle(usage, 10.25)).rejects.toMatchObject({ code: 'JOB_BUDGET' });
    expect(await balance()).toMatchObject({ spent: 10.25, held: 0, available: 4.75 });
    await actualOnly.settle(usage, 10.25);
    await expect(
      actualOnly.reserve(job.generationId, 'explicit-unbilled-fixture', 1),
    ).rejects.toMatchObject({ code: 'JOB_BUDGET' });
    await services.generations.stage(job.generationId, 'failed');
    expect(await balance()).toMatchObject({ spent: 10.25, held: 0 });
  });
  it('serializes actual-only requests and stops on missing billed cost instead of treating it as zero', async () => {
    const actualOnly = new InferenceBudget(services.db, false);
    const job = await start();
    const calls = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        actualOnly.reserve(job.generationId, 'explicit-unbilled-fixture', 25),
      ),
    );
    expect(calls.filter((call) => call.status === 'fulfilled')).toHaveLength(1);
    expect(
      calls
        .filter((call) => call.status === 'rejected')
        .every((call) => call.reason.code === 'INFERENCE_PENDING'),
    ).toBe(true);
    const [usage] = calls.flatMap((call) => (call.status === 'fulfilled' ? [call.value] : []));
    await expect(actualOnly.settle(usage!, undefined)).rejects.toMatchObject({
      code: 'MODEL_USAGE_MISSING',
    });
    await expect(
      budget.reserve(job.generationId, 'explicit-unbilled-fixture', 1),
    ).rejects.toMatchObject({ code: 'INFERENCE_PENDING' });
    await expect(
      actualOnly.reserve(job.generationId, 'explicit-unbilled-fixture', 25),
    ).rejects.toMatchObject({ code: 'INFERENCE_PENDING' });
    await services.generations.stage(job.generationId, 'cancelled');
    // Late provider reconciliation remains possible even after cancellation.
    await budget.settle(usage!, 0.5);
    expect(await balance()).toMatchObject({ spent: 0.5, held: 0, available: 14.5 });
    await expect(
      actualOnly.reserve(job.generationId, 'explicit-unbilled-fixture', 25),
    ).rejects.toMatchObject({ code: 'JOB_INACTIVE' });
  });

  it('pauses create and modify charges without resetting exhausted balances or provider budgets', async () => {
    await services.db.pool.query(
      'insert into daily_credits(user_id,day,spent_cost) values($1,$2,15)',
      [userId, now.slice(0, 10)],
    );
    const paused = compose({ ...config, GENERATION_CREDITS_ENABLED: 'false' });
    const pausedCreate = new CreateGame(
      paused.games,
      paused.generations,
      paused.ids,
      clock,
      policy,
    );
    const input = {
      prompt: 'Explicit unbilled paused-credit fixture game.',
      orientation: 'portrait' as const,
    };
    const app = await createServer({ ...paused, clock, policy });
    try {
      expect(await paused.credits.balance(userId, now)).toMatchObject({
        enabled: false,
        available: 15,
        spent: 0,
        held: 0,
      });
      const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signed = await client.auth.signInWithPassword({
        email,
        password: 'Credits-fixture-2048!',
      });
      if (signed.error) throw signed.error;
      expect((await app.inject({ url: '/me/credits' })).statusCode).toBe(401);
      const reply = await app.inject({
        url: '/me/credits',
        headers: { authorization: `Bearer ${signed.data.session!.access_token}` },
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.headers['cache-control']).toBe('private, no-store');
      expect(reply.json()).toMatchObject({ enabled: false, available: 15, spent: 0, held: 0 });
      const first = await pausedCreate.execute(userId, input);
      const row = await services.db.pool.query(
        'select reserved_cost,credits_enabled from generation_jobs where id=$1',
        [first.generationId],
      );
      expect(row.rows[0]).toMatchObject({ reserved_cost: '10.000000', credits_enabled: false });
      await expect(
        budget.reserve(first.generationId, 'explicit-unbilled-fixture', 10.01),
      ).rejects.toMatchObject({ code: 'JOB_BUDGET' });
      await expect(pausedCreate.execute(userId, input)).rejects.toMatchObject({
        code: 'CONCURRENT_LIMIT',
      });
      const usage = await budget.reserve(first.generationId, 'explicit-unbilled-fixture', 0.5);
      await budget.settle(usage, 0.123456);
      await paused.generations.stage(first.generationId, 'ready');
      const modified = await pausedCreate.execute(userId, { ...input, gameId: first.gameId });
      const modificationUsage = await budget.reserve(
        modified.generationId,
        'explicit-unbilled-fixture',
        0.5,
      );
      await budget.settle(modificationUsage, 0.25);
      await paused.generations.stage(modified.generationId, 'cancelled');
      const actual = await services.db.pool.query(
        'select charged_cost from generation_jobs where id=$1',
        [modified.generationId],
      );
      expect(Number(actual.rows[0].charged_cost)).toBe(0.25);
      expect(await balance()).toMatchObject({ enabled: true, available: 0, spent: 15, held: 0 });
      await expect(
        services.db.pool.query('update generation_jobs set credits_enabled=true where id=$1', [
          modified.generationId,
        ]),
      ).rejects.toThrow('Generation credit policy is immutable');
      await services.db.pool.query('delete from games where id=$1', [first.gameId]);
      expect(await balance()).toMatchObject({ available: 0, spent: 15, held: 0 });
      // Re-enabling credits uses the preserved ledger and never bills paused jobs retroactively.
      await expect(start()).rejects.toMatchObject({ code: 'CREDITS_EXHAUSTED' });
    } finally {
      await app.close();
      await paused.db.close();
    }
  });

  it('keeps daily server and generation limits when user credit charging is paused', async () => {
    const paused = compose({ ...config, GENERATION_CREDITS_ENABLED: 'false' });
    const input = {
      prompt: 'Explicit unbilled paused-limit fixture game.',
      orientation: 'portrait' as const,
    };
    try {
      const capped = new CreateGame(paused.games, paused.generations, paused.ids, clock, {
        ...policy,
        dailyCap: 0.01,
      });
      await expect(capped.execute(userId, input)).rejects.toMatchObject({ code: 'GLOBAL_BUDGET' });
      const limited = new CreateGame(paused.games, paused.generations, paused.ids, clock, {
        ...policy,
        newLimit: 1,
      });
      const job = await limited.execute(userId, input);
      await paused.generations.stage(job.generationId, 'failed');
      await expect(limited.execute(userId, input)).rejects.toMatchObject({ code: 'DAILY_QUOTA' });
      const ledger = await services.db.pool.query('select 1 from daily_credits where user_id=$1', [
        userId,
      ]);
      expect(ledger.rowCount).toBe(0);
    } finally {
      await paused.db.close();
    }
  });

  it('settles previously metered jobs and late paused-job usage according to their original policy', async () => {
    const metered = await start();
    const meteredUsage = await budget.reserve(metered.generationId, 'explicit-unbilled-fixture', 1);
    const paused = compose({ ...config, GENERATION_CREDITS_ENABLED: 'false' });
    try {
      await budget.settle(meteredUsage, 0.25);
      await paused.generations.stage(metered.generationId, 'ready');
      expect(await balance()).toMatchObject({ spent: 0.25, held: 0, available: 14.75 });
      const unmetered = await new CreateGame(
        paused.games,
        paused.generations,
        paused.ids,
        clock,
        policy,
      ).execute(userId, {
        prompt: 'Explicit unbilled late-settlement fixture.',
        orientation: 'portrait',
      });
      const usage = await budget.reserve(unmetered.generationId, 'explicit-unbilled-fixture', 1);
      // Use the enabled repository for completion before a late settlement.
      await services.generations.stage(unmetered.generationId, 'cancelled');
      await budget.settle(usage, 0.4);
      expect(await balance()).toMatchObject({ spent: 0.25, held: 0, available: 14.75 });
    } finally {
      await paused.db.close();
    }
  });
});
