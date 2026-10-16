import { it, expect, vi } from 'vitest';
import { GenerateGame } from '../../packages/application/src/generate.ts';
import type {
  GenerationRepository,
  GameRepository,
  SandboxPort,
  StoragePort,
} from '../../packages/application/src/ports.ts';
import { noAnalytics } from '../../packages/application/src/analytics.ts';
import type { Generation } from '../../packages/domain/src/index.ts';
import { game, smallFiles, signing } from '../helpers.ts';
import { fixtureModeration } from '../moderation-fixture.ts';
function generation() {
  const job: Generation = {
    id: 'gen_test',
    gameId: game.id,
    userId: game.ownerId,
    prompt: 'private idea',
    kind: 'modify',
    stage: 'queued',
    error: null,
    baseVersionId: null,
    createdAt: game.createdAt,
  };
  const repo: GenerationRepository = {
    get: async () => job,
    list: async () => [],
    reserve: async () => {},
    stage: async (_id, stage) => {
      job.stage = stage;
    },
    publish: async () => {
      job.stage = 'ready';
    },
  };
  const telemetry = { ...noAnalytics, capture: vi.fn(), exception: vi.fn() };
  const box = {
    artwork: async () => {},
    generate: async () => {},
    build: async () => {},
    validate: vi.fn(async () => ({
      files: smallFiles,
      source: new Uint8Array(),
      title: 'Test',
      description: 'Test',
    })),
    destroy: vi.fn(),
  };
  let now = Date.parse(game.createdAt) + 1000;
  const make = () =>
    new GenerateGame(
      repo,
      { accessible: async () => game, versions: async () => [] } as unknown as GameRepository,
      { create: async () => box } as unknown as SandboxPort,
      {
        register: async () => ({ url: 'fixture', token: 'fixture', model: 'fixture' }),
        revoke: vi.fn(),
      },
      { create: async () => new Uint8Array() },
      { put: async () => {} } as unknown as StoragePort,
      signing().packager,
      { next: () => 'ver_test', token: () => '', hash: () => '' },
      { now: () => new Date((now += 100)).toISOString() },
      30000,
      1,
      fixtureModeration,
      undefined,
      telemetry,
      'fixture',
    );
  return { make, telemetry, box, job };
}
it('tracks queued time, each generation stage, duration, publication, and modification metadata', async () => {
  const { make, telemetry, box, job } = generation();
  await make().execute(job.id);
  expect(box.destroy).toHaveBeenCalledOnce();
  expect(telemetry.capture).toHaveBeenCalledWith(
    'generation_started',
    game.ownerId,
    expect.objectContaining({ queue_wait_ms: 1100, source: 'fixture', fixture: true }),
  );
  expect(
    telemetry.capture.mock.calls
      .filter((c) => c[0] === 'generation_stage_changed')
      .map((c) => c[2]?.stage),
  ).toEqual(['designing', 'artwork', 'coding', 'building', 'testing', 'packaging', 'ready']);
  expect(telemetry.capture).toHaveBeenCalledWith(
    'generation_completed',
    game.ownerId,
    expect.objectContaining({
      version_id: 'ver_test',
      kind: 'modify',
      duration_ms: expect.any(Number),
      total_duration_ms: expect.any(Number),
    }),
  );
  expect(telemetry.capture).toHaveBeenCalledWith(
    'game_updated',
    game.ownerId,
    expect.objectContaining({ game_id: game.id }),
  );
  expect(JSON.stringify(telemetry.capture.mock.calls)).not.toContain('private idea');
  await make().execute(job.id);
  expect(telemetry.capture.mock.calls.filter((c) => c[0] === 'generation_completed')).toHaveLength(
    1,
  );
});
it('tracks bounded repairs and terminal failures without claiming publication', async () => {
  const { make, telemetry, box, job } = generation();
  box.validate.mockRejectedValue(new Error('untrusted secret'));
  await expect(make().execute(job.id)).rejects.toThrow('untrusted secret');
  expect(
    telemetry.capture.mock.calls.filter((c) => c[0] === 'generation_repair_started'),
  ).toHaveLength(1);
  expect(telemetry.capture.mock.calls.filter((c) => c[0] === 'generation_failed')).toHaveLength(1);
  expect(telemetry.capture.mock.calls.some((c) => c[0] === 'generation_completed')).toBe(false);
  expect(telemetry.exception).toHaveBeenCalledOnce();
  expect(box.destroy).toHaveBeenCalledOnce();
});
it('keeps generation successful if the telemetry adapter throws', async () => {
  const { make, telemetry, job } = generation();
  telemetry.capture.mockImplementation(() => {
    throw new Error('PostHog unavailable');
  });
  await expect(make().execute(job.id)).resolves.toBeUndefined();
  expect(job.stage).toBe('ready');
});
it('records cancellation without a terminal failure or exception', async () => {
  const { make, telemetry, box, job } = generation();
  box.generate = async () => {
    job.stage = 'cancelled';
  };
  await expect(make().execute(job.id)).rejects.toThrow();
  expect(job.stage).toBe('cancelled');
  expect(telemetry.capture.mock.calls.filter((c) => c[0] === 'generation_cancelled')).toHaveLength(
    1,
  );
  expect(telemetry.capture.mock.calls.some((c) => c[0] === 'generation_failed')).toBe(false);
  expect(telemetry.exception).not.toHaveBeenCalled();
  expect(box.destroy).toHaveBeenCalledOnce();
});
