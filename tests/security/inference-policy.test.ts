import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  InferenceBudget,
  OpenRouterClient,
  type CodingModel,
} from '../../packages/adapters/src/ai/openrouter.ts';
import type { Database } from '../../packages/adapters/src/postgres/db.ts';

const model: CodingModel = {
  id: 'openai/gpt-6.1-sol',
  architecture: { output_modalities: ['text'] },
  supported_parameters: ['tools', 'reasoning'],
  reasoning: { supported_efforts: ['low', 'medium', 'high'] },
  pricing: {
    prompt: '0.000002',
    completion: '0.00001',
    overrides: [{ prompt: '0.000004', completion: '0.000015' }],
  },
};
const options = { reasoningEffort: 'high' as const, maxTokens: 16384 };
// Explicit unbilled catalog/transport fixture, never a live Muse result.
const museEndpoint = {
  tag: 'meta',
  status: 0,
  context_length: 65536,
  max_completion_tokens: 58982,
  pricing: { prompt: '0', completion: '0', image_output: '0.00000239520958083832' },
};
const museCatalog = (endpoints: unknown[] = [museEndpoint]) => ({
  data: {
    id: 'meta/muse-image',
    architecture: { output_modalities: ['image'] },
    endpoints,
  },
});

function budget() {
  const instance = new InferenceBudget({} as Database);
  vi.spyOn(instance, 'reserve').mockResolvedValue(7);
  vi.spyOn(instance, 'settle').mockResolvedValue(undefined);
  return instance;
}

