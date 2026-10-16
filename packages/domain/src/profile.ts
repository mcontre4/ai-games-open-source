import { DomainError } from './index.ts';

export const avatarIds = [
  'blob',
  'sprout',
  'noodle',
  'puddle',
  'crumb',
  'wiggle',
  'moss',
  'pip',
  'fizz',
  'orbit',
] as const;
export type AvatarId = (typeof avatarIds)[number];
export interface CreatorProfile {
  id: string;
  username: string;
  displayName: string;
  avatarId: AvatarId;
}
export interface Profile extends CreatorProfile {
  bio: string;
  createdAt: string;
  profileVisible: boolean;
}
export interface AccountProfile extends Profile {
  autoSync: boolean;
  leaderboardVisible: boolean;
}
export type ProfileUpdate = Omit<AccountProfile, 'id' | 'createdAt'>;

export function validateProfile(input: ProfileUpdate): ProfileUpdate {
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();
  if (!/^[a-z0-9_]{4,25}$/.test(username))
    throw new DomainError(
      'INVALID_USERNAME',
      'Use 4–25 letters, numbers or underscores for your username.',
    );
  if (['admin', 'administrator', 'support', 'aigames', 'moderator'].includes(username))
    throw new DomainError('INVALID_USERNAME', 'That username is reserved. Choose another.');
  if (
    !displayName ||
    displayName.length > 40 ||
    bio.length > 280 ||
    !avatarIds.includes(input.avatarId)
  )
    throw new DomainError('INVALID_PROFILE', 'Check your display name, bio and creature.');
  return { ...input, username, displayName, bio };
}
