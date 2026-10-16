import { it, expect, vi } from 'vitest';
import { GenerateGame } from '../../packages/application/src/generate.ts';
import type {
  GameRepository,
  GenerationRepository,
  StoragePort,
  SandboxPort,
} from '../../packages/application/src/ports.ts';
import type { Generation, Stage, Game } from '../../packages/domain/src/index.ts';
import { game, smallFiles, signing } from '../helpers.ts';
import { fixtureModeration, safePromptAssessment } from '../moderation-fixture.ts';
import { promptIssues } from '../../packages/domain/src/moderation.ts';
import { watercolorDirection } from '../art-direction-fixture.ts';
it.each([
  { view: '2d', reuseSprites: false },
  { view: '2d', reuseSprites: true },
  { view: '3d', reuseSprites: false },
  { view: 'isometric', reuseSprites: false },
] as const)(
  'carries saved $view through modification with sprite reuse=$reuseSprites',
  async ({ view, reuseSprites }) => {
    const source = new Uint8Array([1, 2, 3]);
    const job: Generation = {
      id: 'gen_view_fixture',
      gameId: game.id,
      userId: game.ownerId,
      prompt: 'Add more forest collectibles.',
      kind: 'modify',
      stage: 'queued',
      error: null,
      baseVersionId: 'ver_testing',
      createdAt: game.createdAt,
    };
    const repo: GenerationRepository = {
      get: async () => job,
      reserve: vi.fn(),
      list: async () => [],
      stage: async (_id, stage) => {
        job.stage = stage;
      },
      publish: vi.fn(),
    };
    const games = {
      accessible: async () => ({ ...game, view }),
      versions: async () => [],
      version: async () => ({ sourceKey: 'source_fixture' }),
    } as unknown as GameRepository;
    const generate = vi.fn();
    const create = vi.fn(async () => ({
      endpoint: 'explicit-view-fixture',
      configureArtDirection: vi.fn(),
      generate,
      artwork: vi.fn(),
      reuseSpriteArtwork: vi.fn(async () => (reuseSprites ? new Uint8Array([8]) : null)),
      build: vi.fn(),
      validate: async () => ({
        files: smallFiles,
        source,
        title: 'Forest fixture',
        description: 'Explicit offline pipeline fixture.',
      }),
      destroy: vi.fn(),
    }));
    const plan = vi.fn(async () => watercolorDirection);
    const images = { create: vi.fn(async (_prompt: string) => new Uint8Array()) };
    const packager = {
      package: vi.fn(async (_game: Game) => ({ bytes: new Uint8Array([9]), checksum: 'test' })),
    };
    const grant = { url: 'fixture://gateway', token: 'fixture-token', model: 'fixture-model' };
    await new GenerateGame(
      repo,
      games,
      { create },
      { register: async () => grant, revoke: vi.fn() },
      images,
      { get: async () => source, put: vi.fn() } as unknown as StoragePort,
      packager,
      { next: () => 'ver_view_fixture', token: () => '', hash: () => '' },
      { now: () => game.createdAt },
      10000,
      0,
      fixtureModeration,
      { plan },
    ).execute(job.id);
    expect(plan).toHaveBeenCalledWith(
      { prompt: job.prompt, orientation: game.orientation, view, previousSource: source },
      job.id,
      expect.any(AbortSignal),
    );
    expect(create).toHaveBeenCalledWith(job.id, source, grant, view);
    expect(JSON.parse(generate.mock.calls[0]![0])).toMatchObject({
      view,
      request: job.prompt,
      artDirection: watercolorDirection,
    });
    expect(JSON.parse(images.create.mock.calls[0]![0])).toMatchObject({ view });
    expect(images.create).toHaveBeenCalledTimes(view === '2d' && !reuseSprites ? 2 : 1);
    if (view === '2d') {
      const box = await create.mock.results[0]!.value;
      expect(box.reuseSpriteArtwork).toHaveBeenCalledWith(watercolorDirection);
      if (!reuseSprites) {
        expect(JSON.parse(images.create.mock.calls[1]![0])).toMatchObject({
          sprites: watercolorDirection.sprites,
        });
        expect(box.artwork).toHaveBeenLastCalledWith(expect.any(Uint8Array), 'sprites');
      } else expect(box.artwork).toHaveBeenLastCalledWith(new Uint8Array([8]), 'sprites');
      expect(JSON.parse(generate.mock.calls[0]![0])).toMatchObject({
        spriteSheet: {
          path: 'assets/sprites.png',
          frameWidth: 512,
          frameHeight: 512,
          frames: { player: 0, threat: 1, reward: 2, prop: 3 },
        },
      });
    } else expect(JSON.parse(generate.mock.calls[0]![0])).not.toHaveProperty('spriteSheet');
    expect(packager.package.mock.calls[0]![0]).toMatchObject({ view });
    expect(repo.publish).toHaveBeenCalledOnce();
  },
);
it('bounds validation repairs, records failure, revokes grants and destroys the isolated job', async () => {
  const job: Generation = {
    id: 'gen_test',
    gameId: game.id,
    userId: game.ownerId,
    prompt: 'Create an autumn forest game in hand-painted watercolor.',
    kind: 'create',
    stage: 'queued',
    error: null,
    baseVersionId: null,
    createdAt: game.createdAt,
  };
  const stages: Stage[] = [];
  const repo: GenerationRepository = {
    get: async () => job,
    reserve: async () => {},
    list: async () => [],
    stage: async (_id, stage) => {
      job.stage = stage;
      stages.push(stage);
    },
    publish: vi.fn(),
  };
  const games = {
    accessible: async () => game,
    versions: async () => [],
  } as unknown as GameRepository;
  const destroy = vi.fn(),
    configureArtDirection = vi.fn(),
    generate = vi.fn(),
    build = vi.fn(async () => {
      throw new Error('Untrusted build invalid');
    });
  const sandbox: SandboxPort = {
    create: async () => ({
      endpoint: 'explicit-test',
      configureArtDirection,
      generate,
      build,
      validate: async () => ({
        files: smallFiles,
        source: new Uint8Array(),
        title: 'Test',
        description: 'Explicit fixture.',
      }),
      artwork: async () => {},
      destroy,
    }),
  };
  const revoke = vi.fn();
  const images = { create: vi.fn(async (_prompt: string) => new Uint8Array()) };
  const storage = { put: vi.fn() } as unknown as StoragePort;
  await expect(
    new GenerateGame(
      repo,
      games,
      sandbox,
      { register: async () => ({ url: 'test', token: 'test', model: 'test' }), revoke },
      images,
      storage,
      signing().packager,
      { next: () => '', token: () => '', hash: () => '' },
      { now: () => game.createdAt },
      10_000,
      2,
      fixtureModeration,
      { plan: async () => watercolorDirection },
    ).execute(job.id),
  ).rejects.toThrow('invalid');
  expect(generate).toHaveBeenCalledTimes(3);
  expect(configureArtDirection).toHaveBeenCalledWith(watercolorDirection);
  expect(JSON.parse(images.create.mock.calls[0]![0] as unknown as string)).toMatchObject({
    visualStyle: watercolorDirection.visualStyle,
    theme: watercolorDirection.theme,
  });
  for (const call of generate.mock.calls) {
    expect(call[0]).toContain(job.prompt);
    expect(call[0]).toContain(watercolorDirection.visualStyle);
  }
  expect(build).toHaveBeenCalledTimes(3);
  expect(stages.at(-1)).toBe('failed');
  expect(destroy).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith(job.id);
  expect(storage.put).not.toHaveBeenCalled();
  expect(repo.publish).not.toHaveBeenCalled();
});

