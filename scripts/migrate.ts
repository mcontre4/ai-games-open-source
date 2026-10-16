import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
if (!process.env.DATABASE_URL)
  throw new Error('Run db:migrate:dev or db:migrate:prod with an explicit database.');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
await pool.query('create table if not exists public.ai_games_migrations(name text primary key)');
for (const name of (await readdir('infrastructure/supabase/migrations')).sort()) {
  const applied = await pool.query('select 1 from ai_games_migrations where name=$1', [name]);
  if (applied.rowCount) continue;
  // Supabase start may already have applied the initial migration.
  if (
    name === '202610100001_games.sql' &&
    (await pool.query("select to_regclass('public.games') as present")).rows[0]?.present
  ) {
    await pool.query('insert into ai_games_migrations(name) values($1)', [name]);
    continue;
  }
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(await readFile(`infrastructure/supabase/migrations/${name}`, 'utf8'));
    await c.query('insert into ai_games_migrations(name) values($1)', [name]);
    await c.query('commit');
    console.log(`Applied ${name}`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
await pool.end();
