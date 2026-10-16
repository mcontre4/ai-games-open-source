import { expect, it, vi } from 'vitest';
import { ControlledGateway } from '../../packages/adapters/src/ai/gateway.ts';
import { codingTier } from '../../packages/adapters/src/ai/coding-route.ts';
import { OpenRouterArtDirector } from '../../packages/adapters/src/ai/art-direction.ts';
import { OpenRouterGameQuality } from '../../packages/adapters/src/ai/game-quality.ts';
import {
  InferenceBudget,
  OpenRouterClient,
  type CodingModel,
} from '../../packages/adapters/src/ai/openrouter.ts';
import type { Database } from '../../packages/adapters/src/postgres/db.ts';
import { generationSpeeds } from '../../packages/domain/src/index.ts';
import { createGameSchema, modifyGameSchema } from '../../packages/contracts/src/index.ts';
import { watercolorDirection } from '../art-direction-fixture.ts';

it('defaults old create/modify clients to regular and rejects unapproved routing choices', () => {
  const input = { prompt: 'Explicit unbilled speed selection fixture.' };
  expect(createGameSchema.parse(input).speed).toBe('regular');
  expect(modifyGameSchema.parse(input).speed).toBe('regular');
  expect(createGameSchema.safeParse({ ...input, speed: 'flex' }).success).toBe(false);
  expect(modifyGameSchema.safeParse({ ...input, service_tier: 'ultrafast' }).success).toBe(false);
  expect(() => codingTier('flex' as never)).toThrow('Choose regular');
});

it('keeps concurrent grants and planning on their saved model and speed for both APIs', async () => {
  // Explicit unbilled provider fixtures. No live generation or measured latency.
  const routes = Object.fromEntries(
    generationSpeeds.map((speed) => {
      const spending = new InferenceBudget({} as Database);
      vi.spyOn(spending, 'reserve').mockResolvedValue(1);
      vi.spyOn(spending, 'settle').mockResolvedValue(undefined);
      const transport = vi.fn<typeof fetch>(async (url, init) =>
        Response.json(
          String(url).endsWith('/responses')
            ? {
                id: 'resp_speed_fixture',
                status: 'completed',
                output: [
                  {
                    id: 'msg_fixture',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [
                      { type: 'output_text', text: 'Explicit unbilled fixture.', annotations: [] },
                    ],
                  },
                ],
                usage: { cost: 0, input_tokens: 1, output_tokens: 1 },
              }
            : {
                choices: [
                  {
                    message: {
                      content: JSON.stringify(
                        JSON.parse(init!.body as string).response_format?.json_schema?.name ===
                          'game_visual_review'
                          ? { approved: true, issues: [] }
                          : watercolorDirection,
                      ),
                    },
                  },
                ],
                usage: { cost: 0, prompt_tokens: 1, completion_tokens: 1 },
              },
        ),
      );
      const tier = codingTier(speed);
      const model: CodingModel = {
        id: `fixture/${speed}`,
        architecture: { output_modalities: ['text'] },
        supported_parameters: ['tools', 'reasoning'],
        pricing: { prompt: '0.000002', completion: '0.00001' },
        ...(tier
          ? {
              serviceTier: tier,
              providerTags: [tier === 'priority' ? 'openai/fast' : 'openai/ultrafast'],
            }
          : {}),
      };
      const client = new OpenRouterClient('fixture-only', spending, transport, {
        serviceTier: tier,
        reasoningEffort: 'high',
        maxTokens: 2048,
      });
      return [speed, { client, model, transport }];
    }),
  );
  const regular = routes.regular!;
  const gateway = new ControlledGateway(
    regular.client,
    regular.model,
    0,
    5000,
    undefined,
    async (jobId) => routes[jobId]!,
  );
  await gateway.start();
  try {
    // Register all before sending: a later selection must never mutate an earlier grant.
    const grants = await Promise.all(generationSpeeds.map((speed) => gateway.register(speed)));
    for (const [index, speed] of generationSpeeds.entries()) {
      const route = routes[speed]!;
      await new OpenRouterArtDirector(route.client, route.model).plan(
        {
          prompt: 'Explicit forest speed fixture.',
          orientation: 'portrait',
          previousSource: null,
        },
        speed,
        AbortSignal.timeout(1000),
      );
      await new OpenRouterGameQuality(route.client, route.model).review(
        {
          request: 'Explicit unbilled visual review fixture.',
          direction: watercolorDirection,
          view: '2d',
          visuals: (['portrait', 'landscape'] as const).flatMap((orientation) =>
            (['menu', 'play', 'later-play'] as const).map((phase) => ({
              orientation,
              phase,
              bytes: new Uint8Array([0xff, 0xd8]),
            })),
          ),
        },
        speed,
        AbortSignal.timeout(1000),
      );
      for (const api of ['chat/completions', 'responses']) {
        const result = await gateway['app'].inject({
          method: 'POST',
          url: `/v1/${api}`,
          headers: { authorization: `Bearer ${grants[index]!.token}` },
          payload:
            api === 'responses'
              ? {
                  model: 'unapproved',
                  input: [],
                  service_tier: 'ultrafast',
                  tools: [
                    {
                      type: 'function',
                      name: 'mcp__game_files__read',
                      parameters: { type: 'object', properties: {} },
                    },
                  ],
                }
              : { model: 'unapproved', messages: [{ role: 'user', content: 'Fixture' }] },
        });
        expect(result.statusCode).toBe(200);
      }
      expect(route.transport).toHaveBeenCalledTimes(4);
      for (const [, init] of route.transport.mock.calls) {
        const sent = JSON.parse(init!.body as string);
        expect(sent.model).toBe(route.model.id);
        expect(sent.reasoning).toEqual({ effort: 'high' });
        expect(sent).not.toHaveProperty('speed');
        if (speed === 'regular') expect(sent).not.toHaveProperty('service_tier');
        else expect(sent.service_tier).toBe(codingTier(speed));
      }
    }
    gateway.revoke('fast');
    expect(
      (
        await gateway['app'].inject({
          method: 'POST',
          url: '/v1/responses',
          headers: { authorization: `Bearer ${grants[1]!.token}` },
          payload: { input: [] },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await gateway.stop();
  }
});
