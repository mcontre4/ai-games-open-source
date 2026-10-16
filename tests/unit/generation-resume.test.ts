import { it, expect } from 'vitest';
import { GenerateGame } from '../../packages/application/src/generate.ts';
import type {
  GameQualityPort,
  GenerationCheckpoint,
  GenerationCheckpointPort,
  GenerationRepository,
  GameRepository,
  Sandbox,
  StoragePort,
} from '../../packages/application/src/ports.ts';
import { DomainError, type Generation } from '../../packages/domain/src/index.ts';
import { game, smallFiles } from '../helpers.ts';
import { safePromptAssessment } from '../moderation-fixture.ts';
import { watercolorDirection } from '../art-direction-fixture.ts';
// Durable fakes model destruction and process replacement. No live provider is used.
const { sprites: _sprites, ...legacyDirection } = watercolorDirection;
function scenario(
  direction = legacyDirection,
  quality?: GameQualityPort,
  repairs = 0,
  captures = true,
) {
  const job: Generation = {
    id: 'gen_resume_fixture',
    gameId: game.id,
    userId: game.ownerId,
    prompt: 'Create a watercolor forest arcade game.',
    kind: 'create',
    stage: 'queued',
    error: null,
    baseVersionId: null,
    createdAt: game.createdAt,
  };
  let saved: GenerationCheckpoint | null = null;
  let sequence = 0;
  const blobs = new Map<string, Uint8Array>();
  const checkpoints: GenerationCheckpointPort = {
    load: async () => (saved ? structuredClone(saved) : null),
    save: async (_id, value) => {
      saved = structuredClone(value);
    },
  };
  const repository: GenerationRepository = {
    reserve: async () => {},
    get: async () => ({ ...job }),
    list: async () => [job],
    stage: async (_id, stage, error) => {
      job.stage = stage;
      job.error = error ?? null;
    },
    publish: async () => {
      job.stage = 'ready';
    },
  };
  const storage: StoragePort = {
    put: async (key, value) => {
      if (blobs.has(key)) throw new Error('Immutable');
      blobs.set(key, value.slice());
    },
    get: async (key) => {
      const value = blobs.get(key);
      if (!value) throw new Error('Missing blob');
      return value.slice();
    },
    exists: async (key) => blobs.has(key),
  };
  const counts = {
    images: 0,
    plans: 0,
    moderation: 0,
    coding: 0,
    destroyed: 0,
    builds: 0,
    waits: 0,
  };
  const restored: { source: Uint8Array | null; context?: Uint8Array }[] = [];
  let coding: (box: { code: Uint8Array; context: Uint8Array }) => Promise<void> = async (box) => {
    box.code = new Uint8Array([42]);
    box.context = new Uint8Array([99]);
  };
  let snapshotFailure = false;
  let moderationFailure = false;
  const make = () =>
    new GenerateGame(
      repository,
      { accessible: async () => game, versions: async () => [] } as unknown as GameRepository,
      {
        create: async (_id, source, _grant, _view, context) => {
          restored.push({ source, context });
          const state = {
            code: source?.slice() ?? new Uint8Array([0]),
            context: context?.slice() ?? new Uint8Array([0]),
          };
          const sandbox: Sandbox = {
            endpoint: 'fixture://durable',
            configureArtDirection: async () => {},
            artwork: async () => {},
            snapshot: async () => {
              if (snapshotFailure) throw new Error('Storage unavailable');
              return { source: state.code.slice(), context: state.context.slice() };
            },
            generate: async () => {
              counts.coding++;
              await coding(state);
            },
            build: async () => {
              counts.builds++;
            },
            validate: async () => ({
              files: smallFiles,
              visuals: captures
                ? [{ orientation: 'portrait', phase: 'play', bytes: new Uint8Array([0xff, 0xd8]) }]
                : undefined,
              source: state.code,
              title: 'Forest Fixture',
              description: 'Explicit unbilled resume fixture.',
            }),
            destroy: async () => {
              counts.destroyed++;
              state.code.fill(0);
              state.context.fill(0);
            },
          };
          return sandbox;
        },
      },
      {
        register: async () => ({
          url: 'fixture://gateway',
          token: 'fixture-only',
          model: 'fixture-only',
        }),
        revoke: () => {},
      },
      {
        create: async () => {
          counts.images++;
          return new Uint8Array([7]);
        },
      },
      storage,
      { package: async () => ({ bytes: new Uint8Array([8]), checksum: 'fixture' }) },
      { next: (prefix) => `${prefix}_${++sequence}`, token: () => '', hash: () => '' },
      { now: () => game.createdAt },
      10_000,
      repairs,
      {
        check: async () => {
          counts.moderation++;
          if (moderationFailure)
            throw new DomainError('MODEL_TEMPORARY', 'Fixture moderation outage');
          return safePromptAssessment();
        },
      },
      {
        plan: async () => {
          counts.plans++;
          return direction;
        },
      },
      undefined,
      'fixture',
      checkpoints,
      {
        wait: async () => {
          counts.waits++;
        },
      },
      quality,
    );
  return {
    job,
    make,
    counts,
    restored,
    checkpoints,
    blobs,
    setCoding: (fn: typeof coding) => {
      coding = fn;
    },
    failSnapshot: () => {
      snapshotFailure = true;
    },
    failModeration: () => {
      moderationFailure = true;
    },
  };
}
it('restores partial code and exact context after a CLI crash without repurchasing artwork or design', async () => {
  const s = scenario();
  s.setCoding(async (box) => {
    if (s.counts.coding === 1) {
      box.code = new Uint8Array([21]);
      box.context = new Uint8Array([81]);
      throw new DomainError('AGENT_FAILED', 'Fixture CLI interrupted');
    }
    expect(box.code).toEqual(new Uint8Array([21]));
    expect(box.context).toEqual(new Uint8Array([81]));
    box.code = new Uint8Array([42]);
  });
  await s.make().execute(s.job.id);
  expect(s.job.stage).toBe('ready');
  expect(s.counts).toMatchObject({
    images: 1,
    plans: 1,
    moderation: 1,
    coding: 2,
    destroyed: 2,
    waits: 1,
  });
  expect(s.restored[1]).toEqual({ source: new Uint8Array([21]), context: new Uint8Array([81]) });
});
it('persists the retry ceiling across replacement use case instances and offers manual resume', async () => {
  const s = scenario();
  s.setCoding(async (box) => {
    box.code = new Uint8Array([s.counts.coding]);
    throw new DomainError('AGENT_FAILED', 'Fixture repeated failure');
  });
  await expect(s.make().execute(s.job.id)).rejects.toMatchObject({ code: 'AGENT_FAILED' });
  expect(s.counts.coding).toBe(3);
  expect(s.counts.waits).toBe(2);
  expect((await s.checkpoints.load(s.job.id))?.attempts).toBe(3);
  expect(s.job.stage).toBe('failed');
  s.job.stage = 'queued'; // Explicit fake of a crashed worker returning after its last attempt.
  await expect(s.make().execute(s.job.id)).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' });
  expect(s.counts.coding).toBe(3);
  const cp = (await s.checkpoints.load(s.job.id))!;
  await s.checkpoints.save(s.job.id, { ...cp, attempts: 0 });
  s.job.stage = 'queued';
  s.setCoding(async (box) => {
    expect(box.code).toEqual(new Uint8Array([3]));
  });
  await s.make().execute(s.job.id);
  expect(s.job.stage).toBe('ready');
  expect(s.counts.images).toBe(1);
});
it('preserves progress on a permanent provider error without automatic paid retries', async () => {
  const s = scenario();
  s.setCoding(async (box) => {
    box.code = new Uint8Array([17]);
    throw new DomainError('PROVIDER_CREDITS', 'Provider requires funds');
  });
  await expect(s.make().execute(s.job.id)).rejects.toMatchObject({ code: 'PROVIDER_CREDITS' });
  const cp = (await s.checkpoints.load(s.job.id))!;
  expect(s.blobs.get(cp.sourceKey!)).toEqual(new Uint8Array([17]));
  expect(cp.artworkKey).toBeTruthy();
  expect(cp.contextKey).toBeTruthy();
  expect(s.counts.waits).toBe(0);
  expect(s.job.stage).toBe('failed');
});
it('retains the surviving sandbox when its progress cannot be durably saved', async () => {
  const s = scenario();
  s.failSnapshot();
  await expect(s.make().execute(s.job.id)).rejects.toMatchObject({ code: 'CHECKPOINT_FAILED' });
  expect(s.counts.destroyed).toBe(0);
  expect(s.counts.waits).toBe(0);
});
it('bounds automatic retries when moderation fails before creating any sandbox', async () => {
  const s = scenario();
  s.failModeration();
  await expect(s.make().execute(s.job.id)).rejects.toMatchObject({ code: 'MODEL_TEMPORARY' });
  expect((await s.checkpoints.load(s.job.id))?.attempts).toBe(3);
  expect(s.counts.moderation).toBe(3);
  expect(s.restored).toHaveLength(0);
});

