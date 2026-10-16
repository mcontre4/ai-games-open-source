import type { CreditRepository } from '../../../application/src/ports.ts';
import { creditBalance, creditPeriod } from '../../../domain/src/credits.ts';
import type { Database } from './db.ts';

export class PgCredits implements CreditRepository {
  constructor(
    private db: Database,
    private enabled = true,
  ) {}
  async balance(userId: string, now: string) {
    // Keep the existing balance fields usable by already-installed clients.
    const result = await this.db.pool.query<{ spent: string; held: string; bonus: string }>(
      'select coalesce(c.spent_cost,0)::text as spent,coalesce(c.held_cost,0)::text as held,public.generation_credit_bonus($1)::text as bonus from (select 1) seed left join daily_credits c on c.user_id=$1 and c.day=$2',
      [userId, creditPeriod(now).day],
    );
    const bonus = Number(result.rows[0]!.bonus);
    if (!this.enabled) return { ...creditBalance(now, 0, 0, bonus), enabled: false };
    return creditBalance(
      now,
      Number(result.rows[0]?.spent ?? 0),
      Number(result.rows[0]?.held ?? 0),
      bonus,
    );
  }
}
