import { DomainError } from '../../domain/src/index.ts';
import type { IdPort } from './ports.ts';

export interface GuestAccountRepository {
  issue(guestId: string, tokenHash: string): Promise<void>;
  claim(tokenHash: string, accountId: string): Promise<{ guestId: string; gameIds: string[] }>;
}
export class IssueGuestClaim {
  constructor(
    private repository: GuestAccountRepository,
    private ids: IdPort,
  ) {}
  async execute(user: { id: string; anonymous?: boolean }) {
    if (!user.anonymous)
      throw new DomainError(
        'GUEST_REQUIRED',
        'Only guest sessions can prepare an account transfer.',
        403,
      );
    const token = this.ids.token();
    await this.repository.issue(user.id, this.ids.hash(token));
    return { token, guestId: user.id };
  }
}
export class ClaimGuestGames {
  constructor(
    private repository: GuestAccountRepository,
    private ids: IdPort,
  ) {}
  async execute(user: { id: string; anonymous?: boolean }, token: string) {
    if (user.anonymous)
      throw new DomainError(
        'ACCOUNT_REQUIRED',
        'Create an account or sign in to keep your guest games.',
        403,
      );
    return this.repository.claim(this.ids.hash(token), user.id);
  }
}
