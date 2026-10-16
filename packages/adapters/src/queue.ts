import { PgBoss } from 'pg-boss';
import type { QueuePort } from '../../application/src/ports.ts';
import type { Database } from './postgres/db.ts';
export class PostgresQueue implements QueuePort {
  readonly boss: PgBoss;
  private interval: ReturnType<typeof setInterval> | undefined;
  constructor(
    private db: Database,
    url: string,
  ) {
    this.boss = new PgBoss({ connectionString: url });
  }
  async start() {
    await this.boss.start();
    // Three bounded 30-minute attempts plus discovery/cleanup; queue retries
    // recover process crashes, while the persisted checkpoint bounds inference retries.
    await this.boss.createQueue('generate-game', {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 10800,
    });
    await this.dispatch();
    this.interval = setInterval(() => {
      void this.dispatch().catch(() => {});
    }, 2000);
  }
  async dispatch() {
    await this.db.transaction(async (c) => {
      const result = await c.query<{ generation_id: string }>(
        'select generation_id from generation_outbox where dispatched_at is null for update skip locked limit 20',
      );
      for (const row of result.rows) {
        await this.boss.send(
          'generate-game',
          { generationId: row.generation_id },
          {
            // Override older deployed queue defaults as well as fresh queues.
            expireInSeconds: 10800,
            retryLimit: 2,
            retryDelay: 30,
            retryBackoff: true,
            id: row.generation_id
              .replace('gen_', '')
              .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
          },
        );
        await c.query('update generation_outbox set dispatched_at=now() where generation_id=$1', [
          row.generation_id,
        ]);
      }
    });
  }
  async stop() {
    clearInterval(this.interval);
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}
