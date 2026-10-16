import { beforeEach, afterEach, afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema } from '../../packages/config/src/index.ts';
import { migrate } from '../../scripts/migrate.ts';

// Isolated real PostgreSQL databases; no shared application tables or live provider calls.
const admin = new Pool({ connectionString: configSchema.parse(process.env).DATABASE_URL });
let databaseName: string;
let databaseUrl: string;
let db: Pool;
let directory: string;
const base = '202610150001_games.sql';
const view = '202610150002_view.sql';

beforeEach(async () => {
  databaseName = `aig_migrations_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`create database "${databaseName}"`);
  const url = new URL(configSchema.parse(process.env).DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.href;
  db = new Pool({ connectionString: databaseUrl });
  directory = await mkdtemp(join(tmpdir(), 'aig-migrations-'));
  await writeFile(join(directory, base), 'create table public.games(id text primary key);');
  await writeFile(
    join(directory, view),
    "alter table public.games add column view text default '2d';",
  );
});

afterEach(async () => {
  await db.end();
  await admin.query(`drop database "${databaseName}"`);
  await rm(directory, { recursive: true, force: true });
});

it('applies a blank database once and preserves application data on subsequent runs', async () => {
  await migrate(databaseUrl, directory);
  await db.query("insert into public.games(id,view) values('retained-game','3d')");
  await migrate(databaseUrl, directory);
  expect((await db.query('select * from public.games')).rows).toEqual([
    { id: 'retained-game', view: '3d' },
  ]);
  expect(
    (await db.query('select count(*)::int as count from public.ai_games_migrations')).rows[0].count,
  ).toBe(2);
});

it('imports Supabase-applied migrations without replaying DDL, then applies new migrations', async () => {
  await db.query(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key);
    create table public.games(id text primary key, view text default '2d');
    insert into public.games values('existing-game','isometric');
    insert into supabase_migrations.schema_migrations values('202610150001'),('202610150002');
  `);
  const newer = '202610150003_orientation.sql';
  await writeFile(
    join(directory, newer),
    "alter table public.games add column orientation text default 'portrait';",
  );
  await migrate(databaseUrl, directory);
  await migrate(databaseUrl, directory);
  expect((await db.query('select * from public.games')).rows).toEqual([
    { id: 'existing-game', view: 'isometric', orientation: 'portrait' },
  ]);
  expect(
    (await db.query('select name from public.ai_games_migrations order by name')).rows,
  ).toEqual([base, view, newer].map((name) => ({ name })));
});

it('rolls back failing SQL and never records it as applied', async () => {
  await writeFile(
    join(directory, view),
    'create table public.partial_fixture(id int); select missing_fixture_function();',
  );
  await expect(migrate(databaseUrl, directory)).rejects.toThrow('missing_fixture_function');
  expect(
    (await db.query("select to_regclass('public.partial_fixture') as present")).rows[0].present,
  ).toBeNull();
  expect((await db.query('select name from public.ai_games_migrations')).rows).toEqual([
    { name: base },
  ]);
});

afterAll(() => admin.end());
