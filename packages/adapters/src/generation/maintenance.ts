import { recoverSandbox } from './recovery.ts';
import { safeAnalytics, type AnalyticsPort } from '../../../application/src/analytics.ts';
import type {
  ClockPort,
  GenerationCheckpointPort,
  StoragePort,
  IdPort,
} from '../../../application/src/ports.ts';
import type { Database } from '../postgres/db.ts';
import { docker } from './docker-sandbox.ts';
export class ReapAbandonedGenerations {
  constructor(
    private db: Database,
    private clock: ClockPort,
    private graceMs = 30 * 60_000,
    private analytics?: AnalyticsPort,
    private recovery?: { checkpoints: GenerationCheckpointPort; storage: StoragePort; ids: IdPort },
  ) {}
  async execute() {
    const deadline = new Date(Date.parse(this.clock.now()) - this.graceMs).toISOString();
    const result = await this.db.pool.query<{
      id: string;
      user_id: string;
      game_id: string;
      kind: string;
      created_at: Date;
    }>(
      "select id,user_id,game_id,kind,created_at from generation_jobs where stage not in ('failed','cancelled','ready') and updated_at < $1",
      [deadline],
    );
    let reaped = 0;
    for (const { id, user_id, game_id, kind, created_at } of result.rows) {
      const lease = await this.db.pool.connect();
      try {
        if (
          !(
            await lease.query<{ locked: boolean }>(
              'select pg_try_advisory_lock(hashtext($1)) as locked',
              ['worker:' + id],
            )
          ).rows[0]!.locked
        )
          continue;
        const current = (
          await lease.query<{ stage: string; updated_at: Date }>(
            'select stage,updated_at from generation_jobs where id=$1',
            [id],
          )
        ).rows[0];
        if (
          !current ||
          ['ready', 'failed', 'cancelled'].includes(current.stage) ||
          current.updated_at.toISOString() >= deadline
        )
          continue;
        if (this.recovery)
          await recoverSandbox(
            id,
            game_id,
            this.recovery.checkpoints,
            this.recovery.storage,
            this.recovery.ids,
          );
        const failed = await lease.query(
          "update generation_jobs set stage='failed',error='Worker interrupted. Your saved creation can be resumed.',updated_at=now() where id=$1 and stage not in ('ready','failed','cancelled') returning id",
          [id],
        );
        if (!failed.rowCount) continue;
        reaped++;
        safeAnalytics(this.analytics).capture('generation_failed', user_id, {
          generation_id: id,
          game_id,
          kind,
          source: 'live',
          error_code: 'WORKER_INTERRUPTED',
          total_duration_ms: Math.max(0, Date.parse(this.clock.now()) - created_at.getTime()),
        });
        const tag = `aig-${id.replaceAll('_', '-')}`;
        await docker(['rm', '-f', tag, `${tag}-gateway`]).catch(() => {});
        await docker(['network', 'rm', `${tag}-net`]).catch(() => {});
        await this.db.pool.query(
          "insert into generation_events(generation_id,stage) values($1,'failed')",
          [id],
        );
      } finally {
        await lease
          .query('select pg_advisory_unlock(hashtext($1))', ['worker:' + id])
          .catch(() => {});
        lease.release();
      }
    }
    return reaped;
  }
}
