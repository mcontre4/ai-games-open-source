import type {
  GenerationCheckpointPort,
  GenerationCallPort,
  GenerationCheckpoint,
} from '../../../application/src/ports.ts';
import type { Database } from './db.ts';
import { z } from 'zod';
import { artDirectionSchema } from '../../../contracts/src/index.ts';
const key = z
  .string()
  .regex(/^game_[a-zA-Z0-9]+\/checkpoints\/gen_[a-zA-Z0-9_]+\/[a-zA-Z0-9_-]+\.(zip|png)$/);
const schema = z
  .object({
    attempts: z.number().int().min(0).max(3),
    moderationComplete: z.boolean().optional(),
    direction: artDirectionSchema.optional(),
    artworkKey: key.optional(),
    spritesKey: key.optional(),
    sourceKey: key.optional(),
    contextKey: key.optional(),
    codingComplete: z.boolean().optional(),
    diagnostic: z.string().max(4000).optional(),
  })
  .strict();
export class PgGenerationCheckpoints implements GenerationCheckpointPort, GenerationCallPort {
  constructor(private db: Database) {}
  async load(jobId: string): Promise<GenerationCheckpoint | null> {
    const row = (
      await this.db.pool.query<{ state: unknown }>(
        'select state from generation_checkpoints where generation_id=$1',
        [jobId],
      )
    ).rows[0];
    return row ? schema.parse(row.state) : null;
  }
  async save(jobId: string, state: GenerationCheckpoint) {
    await this.db.pool.query(
      `insert into generation_checkpoints(generation_id,state) values($1,$2)
      on conflict(generation_id) do update set state=excluded.state,updated_at=now()`,
      [jobId, schema.parse(state)],
    );
    // Refresh the abandonment clock during long coding turns.
    await this.db.pool.query(
      "update generation_jobs set updated_at=now() where id=$1 and stage not in ('ready','failed','cancelled')",
      [jobId],
    );
  }
  async resumeContext(jobId: string): Promise<string | null> {
    // Native CLI sessions carry the complete conversation. Also supply the last
    // provider output in case a process died between billing and CLI receipt.
    const row = (
      await this.db.pool.query<{ output: { output: unknown[] } }>(
        `
      with recursive lineage as (
        select id,retry_of,0 as depth from generation_jobs where id=$1
        union all select j.id,j.retry_of,l.depth+1 from generation_jobs j join lineage l on j.id=l.retry_of where l.depth<20
      ) select c.output from generation_calls c join lineage l on l.id=c.generation_id
        where jsonb_typeof(c.output->'output')='array' order by c.id desc limit 1`,
        [jobId],
      )
    ).rows[0];
    if (!row) return null;
    const output = row.output.output.filter(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        ['message', 'function_call'].includes((item as { type: string }).type),
    );
    return JSON.stringify(output).slice(0, 16_000);
  }
  async record(jobId: string, input: unknown, output: unknown) {
    // Store bodies only, never Authorization, environment, config or grants.
    await this.db.pool.query(
      'insert into generation_calls(generation_id,input,output) values($1,$2,$3)',
      [jobId, JSON.stringify(input), output === undefined ? null : JSON.stringify(output)],
    );
  }
}
