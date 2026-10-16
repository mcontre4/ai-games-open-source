import { createClient } from '@supabase/supabase-js';
import { decodeJwt } from 'jose';
import { DomainError } from '../../domain/src/index.ts';
import type { Database } from './postgres/db.ts';
import type { AuthPort, StoragePort } from '../../application/src/ports.ts';
export class SupabaseAuth implements AuthPort {
  private client;
  constructor(
    private url: string,
    key: string,
    private db: Database,
    private storage?: StoragePort,
  ) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  async authenticate(token: string) {
    try {
      const claims = decodeJwt(token);
      if (
        claims.aud !== 'authenticated' ||
        !claims.exp ||
        claims.exp * 1000 <= Date.now() ||
        typeof claims.iss !== 'string' ||
        claims.iss !== this.url.replace(/\/$/, '') + '/auth/v1'
      )
        throw new Error('Invalid claims');
      // Auth server verifies signature, issuer, expiry AND current session/user validity.
      const { data, error } = await this.client.auth.getUser(token);
      if (error || !data.user) throw new Error('Invalid session');
      if (
        typeof claims.session_id !== 'string' ||
        !(
          await this.db.pool.query('select 1 from auth.sessions where id=$1 and user_id=$2', [
            claims.session_id,
            data.user.id,
          ])
        ).rowCount
      )
        throw new Error('Revoked session');
      if (
        (
          await this.db.pool.query(
            'select 1 from guest_account_claims where guest_id=$1 and claimed_at is not null',
            [data.user.id],
          )
        ).rowCount
      )
        throw new Error('Transferred guest');
      return {
        anonymous: data.user.is_anonymous === true,
        id: data.user.id,
        email: data.user.email ?? '',
        createdAt: data.user.created_at,
        ageConfirmed: data.user.user_metadata.age_confirmed === true,
      };
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Sign in again to continue.', 401);
    }
  }
  async deleteAccount(userId: string) {
    const games = await this.db.pool.query<{ id: string }>(
      'select id from games where owner_id=$1',
      [userId],
    );
    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (error) throw new DomainError('DELETE_FAILED', 'Account could not be deleted.', 503);
    for (const game of games.rows) await this.storage?.removeGame?.(game.id);
  }
}
