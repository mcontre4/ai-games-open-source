import { DomainError, type Game, type GameVersion } from '../../../domain/src/index.ts';
import type { GameRepository } from '../../../application/src/ports.ts';
import type { Database } from './db.ts';
export const gameColumns = `g.id,g.owner_id as "ownerId",g.title,g.description,g.orientation,g.view,g.current_version_id as "currentVersionId",g.is_public as public,g.fixture,g.created_at::text as "createdAt",(select json_build_object('id',p.id,'username',p.username,'displayName',p.display_name,'avatarId',p.avatar_id) from profiles p where p.id=g.owner_id) as creator`;
export const accessSql = `g.deleted_at is null and (g.is_public or g.owner_id=$2::uuid or exists(select 1 from game_members m join share_invitations s on m.invitation_id=s.id where m.game_id=g.id and m.user_id=$2::uuid and not s.revoked)) and not exists(select 1 from blocked_users b where b.user_id=$2::uuid and b.creator_id=g.owner_id)`;
export const versionColumns = `id,game_id as "gameId",number,artifact_key as "artifactKey",source_key as "sourceKey",package_bytes as "packageBytes",checksum,state_schema_version as "stateSchemaVersion",created_at::text as "createdAt"`;
export class PgGames implements GameRepository {
  constructor(private db: Database) {}
  async list(userId: string, ownerId?: string) {
    return (
      await this.db.pool.query<Game>(
        `select ${gameColumns} from games g where ${accessSql} and ($1::uuid is null or g.owner_id=$1::uuid) and not exists(select 1 from hidden_games h where h.game_id=g.id and h.user_id=$2::uuid) order by g.created_at desc limit 200`,
        [ownerId ?? null, userId],
      )
    ).rows;
  }
  async accessible(id: string, userId: string) {
    const row = (
      await this.db.pool.query<Game>(
        `select ${gameColumns} from games g where g.id=$1 and ${accessSql}`,
        [id, userId],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND', 'Game not found or access revoked.', 404);
    return row;
  }
  async updateMetadata(id: string, userId: string, title: string, description: string) {
    await this.db.pool.query(
      'update games set title=$3,description=$4,metadata_edited=true where id=$1 and owner_id=$2 and deleted_at is null',
      [id, userId, title, description],
    );
  }
  async versions(id: string) {
    return (
      await this.db.pool.query<GameVersion>(
        `select ${versionColumns} from game_versions where game_id=$1 order by number desc`,
        [id],
      )
    ).rows;
  }
  async version(id: string) {
    const row = (
      await this.db.pool.query<GameVersion>(
        `select ${versionColumns} from game_versions where id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND', 'Version not found.', 404);
    return row;
  }
  async remove(id: string, userId: string) {
    await this.db.pool.query('update games set deleted_at=now() where id=$1 and owner_id=$2', [
      id,
      userId,
    ]);
    await this.db.pool.query(
      "update generation_jobs set stage='cancelled' where game_id=$1 and stage not in ('ready','failed','cancelled')",
      [id],
    );
  }
  async removeFromLibrary(id: string, userId: string) {
    await this.accessible(id, userId);
    await this.db.pool.query(
      'insert into hidden_games(user_id,game_id) values($1,$2) on conflict do nothing',
      [userId, id],
    );
  }
  async report(id: string, userId: string, reason: string, detail: string) {
    await this.accessible(id, userId);
    await this.db.pool.query(
      'insert into game_reports(game_id,reporter_id,reason,detail) values($1,$2,$3,$4)',
      [id, userId, reason, detail],
    );
  }
  async block(userId: string, creatorId: string) {
    await this.db.pool.query(
      'insert into blocked_users(user_id,creator_id) values($1,$2) on conflict do nothing',
      [userId, creatorId],
    );
  }
}
