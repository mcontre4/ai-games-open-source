import { configSchema } from '../packages/config/src/index.ts';
import { compose } from '../packages/adapters/src/composition.ts';
import { createClient } from '@supabase/supabase-js';
import { CreateGame } from '../packages/application/src/games.ts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { verifyPackage } from '../packages/game-sdk/src/package.ts';
import { validateGameInBrowser } from '../packages/adapters/src/generation/browser-validation.ts';
import { artDirectionSchema } from '../packages/contracts/src/index.ts';
import type { GameArtDirection } from '../packages/domain/src/index.ts';
const config = configSchema.parse(process.env);
if (!config.OPENROUTER_API_KEY)
  throw new Error(
    'BLOCKED: provide OPENROUTER_API_KEY with a funded OpenRouter account. This command performs real paid generation; fixtures cannot pass it.',
  );
const s = compose(config);
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
let userId: string | undefined;
const evidence: { gameId: string; versionId: string; artDirection: GameArtDirection }[] = [];
try {
  const created = await admin.auth.admin.createUser({
    email: `live-test-${Date.now()}@example.com`,
    password: 'Live-test-2048-Password!',
    email_confirm: true,
    user_metadata: { display_name: 'Live Generation Test', age_confirmed: true },
  });
  if (created.error) throw created.error;
  userId = created.data.user!.id;
  const usecase = new CreateGame(s.games, s.generations, s.ids, s.clock, s.policy);
  const first = await usecase.execute(userId, {
    prompt:
      'Create a touch-controlled leaf-catching game in an autumn forest. Use hand-painted watercolor art, textured paper, warm ochre and terracotta colors, and gently swaying leaves. Catch drifting acorns in a basket to score, with clear touch controls and smooth, polished animation.',
    orientation: 'portrait',
  });
  async function wait(id: string) {
    const end = Date.now() + (config.GENERATION_TIMEOUT_SECONDS + 120) * 1000;
    let previousStage = '';
    while (Date.now() < end) {
      const j = await s.generations.get(id);
      if (j.stage !== previousStage) {
        console.log(
          JSON.stringify({ event: 'live_generation_stage', generationId: id, stage: j.stage }),
        );
        previousStage = j.stage;
      }
      if (j.stage === 'ready') return;
      if (j.stage === 'failed' || j.stage === 'cancelled') throw new Error(j.error || j.stage);
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Live worker timeout.');
  }
  async function capture(gameId: string, name: string) {
    const game = await s.games.accessible(gameId, userId!);
    const version = await s.games.version(game.currentVersionId!);
    const publicKey = createPublicKey(await readFile(config.PACKAGE_PUBLIC_KEY_FILE, 'utf8'))
      .export({ type: 'spki', format: 'der' })
      .subarray(-32)
      .toString('hex');
    const packageBytes = await s.storage.get(version.artifactKey);
    const verified = verifyPackage(packageBytes, publicKey, {
      gameId,
      versionId: version.id,
      checksum: version.checksum,
    });
    const metadata = JSON.parse(new TextDecoder().decode(verified.files['game.json']));
    const artDirection = artDirectionSchema.parse(metadata.artDirection);
    await mkdir('work/live-verification', { recursive: true });
    await writeFile(`work/live-verification/${name}.zip`, packageBytes);
    await writeFile(
      `work/live-verification/${name}-source.zip`,
      await s.storage.get(version.sourceKey),
    );
    await validateGameInBrowser(verified.files, `work/live-verification/${name}.png`);
    evidence.push({ gameId, versionId: version.id, artDirection });
    return artDirection;
  }
  await wait(first.generationId);
  const firstDirection = await capture(first.gameId, 'watercolor');
  if (!/watercolo(?:u)?r/i.test(firstDirection.visualStyle))
    throw new Error('Explicit watercolor style was not retained.');
  const modified = await usecase.execute(userId, {
    gameId: first.gameId,
    prompt:
      'Add fluttering butterflies and bonus golden acorns. Preserve the autumn forest setting, hand-painted watercolor style, palette and smooth animation.',
    orientation: 'portrait',
  });
  await wait(modified.generationId);
  const modifiedDirection = await capture(first.gameId, 'watercolor-modified');
  if (
    JSON.stringify(firstDirection.palette) !== JSON.stringify(modifiedDirection.palette) ||
    firstDirection.visualStyle !== modifiedDirection.visualStyle
  )
    throw new Error('A gameplay modification unexpectedly changed the game art style.');
  const versions = await s.games.versions(first.gameId);
  if (versions.length !== 2) throw new Error('Missing immutable modification version');
  const second = await usecase.execute(userId, {
    prompt:
      'Create a playful touch-controlled fishing game on a sunny coral island. Use handcrafted clay/plasticine artwork with rounded expressive shapes, a sky-blue and coral-orange palette, soft cinematic lighting and smoothly bobbing boats. Tap jumping fish to catch them and score; make the first catch easy and the controls clear.',
    orientation: 'portrait',
  });
  await wait(second.generationId);
  const secondDirection = await capture(second.gameId, 'clay-island');
  if (!/clay|plasticine/i.test(secondDirection.visualStyle))
    throw new Error('Explicit clay style was not retained.');
  if (JSON.stringify(firstDirection.palette) === JSON.stringify(secondDirection.palette))
    throw new Error('Different game styles unexpectedly reused the same palette.');
  const costs = await s.db.pool.query(
    'select coalesce(sum(charged_cost),0)::text as retained_charge from generation_jobs where user_id=$1',
    [userId],
  );
  await writeFile(
    'work/live-verification/results.json',
    JSON.stringify(
      {
        codingAgent: 'codex-cli',
        imageModel: config.OPENROUTER_IMAGE_MODEL,
        model: config.OPENROUTER_CODING_MODEL,
        effort: config.OPENROUTER_REASONING_EFFORT,
        jobCapUsd: config.OPENROUTER_MAX_JOB_COST_USD,
        dailyCapUsd: config.OPENROUTER_MAX_DAILY_COST_USD,
        retainedChargeUsd: Number(costs.rows[0].retained_charge),
        games: evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      event: 'live_generation_and_modification_passed',
      gameId: first.gameId,
      versions: versions.map((v) => v.id),
      distinctStylesVerified: true,
      retainedChargeUsd: Number(costs.rows[0].retained_charge),
    }),
  );
} finally {
  if (userId) await s.auth.deleteAccount(userId);
  await s.db.close();
}
