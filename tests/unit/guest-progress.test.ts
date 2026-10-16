import { afterEach, it, expect, vi } from 'vitest';
import type { SQLInputValue } from 'node:sqlite';
import type { Manifest } from '../../packages/contracts/src/index.ts';
import { game } from '../helpers.ts';

// Actual SQLite SQL/transactions behind an explicit Expo transport fixture.
// This verifies persisted data behavior, not native-device installation.
const state = vi.hoisted(() => ({
  db: undefined as import('node:sqlite').DatabaseSync | undefined,
}));
vi.mock('../../apps/mobile/node_modules/expo-file-system', () => ({
  Paths: { document: { uri: 'file:///explicit-documents/' } },
}));
vi.mock('../../apps/mobile/node_modules/expo-sqlite/build/index.js', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    openDatabaseAsync: async () => {
      const db = (state.db = new DatabaseSync(':memory:'));
      const methods = {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args),
        getAllAsync: async (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args),
        getFirstAsync: async (sql: string, ...args: SQLInputValue[]) =>
          db.prepare(sql).get(...args) ?? null,
      };
      const adapter = {
        ...methods,
        withTransactionAsync: async (operation: () => Promise<void>) => transaction(operation),
        withExclusiveTransactionAsync: async (operation: (tx: typeof methods) => Promise<void>) =>
          transaction(() => operation(adapter)),
      };
      async function transaction(operation: () => Promise<void>) {
        db.exec('begin');
        try {
          await operation();
          db.exec('commit');
        } catch (error) {
          db.exec('rollback');
          throw error;
        }
      }
      return adapter;
    },
  };
});
import type { Game, Save, Json } from '../../packages/domain/src/index.ts';
type InstalledGame = {
  game: Game;
  manifest: Manifest;
  directory: string;
  bytes: number;
  lastPlayed: string | null;
};
interface FixtureDatabase {
  cache(account: string, games: Game[]): Promise<void>;
  library(account: string): Promise<Game[]>;
  save(account: string, manifest: Manifest, state: Json): Promise<void>;
  load(account: string, id: string): Promise<Save | null>;
  score(account: string, manifest: Manifest, score: number): Promise<void>;
  install(account: string, game: InstalledGame): Promise<void>;
  installed(account: string): Promise<InstalledGame[]>;
  transferAccount(source: string, target: string, installs: InstalledGame[]): Promise<void>;
  pendingScores(account: string): Promise<{ game_id: string; version_id: string; score: number }[]>;
}
// Dynamic import prevents Expo's native ambient globals from entering server type checking.
const adapterPath = '../../apps/mobile/src/adapters/sqlite.ts';
const { LocalDatabase } = (await import(adapterPath)) as {
  LocalDatabase: new () => FixtureDatabase;
};
const manifest = {
  gameId: game.id,
  versionId: 'ver_guestfixture',
  stateSchemaVersion: 1,
} as Manifest;
afterEach(() => {
  state.db?.close();
  state.db = undefined;
});
it('moves guest caches, installations, saves and scores while retaining destination progress and retry safety', async () => {
  const db = new LocalDatabase();
  const owned = { ...game, ownerId: 'guest-source' };
  const shared = { ...game, id: 'game_shared', ownerId: 'another-creator' };
  const sharedManifest = { ...manifest, gameId: shared.id };
  await db.cache('guest-source', [owned, shared]);
  await db.cache('registered', [shared]);
  await db.save('guest-source', manifest, { coins: 42 });
  await db.save('guest-source', sharedManifest, { coins: 1 });
  await db.save('registered', sharedManifest, { coins: 99 });
  await db.score('guest-source', manifest, 87);
  const installation = {
    game: owned,
    manifest,
    directory: 'explicit-source-directory',
    bytes: 1,
    lastPlayed: null,
  } satisfies InstalledGame;
  await db.install('guest-source', installation);
  const copy = {
    ...installation,
    game: { ...owned, ownerId: 'registered' },
    directory: `file:///explicit-documents/games/registered/${owned.id}-${manifest.versionId}/`,
  };
  await db.transferAccount('guest-source', 'registered', [copy]);
  expect((await db.library('registered')).find((g) => g.id === owned.id)?.ownerId).toBe(
    'registered',
  );
  expect((await db.library('registered')).find((g) => g.id === shared.id)?.ownerId).toBe(
    'another-creator',
  );
  expect((await db.load('registered', owned.id))?.state).toEqual({ coins: 42 });
  expect((await db.load('registered', shared.id))?.state).toEqual({ coins: 99 });
  expect(await db.installed('registered')).toEqual([copy]);
  expect(await db.pendingScores('registered')).toEqual([
    { game_id: owned.id, version_id: manifest.versionId, score: 87 },
  ]);
  expect(await db.library('guest-source')).toEqual([]);
  expect(await db.installed('guest-source')).toEqual([]);
  expect(await db.load('guest-source', owned.id)).toBeNull();
  await db.transferAccount('guest-source', 'registered', []);
  expect((await db.load('registered', owned.id))?.state).toEqual({ coins: 42 });
});
it('rolls back a failed local transfer without losing the guest save or creating partial destination records', async () => {
  const db = new LocalDatabase();
  await db.cache('guest-source', [game]);
  await db.save('guest-source', manifest, { coins: 42 });
  const installation = {
    game,
    manifest,
    directory: 'explicit-directory',
    bytes: 1,
    lastPlayed: null,
  } satisfies InstalledGame;
  const invalid = { ...installation, game: { ...game, id: 'game_invalid' } };
  Object.assign(invalid, { circular: invalid });
  await expect(
    db.transferAccount('guest-source', 'registered', [installation, invalid]),
  ).rejects.toThrow();
  expect(await db.installed('registered')).toEqual([]);
  expect((await db.load('guest-source', game.id))?.state).toEqual({ coins: 42 });
});
