import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

export async function migrate(
  databaseUrl: string,
  directory = 'infrastructure/supabase/migrations',
) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      'create table if not exists public.ai_games_migrations(name text primary key)',
    );
    // Fresh Supabase databases already have these timestamps in their own ledger.
    // Import that evidence instead of replaying non-idempotent DDL.
    const supabaseVersions = new Set<string>();
    const history = await pool.query(
      "select to_regclass('supabase_migrations.schema_migrations') as present",
    );
    if (history.rows[0]?.present) {
      const applied = await pool.query<{ version: string }>(
        'select version from supabase_migrations.schema_migrations',
      );
      for (const row of applied.rows) supabaseVersions.add(row.version);
    }
    for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
      const applied = await pool.query('select 1 from public.ai_games_migrations where name=$1', [
        name,
      ]);
      if (applied.rowCount) continue;
      const version = name.match(/^(\d+)_/)?.[1];
      if (version && supabaseVersions.has(version)) {
        await pool.query('insert into public.ai_games_migrations(name) values($1)', [name]);
        continue;
      }
      // Preserve the legacy baseline for databases initialized before the app ledger.
      if (
        name === '202610100001_games.sql' &&
        (await pool.query("select to_regclass('public.games') as present")).rows[0]?.present
      ) {
        await pool.query('insert into public.ai_games_migrations(name) values($1)', [name]);
        continue;
      }
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(await readFile(join(directory, name), 'utf8'));
        await c.query('insert into public.ai_games_migrations(name) values($1)', [name]);
        await c.query('commit');
        console.log(`Applied ${name}`);
      } catch (error) {
        await c.query('rollback');
        throw error;
      } finally {
        c.release();
      }
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  if (!process.env.DATABASE_URL)
    throw new Error('Run db:migrate:dev or db:migrate:prod with an explicit database.');
  await migrate(process.env.DATABASE_URL);
}