describe('controlled inference policy', () => {
  it('enforces model, high effort and total token allowance before reserving paid inference', async () => {
    const spending = budget();
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ message: { content: 'Explicit unbilled transport fixture.' } }],
        usage: { cost: 0.02, prompt_tokens: 100, completion_tokens: 200 },
      }),
    );
    const client = new OpenRouterClient('test-only', spending, transport, options);
    await client.chat(
      'gen_test',
      model,
      {
        messages: [{ role: 'user', content: 'Create a space game.' }],
        model: 'unapproved/model',
        reasoning: { effort: 'max' },
        reasoning_effort: 'low',
        max_tokens: 1_000_000,
        max_completion_tokens: 1_000_000,
        stream: true,
        provider: { allow_fallbacks: true },
        temperature: 2,
      },
      AbortSignal.timeout(1000),
    );
    const sent = JSON.parse(transport.mock.calls[0]![1]!.body as string);
    expect(sent).toMatchObject({
      model: model.id,
      reasoning: { effort: 'high' },
      max_tokens: 16384,
      stream: false,
      provider: { allow_fallbacks: false, require_parameters: true },
    });
    expect(sent).not.toHaveProperty('max_completion_tokens');
    expect(sent).not.toHaveProperty('reasoning_effort');
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('service_tier');
    expect(sent).not.toHaveProperty('speed');
    const bytes = new TextEncoder().encode(JSON.stringify(sent)).length;
    expect(spending.reserve).toHaveBeenCalledWith(
      'gen_test',
      model.id,
      (bytes + 512) * 0.000004 * 1.25 + 16384 * 0.000015 * 1.25,
    );
    expect(spending.settle).toHaveBeenCalledWith(7, 0.02, 100, 200);
  });

  it('uses native Responses tool calls with server-owned model, high effort and settled usage', async () => {
    const spending = budget();
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: 'resp_test',
        status: 'incomplete',
        output: [],
        usage: { cost: 0.03, input_tokens: 110, output_tokens: 210 },
      }),
    );
    const client = new OpenRouterClient('test-only', spending, transport, options);
    await client.responses(
      'gen_test',
      model,
      {
        input: [],
        tools: [{ type: 'function', name: 'mcp__game_files__read' }],
        model: 'other/model',
        reasoning: { effort: 'low' },
        max_output_tokens: 1_000_000,
        stream: true,
        provider: { allow_fallbacks: true },
        service_tier: 'ultrafast',
        speed: 'fast',
      },
      AbortSignal.timeout(1000),
    );
    expect(transport.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/responses');
    const sent = JSON.parse(transport.mock.calls[0]![1]!.body as string);
    expect(sent).toMatchObject({
      model: model.id,
      stream: false,
      store: false,
      reasoning: { effort: 'high' },
      max_output_tokens: 16384,
      provider: { allow_fallbacks: false, require_parameters: true },
    });
    expect(spending.reserve).toHaveBeenCalledWith('gen_test', model.id, expect.any(Number));
    expect(sent).not.toHaveProperty('service_tier');
    expect(sent).not.toHaveProperty('speed');
    // Even incomplete output must be billed before the gateway rejects it.
    expect(spending.settle).toHaveBeenCalledWith(7, 0.03, 110, 210);
  });
  it('bounds enlarged native Responses history before any paid inference', async () => {
    const spending = budget();
    const transport = vi.fn<typeof fetch>();
    const client = new OpenRouterClient('test-only', spending, transport, options);
    await expect(
      client.responses(
        'gen_test',
        model,
        { input: [{ type: 'reasoning', encrypted_content: 'x'.repeat(400_000) }] },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('bounded request size');
    expect(spending.reserve).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it('explains account access when image discovery hides Muse and makes no paid request', async () => {
    const spending = budget();
    const transport = vi.fn<typeof fetch>(async (url) =>
      Response.json(String(url).includes('/images/models/') ? { endpoints: [] } : museCatalog([])),
    );
    const client = new OpenRouterClient('test-only', spending, transport);
    await expect(
      client.image('gen_test', 'meta/muse-image', 'Forest.', AbortSignal.timeout(1000)),
    ).rejects.toThrow('Check 18+ confirmation and model access');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(spending.reserve).not.toHaveBeenCalled();
  });

  it('preserves the provider account requirement as an actionable domain error', async () => {
    const spending = budget();
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            message: 'This model requires 18+ age confirmation.',
            metadata: { missing_attestation_types: ['age_18plus'] },
          },
        },
        { status: 403 },
      ),
    );
    const client = new OpenRouterClient('test-only', spending, transport);
    await expect(
      client.imageModel('meta/muse-image', AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      code: 'MODEL_ACCOUNT_REQUIRED',
      message: expect.stringContaining('https://openrouter.ai/settings/preferences'),
    });
    expect(spending.reserve).not.toHaveBeenCalled();
  });

  it.each([
    { ...model, supported_parameters: ['tools'] },
    { ...model, reasoning: { supported_efforts: ['low', 'medium'] } },
  ])('rejects a coding endpoint that cannot honor configured high effort', async (candidate) => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: [candidate] }));
    const client = new OpenRouterClient('test-only', budget(), transport, options);
    await expect(client.codingModel(model.id, AbortSignal.timeout(1000))).rejects.toThrow(
      'selected reasoning effort',
    );
  });

  it('makes no paid request when the full reasoning/output allowance cannot be reserved', async () => {
    const spending = budget();
    vi.mocked(spending.reserve).mockRejectedValue(new Error('This game reached its limit.'));
    const transport = vi.fn<typeof fetch>();
    const client = new OpenRouterClient('test-only', spending, transport, options);
    await expect(
      client.chat(
        'gen_test',
        model,
        { messages: [{ role: 'user', content: 'Create a game.' }] },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('reached its limit');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('game image quality and layout', () => {
  it('generates Muse through /images despite empty image discovery and reserves its full catalog ceiling', async () => {
    const bytes = await sharp({
      create: { width: 1280, height: 1920, channels: 3, background: '#c4a778' },
    })
      .png()
      .toBuffer();
    const spending = budget();
    const transport = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('/images/models/')) return Response.json({ endpoints: [] });
      if (String(url).endsWith('/endpoints')) return Response.json(museCatalog());
      return Response.json({
        data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }],
        usage: { cost: 0.01 },
      });
    });
    const client = new OpenRouterClient('test-only', spending, transport, options);
    const result = await client.image(
      'gen_test',
      'meta/muse-image',
      'Watercolor forest.',
      AbortSignal.timeout(1000),
    );
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'https://openrouter.ai/api/v1/images/models/meta/muse-image/endpoints',
      'https://openrouter.ai/api/v1/models/meta/muse-image/endpoints',
      'https://openrouter.ai/api/v1/images',
    ]);
    expect(JSON.parse(transport.mock.calls[2]![1]!.body as string)).toMatchObject({
      model: 'meta/muse-image',
      n: 1,
      resolution: '2K',
      aspect_ratio: '9:16',
      provider: { only: ['meta'], allow_fallbacks: false },
    });
    expect(spending.reserve).toHaveBeenCalledWith(
      'gen_test',
      'meta/muse-image',
      58982 * Number(museEndpoint.pricing.image_output) * 1.5,
    );
    expect(spending.settle).toHaveBeenCalledWith(7, 0.01);
    expect(await sharp(result).metadata()).toMatchObject({
      width: 1280,
      height: 1920,
      format: 'png',
    });
  });

  it.each([
    { ...museEndpoint, status: 1 },
    { ...museEndpoint, max_completion_tokens: null },
    { ...museEndpoint, pricing: { ...museEndpoint.pricing, image_output: '-1' } },
  ])('rejects unavailable or unbounded Muse catalogs before paid inference', async (endpoint) => {
    const spending = budget();
    const transport = vi.fn<typeof fetch>(async (url) =>
      Response.json(
        String(url).includes('/images/models/') ? { endpoints: [] } : museCatalog([endpoint]),
      ),
    );
    await expect(
      new OpenRouterClient('test-only', spending, transport).image(
        'gen_test',
        'meta/muse-image',
        'Forest.',
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(spending.reserve).not.toHaveBeenCalled();
  });

  it('does not submit Muse inference when its conservative reservation exceeds the job budget', async () => {
    const spending = budget();
    vi.mocked(spending.reserve).mockRejectedValue(new Error('Job budget exhausted.'));
    const transport = vi.fn<typeof fetch>(async (url) =>
      Response.json(String(url).includes('/images/models/') ? { endpoints: [] } : museCatalog()),
    );
    await expect(
      new OpenRouterClient('test-only', spending, transport).image(
        'gen_test',
        'meta/muse-image',
        'Forest.',
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('Job budget exhausted.');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(spending.settle).not.toHaveBeenCalled();
  });

  async function imageClient(width: number, height: number) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: '#c4a778' } })
      .png()
      .toBuffer();
    const transport = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/endpoints'))
        return Response.json({
          endpoints: [
            {
              provider_tag: 'test-only',
              supported_parameters: {
                resolution: { type: 'enum', values: ['1K', '2K'] },
                aspect_ratio: { type: 'enum', values: ['9:16', '16:9'] },
              },
              pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }],
            },
          ],
        });
      return Response.json({
        data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }],
        usage: { cost: 0.04 },
      });
    });
    return { client: new OpenRouterClient('test-only', budget(), transport), transport };
  }
  it('requests premium 2K portrait art and preserves the delivered composition without stretching or cropping', async () => {
    const { client, transport } = await imageClient(1024, 1820);
    const result = await client.image(
      'gen_test',
      'test/image',
      'Watercolor forest background.',
      AbortSignal.timeout(1000),
      { orientation: 'portrait', quality: 'premium' },
    );
    expect(JSON.parse(transport.mock.calls[1]![1]!.body as string)).toMatchObject({
      resolution: '2K',
      aspect_ratio: '9:16',
      n: 1,
    });
    expect(await sharp(result).metadata()).toMatchObject({ width: 1024, height: 1820 });
  });
  it('rejects undersized art for a premium game', async () => {
    const { client } = await imageClient(128, 128);
    await expect(
      client.image('gen_test', 'test/image', 'Forest background.', AbortSignal.timeout(1000)),
    ).rejects.toThrow('undersized premium asset');
  });
  it('honors intentionally lower fidelity and landscape composition', async () => {
    const { client, transport } = await imageClient(512, 288);
    const result = await client.image(
      'gen_test',
      'test/image',
      'Deliberately rough low-fidelity sketch game.',
      AbortSignal.timeout(1000),
      { orientation: 'landscape', quality: 'intentional-low-fi' },
    );
    expect(JSON.parse(transport.mock.calls[1]![1]!.body as string)).toMatchObject({
      resolution: '1K',
      aspect_ratio: '16:9',
    });
    expect(await sharp(result).metadata()).toMatchObject({ width: 512, height: 288 });
  });
});

