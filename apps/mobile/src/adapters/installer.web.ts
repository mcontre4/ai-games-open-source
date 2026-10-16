import { verifyPackage } from '../../../../packages/game-sdk/src/package.ts';
import type { Game } from '../../../../packages/domain/src/index.ts';
import type { LocalDatabase, InstalledGame } from './sqlite';
export class NativeInstaller {
  constructor(private db: LocalDatabase) {}
  async execute(
    account: string,
    game: Game,
    bytes: Uint8Array,
    publicKey: string,
    expected?: { gameId: string; versionId: string; checksum: string },
  ): Promise<InstalledGame> {
    const { manifest } = verifyPackage(bytes, publicKey, expected);
    const installed: InstalledGame = {
      game,
      manifest,
      directory: 'bundled-fixture',
      lastPlayed: null,
      bytes: manifest.packageSize,
    };
    await this.db.install(account, installed);
    return installed;
  }
  async transferAccount(source: string, target: string, gameIds: string[]) {
    const installs = (await this.db.installed(source)).map((installed) => ({
      ...installed,
      game: {
        ...installed.game,
        ...(gameIds.includes(installed.game.id) ? { ownerId: target } : {}),
      },
    }));
    await this.db.transferAccount(source, target, installs);
  }
  async purge(_account: string) {}
  async remove(account: string, game: InstalledGame) {
    await this.db.uninstall(account, game.game.id);
  }
}
