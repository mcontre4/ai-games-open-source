import type { AnalyticsPort } from '../../../application/src/analytics.ts';
import type { Database } from './db.ts';
/** Rows are acknowledged only after flush; stable insert IDs deduplicate retries. */
export class DispatchAccountAnalytics {
  constructor(
    private db: Database,
    private analytics: AnalyticsPort,
  ) {}
  async execute(userId?: string) {
    return this.db.transaction(async (connection) => {
      const { rows } = await connection.query<{
        id: string;
        user_id: string;
        event: string;
        email_confirmed: boolean;
        created_at: Date;
      }>(
        'select id,user_id,event,email_confirmed,created_at from analytics_outbox where ($1::uuid is null or user_id=$1) order by created_at limit 100 for update skip locked',
        [userId ?? null],
      );
      if (!rows.length) return 0;
      for (const row of rows)
        this.analytics.capture(row.event, row.user_id, {
          event_id: row.id,
          occurred_at: row.created_at.toISOString(),
          email_confirmed: row.email_confirmed,
          source: 'auth_database',
        });
      if (!(await this.analytics.flush())) return 0;
      await connection.query('delete from analytics_outbox where id=any($1::uuid[])', [
        rows.map((row) => row.id),
      ]);
      return rows.length;
    });
  }
}