it.each(['create', 'modify'] as const)(
  'blocks all prohibited %s prompts before any generation side effects',
  async (kind) => {
    for (const issue of [...promptIssues, 'uncertain', 'unavailable'] as const) {
      const job: Generation = {
        id: 'gen_moderation_fixture',
        gameId: game.id,
        userId: game.ownerId,
        prompt: 'Explicit moderation orchestration fixture.',
        kind,
        stage: 'queued',
        error: null,
        baseVersionId: kind === 'modify' ? game.currentVersionId : null,
        createdAt: game.createdAt,
      };
      const repo: GenerationRepository = {
        get: async () => job,
        reserve: vi.fn(),
        list: async () => [],
        publish: vi.fn(),
        stage: async (_id, stage, error) => {
          job.stage = stage;
          job.error = error ?? null;
        },
      };
      const games = { accessible: async () => game } as unknown as GameRepository;
      const sandbox = { create: vi.fn() } as SandboxPort;
      const gateway = { register: vi.fn(), revoke: vi.fn() };
      const images = { create: vi.fn() };
      const storage = { get: vi.fn(), put: vi.fn() } as unknown as StoragePort;
      const packager = { package: vi.fn() };
      const art = { plan: vi.fn() };
      const moderation = {
        check: vi.fn(async () => {
          if (issue === 'unavailable') throw new Error('Explicit test provider outage');
          return {
            ...safePromptAssessment(),
            [issue === 'uncertain' ? 'payments' : issue]: issue === 'uncertain' ? 0.5 : 0.99,
          };
        }),
      };
      await expect(
        new GenerateGame(
          repo,
          games,
          sandbox,
          gateway,
          images,
          storage,
          packager,
          { next: vi.fn(), token: vi.fn(), hash: vi.fn() },
          { now: () => game.createdAt },
          10_000,
          0,
          moderation,
          art,
        ).execute(job.id),
      ).rejects.toThrow();
      expect(moderation.check).toHaveBeenCalledWith(
        job.prompt,
        kind === 'modify',
        job.id,
        expect.any(AbortSignal),
      );
      expect(job.stage).toBe('failed');
      expect(job.error).toBeTruthy();
      expect(sandbox.create).not.toHaveBeenCalled();
      expect(gateway.register).not.toHaveBeenCalled();
      expect(art.plan).not.toHaveBeenCalled();
      expect(images.create).not.toHaveBeenCalled();
      expect(storage.get).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
      expect(packager.package).not.toHaveBeenCalled();
      expect(repo.publish).not.toHaveBeenCalled();
    }
  },
);

