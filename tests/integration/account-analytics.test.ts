import { it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { configSchema } from '../../packages/config/src/index.ts';
import { Database } from '../../packages/adapters/src/postgres/db.ts';
import { DispatchAccountAnalytics } from '../../packages/adapters/src/postgres/account-analytics.ts';
import { noAnalytics } from '../../packages/application/src/analytics.ts';
it('durably records account creation/update/deletion without profile data and acknowledges only successful delivery', async () => {
  const config = configSchema.parse(process.env);
  const db = new Database(config.DATABASE_URL);
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let userId: string | undefined;
  try {
    const created = await admin.auth.admin.createUser({
      email: `analytics-${Date.now()}@example.com`,
      password: 'Test-only-Password-2048!',
      email_confirm: true,
      user_metadata: { display_name: 'Private name', age_confirmed: true },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const updated = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { display_name: 'Private changed name' },
    });
    if (updated.error) throw updated.error;
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw deleted.error;
    const rows = await db.pool.query(
      'select * from analytics_outbox where user_id=$1 order by created_at',
      [userId],
    );
    expect(rows.rows[0]?.event).toBe('account_created');
    expect(rows.rows.at(-1)?.event).toBe('account_deleted');
    expect(rows.rows.some((row) => row.event === 'account_updated')).toBe(true);
    const eventCount = rows.rowCount;
    expect(JSON.stringify(rows.rows)).not.toContain('Private');
    expect(JSON.stringify(rows.rows)).not.toContain('@');
    const sent: { event: string; id: string; insertId: unknown }[] = [];
    let succeeds = false;
    const telemetry = {
      ...noAnalytics,
      capture(event: string, id: string, properties: Record<string, unknown> = {}) {
        sent.push({ event, id, insertId: properties.event_id });
      },
      flush: async () => succeeds,
    };
    const dispatcher = new DispatchAccountAnalytics(db, telemetry);
    expect(await dispatcher.execute(userId)).toBe(0);
    expect(
      (await db.pool.query('select id from analytics_outbox where user_id=$1', [userId])).rowCount,
    ).toBe(eventCount);
    const firstIds = sent.filter((e) => e.id === userId).map((e) => e.insertId);
    sent.length = 0;
    succeeds = true;
    expect(await dispatcher.execute(userId)).toBe(eventCount);
    expect(sent.filter((e) => e.id === userId).map((e) => e.insertId)).toEqual(firstIds);
    expect(
      (await db.pool.query('select id from analytics_outbox where user_id=$1', [userId])).rowCount,
    ).toBe(0);
    await db.transaction(async (connection) => {
      await connection.query('set local role authenticated');
      await expect(connection.query('select * from analytics_outbox')).rejects.toThrow(
        'permission denied',
      );
    });
  } finally {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
      await db.pool.query('delete from analytics_outbox where user_id=$1', [userId]);
    }
    await db.close();
  }
});
