import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyPackage } from '../../packages/game-sdk/src/package.ts';
import type { Game } from '../../packages/domain/src/index.ts';
import fixture from '../../apps/mobile/assets/fixture.json';

// Explicit native API fixtures: no simulator or live generation is used here.
const native = vi.hoisted(() => ({
  documents: { uri: 'file:///app/old-container/Documents/' },
  db: {
    execAsync: vi.fn(),
    getAllAsync: vi.fn(),
    getFirstAsync: vi.fn(),
    runAsync: vi.fn(),
  },
}));
vi.mock('../../apps/mobile/node_modules/expo-sqlite', () => ({
  openDatabaseAsync: async () => native.db,
}));
vi.mock('../../apps/mobile/node_modules/expo-file-system', () => ({
  Paths: { document: native.documents },
}));

// Keep React Native's ambient types out of the server's TypeScript project.
const sqliteAdapterPath = '../../apps/mobile/src/adapters/sqlite.ts';
const { LocalDatabase } = await import(sqliteAdapterPath);

const { manifest } = verifyPackage(
  readFileSync('apps/mobile/assets/neon-comet.zip'),
  fixture.publicKey,
);
const download = {
  game: fixture.game as Game,
  manifest,
  directory: `file:///app/old-container/Documents/games/guest/${fixture.game.id}-${manifest.versionId}/`,
  bytes: fixture.bytes,
  lastPlayed: '2026-10-10T12:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  native.documents.uri = 'file:///app/old-container/Documents/';
  native.db.getAllAsync.mockResolvedValue([{ payload: JSON.stringify(download) }]);
});

describe('native downloads after an app container move', () => {
  it('reopens an existing download from the current container and preserves metadata and saves', async () => {
    const db = new LocalDatabase();
    expect((await db.installed('guest'))[0]?.directory).toBe(download.directory);
    native.documents.uri = 'file:///app/new-container/Documents/';
    const [relocated] = await db.installed('guest');
    expect(relocated).toEqual({
      ...download,
      directory: `file:///app/new-container/Documents/games/guest/${fixture.game.id}-${manifest.versionId}/`,
    });
    const save = { gameId: fixture.game.id, state: { best: 123 }, revision: 4 };
    native.db.getFirstAsync.mockResolvedValue({ payload: JSON.stringify(save) });
    expect(await db.load('guest', fixture.game.id)).toEqual(save);
    expect(native.db.runAsync).not.toHaveBeenCalled();
  });

  it('keeps the current account and installed version in the relocated path', async () => {
    native.documents.uri = 'file:///app/new-container/Documents';
    native.db.getAllAsync.mockResolvedValue([
      {
        payload: JSON.stringify({
          ...download,
          game: { ...download.game, currentVersionId: 'newer-version' },
        }),
      },
    ]);
    const [installed] = await new LocalDatabase().installed('player_2');
    expect(installed?.directory).toBe(
      `file:///app/new-container/Documents/games/player_2/${fixture.game.id}-${manifest.versionId}/`,
    );
    expect(native.db.getAllAsync).toHaveBeenCalledWith(
      'select payload from installs where account=?',
      'player_2',
    );
  });

  it.each([
    ['../other', fixture.game.id, manifest.versionId],
    ['guest', '../other', manifest.versionId],
    ['guest', fixture.game.id, '../other'],
  ])('rejects paths that leave their installation scope', async (account, gameId, versionId) => {
    native.db.getAllAsync.mockResolvedValue([
      {
        payload: JSON.stringify({
          ...download,
          game: { ...download.game, id: gameId },
          manifest: { ...manifest, versionId },
        }),
      },
    ]);
    await expect(new LocalDatabase().installed(account)).rejects.toThrow(
      'Invalid installation scope',
    );
  });
});
