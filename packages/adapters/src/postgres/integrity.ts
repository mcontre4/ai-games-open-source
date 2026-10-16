import type {
  AppInstance,
  IntegrityChallenge,
  IntegrityRepository,
} from '../../../application/src/integrity-ports.ts';
import { invalidIntegrity } from '../../../application/src/integrity.ts';
import { DomainError } from '../../../domain/src/index.ts';
import type { Database } from './db.ts';

export class PgIntegrity implements IntegrityRepository {
  constructor(
    private db: Database,
    private challengeLimitEnabled = true,
  ) {}
  async issue(input: IntegrityChallenge, now: string) {
    await this.db.transaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`integrity:${input.userId}`]);
      await c.query('delete from app_integrity_challenges where expires_at <= $1', [now]);
      const count = await c.query<{ count: number }>(
        'select count(*)::int as count from app_integrity_challenges where user_id=$1',
        [input.userId],
      );
      if (this.challengeLimitEnabled && count.rows[0]!.count >= 20)
        throw new DomainError('RATE_LIMIT', 'Too many pending app checks. Try again shortly.', 429);
      await c.query(
        'insert into app_integrity_challenges(nonce,user_id,purpose,expires_at) values($1,$2,$3,$4)',
        [input.nonce, input.userId, input.purpose, input.expiresAt],
      );
    });
  }
  async challenge(nonce: string) {
    return (
      (
        await this.db.pool.query<IntegrityChallenge>(
          'select nonce,user_id as "userId",purpose,expires_at::text as "expiresAt" from app_integrity_challenges where nonce=$1',
          [nonce],
        )
      ).rows[0] ?? null
    );
  }
  async instance(keyId: string) {
    return (
      (
        await this.db.pool.query<AppInstance>(
          'select key_id as "keyId",user_id as "userId",public_key as "publicKey",counter::float8 as counter from app_integrity_instances where key_id=$1',
          [keyId],
        )
      ).rows[0] ?? null
    );
  }
  async complete(input: Parameters<IntegrityRepository['complete']>[0]) {
    await this.db.transaction(async (c) => {
      const consumed = await c.query(
        'delete from app_integrity_challenges where nonce=$1 and user_id=$2 and purpose=$3 and expires_at>$4 returning nonce',
        [input.nonce, input.userId, input.purpose, input.now],
      );
      if (!consumed.rowCount) throw invalidIntegrity();
      if (input.registration) {
        const key = input.registration;
        const inserted = await c.query(
          'insert into app_integrity_instances(key_id,user_id,public_key,counter) values($1,$2,$3,0) on conflict do nothing returning key_id',
          [key.keyId, key.userId, key.publicKey],
        );
        // Never reset a registered key counter or reassign it to a different user.
        if (!inserted.rowCount) throw invalidIntegrity();
      }
      if (input.assertion) {
        const { keyId, counter } = input.assertion;
        const advanced = await c.query(
          'update app_integrity_instances set counter=$3 where key_id=$1 and user_id=$2 and counter<$3 returning key_id',
          [keyId, input.userId, counter],
        );
        if (!advanced.rowCount) throw invalidIntegrity();
      }
    });
  }
}
