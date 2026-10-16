import { codingTier } from '../../../packages/adapters/src/ai/coding-route.ts';
import type { GenerationSpeed } from '../../../packages/domain/src/index.ts';
import { recoverSandbox } from '../../../packages/adapters/src/generation/recovery.ts';
import { DispatchAccountAnalytics } from '../../../packages/adapters/src/postgres/account-analytics.ts';
import {
  createAnalytics,
  installFatalAnalytics,
} from '../../../packages/adapters/src/analytics.ts';
import { readFile } from 'node:fs/promises';
import { runtimeConfig } from '../../../packages/config/src/index.ts';
import { compose } from '../../../packages/adapters/src/composition.ts';
import { PostgresQueue } from '../../../packages/adapters/src/queue.ts';
import {
  InferenceBudget,
  OpenRouterClient,
  OpenRouterImages,
} from '../../../packages/adapters/src/ai/openrouter.ts';
import { JevPromptModeration } from '../../../packages/adapters/src/ai/jev.ts';
import { ControlledGateway } from '../../../packages/adapters/src/ai/gateway.ts';
import { OpenRouterGameQuality } from '../../../packages/adapters/src/ai/game-quality.ts';
import { OpenRouterArtDirector } from '../../../packages/adapters/src/ai/art-direction.ts';
import { DockerSandbox } from '../../../packages/adapters/src/generation/docker-sandbox.ts';
import { SignedPackager } from '../../../packages/adapters/src/packager.ts';
import { GenerateGame } from '../../../packages/application/src/generate.ts';
import { ReapAbandonedGenerations } from '../../../packages/adapters/src/generation/maintenance.ts';
const config = runtimeConfig(process.env);
const services = compose(config, 'worker');
installFatalAnalytics(services.analytics, 'worker');
const queue = new PostgresQueue(services.db, config.DATABASE_URL);
let gateway: ControlledGateway | undefined;
const maintenance = new ReapAbandonedGenerations(
  services.db,
  services.clock,
  Math.max(30 * 60_000, config.GENERATION_TIMEOUT_SECONDS * 2000),
  services.analytics,
  { checkpoints: services.checkpoints, storage: services.storage, ids: services.ids },
);
await maintenance.execute();
const accountDelivery = createAnalytics(config, 'accounts', fetch, true);
const accountAnalytics = new DispatchAccountAnalytics(services.db, accountDelivery);
let dispatching: Promise<void> | undefined;
const accountAnalyticsTimer = setInterval(() => {
  if (dispatching || !config.POSTHOG_API_KEY || config.POSTHOG_ENABLED === 'false') return;
  dispatching = accountAnalytics
    .execute()
    .then(() => {})
    .catch((error) => {
      services.analytics.exception(error, 'system:worker', {
        operation: 'account_analytics_dispatch',
      });
    })
    .finally(() => {
      dispatching = undefined;
    });
}, 10000);
const maintenanceTimer = setInterval(() => {
  void maintenance.execute().catch((error) => {
    services.analytics.exception(error, 'system:worker', { operation: 'maintenance' });
    console.error(JSON.stringify({ event: 'maintenance_failed' }));
  });
}, 60_000);
await queue.start();
if (config.OPENROUTER_API_KEY) {
  const createClient = (speed: GenerationSpeed) =>
    new OpenRouterClient(
      config.OPENROUTER_API_KEY,
      new InferenceBudget(
        services.db,
        config.OPENROUTER_ESTIMATED_COST_ENABLED === 'true',
        config.OPENROUTER_JOB_COST_LIMIT_ENABLED === 'true' ||
          config.GENERATION_CREDITS_ENABLED === 'true',
      ),
      fetch,
      {
        reasoningEffort: config.OPENROUTER_REASONING_EFFORT,
        serviceTier: codingTier(speed),
        maxTokens: config.OPENROUTER_MAX_OUTPUT_TOKENS,
      },
      undefined,
      services.checkpoints,
    );
  const clients = {
    regular: createClient('regular'),
    fast: createClient('fast'),
    'ultra-fast': createClient('ultra-fast'),
  };
  const client = clients.regular;
  const route = async (jobId: string) => {
    const generation = await services.generations.get(jobId);
    const selected = clients[generation.speed ?? 'regular'];
    const model = await selected.codingModel(
      config.OPENROUTER_CODING_MODEL,
      AbortSignal.timeout(30_000),
    );
    return { client: selected, model };
  };
  const model = await client.codingModel(
    config.OPENROUTER_CODING_MODEL,
    AbortSignal.timeout(30_000),
  );
  const codingGateway = new ControlledGateway(
    client,
    model,
    config.GATEWAY_PORT,
    config.GENERATION_TIMEOUT_SECONDS * 1000,
    services.checkpoints,
    route,
  );
  gateway = codingGateway;
  await codingGateway.start();
  const moderation = new JevPromptModeration(
    client,
    await client.decisionModel(config.OPENROUTER_MODERATION_MODEL, AbortSignal.timeout(30_000)),
  );
  const packager = new SignedPackager(await readFile(config.PACKAGE_SIGNING_KEY_FILE, 'utf8'));
  const createGenerator = (selected: Awaited<ReturnType<typeof route>>) =>
    new GenerateGame(
      services.generations,
      services.games,
      new DockerSandbox(config.SANDBOX_IMAGE, config.GATEWAY_PORT),
      codingGateway,
      new OpenRouterImages(client, config.OPENROUTER_IMAGE_MODEL),
      services.storage,
      packager,
      services.ids,
      services.clock,
      config.GENERATION_TIMEOUT_SECONDS * 1000,
      config.GENERATION_REPAIR_LIMIT,
      moderation,
      new OpenRouterArtDirector(selected.client, selected.model),
      services.analytics,
      'live',
      services.checkpoints,
      {
        wait: async (ms) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
        },
      },
      new OpenRouterGameQuality(selected.client, selected.model),
    );
  await queue.boss.work<{ generationId: string }>(
    'generate-game',
    { localConcurrency: config.GENERATION_CONCURRENCY, pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        const lease = await services.db.pool.connect();
        try {
          const acquired = (
            await lease.query<{ locked: boolean }>(
              'select pg_try_advisory_lock(hashtext($1)) as locked',
              ['worker:' + job.data.generationId],
            )
          ).rows[0]!.locked;
          if (!acquired) throw new Error('Generation already has an active worker.');
          const generation = await services.generations.get(job.data.generationId);
          let generationStarted = false;
          const preflightStarted = Date.parse(services.clock.now());
          try {
            if (['cancelled', 'ready', 'failed'].includes(generation.stage)) continue;
            if (
              generation.retryOf &&
              (await services.checkpoints.load(generation.id))?.attempts === 0
            ) {
              const recovered = await recoverSandbox(
                generation.retryOf,
                generation.gameId,
                services.checkpoints,
                services.storage,
                services.ids,
              );
              if (recovered)
                await services.checkpoints.save(generation.id, { ...recovered, attempts: 0 });
            }
            await recoverSandbox(
              generation.id,
              generation.gameId,
              services.checkpoints,
              services.storage,
              services.ids,
            );
            services.analytics.capture('generation_preflight_started', generation.userId, {
              generation_id: generation.id,
              game_id: generation.gameId,
              kind: generation.kind,
              queue_wait_ms: Math.max(0, preflightStarted - Date.parse(generation.createdAt)),
              source: 'live',
              fixture: false,
            });
            // Discovery is unbilled. Catch missing model/pricing metadata before
            // paying for moderation/art direction or creating a game sandbox.
            const selected = await route(generation.id);
            await client.imageModel(config.OPENROUTER_IMAGE_MODEL, AbortSignal.timeout(30_000));
            services.analytics.capture('generation_preflight_completed', generation.userId, {
              generation_id: generation.id,
              game_id: generation.gameId,
              kind: generation.kind,
              duration_ms: Date.parse(services.clock.now()) - preflightStarted,
              source: 'live',
            });
            generationStarted = true;
            await createGenerator(selected).execute(generation.id);
          } catch (error) {
            const current = await services.generations.get(generation.id);
            if (!generationStarted && current.stage !== 'cancelled') {
              services.analytics.capture('generation_failed', generation.userId, {
                generation_id: generation.id,
                game_id: generation.gameId,
                kind: generation.kind,
                stage: 'preflight',
                duration_ms: Date.parse(services.clock.now()) - preflightStarted,
                source: 'live',
                error_code: 'PREFLIGHT_ERROR',
              });
              services.analytics.exception(error, generation.userId, {
                generation_id: generation.id,
                game_id: generation.gameId,
                operation: 'generation_preflight',
              });
            }
            await services.generations.stage(
              job.data.generationId,
              'failed',
              error instanceof Error ? error.message.slice(0, 160) : 'Generation failed.',
            );
            console.error(
              JSON.stringify({ event: 'generation_failed', generationId: job.data.generationId }),
            );
            throw error;
          }
        } finally {
          await lease
            .query('select pg_advisory_unlock(hashtext($1))', ['worker:' + job.data.generationId])
            .catch(() => {});
          lease.release();
        }
      }
    },
  );
  console.log(
    JSON.stringify({
      event: 'worker_ready',
      mode: 'live',
      codingAgent: 'codex-cli',
      imageModel: config.OPENROUTER_IMAGE_MODEL,
      moderationModel: config.OPENROUTER_MODERATION_MODEL,
      model: model.id,
      reasoningEffort: config.OPENROUTER_REASONING_EFFORT,
      dailyCapUsd: config.OPENROUTER_MAX_DAILY_COST_USD,
      estimatedCostEnabled: config.OPENROUTER_ESTIMATED_COST_ENABLED === 'true',
    }),
  );
} else
  console.log(
    JSON.stringify({
      event: 'worker_ready',
      mode: 'ai_unavailable',
      message: 'Set OPENROUTER_API_KEY to enable live generation.',
    }),
  );
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(maintenanceTimer);
  clearInterval(accountAnalyticsTimer);
  await queue.stop();
  await gateway?.stop();
  await dispatching;
  await services.db.close();
  await services.analytics.shutdown();
  await accountDelivery.shutdown();
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