it.each(
  (['priority', 'ultrafast'] as const).flatMap((tier) =>
    (['chat', 'responses'] as const).map((api) => ({ tier, api })),
  ),
)('uses discovered $tier prices and pins the approved tier for $api', async ({ api, tier }) => {
  const spending = budget();
  const fast = {
    tag: 'openai/fast',
    status: 0,
    supported_parameters: ['tools', 'reasoning'],
    pricing: {
      prompt: '0.000004',
      completion: '0.00002',
      overrides: [{ prompt: '0.000008', completion: '0.00003' }],
    },
  };
  const ultrafast = {
    ...fast,
    tag: 'openai/ultrafast',
    pricing: {
      prompt: '0.000012',
      completion: '0.00006',
      overrides: [{ prompt: '0.000024', completion: '0.00009' }],
    },
  };
  const transport = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [model] });
    if (String(url).endsWith('/endpoints'))
      return Response.json({
        data: {
          id: model.id,
          endpoints: [fast, ultrafast],
        },
      });
    return Response.json(
      api === 'responses'
        ? {
            output: [],
            usage: { cost: 0.03, input_tokens: 10, output_tokens: 20 },
            service_tier: tier,
          }
        : {
            choices: [{ message: { content: 'Explicit transport fixture.' } }],
            usage: { cost: 0.03, prompt_tokens: 10, completion_tokens: 20 },
            service_tier: tier,
          },
    );
  });
  const client = new OpenRouterClient('test-only', spending, transport, {
    ...options,
    serviceTier: tier,
  });
  const discovered = await client.codingModel(model.id, AbortSignal.timeout(1000));
  await client[api](
    'gen_fast_fixture',
    discovered,
    {
      input: [],
      messages: [],
      service_tier: tier === 'ultrafast' ? 'priority' : 'ultrafast',
      speed: 'standard',
      provider: { only: ['unapproved'] },
    },
    AbortSignal.timeout(1000),
  );
  const sent = JSON.parse(transport.mock.calls[2]![1]!.body as string);
  expect(sent).toMatchObject({
    model: model.id,
    service_tier: tier,
    reasoning: { effort: 'high' },
    provider: {
      only: [tier === 'ultrafast' ? 'openai/ultrafast' : 'openai/fast'],
      allow_fallbacks: false,
      require_parameters: true,
    },
  });
  expect(sent).not.toHaveProperty('speed');
  const bytes = new TextEncoder().encode(JSON.stringify(sent)).length;
  expect(spending.reserve).toHaveBeenCalledWith(
    'gen_fast_fixture',
    model.id,
    (bytes + 512) *
      Number((tier === 'ultrafast' ? ultrafast : fast).pricing.overrides[0]!.prompt) *
      1.25 +
      16384 *
        Number((tier === 'ultrafast' ? ultrafast : fast).pricing.overrides[0]!.completion) *
        1.25,
  );
  expect(spending.settle).toHaveBeenCalledWith(7, 0.03, 10, 20);
  const otherTier = tier === 'ultrafast' ? 'priority' : 'ultrafast';
  const otherClient = new OpenRouterClient('test-only', spending, transport, {
    ...options,
    serviceTier: otherTier,
  });
  await expect(
    otherClient[api](
      'gen_other_tier',
      discovered,
      { input: [], messages: [] },
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({
    code: otherTier === 'ultrafast' ? 'MODEL_ULTRAFAST_UNAVAILABLE' : 'MODEL_PRIORITY_UNAVAILABLE',
  });
  expect(spending.reserve).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledTimes(3);
});

