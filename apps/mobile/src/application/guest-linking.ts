export interface PendingGuestClaim {
  token: string;
  guestId: string;
  accountId?: string;
}
export interface GuestClaimStoragePort {
  load(): Promise<PendingGuestClaim | null>;
  save(claim: PendingGuestClaim): Promise<void>;
  remove(): Promise<void>;
}
export interface GuestLinkingApiPort {
  issue(): Promise<{ token: string; guestId: string }>;
  claim(token: string, accountId: string): Promise<{ guestId: string; gameIds: string[] }>;
}
export class PrepareGuestLink {
  constructor(
    private api: GuestLinkingApiPort,
    private storage: GuestClaimStoragePort,
  ) {}
  async execute(guestId: string) {
    const pending = await this.storage.load();
    if (pending?.guestId === guestId) return;
    if (pending) throw new Error('Sign in to finish linking your previous guest games first.');
    const issued = await this.api.issue();
    if (issued.guestId !== guestId) throw new Error('Account changed. Try again.');
    await this.storage.save(issued);
  }
}
export class CompleteGuestLink {
  constructor(
    private api: GuestLinkingApiPort,
    private storage: GuestClaimStoragePort,
    private moveLocal: (guestId: string, accountId: string, gameIds: string[]) => Promise<void>,
  ) {}
  async execute(accountId: string) {
    const pending = await this.storage.load();
    if (!pending) return;
    if (pending.accountId && pending.accountId !== accountId)
      throw new Error('Sign in to the account you chose to finish linking your guest games.');
    // Bind retries to the first chosen account before making the request.
    await this.storage.save({ ...pending, accountId });
    const result = await this.api.claim(pending.token, accountId);
    await this.moveLocal(result.guestId, accountId, result.gameIds);
    await this.storage.remove();
  }
}
