import { Pool, type PoolClient } from 'pg';
export class Database {
  readonly pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 10 });
    this.pool.on('error', () => {
      console.error(JSON.stringify({ event: 'database_connection_lost' }));
    });
  }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const value = await fn(c);
      await c.query('commit');
      return value;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  close() {
    return this.pool.end();
  }
}
