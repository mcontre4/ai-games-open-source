import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Paths } from 'expo-file-system';
import { installationDirectory } from './installation-path';
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
  private db?: SQLiteDatabase;
  private async connection() {
    if (!this.db) {
      this.db = await openDatabaseAsync('ai-games.db');
      await this.db.execAsync(
        `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS library(account TEXT NOT NULL,game_id TEXT NOT NULL,game TEXT NOT NULL,PRIMARY KEY(account,game_id));CREATE TABLE IF NOT EXISTS installs(account TEXT NOT NULL,game_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(account,game_id));CREATE TABLE IF NOT EXISTS saves(account TEXT NOT NULL,game_id TEXT NOT NULL,payload TEXT NOT NULL,local_revision INTEGER NOT NULL DEFAULT 0,cloud_revision INTEGER NOT NULL DEFAULT 0,dirty INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account,game_id));CREATE TABLE IF NOT EXISTS conflicts(account TEXT NOT NULL,game_id TEXT NOT NULL,local TEXT NOT NULL,cloud TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS scores(account TEXT NOT NULL,game_id TEXT NOT NULL,version_id TEXT NOT NULL,score INTEGER NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account,game_id));`,
      );
    }
    return this.db;
  }
  async transferAccount(source: string, target: string, installs: InstalledGame[]) {
    if (source === target) return;
    const db = await this.connection();
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const installed of installs)
        await tx.runAsync(
          'insert or ignore into installs(account,game_id,payload) values(?,?,?)',
          target,
          installed.game.id,
          JSON.stringify(installed),
        );
      await tx.runAsync(
        "insert or ignore into library(account,game_id,game) select ?,game_id,case when json_extract(game,'$.ownerId')=? then json_set(game,'$.ownerId',?) else game end from library where account=?",
        target,
        source,
        target,
        source,
      );
      await tx.runAsync(
        'insert or ignore into saves(account,game_id,payload,local_revision,cloud_revision,dirty) select ?,game_id,payload,local_revision,cloud_revision,dirty from saves where account=?',
        target,
        source,
      );
      await tx.runAsync(
        'insert or ignore into scores(account,game_id,version_id,score,dirty) select ?,game_id,version_id,score,dirty from scores where account=?',
        target,
        source,
      );
      await tx.runAsync('update conflicts set account=? where account=?', target, source);
      for (const table of ['library', 'installs', 'saves', 'scores'])
        await tx.runAsync(`delete from ${table} where account=?`, source);
    });
  }
  async cache(account: string, games: Game[]) {
    const db = await this.connection();
    await db.withTransactionAsync(async () => {
      await db.runAsync('delete from library where account=?', account);
      for (const game of games)
        await db.runAsync(
          'insert into library(account,game_id,game) values(?,?,?)',
          account,
          game.id,
          JSON.stringify(game),
        );
    });
  }
  async library(account: string): Promise<Game[]> {
    const rows = await (
      await this.connection()
    ).getAllAsync<{ game: string }>('select game from library where account=?', account);
    return rows.map((r) => JSON.parse(r.game));
  }
  async installed(account: string): Promise<InstalledGame[]> {
    const rows = await (
      await this.connection()
    ).getAllAsync<{ payload: string }>('select payload from installs where account=?', account);
    return rows.map((r) => {
      const installed: InstalledGame = JSON.parse(r.payload);
      return {
        ...installed,
        directory: installationDirectory(
          Paths.document.uri,
          account,
          installed.game.id,
          installed.manifest.versionId,
        ),
      };
    });
  }
  async install(account: string, game: InstalledGame) {
    await (
      await this.connection()
    ).runAsync(
      'insert into installs(account,game_id,payload) values(?,?,?) on conflict(account,game_id) do update set payload=excluded.payload',
      account,
      game.game.id,
      JSON.stringify(game),
    );
  }
  async uninstall(account: string, gameId: string) {
    await (
      await this.connection()
    ).runAsync('delete from installs where account=? and game_id=?', account, gameId);
  }
  async load(account: string, gameId: string): Promise<Save | null> {
    const row = await (
      await this.connection()
    ).getFirstAsync<{ payload: string }>(
      'select payload from saves where account=? and game_id=?',
      account,
      gameId,
    );
    if (!row) return null;
    try {
      return JSON.parse(row.payload);
    } catch {
      return null;
    }
  }
  async save(account: string, manifest: Manifest, state: Json) {
    const db = await this.connection();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const current = await tx.getFirstAsync<{ cloud_revision: number }>(
        'select cloud_revision from saves where account=? and game_id=?',
        account,
        manifest.gameId,
      );
      const save: Save = {
        gameId: manifest.gameId,
        versionId: manifest.versionId,
        schemaVersion: manifest.stateSchemaVersion,
        state,
        revision: current?.cloud_revision ?? 0,
      };
      await tx.runAsync(
        'insert into saves(account,game_id,payload) values(?,?,?) on conflict(account,game_id) do update set payload=excluded.payload,local_revision=saves.local_revision+1,dirty=1',
        account,
        manifest.gameId,
        JSON.stringify(save),
      );
    });
  }
  async score(account: string, manifest: Manifest, score: number) {
    await (
      await this.connection()
    ).runAsync(
      'insert into scores(account,game_id,version_id,score) values(?,?,?,?) on conflict(account,game_id) do update set score=max(scores.score,excluded.score),version_id=excluded.version_id,dirty=1',
      account,
      manifest.gameId,
      manifest.versionId,
      score,
    );
  }
  async pending(account: string): Promise<{ save: Save; localRevision: number }[]> {
    const rows = await (
      await this.connection()
    ).getAllAsync<{ payload: string; local_revision: number }>(
      'select payload,local_revision from saves where account=? and dirty=1',
      account,
    );
    return rows.map((r) => ({ save: JSON.parse(r.payload), localRevision: r.local_revision }));
  }
  async restore(account: string, save: Save) {
    await (
      await this.connection()
    ).runAsync(
      'insert into saves(account,game_id,payload,cloud_revision,dirty) values(?,?,?,?,0) on conflict(account,game_id) do nothing',
      account,
      save.gameId,
      JSON.stringify(save),
      save.revision,
    );
  }
  async acknowledge(account: string, save: Save, localRevision: number) {
    const db = await this.connection();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<{ payload: string; local_revision: number }>(
        'select payload,local_revision from saves where account=? and game_id=?',
        account,
        save.gameId,
      );
      if (!row) return;
      const unchanged = row.local_revision === localRevision;
      const payload = unchanged ? save : { ...JSON.parse(row.payload), revision: save.revision };
      await tx.runAsync(
        'update saves set payload=?,cloud_revision=?,dirty=? where account=? and game_id=?',
        JSON.stringify(payload),
        save.revision,
        unchanged ? 0 : 1,
        account,
        save.gameId,
      );
    });
  }
  async conflict(account: string, local: Save, cloud: Save, localRevision: number) {
    const db = await this.connection();
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        'insert into conflicts(account,game_id,local,cloud,created_at) values(?,?,?,?,?)',
        account,
        local.gameId,
        JSON.stringify(local),
        JSON.stringify(cloud),
        new Date().toISOString(),
      );
      await tx.runAsync(
        'update saves set payload=?,cloud_revision=?,dirty=0 where account=? and game_id=? and local_revision=?',
        JSON.stringify(cloud),
        cloud.revision,
        account,
        local.gameId,
        localRevision,
      );
    });
  }
  async conflicts(account: string): Promise<{ gameId: string; local: Save; cloud: Save }[]> {
    const rows = await (
      await this.connection()
    ).getAllAsync<{ game_id: string; local: string; cloud: string }>(
      'select game_id,local,cloud from conflicts where account=? order by created_at desc',
      account,
    );
    return rows.map((r) => ({
      gameId: r.game_id,
      local: JSON.parse(r.local),
      cloud: JSON.parse(r.cloud),
    }));
  }
  async pendingScores(account: string) {
    return (await this.connection()).getAllAsync<{
      game_id: string;
      version_id: string;
      score: number;
    }>('select game_id,version_id,score from scores where account=? and dirty=1', account);
  }
  async scoreAcknowledged(account: string, gameId: string, score: number) {
    await (
      await this.connection()
    ).runAsync(
      'update scores set dirty=0 where account=? and game_id=? and score=?',
      account,
      gameId,
      score,
    );
  }
  async purge(account: string) {
    const db = await this.connection();
    for (const table of ['library', 'installs', 'saves', 'scores', 'conflicts'])
      await db.runAsync(`delete from ${table} where account=?`, account);
  }
}
