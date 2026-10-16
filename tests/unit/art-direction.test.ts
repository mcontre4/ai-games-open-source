import { expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { OpenRouterArtDirector } from '../../packages/adapters/src/ai/art-direction.ts';
import type { OpenRouterClient, CodingModel } from '../../packages/adapters/src/ai/openrouter.ts';
import { watercolorDirection } from '../art-direction-fixture.ts';

const model = { id: 'test-only' } as CodingModel;
it('passes explicit style/theme and prior version art direction through structured planning', async () => {
  const chat = vi.fn(
    async (_jobId: string, _model: CodingModel, _body: Record<string, unknown>) => ({
      choices: [{ message: { content: JSON.stringify(watercolorDirection) } }],
    }),
  );
  const planner = new OpenRouterArtDirector({ chat } as unknown as OpenRouterClient, model);
  const request =
    'Add butterflies to my autumn watercolor forest puzzle game; preserve its hand-painted style.';
  const previousSource = zipSync({
    'public/game.json': strToU8(
      JSON.stringify({
        title: 'Autumn Garden',
        description: 'An autumn garden puzzle.',
        artDirection: watercolorDirection,
      }),
    ),
    'src/Game.ts': strToU8('// Explicit prior-game mechanics fixture.'),
  });
  expect(
    await planner.plan(
      { prompt: request, orientation: 'portrait', previousSource },
      'gen_test',
      AbortSignal.timeout(1000),
    ),
  ).toEqual(watercolorDirection);
  const body = chat.mock.calls[0]![2] as unknown as {
    messages: { role: string; content: string }[];
    response_format: { json_schema: { strict: boolean } };
  };
  expect(JSON.parse(body.messages[1]!.content)).toMatchObject({
    request,
    previousGame: { artDirection: watercolorDirection },
    previousGameplaySource: '// Explicit prior-game mechanics fixture.',
  });
  expect(body.response_format.json_schema.strict).toBe(true);
});

it('reads legacy direction metadata but rejects a new 2D plan without gameplay and sprites', async () => {
  const { gameplay: _gameplay, sprites: _sprites, ...legacy } = watercolorDirection;
  const planner = new OpenRouterArtDirector(
    {
      chat: async () => ({ choices: [{ message: { content: JSON.stringify(legacy) } }] }),
    } as unknown as OpenRouterClient,
    model,
  );
  await expect(
    planner.plan(
      {
        prompt: 'Create a forest puzzle game.',
        orientation: 'portrait',
        previousSource: null,
      },
      'gen_fixture',
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow('invalid game art direction');
});

it('allows a simple game to request only its player sprite, without invented enemies or props', async () => {
  const direction = {
    ...watercolorDirection,
    sprites: {
      player: 'A single large red illustrated rubber ball.',
      threat: null,
      reward: null,
      prop: null,
    },
  };
  const planner = new OpenRouterArtDirector(
    {
      chat: async () => ({ choices: [{ message: { content: JSON.stringify(direction) } }] }),
    } as unknown as OpenRouterClient,
    model,
  );
  expect(
    await planner.plan(
      {
        prompt: 'A single red ball to tap. Nothing else.',
        orientation: 'portrait',
        previousSource: null,
      },
      'gen_fixture',
      AbortSignal.timeout(1000),
    ),
  ).toEqual(direction);
});

it('requires gameplay for a 3D plan without requesting a flat sprite sheet', async () => {
  const { sprites: _sprites, ...direction } = watercolorDirection;
  const chat = vi.fn(
    async (_jobId: string, _model: CodingModel, _body: Record<string, unknown>) => ({
      choices: [{ message: { content: JSON.stringify(direction) } }],
    }),
  );
  const planner = new OpenRouterArtDirector({ chat } as unknown as OpenRouterClient, model);
  expect(
    await planner.plan(
      {
        prompt: 'Create a 3D forest puzzle game.',
        orientation: 'portrait',
        view: '3d',
        previousSource: null,
      },
      'gen_fixture',
      AbortSignal.timeout(1000),
    ),
  ).toEqual(direction);
  const body = chat.mock.calls[0]![2] as {
    response_format: {
      json_schema: { schema: { properties: Record<string, unknown>; required: string[] } };
    };
  };
  expect(body.response_format.json_schema.schema.required).toContain('gameplay');
  expect(body.response_format.json_schema.schema.properties).not.toHaveProperty('sprites');
});

it('rejects unsafe palette strings instead of admitting CSS or external URLs', async () => {
  const bad = {
    ...watercolorDirection,
    palette: { ...watercolorDirection.palette, background: 'url(https://example.com/tracker)' },
  };
  const chat = async () => ({ choices: [{ message: { content: JSON.stringify(bad) } }] });
  const planner = new OpenRouterArtDirector({ chat } as unknown as OpenRouterClient, model);
  await expect(
    planner.plan(
      { prompt: 'Create a forest puzzle game.', orientation: 'portrait', previousSource: null },
      'gen_test',
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow('invalid game art direction');
});

it('requires a concrete presentation plan on every new plan while retaining legacy metadata compatibility', async () => {
  const { presentation: _presentation, ...old } = watercolorDirection;
  const planner = new OpenRouterArtDirector(
    {
      chat: async () => ({ choices: [{ message: { content: JSON.stringify(old) } }] }),
    } as unknown as OpenRouterClient,
    model,
  );
  await expect(
    planner.plan(
      { prompt: 'A polished forest game.', orientation: 'portrait', previousSource: null },
      'gen_fixture',
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow('invalid game art direction');
});
