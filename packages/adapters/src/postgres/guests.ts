import type { GuestAccountRepository } from '../../../application/src/guests.ts';
import { DomainError } from '../../../domain/src/index.ts';
import type { Database } from './db.ts';

const unavailable = () =>
  new DomainError(
    'GUEST_CLAIM_INVALID',
    'These guest games could not be linked to this account.',
    403,
  );
export class PgGuestAccounts implements GuestAccountRepository {
  constructor(private db: Database) {}
  async issue(guestId: string, tokenHash: string) {
    const result = await this.db.pool.query(
      `insert into guest_account_claims(guest_id,token_hash)
       select id,$2 from auth.users where id=$1 and is_anonymous
       on conflict(guest_id) do update set token_hash=excluded.token_hash where guest_account_claims.claimed_at is null
       returning guest_id`,
      [guestId, tokenHash],
    );
    if (!result.rowCount) throw unavailable();
  }
  async claim(tokenHash: string, accountId: string) {
    return this.db.transaction(async (c) => {
      // Same lock order as generation reservation: no new jobs can slip into a transferred guest.
      await c.query("select pg_advisory_xact_lock(hashtext('generation-global'))");
      const found = await c.query<{
        guest_id: string;
        account_id: string | null;
        claimed_at: string | null;
        game_ids: string[];
      }>('select * from guest_account_claims where token_hash=$1 for update', [tokenHash]);
      const claim = found.rows[0];
      if (!claim) throw unavailable();
      if (claim.claimed_at) {
        if (claim.account_id !== accountId) throw unavailable();
        return { guestId: claim.guest_id, gameIds: claim.game_ids };
      }
      const source = await c.query(
        'select id from auth.users where id=$1 and is_anonymous for update',
        [claim.guest_id],
      );
      const target = await c.query(
        'select id from auth.users where id=$1 and not is_anonymous for update',
        [accountId],
      );
      if (!source.rowCount || !target.rowCount || claim.guest_id === accountId) throw unavailable();
      for (const id of [claim.guest_id, accountId].sort())
        await c.query('select pg_advisory_xact_lock(hashtext($1))', [id]);
      // Lock jobs before credit rows, matching inference reservation/settlement order.
      await c.query(
        'select id from generation_jobs where user_id=any($1::uuid[]) order by id for update',
        [[claim.guest_id, accountId]],
      );
      await c.query(
        'update guest_account_claims set account_id=$2,claimed_at=now() where guest_id=$1',
        [claim.guest_id, accountId],
      );
      await c.query(
        `insert into daily_credits(user_id,day,spent_cost,held_cost)
        select $2,day,spent_cost,held_cost from daily_credits where user_id=$1
        on conflict(user_id,day) do update set spent_cost=daily_credits.spent_cost+excluded.spent_cost,held_cost=daily_credits.held_cost+excluded.held_cost`,
        [claim.guest_id, accountId],
      );
      await c.query('delete from daily_credits where user_id=$1', [claim.guest_id]);
      await c.query('update credit_grants set user_id=$2 where user_id=$1', [
        claim.guest_id,
        accountId,
      ]);
      const games = await c.query<{ id: string }>(
        'update games set owner_id=$2 where owner_id=$1 returning id',
        [claim.guest_id, accountId],
      );
      await c.query('update generation_jobs set user_id=$2 where user_id=$1', [
        claim.guest_id,
        accountId,
      ]);
      await c.query('update share_invitations set owner_id=$2 where owner_id=$1', [
        claim.guest_id,
        accountId,
      ]);
      for (const table of [
        'player_saves',
        'game_scores',
        'game_members',
        'hidden_games',
      ] as const) {
        // Preserve the destination's existing progress; transfer nonconflicting guest records.
        await c.query(
          `delete from ${table} guest using ${table} target where guest.user_id=$1 and target.user_id=$2 and guest.game_id=target.game_id`,
          [claim.guest_id, accountId],
        );
        await c.query(`update ${table} set user_id=$2 where user_id=$1`, [
          claim.guest_id,
          accountId,
        ]);
      }
      await c.query('update game_reports set reporter_id=$2 where reporter_id=$1', [
        claim.guest_id,
        accountId,
      ]);
      const gameIds = games.rows.map((g) => g.id);
      await c.query(
        'update guest_account_claims set account_id=$2,claimed_at=now(),game_ids=$3 where guest_id=$1',
        [claim.guest_id, accountId, gameIds],
      );
      // Revoke the old identity in Auth and RLS as well as the API, without deleting live jobs.
      await c.query('delete from auth.sessions where user_id=$1', [claim.guest_id]);
      return { guestId: claim.guest_id, gameIds };
    });
  }
}