it.each(
  (['priority', 'ultrafast'] as const).flatMap((tier) => {
    const endpoint = {
      tag: tier === 'ultrafast' ? 'openai/ultrafast' : 'openai/fast',
      status: 0,
      supported_parameters: ['tools'],
      pricing: { prompt: '0.000012', completion: '0.00006' },
    };
    return [
      { tier, condition: 'absent', endpoints: [] },
      {
        tier,
        condition: 'unpriced',
        endpoints: [{ ...endpoint, pricing: { prompt: 'unknown', completion: '0.00006' } }],
      },
      { tier, condition: 'unhealthy', endpoints: [{ ...endpoint, status: 1 }] },
      {
        tier,
        condition: 'only another tier',
        endpoints: [
          { ...endpoint, tag: tier === 'ultrafast' ? 'openai/fast' : 'openai/ultrafast' },
        ],
      },
    ];
  }),
)('fails before paid inference when $tier capacity is $condition', async ({ tier, endpoints }) => {
  const spending = budget();
  const transport = vi.fn<typeof fetch>(async (url) =>
    Response.json(
      String(url).endsWith('/models') ? { data: [model] } : { data: { id: model.id, endpoints } },
    ),
  );
  const client = new OpenRouterClient('test-only', spending, transport, {
    ...options,
    serviceTier: tier,
  });
  const code = tier === 'ultrafast' ? 'MODEL_ULTRAFAST_UNAVAILABLE' : 'MODEL_PRIORITY_UNAVAILABLE';
  await expect(client.codingModel(model.id, AbortSignal.timeout(1000))).rejects.toMatchObject({
    code,
  });
  await expect(
    client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ code });
  expect(spending.reserve).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledTimes(2);
});

