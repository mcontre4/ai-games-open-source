import { it, expect, vi } from 'vitest';
import { IssueGuestClaim, ClaimGuestGames } from '../../packages/application/src/guests.ts';
import {
  CompleteGuestLink,
  PrepareGuestLink,
  type PendingGuestClaim,
} from '../../apps/mobile/src/application/guest-linking.ts';
import { integrityIds } from '../integrity-fixture.ts';

it('issues ownership proof only to a guest and requires a registered destination', async () => {
  const repository = {
    issue: vi.fn(async () => {}),
    claim: vi.fn(async () => ({ guestId: 'guest', gameIds: ['game'] })),
  };
  const issue = new IssueGuestClaim(repository, integrityIds);
  await expect(issue.execute({ id: 'permanent' })).rejects.toMatchObject({ status: 403 });
  const credential = await issue.execute({ id: 'guest', anonymous: true });
  expect(repository.issue).toHaveBeenCalledWith('guest', integrityIds.hash(credential.token));
  const claim = new ClaimGuestGames(repository, integrityIds);
  await expect(
    claim.execute({ id: 'another-guest', anonymous: true }, credential.token),
  ).rejects.toMatchObject({ status: 403 });
  await claim.execute({ id: 'account', anonymous: false }, credential.token);
  expect(repository.claim).toHaveBeenCalledWith(integrityIds.hash(credential.token), 'account');
});
it('retains the guest credential across failures/restarts, binds retries to one account, and clears it after local transfer', async () => {
  let saved: PendingGuestClaim | null = { token: 'secret-ownership-proof', guestId: 'guest' };
  const storage = {
    load: async () => saved,
    save: async (value: PendingGuestClaim) => {
      saved = value;
    },
    remove: async () => {
      saved = null;
    },
  };
  const api = {
    issue: vi.fn(),
    claim: vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ guestId: 'guest', gameIds: ['game'] }),
  };
  const local = vi
    .fn()
    .mockRejectedValueOnce(new Error('Local copy failed'))
    .mockResolvedValue(undefined);
  await expect(new CompleteGuestLink(api, storage, local).execute('account')).rejects.toThrow(
    'Offline',
  );
  expect(saved).toMatchObject({ token: 'secret-ownership-proof', accountId: 'account' });
  await expect(new CompleteGuestLink(api, storage, local).execute('other-account')).rejects.toThrow(
    'account you chose',
  );
  expect(api.claim).toHaveBeenCalledTimes(1);
  await expect(new CompleteGuestLink(api, storage, local).execute('account')).rejects.toThrow(
    'Local copy failed',
  );
  expect(saved).not.toBeNull();
  await new CompleteGuestLink(api, storage, local).execute('account');
  expect(local).toHaveBeenLastCalledWith('guest', 'account', ['game']);
  expect(saved).toBeNull();
});
it('does not overwrite another pending guest or accept a credential for a switched session', async () => {
  let saved: PendingGuestClaim | null = { token: 'pending', guestId: 'first' };
  const storage = {
    load: async () => saved,
    save: async (value: PendingGuestClaim) => {
      saved = value;
    },
    remove: async () => {
      saved = null;
    },
  };
  const api = {
    issue: vi.fn(async () => ({ token: 'other', guestId: 'switched' })),
    claim: vi.fn(),
  };
  await new PrepareGuestLink(api, storage).execute('first');
  expect(api.issue).not.toHaveBeenCalled();
  await expect(new PrepareGuestLink(api, storage).execute('second')).rejects.toThrow(
    'previous guest games',
  );
  saved = null;
  await expect(new PrepareGuestLink(api, storage).execute('second')).rejects.toThrow(
    'Account changed',
  );
  expect(saved).toBeNull();
});
