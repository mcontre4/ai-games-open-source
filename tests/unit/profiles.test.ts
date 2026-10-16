import { describe, expect, it } from 'vitest';
import { validateProfile, type ProfileUpdate } from '../../packages/domain/src/profile.ts';
import { profileUpdateSchema } from '../../packages/contracts/src/index.ts';
const input: ProfileUpdate = {
  username: 'little_blob',
  displayName: 'Little Blob',
  bio: 'I make games.',
  avatarId: 'blob',
  profileVisible: true,
  leaderboardVisible: true,
  autoSync: true,
};
describe('creator identity', () => {
  it('normalizes handles and trims user text', () => {
    expect(
      validateProfile({ ...input, username: ' Little_Blob ', displayName: ' Blob ', bio: ' Hi ' }),
    ).toMatchObject({ username: 'little_blob', displayName: 'Blob', bio: 'Hi' });
  });
  it.each(['abc', 'has spaces', 'bad-name', 'x'.repeat(26), 'admin', 'SUPPORT'])(
    'rejects invalid or reserved handle %s',
    (username) => {
      expect(() => validateProfile({ ...input, username })).toThrow();
    },
  );
  it('rejects invalid avatar identifiers, blank names and long bios', () => {
    for (const update of [
      { avatarId: 'https://untrusted.example/a.png' },
      { displayName: ' ' },
      { bio: 'x'.repeat(281) },
    ])
      expect(profileUpdateSchema.safeParse({ ...input, ...update }).success).toBe(false);
  });
  it('rejects supplied identities and unsupported settings at the boundary', () => {
    expect(profileUpdateSchema.safeParse({ ...input, id: 'another-user' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ ...input, ageConfirmed: true }).success).toBe(false);
  });
});
