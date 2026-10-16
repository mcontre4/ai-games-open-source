import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { configSchema } from '../packages/config/src/index.ts';
import { compose } from '../packages/adapters/src/composition.ts';
import { InferenceBudget, OpenRouterClient } from '../packages/adapters/src/ai/openrouter.ts';
import { JevPromptModeration } from '../packages/adapters/src/ai/jev.ts';
import { requireSafePrompt } from '../packages/domain/src/moderation.ts';
import { jevLiveCases } from '../tests/jev-live-cases.ts';

const config = configSchema.parse(process.env);
if (!config.OPENROUTER_API_KEY)
  throw new Error(
    'BLOCKED: live Jev verification requires a funded backend OPENROUTER_API_KEY. No fixture is substituted.',
  );
const services = compose(config);
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
let userId: string | undefined;
const evidence: unknown[] = [];
try {
  const created = await admin.auth.admin.createUser({
    email: `jev-live-${Date.now()}@example.com`,
    password: services.ids.token(),
    email_confirm: true,
  });
  if (created.error)
    throw new Error(
      'BLOCKED: local Supabase is required for the live moderation spending reservation.',
    );
  userId = created.data.user!.id;
  const gameId = services.ids.next('game'),
    jobId = services.ids.next('gen');
  // Reserve a real, bounded inference ledger without an outbox entry: this
  // evaluates live Jev only and must never dispatch artwork or game generation.
  await services.db.transaction(async (db) => {
    await db.query(
      'insert into games(id,owner_id,title,description,orientation) values($1,$2,$3,$4,$5)',
      [
        gameId,
        userId,
        'Live Jev evaluation',
        'Non-playable evaluation record; deleted after the run.',
        'portrait',
      ],
    );
    await db.query(
      "insert into generation_jobs(id,game_id,user_id,prompt,kind,stage,reserved_cost) values($1,$2,$3,$4,'create','designing',0.05)",
      [jobId, gameId, userId, 'Live moderation evaluation only.'],
    );
  });
  const client = new OpenRouterClient(config.OPENROUTER_API_KEY, new InferenceBudget(services.db));
  const moderation = new JevPromptModeration(
    client,
    await client.decisionModel(config.OPENROUTER_MODERATION_MODEL, AbortSignal.timeout(30_000)),
  );
  let failures = 0;
  for (const sample of jevLiveCases) {
    const assessment = await moderation.check(
      sample.prompt,
      sample.modification ?? false,
      jobId,
      AbortSignal.timeout(30_000),
    );
    let allowed = true;
    try {
      requireSafePrompt(assessment);
    } catch {
      allowed = false;
    }
    const passed = sample.issue ? !allowed && assessment[sample.issue] >= 0.7 : allowed;
    if (!passed) failures++;
    evidence.push({
      id: sample.id,
      expected: sample.issue ?? 'allow',
      allowed,
      passed,
      assessment,
    });
    console.log(JSON.stringify({ case: sample.id, passed, allowed }));
  }
  const costs = await services.db.pool.query<{ charged_cost: string }>(
    'select charged_cost from generation_jobs where id=$1',
    [jobId],
  );
  await mkdir('work/jev-live', { recursive: true });
  await writeFile(
    'work/jev-live/results.json',
    JSON.stringify(
      {
        model: config.OPENROUTER_MODERATION_MODEL,
        costUsd: Number(costs.rows[0]!.charged_cost),
        cases: evidence,
      },
      null,
      2,
    ),
  );
  if (failures)
    throw new Error(
      `${failures} live Jev evaluation cases failed. Inspect work/jev-live/results.json.`,
    );
  console.log(
    JSON.stringify({
      event: 'live_jev_evaluation_passed',
      cases: evidence.length,
      costUsd: Number(costs.rows[0]!.charged_cost),
    }),
  );
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await services.db.close();
}
