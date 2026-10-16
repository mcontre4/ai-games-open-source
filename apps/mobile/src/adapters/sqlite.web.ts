import type { Game, Save, Json } from '../../../../packages/domain/src/index.ts';
import type { Manifest } from '../../../../packages/contracts/src/index.ts';
export interface InstalledGame {
  game: Game;
  manifest: Manifest;
  directory: string;
  lastPlayed: string | null;
  bytes: number;
}
export class LocalDatabase {
  private read<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(`aigames:${key}`) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  }
  private write(key: string, value: unknown) {
    localStorage.setItem(`aigames:${key}`, JSON.stringify(value));
  }
  async transferAccount(source: string, target: string, installs: InstalledGame[]) {
    if (source === target) return;
    const guestGames = (await this.library(source)).map((game) => ({
      ...game,
      ownerId: game.ownerId === source ? target : game.ownerId,
    }));
    await this.cache(target, [
      ...new Map(
        [...guestGames, ...(await this.library(target))].map((game) => [game.id, game]),
      ).values(),
    ]);
    for (const installed of installs)
      if (!(await this.installed(target)).some((item) => item.game.id === installed.game.id))
        await this.install(target, installed);
    const keys = Object.keys(localStorage).filter((item) => item.startsWith(`aigames:${source}:`));
    for (const key of keys) {
      if (key.endsWith(':installs') || key.endsWith(':library')) continue;
      const destination = key.replace(`aigames:${source}:`, `aigames:${target}:`);
      if (localStorage.getItem(destination) === null)
        localStorage.setItem(destination, localStorage.getItem(key)!);
    }
    await this.purge(source);
  }
  async cache(account: string, games: Game[]) {
    this.write(`${account}:library`, games);
  }
  async library(account: string): Promise<Game[]> {
    return this.read(`${account}:library`, []);
  }
  async installed(account: string): Promise<InstalledGame[]> {
    return this.read(`${account}:installs`, []);
  }
  async install(account: string, game: InstalledGame) {
    this.write(`${account}:installs`, [
      ...(await this.installed(account)).filter((g) => g.game.id !== game.game.id),
      game,
    ]);
  }
  async uninstall(account: string, id: string) {
    this.write(
      `${account}:installs`,
      (await this.installed(account)).filter((g) => g.game.id !== id),
    );
  }
  async load(account: string, id: string): Promise<Save | null> {
    return this.read(`${account}:${id}:save`, null);
  }
  async save(account: string, m: Manifest, state: Json) {
    const previous = await this.load(account, m.gameId);
    this.write(`${account}:${m.gameId}:save`, {
      gameId: m.gameId,
      versionId: m.versionId,
      schemaVersion: m.stateSchemaVersion,
      revision: previous?.revision ?? 0,
      state,
    });
    this.write(`${account}:${m.gameId}:dirty`, true);
  }
  async score(account: string, m: Manifest, score: number) {
    this.write(
      `${account}:${m.gameId}:score`,
      Math.max(this.read(`${account}:${m.gameId}:score`, 0), score),
    );
  }
  async pending(_account: string): Promise<{ save: Save; localRevision: number }[]> {
    return [];
  }
  async restore(account: string, save: Save) {
    if (!(await this.load(account, save.gameId)))
      this.write(`${account}:${save.gameId}:save`, save);
  }
  async acknowledge(_account: string, _save: Save, _revision: number) {}
  async conflict(_account: string, _local: Save, _cloud: Save, _revision: number) {}
  async conflicts(_account: string): Promise<{ gameId: string; local: Save; cloud: Save }[]> {
    return [];
  }
  async pendingScores(
    _account: string,
  ): Promise<{ game_id: string; version_id: string; score: number }[]> {
    return [];
  }
  async scoreAcknowledged(_account: string, _id: string, _score: number) {}
  async purge(account: string) {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`aigames:${account}:`)) localStorage.removeItem(key);
  }
}
