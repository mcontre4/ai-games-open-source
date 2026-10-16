import { describe, expect, it, vi } from 'vitest';
import {
  InferenceBudget,
  OpenRouterClient,
  type CodingModel,
} from '../../packages/adapters/src/ai/openrouter.ts';
import type { Database } from '../../packages/adapters/src/postgres/db.ts';

// Explicit unbilled provider transport. No live completion is implied.
const model: CodingModel = {
  id: 'openai/gpt-6.1-sol',
  architecture: { output_modalities: ['text'] },
  supported_parameters: ['tools', 'reasoning'],
  pricing: { prompt: '0.000002', completion: '0.00001' },
};
const limited = (
  source = 'openrouter_in_flight_budget',
  reason = 'in_flight_budget_exhausted',
  retryAfter = '2',
) =>
  Response.json(
    {
      error: {
        message: 'In-flight spending budget exhausted.',
        metadata: { limit_source: source, reason },
      },
    },
    { status: 402, headers: { 'Retry-After': retryAfter } },
  );
const completed = () =>
  Response.json({ output: [], usage: { cost: 0.02, input_tokens: 100, output_tokens: 200 } });
function spending() {
  const budget = new InferenceBudget({} as Database);
  vi.spyOn(budget, 'reserve').mockResolvedValue(7);
  vi.spyOn(budget, 'settle').mockResolvedValue(undefined);
  return budget;
}

describe('OpenRouter in-flight settlement retries', () => {
  it('honors Retry-After and reuses one reservation and one actual settlement', async () => {
    const budget = spending();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(completed());
    const wait = vi.fn(async () => {});
    const client = new OpenRouterClient('test-only', budget, transport, {}, { now: () => 0, wait });
    await client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000));
    expect(wait).toHaveBeenCalledWith(2000, expect.any(AbortSignal));
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]![1]!.body).toEqual(transport.mock.calls[1]![1]!.body);
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.settle).toHaveBeenCalledExactlyOnceWith(7, 0.02, 100, 200);
  });
  it('honors HTTP-date Retry-After using the injected clock', async () => {
    const now = Date.parse('2026-10-12T00:00:00Z');
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(limited(undefined, undefined, 'Mon, 12 Oct 2026 00:00:07 GMT'))
      .mockResolvedValueOnce(completed());
    const wait = vi.fn(async () => {});
    const client = new OpenRouterClient(
      'test-only',
      spending(),
      transport,
      {},
      { now: () => now, wait },
    );
    await client.request('/responses', { input: [] }, AbortSignal.timeout(1000));
    expect(wait).toHaveBeenCalledWith(7000, expect.any(AbortSignal));
  });
  it.each([
    ['openrouter_key_limit', 'in_flight_budget_exhausted'],
    ['openrouter_credits', 'weight_exceeds_budget'],
    ['openrouter_in_flight_budget', 'unknown'],
  ])(
    'does not retry permanent or unrecognized credit failures: %s / %s',
    async (source, reason) => {
      const transport = vi.fn<typeof fetch>(async () => limited(source, reason));
      const wait = vi.fn(async () => {});
      const client = new OpenRouterClient(
        'test-only',
        spending(),
        transport,
        {},
        { now: () => 0, wait },
      );
      await expect(
        client.request('/responses', { input: [] }, AbortSignal.timeout(1000)),
      ).rejects.toMatchObject({ code: 'PROVIDER_CREDITS' });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    },
  );
  it('bounds retry count without treating rejected requests as additional billed calls', async () => {
    const budget = spending();
    const transport = vi.fn<typeof fetch>(async () => limited());
    const wait = vi.fn(async () => {});
    const client = new OpenRouterClient('test-only', budget, transport, {}, { now: () => 0, wait });
    await expect(
      client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: 'MODEL_TEMPORARY' });
    expect(transport).toHaveBeenCalledTimes(7);
    expect(wait).toHaveBeenCalledTimes(6);
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.settle).toHaveBeenCalledExactlyOnceWith(7, 0);
  });
  it('stops before another request when cancelled during the settlement wait', async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>(async () => limited());
    const wait = vi.fn(async () => {
      controller.abort(new Error('Explicit test cancellation.'));
    });
    const client = new OpenRouterClient(
      'test-only',
      spending(),
      transport,
      {},
      { now: () => 0, wait },
    );
    await expect(client.request('/responses', { input: [] }, controller.signal)).rejects.toThrow(
      'Explicit test cancellation.',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('never retries ambiguous provider or network failures', async () => {
    for (const result of ['network', 'server']) {
      const transport = vi.fn<typeof fetch>(async () => {
        if (result === 'network') throw new Error('Uncertain paid transport.');
        return Response.json(
          { error: { message: 'Uncertain provider failure.' } },
          { status: 500 },
        );
      });
      const wait = vi.fn(async () => {});
      const client = new OpenRouterClient(
        'test-only',
        spending(),
        transport,
        {},
        { now: () => 0, wait },
      );
      await expect(
        client.request('/responses', { input: [] }, AbortSignal.timeout(1000)),
      ).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
  });
});

it('releases definite rejected reservations while retaining ambiguous bills and saves call bodies without credentials', async () => {
  for (const status of [402, 429, 500]) {
    const budget = spending();
    const records: unknown[] = [];
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ error: { message: 'Explicit unbilled failure fixture' } }, { status }),
    );
    const client = new OpenRouterClient('secret-test-key', budget, transport, {}, undefined, {
      record: async (...args) => {
        records.push(args);
      },
    });
    await expect(
      client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
    ).rejects.toThrow();
    if (status === 500) expect(budget.settle).not.toHaveBeenCalled();
    else expect(budget.settle).toHaveBeenCalledExactlyOnceWith(7, 0);
    expect(records).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain('secret-test-key');
    expect(transport).toHaveBeenCalledTimes(1);
  }
});

