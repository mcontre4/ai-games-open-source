import type { CloudSavePort, LocalSavePort } from './ports.ts';
export class SynchronizeOfflineProgress {
  constructor(
    private local: LocalSavePort,
    private cloud: CloudSavePort,
  ) {}
  async execute(accountId: string): Promise<{ synced: number; conflicts: number }> {
    let synced = 0,
      conflicts = 0;
    for (const local of await this.local.pending(accountId)) {
      try {
        const cloud = await this.cloud.push(local, local.revision);
        await this.local.acknowledge(accountId, local.gameId, local.revision, cloud);
        synced++;
      } catch (error) {
        if (error instanceof Error && error.message === 'REVISION_CONFLICT') {
          const cloud = await this.cloud.load(local.gameId);
          if (cloud) {
            await this.local.conflict(accountId, local.gameId, local, cloud);
            conflicts++;
          }
        } else break;
      }
    }
    return { synced, conflicts };
  }
}
