import type { PoolClient } from 'pg';
import {
  DomainError,
  activeStages,
  type Generation,
  type Game,
  type GameVersion,
  type Stage,
} from '../../../domain/src/index.ts';
import type { GenerationRepository } from '../../../application/src/ports.ts';
import { creditPeriod } from '../../../domain/src/credits.ts';
import type { Database } from './db.ts';
const columns = `id,game_id as "gameId",user_id as "userId",prompt,speed,kind,stage,error,base_version_id as "baseVersionId",created_at::text as "createdAt",retry_of as "retryOf",exists(select 1 from generation_checkpoints cp where cp.generation_id=generation_jobs.id) as "progressSaved"`;
export class PgGenerations implements GenerationRepository {
  constructor(
    private db: Database,
    private creditsEnabled = true,
    private limits = {
      dailyGeneration: true,
      dailyModification: true,
      concurrent: true,
      dailyCost: true,
      jobCost: true,
    },
  ) {}
  async reserve(input: {
    generation: Generation;
    game: Game | null;
    newLimit: number;
    modifyLimit: number;
    jobCap: number;
    dailyCap: number;
  }) {
    await this.db.transaction((c) => this.reserveWithin(input, c));
  }
  private async reserveWithin(
    input: Parameters<GenerationRepository['reserve']>[0],
    c: PoolClient,
  ) {
    const { generation: j, game: g } = input;
    await c.query("select pg_advisory_xact_lock(hashtext('generation-global'))");
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [j.userId]);
    if (
      (
        await c.query(
          'select 1 from guest_account_claims where guest_id=$1 and claimed_at is not null',
          [j.userId],
        )
      ).rowCount
    )
      throw new DomainError(
        'UNAUTHENTICATED',
        'This guest session has been linked to an account.',
        401,
      );
    const counts = await c.query<{ active: number; daily: number }>(
      `select count(*) filter(where stage=any($2))::int as active,count(*) filter(where kind=$3 and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')::int as daily from generation_jobs where user_id=$1`,
      [j.userId, activeStages, j.kind],
    );
    if (this.limits.concurrent && counts.rows[0]!.active >= 1)
      throw new DomainError('CONCURRENT_LIMIT', 'You already have a game being created.', 429);
    if (
      (j.kind === 'create' ? this.limits.dailyGeneration : this.limits.dailyModification) &&
      counts.rows[0]!.daily >= (j.kind === 'create' ? input.newLimit : input.modifyLimit)
    )
      throw new DomainError(
        'DAILY_QUOTA',
        'Your free daily generation limit has been reached.',
        429,
      );
    const day = creditPeriod(j.createdAt).day;
    let jobCap = input.jobCap;
    if (this.creditsEnabled) {
      await c.query('insert into daily_credits(user_id,day) values($1,$2) on conflict do nothing', [
        j.userId,
        day,
      ]);
      await c.query('select user_id from daily_credits where user_id=$1 and day=$2 for update', [
        j.userId,
        day,
      ]);
      const credits = await c.query<{ available: string }>(
        'select public.generation_credit_available($1,$2)::text as available',
        [j.userId, day],
      );
      jobCap = this.limits.jobCost
        ? Math.min(jobCap, Number(credits.rows[0]!.available))
        : Number(credits.rows[0]!.available);
      if (jobCap <= 0)
        throw new DomainError(
          'CREDITS_EXHAUSTED',
          'You have used your daily credits. Your 15 free credits reset at midnight UTC.',
          429,
        );
    }
    const budget = await c.query<{ cost: string }>(
      "select coalesce(sum(case when stage=any($1) then greatest(reserved_cost,charged_cost) else charged_cost end),0)::text as cost from generation_jobs where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'",
      [activeStages],
    );
    if (this.limits.dailyCost && Number(budget.rows[0]!.cost) + jobCap > input.dailyCap)
      throw new DomainError(
        'GLOBAL_BUDGET',
        'AI creation is temporarily paused for the daily spending limit.',
        429,
      );
    if (g)
      await c.query(
        'insert into games(id,owner_id,title,description,orientation,view,created_at) values($1,$2,$3,$4,$5,$6,$7)',
        [g.id, g.ownerId, g.title, g.description, g.orientation, g.view ?? '2d', g.createdAt],
      );
    await c.query(
      'insert into generation_jobs(id,game_id,user_id,prompt,kind,base_version_id,reserved_cost,created_at,credit_day,credits_enabled,retry_of,speed) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        j.id,
        j.gameId,
        j.userId,
        j.prompt,
        j.kind,
        j.baseVersionId,
        jobCap,
        j.createdAt,
        day,
        this.creditsEnabled,
        j.retryOf ?? null,
        j.speed ?? 'regular',
      ],
    );
    await c.query('insert into generation_outbox(generation_id) values($1)', [j.id]);
    await c.query("insert into generation_events(generation_id,stage) values($1,'queued')", [j.id]);
  }

  async retry(input: NonNullable<Parameters<NonNullable<GenerationRepository['retry']>>[0]>) {
    return this.db.transaction(async (c) => {
      await c.query("select pg_advisory_xact_lock(hashtext('generation-global'))");
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [input.userId]);
      const parent = (
        await c.query<Generation>(
          `select ${columns} from generation_jobs where id=$1 and user_id=$2 for update`,
          [input.id, input.userId],
        )
      ).rows[0];
      if (!parent) throw new DomainError('NOT_FOUND', 'Generation not found.', 404);
      if (parent.stage !== 'failed')
        throw new DomainError('NOT_FAILED', 'Only failed creations can be resumed.', 409);
      const existing = (
        await c.query<Generation>(`select ${columns} from generation_jobs where retry_of=$1`, [
          input.id,
        ])
      ).rows[0];
      if (existing) return existing;
      if (
        (
          await c.query(
            'select 1 from inference_usage where generation_id=$1 and settled_at is null limit 1',
            [input.id],
          )
        ).rowCount
      )
        throw new DomainError(
          'INFERENCE_PENDING',
          'The provider bill is still being reconciled. Your progress is saved; try again later.',
          409,
        );
      const generation = {
        ...input.generation,
        gameId: parent.gameId,
        userId: parent.userId,
        prompt: parent.prompt,
        speed: parent.speed ?? 'regular',
        kind: parent.kind,
        baseVersionId: parent.baseVersionId,
        retryOf: parent.id,
      };
      const spending = (
        await c.query<{ cost: string }>(
          `
        with recursive lineage as (
          select id,retry_of,charged_cost from generation_jobs where id=$1
          union all select j.id,j.retry_of,j.charged_cost from generation_jobs j join lineage l on j.id=l.retry_of
        ) select coalesce(sum(charged_cost),0)::text as cost from lineage`,
          [parent.id],
        )
      ).rows[0]!;
      const jobCap = this.limits.jobCost
        ? input.policy.jobCap - Number(spending.cost)
        : input.policy.jobCap;
      if (this.limits.jobCost && jobCap <= 0)
        throw new DomainError(
          'JOB_BUDGET',
          'This creation reached its total inference spending limit.',
          429,
        );
      await this.reserveWithin({ generation, game: null, ...input.policy, jobCap }, c);
      // The outbox and inherited checkpoint become visible atomically. A retry
      // receives today's allowance; the old job's actual spending stays recorded.
      await c.query(
        `insert into generation_checkpoints(generation_id,state)
        select $2,state || '{"attempts":0}'::jsonb from generation_checkpoints where generation_id=$1`,
        [parent.id, generation.id],
      );
      return { ...generation, progressSaved: parent.progressSaved };
    });
  }
  async get(id: string) {
    const row = (
      await this.db.pool.query<Generation>(`select ${columns} from generation_jobs where id=$1`, [
        id,
      ])
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND', 'Generation not found.', 404);
    return row;
  }
  async list(userId: string) {
    return (
      await this.db.pool.query<Generation>(
        `select ${columns} from generation_jobs where user_id=$1 order by created_at desc limit 100`,
        [userId],
      )
    ).rows;
  }
  async stage(id: string, stage: Stage, error?: string) {
    await this.db.transaction(async (c) => {
      const result = await c.query(
        "update generation_jobs set stage=$2,error=$3,updated_at=now() where id=$1 and stage not in ('cancelled','ready','failed') returning id",
        [id, stage, error ?? null],
      );
      if (result.rowCount)
        await c.query('insert into generation_events(generation_id,stage) values($1,$2)', [
          id,
          stage,
        ]);
    });
  }
  async publish(id: string, v: GameVersion, title: string, description: string) {
    await this.db.transaction(async (c) => {
      const row = await c.query('select stage from generation_jobs where id=$1 for update', [id]);
      if (row.rows[0]?.stage !== 'packaging')
        throw new DomainError('CANCELLED', 'Job cannot be published.');
      await c.query(
        'insert into game_versions(id,game_id,number,artifact_key,source_key,package_bytes,checksum,state_schema_version,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          v.id,
          v.gameId,
          v.number,
          v.artifactKey,
          v.sourceKey,
          v.packageBytes,
          v.checksum,
          v.stateSchemaVersion,
          v.createdAt,
        ],
      );
      await c.query(
        'update games set current_version_id=$2,title=case when metadata_edited then title else $3 end,description=case when metadata_edited then description else $4 end where id=$1',
        [v.gameId, v.id, title, description],
      );
      await c.query("update generation_jobs set stage='ready',updated_at=now() where id=$1", [id]);
      await c.query("insert into generation_events(generation_id,stage) values($1,'ready')", [id]);
    });
  }
}
