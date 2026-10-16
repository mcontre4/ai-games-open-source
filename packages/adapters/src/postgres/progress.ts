import { DomainError, type Save } from '../../../domain/src/index.ts';
import type { ProgressRepository } from '../../../application/src/ports.ts';
import type { Database } from './db.ts';
const columns = `game_id as "gameId",version_id as "versionId",schema_version as "schemaVersion",revision,state`;
export class PgProgress implements ProgressRepository {
  constructor(private db: Database) {}
  async load(userId: string, gameId: string) {
    return (
      (
        await this.db.pool.query<Save>(
          `select ${columns} from player_saves where user_id=$1 and game_id=$2`,
          [userId, gameId],
        )
      ).rows[0] ?? null
    );
  }
  async save(
    userId: string,
    gameId: string,
    input: Omit<Save, 'gameId' | 'revision'>,
    baseRevision: number,
  ) {
    return this.db.transaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`${userId}:${gameId}`]);
      const current = (
        await c.query<Save>(
          `select ${columns} from player_saves where user_id=$1 and game_id=$2 for update`,
          [userId, gameId],
        )
      ).rows[0];
      if ((current?.revision ?? 0) !== baseRevision)
        throw new DomainError(
          'REVISION_CONFLICT',
          'The cloud has a newer save. Your local copy is retained for recovery.',
          409,
        );
      return (
        await c.query<Save>(
          `insert into player_saves(user_id,game_id,version_id,schema_version,state,revision) values($1,$2,$3,$4,$5,1) on conflict(user_id,game_id) do update set version_id=excluded.version_id,schema_version=excluded.schema_version,state=excluded.state,revision=player_saves.revision+1,updated_at=now() returning ${columns}`,
          [userId, gameId, input.versionId, input.schemaVersion, JSON.stringify(input.state)],
        )
      ).rows[0]!;
    });
  }
  async score(userId: string, gameId: string, versionId: string, score: number) {
    await this.db.pool.query(
      'insert into game_scores(user_id,game_id,version_id,score) values($1,$2,$3,$4) on conflict(user_id,game_id) do update set score=greatest(game_scores.score,excluded.score),version_id=excluded.version_id,updated_at=now()',
      [userId, gameId, versionId, score],
    );
  }
  async leaderboard(gameId: string) {
    return (
      await this.db.pool.query<{ player: string; score: number }>(
        `select p.display_name as player,s.score::int as score from game_scores s join profiles p on p.id=s.user_id join games g on g.id=s.game_id where s.game_id=$1 and p.leaderboard_visible and (g.is_public or g.owner_id=s.user_id or exists(select 1 from game_members m join share_invitations i on i.id=m.invitation_id where m.game_id=g.id and m.user_id=s.user_id and not i.revoked)) order by score desc limit 20`,
        [gameId],
      )
    ).rows;
  }
}
