import { DomainError, type Game, type Invitation } from '../../../domain/src/index.ts';
import type { SharingRepository } from '../../../application/src/ports.ts';
import type { Database } from './db.ts';
import { gameColumns } from './games.ts';
export class PgSharing implements SharingRepository {
  constructor(private db: Database) {}
  async create(ownerId: string, gameId: string, hash: string, id: string, expiresAt: string) {
    await this.db.pool.query(
      'insert into share_invitations(id,game_id,owner_id,token_hash,expires_at) values($1,$2,$3,$4,$5)',
      [id, gameId, ownerId, hash, expiresAt],
    );
    return { id, gameId, expiresAt, revoked: false };
  }
  async accept(userId: string, hash: string, now: string) {
    return this.db.transaction(async (c) => {
      const result = await c.query<Invitation>(
        'select id,game_id as "gameId",expires_at::text as "expiresAt",revoked from share_invitations where token_hash=$1 for update',
        [hash],
      );
      const invitation = result.rows[0];
      if (!invitation || invitation.revoked || Date.parse(invitation.expiresAt) <= Date.parse(now))
        throw new DomainError('INVALID_INVITATION', 'This invitation expired or was revoked.', 404);
      const game = (
        await c.query<Game>(
          `select ${gameColumns} from games g where id=$1 and deleted_at is null and not exists(select 1 from blocked_users where user_id=$2 and creator_id=g.owner_id)`,
          [invitation.gameId, userId],
        )
      ).rows[0];
      if (!game) throw new DomainError('NOT_FOUND', 'Game not available.', 404);
      await c.query(
        'insert into game_members(game_id,user_id,invitation_id) values($1,$2,$3) on conflict(game_id,user_id) do update set invitation_id=excluded.invitation_id',
        [game.id, userId, invitation.id],
      );
      await c.query('delete from hidden_games where user_id=$1 and game_id=$2', [userId, game.id]);
      return game;
    });
  }
  async list(gameId: string) {
    return (
      await this.db.pool.query<Invitation & { playerIds: string[] }>(
        `select i.id,i.game_id as "gameId",i.expires_at::text as "expiresAt",i.revoked,coalesce(array_agg(m.user_id::text) filter(where m.user_id is not null),'{}') as "playerIds" from share_invitations i left join game_members m on m.invitation_id=i.id where i.game_id=$1 group by i.id`,
        [gameId],
      )
    ).rows;
  }
  async revoke(ownerId: string, id: string) {
    const r = await this.db.pool.query(
      'update share_invitations set revoked=true where id=$1 and owner_id=$2 returning id',
      [id, ownerId],
    );
    if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Invitation not found.', 404);
  }
}