it('reports the job deadline when an in-flight coding adapter rejects with AbortError and still cleans up', async () => {
  vi.useFakeTimers();
  const job: Generation = {
    id: 'gen_timeout_fixture',
    gameId: game.id,
    userId: game.ownerId,
    prompt: 'Create an explicit forest timeout fixture.',
    kind: 'create',
    stage: 'queued',
    error: null,
    baseVersionId: null,
    createdAt: game.createdAt,
  };
  const repo: GenerationRepository = {
    get: async () => job,
    reserve: vi.fn(),
    list: async () => [],
    publish: vi.fn(),
    stage: async (_id, stage, error) => {
      job.stage = stage;
      job.error = error ?? null;
    },
  };
  let entered!: () => void;
  const coding = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const destroy = vi.fn(),
    revoke = vi.fn();
  const box = {
    endpoint: 'explicit-timeout-fixture',
    artwork: vi.fn(),
    build: vi.fn(),
    validate: vi.fn(),
    destroy,
    generate: async (_prompt: string, signal: AbortSignal) => {
      entered();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    },
  };
  try {
    const pending = new GenerateGame(
      repo,
      { accessible: async () => game } as unknown as GameRepository,
      { create: async () => box },
      { register: async () => ({ url: 'fixture', token: 'fixture', model: 'fixture' }), revoke },
      { create: async () => new Uint8Array() },
      { put: vi.fn() } as unknown as StoragePort,
      { package: vi.fn() },
      { next: vi.fn(), token: vi.fn(), hash: vi.fn() },
      { now: () => game.createdAt },
      1000,
      0,
      fixtureModeration,
    ).execute(job.id);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await coding;
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(job.stage).toBe('failed');
    expect(job.error).toContain('time limit');
    expect(box.build).not.toHaveBeenCalled();
    expect(repo.publish).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith(job.id);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