// Explicit fixture matching the saved failed Responses envelope; no live inference.
const creditVerificationFailure = {
  id: 'gen-credit-verification-fixture',
  status: 'failed',
  output: [],
  usage: null,
  error: {
    code: 'rate_limit_exceeded',
    message:
      'OpenRouter could not verify available credits for this request in time. Retry shortly.',
  },
};

describe('OpenRouter failed Responses envelopes', () => {
  it('retries credit verification failures and settles only the successful completion', async () => {
    const budget = spending();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(creditVerificationFailure))
      .mockResolvedValueOnce(completed());
    const wait = vi.fn(async () => {});
    const client = new OpenRouterClient('test-only', budget, transport, {}, { now: () => 0, wait });
    await client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000));
    expect(wait).toHaveBeenCalledExactlyOnceWith(10_000, expect.any(AbortSignal));
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]![1]!.body).toEqual(transport.mock.calls[1]![1]!.body);
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.settle).toHaveBeenCalledExactlyOnceWith(7, 0.02, 100, 200);
  });

  it('bounds repeated credit verification failures and reports the provider cause', async () => {
    const budget = spending();
    const transport = vi.fn<typeof fetch>(async () => Response.json(creditVerificationFailure));
    const wait = vi.fn(async () => {});
    const client = new OpenRouterClient('test-only', budget, transport, {}, { now: () => 0, wait });
    await expect(
      client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      code: 'MODEL_TEMPORARY',
      message: expect.stringContaining('could not verify available credits'),
    });
    expect(transport).toHaveBeenCalledTimes(7);
    expect(wait).toHaveBeenCalledTimes(6);
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.settle).toHaveBeenCalledExactlyOnceWith(7, 0);
  });

  it.each([
    { ...creditVerificationFailure, usage: { cost: 0.02 } },
    { ...creditVerificationFailure, output: [{ type: 'reasoning' }] },
    {
      ...creditVerificationFailure,
      error: { code: 'rate_limit_exceeded', message: 'Unknown provider rate limit.' },
    },
    {
      ...creditVerificationFailure,
      error: { code: 'server_error', message: 'Uncertain provider failure.' },
    },
  ])(
    'retains ambiguous reservations and does not retry other failed envelopes: %j',
    async (raw) => {
      const budget = spending();
      const transport = vi.fn<typeof fetch>(async () => Response.json(raw));
      const wait = vi.fn(async () => {});
      const client = new OpenRouterClient(
        'test-only',
        budget,
        transport,
        {},
        { now: () => 0, wait },
      );
      await expect(
        client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
      ).rejects.toMatchObject({ message: expect.stringContaining(raw.error.message) });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
      expect(budget.settle).not.toHaveBeenCalled();
    },
  );

  it('does not make another request after cancellation during credit verification wait', async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>(async () => Response.json(creditVerificationFailure));
    const wait = vi.fn(async () => controller.abort(new Error('Explicit test cancellation.')));
    const client = new OpenRouterClient(
      'test-only',
      spending(),
      transport,
      {},
      { now: () => 0, wait },
    );
    await expect(client.request('/responses', { input: [] }, controller.signal)).rejects.toThrow(
      'Explicit test cancellation.',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

// Fake elapsed time models a base-speed planning/review request exceeding the
// old two-minute cap. The transport honors aborts, so the old cap fails this test.
describe('base-speed Chat Completions deadlines', () => {
  it('allows slow planning/review beyond two minutes and preserves the shorter discovery deadline', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
      return controller.signal;
    });
    try {
      const budget = spending();
      const transport = vi.fn<typeof fetch>(
        (_url, options) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () =>
                resolve(
                  Response.json({
                    choices: [{ message: { content: 'Slow unbilled planning fixture' } }],
                    usage: { cost: 0.02, prompt_tokens: 100, completion_tokens: 200 },
                  }),
                ),
              130_000,
            );
            options!.signal!.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(options!.signal!.reason);
              },
              { once: true },
            );
          }),
      );
      const client = new OpenRouterClient('test-only', budget, transport);
      const completion = client.chat(
        'gen_test',
        model,
        { messages: [] },
        new AbortController().signal,
      );
      const assertion = expect(completion).resolves.toMatchObject({
        choices: [{ message: { content: 'Slow unbilled planning fixture' } }],
      });
      await vi.advanceTimersByTimeAsync(130_000);
      await assertion;
      expect(timeout).toHaveBeenCalledWith(600_000);
      expect(budget.settle).toHaveBeenCalledExactlyOnceWith(7, 0.02, 100, 200);
      const discovery = client.request('/models', undefined, new AbortController().signal);
      const discoveryAssertion = expect(discovery).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(120_000);
      await discoveryAssertion;
      expect(timeout).toHaveBeenLastCalledWith(120_000);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
  it('honors caller cancellation during slow planning without another paid call or an invented settlement', async () => {
    const budget = spending();
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>(async () => {
      const reason = new Error('Explicit caller cancellation');
      controller.abort(reason);
      throw reason;
    });
    const client = new OpenRouterClient('test-only', budget, transport);
    await expect(
      client.chat('gen_test', model, { messages: [] }, controller.signal),
    ).rejects.toThrow('Explicit caller cancellation');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(budget.settle).not.toHaveBeenCalled();
  });
  it('records a clear request-timeout error while retaining an uncertain bill', async () => {
    const budget = spending();
    const records: unknown[] = [];
    const transport = vi.fn<typeof fetch>(async () => {
      throw new DOMException('Request timed out', 'TimeoutError');
    });
    const client = new OpenRouterClient('test-only', budget, transport, {}, undefined, {
      record: async (...args) => {
        records.push(args);
      },
    });
    await expect(
      client.chat('gen_test', model, { messages: [] }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
    expect(records.at(-1)).toMatchObject([
      'gen_test',
      expect.any(Object),
      { error: 'MODEL_TIMEOUT' },
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(budget.settle).not.toHaveBeenCalled();
  });
});

// Explicit dropped-body fixtures carrying the same header used by live OpenRouter.
const providerId = 'gen-1791826459-receipt-fixture';
function disconnected(id = providerId) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError('terminated'));
      },
    }),
    { headers: { 'X-Generation-Id': id } },
  );
}
const receipt = {
  id: providerId,
  model: 'openai/gpt-6.1-sol-20260929',
  total_cost: 0.1752921,
  finish_reason: 'tool_calls',
  tokens_prompt: 49559,
  tokens_completion: 9407,
};
describe('dropped OpenRouter response accounting', () => {
  it('settles the exact completed receipt before allowing saved progress to resume, without reissuing inference', async () => {
    const budget = spending();
    const records: unknown[] = [];
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(disconnected())
      .mockResolvedValueOnce(Response.json({ data: receipt }));
    const client = new OpenRouterClient('secret-test-key', budget, transport, {}, undefined, {
      record: async (...args) => {
        records.push(args);
      },
    });
    await expect(
      client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: 'MODEL_TEMPORARY' });
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.settle).toHaveBeenCalledExactlyOnceWith(7, receipt.total_cost, 49559, 9407);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]![0]).toBe(
      `https://openrouter.ai/api/v1/generation?id=${providerId}`,
    );
    expect(transport.mock.calls[1]![1]!.method).toBe('GET');
    expect(records[1]).toMatchObject([
      'gen_test',
      expect.anything(),
      {
        providerGenerationId: providerId,
        usageId: 7,
        status: 'response_received',
      },
    ]);
    expect(JSON.stringify(records)).not.toContain('secret-test-key');
  });
  it.each([
    { ...receipt, finish_reason: null },
    { ...receipt, id: 'gen-other-request' },
    { ...receipt, model: 'other/model' },
    { ...receipt, total_cost: -1 },
    { ...receipt, total_cost: undefined },
    { ...receipt, tokens_prompt: 1.2 },
  ])(
    'retains uncertain reservations for unfinished, mismatched or invalid receipts %j',
    async (data) => {
      const budget = spending();
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(disconnected())
        .mockResolvedValueOnce(Response.json({ data }));
      const client = new OpenRouterClient('test-only', budget, transport);
      await expect(
        client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
      ).rejects.toThrow('terminated');
      expect(budget.settle).not.toHaveBeenCalled();
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );
  it('preserves caller cancellation while retaining the response ID and uncertain bill', async () => {
    const budget = spending(),
      controller = new AbortController();
    const records: unknown[] = [];
    const reason = new Error('Explicit caller cancellation.');
    const transport = vi.fn<typeof fetch>(async () => {
      controller.abort(reason);
      return disconnected();
    });
    const client = new OpenRouterClient('test-only', budget, transport, {}, undefined, {
      record: async (...args) => {
        records.push(args);
      },
    });
    await expect(
      client.responses('gen_test', model, { input: [] }, controller.signal),
    ).rejects.toBe(reason);
    expect(budget.settle).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(records)).toContain(providerId);
  });
  it('does not query arbitrary or absent provider IDs', async () => {
    const budget = spending();
    const transport = vi.fn<typeof fetch>(async () =>
      disconnected('https://other.invalid/private'),
    );
    const client = new OpenRouterClient('test-only', budget, transport);
    await expect(
      client.responses('gen_test', model, { input: [] }, AbortSignal.timeout(1000)),
    ).rejects.toThrow('terminated');
    expect(budget.settle).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
