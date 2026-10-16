import { DomainError } from '../../../domain/src/index.ts';
import type {
  AccountProfile,
  CreatorProfile,
  Profile,
  ProfileUpdate,
} from '../../../domain/src/profile.ts';
import type { ProfileRepository } from '../../../application/src/ports.ts';
import type { Database } from './db.ts';
const identity = `p.id,p.username,p.display_name as "displayName",p.avatar_id as "avatarId"`;
const publicColumns = `${identity},p.bio,to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",p.profile_visible as "profileVisible"`;
const accountColumns = `${publicColumns},p.auto_sync as "autoSync",p.leaderboard_visible as "leaderboardVisible"`;
export class PgProfiles implements ProfileRepository {
  constructor(private db: Database) {}
  async account(userId: string) {
    const row = (
      await this.db.pool.query<AccountProfile>(
        `select ${accountColumns} from profiles p where id=$1`,
        [userId],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND', 'Profile not found.', 404);
    return row;
  }
  async update(userId: string, input: ProfileUpdate) {
    try {
      await this.db.pool.query(
        `update profiles set username=$2,display_name=$3,avatar_id=$4,bio=$5,profile_visible=$6,auto_sync=$7,leaderboard_visible=$8 where id=$1`,
        [
          userId,
          input.username,
          input.displayName,
          input.avatarId,
          input.bio,
          input.profileVisible,
          input.autoSync,
          input.leaderboardVisible,
        ],
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new DomainError('USERNAME_TAKEN', 'That username is taken. Choose another.', 409);
      throw error;
    }
    return this.account(userId);
  }
  async creator(username: string, viewerId: string) {
    const row = (
      await this.db.pool.query<Profile>(
        `select ${publicColumns} from profiles p where username=$1 and (profile_visible or p.id=$2) and not exists(select 1 from blocked_users b where b.user_id=$2 and b.creator_id=p.id)`,
        [username, viewerId],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND', 'Creator profile is unavailable.', 404);
    return row;
  }
  async blocked(userId: string) {
    return (
      await this.db.pool.query<CreatorProfile>(
        `select ${identity} from blocked_users b join profiles p on p.id=b.creator_id where b.user_id=$1 order by p.username`,
        [userId],
      )
    ).rows;
  }
  async unblock(userId: string, creatorId: string) {
    await this.db.pool.query('delete from blocked_users where user_id=$1 and creator_id=$2', [
      userId,
      creatorId,
    ]);
  }
  async export(userId: string) {
    const profile = await this.account(userId);
    const data: Record<string, unknown> = { profile };
    for (const [key, table, column] of [
      ['games', 'games', 'owner_id'],
      ['saves', 'player_saves', 'user_id'],
      ['scores', 'game_scores', 'user_id'],
      ['reports', 'game_reports', 'reporter_id'],
      ['blocks', 'blocked_users', 'user_id'],
      ['memberships', 'game_members', 'user_id'],
      ['generations', 'generation_jobs', 'user_id'],
      ['credits', 'daily_credits', 'user_id'],
      ['hiddenGames', 'hidden_games', 'user_id'],
    ]) {
      data[key!] = (
        await this.db.pool.query(`select * from ${table} where ${column}=$1`, [userId])
      ).rows;
    }
    return data;
  }
}
