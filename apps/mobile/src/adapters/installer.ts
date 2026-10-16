import { Directory, File, Paths } from 'expo-file-system';
import { verifyPackage } from '../../../../packages/game-sdk/src/package.ts';
import type { Game } from '../../../../packages/domain/src/index.ts';
import type { InstalledGame, LocalDatabase } from './sqlite';
import { installationDirectory } from './installation-path';
export class NativeInstaller {
  constructor(private db: LocalDatabase) {}
  async execute(
    account: string,
    game: Game,
    bytes: Uint8Array,
    publicKey: string,
    expected?: { gameId: string; versionId: string; checksum: string },
  ): Promise<InstalledGame> {
    const verified = verifyPackage(bytes, publicKey, expected);
    if (Paths.availableDiskSpace < verified.manifest.packageSize * 2 + 10 * 1024 * 1024)
      throw new Error('Not enough storage. Free some space and try again.');
    if (!/^[a-zA-Z0-9_-]+$/.test(account)) throw new Error('Invalid account scope.');
    const accountRoot = new Directory(Paths.document, 'games', account);
    accountRoot.create({ intermediates: true, idempotent: true });
    const final = new Directory(
      installationDirectory(Paths.document.uri, account, game.id, verified.manifest.versionId),
    );
    const stage = new Directory(accountRoot, `partial-${Date.now()}`);
    stage.create();
    try {
      for (const [path, content] of Object.entries(verified.files)) {
        const parts = path.split('/');
        parts.pop();
        const parent = new Directory(stage, ...parts);
        parent.create({ intermediates: true, idempotent: true });
        const file = new File(stage, path);
        file.create();
        file.write(content);
      }
      if (final.exists) {
        stage.delete();
      } else stage.move(final);
      const installed: InstalledGame = {
        game,
        manifest: verified.manifest,
        directory: final.uri,
        lastPlayed: null,
        bytes: verified.manifest.packageSize,
      };
      await this.db.install(account, installed);
      return installed;
    } catch (error) {
      if (stage.exists) stage.delete();
      throw error;
    }
  }
  async transferAccount(source: string, target: string, gameIds: string[]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(source) || !/^[a-zA-Z0-9_-]+$/.test(target))
      throw new Error('Invalid account scope.');
    const root = new Directory(Paths.document, 'games', target);
    root.create({ intermediates: true, idempotent: true });
    const copies: InstalledGame[] = [];
    for (const installed of await this.db.installed(source)) {
      const destination = new Directory(
        root,
        `${installed.game.id}-${installed.manifest.versionId}`,
      );
      if (!destination.exists) {
        const stage = new Directory(
          root,
          `partial-transfer-${installed.game.id}-${installed.manifest.versionId}`,
        );
        if (stage.exists) stage.delete();
        try {
          new Directory(installed.directory).copy(stage);
          stage.move(destination);
        } catch (error) {
          if (stage.exists) stage.delete();
          throw error;
        }
      }
      copies.push({
        ...installed,
        directory: destination.uri,
        game: {
          ...installed.game,
          ...(gameIds.includes(installed.game.id) ? { ownerId: target } : {}),
        },
      });
    }
    await this.db.transferAccount(source, target, copies);
    await this.purge(source);
  }
  async purge(account: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(account)) throw new Error('Invalid account.');
    const root = new Directory(Paths.document, 'games', account);
    if (root.exists) root.delete();
  }
  async remove(account: string, game: InstalledGame) {
    await this.db.uninstall(account, game.game.id);
    const dir = new Directory(game.directory);
    if (dir.exists) dir.delete();
  }
}