it('checkpoints the separate sprite image and restores it after a CLI failure without repurchasing it', async () => {
  const s = scenario(watercolorDirection);
  s.setCoding(async (box) => {
    if (s.counts.coding === 1) {
      box.code = new Uint8Array([31]);
      throw new DomainError('AGENT_FAILED', 'Explicit interrupted sprite game fixture');
    }
    expect(box.code).toEqual(new Uint8Array([31]));
  });
  await s.make().execute(s.job.id);
  const cp = (await s.checkpoints.load(s.job.id))!;
  expect(s.job.stage).toBe('ready');
  expect(s.counts.images).toBe(2); // One background, one sprite sheet across both attempts.
  expect(s.counts.coding).toBe(2);
  expect(cp.spritesKey).toBeTruthy();
  expect(s.blobs.get(cp.spritesKey!)).toEqual(new Uint8Array([7]));
});

it('requires a visual approval after repairing a rejected functional build, preserving paid artwork', async () => {
  let reviews = 0;
  const s = scenario(
    watercolorDirection,
    {
      review: async () => {
        reviews++;
        return reviews === 1
          ? {
              approved: false,
              issues: [
                'Portrait play: basket is hidden behind the HUD; move it into the catching area.',
              ],
            }
          : { approved: true, issues: [] };
      },
    },
    1,
  );
  await s.make().execute(s.job.id);
  expect(s.job.stage).toBe('ready');
  expect(reviews).toBe(2);
  expect(s.counts).toMatchObject({ coding: 2, builds: 2, images: 2, plans: 1 });
});
it('fails publication when visual defects remain after the bounded polish pass', async () => {
  let reviews = 0;
  const s = scenario(
    watercolorDirection,
    {
      review: async () => {
        reviews++;
        return {
          approved: false,
          issues: ['Landscape play: reward is too small to read; increase its visible scale.'],
        };
      },
    },
    1,
  );
  await expect(s.make().execute(s.job.id)).rejects.toMatchObject({ code: 'QUALITY_FAILED' });
  expect(s.job.stage).toBe('failed');
  expect(reviews).toBe(2);
  expect(s.counts.coding).toBe(2);
  expect(s.counts.waits).toBe(0);
  expect((await s.checkpoints.load(s.job.id))?.diagnostic).toContain('reward is too small');
});
it('cannot publish through the quality gate without real captures', async () => {
  const s = scenario(
    watercolorDirection,
    {
      review: async () => {
        throw new Error('Should not review missing captures');
      },
    },
    0,
    false,
  );
  await expect(s.make().execute(s.job.id)).rejects.toMatchObject({ code: 'QUALITY_FAILED' });
  expect(s.job.stage).toBe('failed');
});
it('resumes an interrupted visual review without recoding or repurchasing completed artwork', async () => {
  let reviews = 0;
  const s = scenario(watercolorDirection, {
    review: async () => {
      if (++reviews === 1) throw new DomainError('MODEL_TEMPORARY', 'Fixture vision outage');
      return { approved: true, issues: [] };
    },
  });
  await s.make().execute(s.job.id);
  expect(s.job.stage).toBe('ready');
  expect(s.counts).toMatchObject({ coding: 1, images: 2, plans: 1, waits: 1, builds: 2 });
});
