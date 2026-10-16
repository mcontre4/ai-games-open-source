import type { ProfileRepository, GameRepository } from './ports.ts';
import { validateProfile, type ProfileUpdate } from '../../domain/src/profile.ts';

export class GetAccountProfile {
  constructor(private profiles: ProfileRepository) {}
  execute(userId: string) {
    return this.profiles.account(userId);
  }
}
export class UpdateAccountProfile {
  constructor(private profiles: ProfileRepository) {}
  execute(userId: string, input: ProfileUpdate) {
    return this.profiles.update(userId, validateProfile(input));
  }
}
export class GetCreatorProfile {
  constructor(
    private profiles: ProfileRepository,
    private games: GameRepository,
  ) {}
  async execute(viewerId: string, username: string) {
    const profile = await this.profiles.creator(username.toLowerCase(), viewerId);
    const games = await this.games.list(viewerId, profile.id);
    return { profile, games };
  }
}
export class ListBlockedCreators {
  constructor(private profiles: ProfileRepository) {}
  execute(userId: string) {
    return this.profiles.blocked(userId);
  }
}
export class UnblockCreator {
  constructor(private profiles: ProfileRepository) {}
  execute(userId: string, creatorId: string) {
    return this.profiles.unblock(userId, creatorId);
  }
}
export class ExportAccountData {
  constructor(private profiles: ProfileRepository) {}
  execute(userId: string) {
    return this.profiles.export(userId);
  }
}