it('keeps text chat bounded while allowing a separately bounded trusted six-image review', async () => {
  const spending = budget();
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      choices: [{ message: { content: '{"approved":true,"issues":[]}' } }],
      usage: { cost: 0.04, prompt_tokens: 1000, completion_tokens: 20 },
    }),
  );
  const client = new OpenRouterClient('test-only', spending, transport, options);
  const body = {
    messages: [
      {
        role: 'user',
        content: Array.from({ length: 6 }, () => ({
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(40_000) },
        })),
      },
    ],
    service_tier: 'ultrafast',
  };
  await expect(client.chat('gen_test', model, body, AbortSignal.timeout(1000))).rejects.toThrow(
    'bounded request size',
  );
  expect(spending.reserve).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  await client.chat('gen_test', model, body, AbortSignal.timeout(1000), 'visual-review');
  expect(transport).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(transport.mock.calls[0]![1]!.body as string);
  expect(sent.model).toBe(model.id);
  expect(sent).not.toHaveProperty('service_tier');
  expect(sent.max_tokens).toBe(16384);
  expect(sent.reasoning).toEqual({ effort: 'high' });
  expect(spending.settle).toHaveBeenCalledWith(7, 0.04, 1000, 20);
  await expect(
    client.chat(
      'gen_test',
      model,
      { messages: [{ role: 'user', content: 'x'.repeat(400_000) }] },
      AbortSignal.timeout(1000),
      'visual-review',
    ),
  ).rejects.toThrow('bounded request size');
  expect(spending.reserve).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledTimes(1);
});
