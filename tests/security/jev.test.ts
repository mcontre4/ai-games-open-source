import { describe, expect, it, vi } from 'vitest';
import { JevPromptModeration } from '../../packages/adapters/src/ai/jev.ts';
import {
  InferenceBudget,
  OpenRouterClient,
  type DecisionModel,
} from '../../packages/adapters/src/ai/openrouter.ts';
import type { Database } from '../../packages/adapters/src/postgres/db.ts';
import { promptIssues } from '../../packages/domain/src/moderation.ts';

const model: DecisionModel = { id: 'typesafe/jev-1.13', promptPrice: 0.000000042 };
function reply() {
  return {
    model: `${model.id}-20260917`,
    answers: Object.fromEntries(promptIssues.map((issue) => [issue, { type: 'noul', noul: 0.01 }])),
    usage: { cost: 0.00005, input_tokens: 1200, output_tokens: 100 },
  };
}
function setup(response: unknown = reply()) {
  const budget = new InferenceBudget({} as Database);
  vi.spyOn(budget, 'reserve').mockResolvedValue(7);
  vi.spyOn(budget, 'settle').mockResolvedValue(undefined);
  const transport = vi.fn<typeof fetch>(async () => Response.json(response));
  const client = new OpenRouterClient('server-only-test-key', budget, transport, {
    reasoningEffort: 'high',
    maxTokens: 16384,
  });
  return { client, budget, transport, moderation: new JevPromptModeration(client, model) };
}
const signal = () => AbortSignal.timeout(1000);

describe('Jev Decisions transport with explicit unbilled fixtures', () => {
  it('sends separate typed questions, charges the reserved job, and never sends coding options', async () => {
    const { moderation, transport, budget } = setup();
    const prompt = 'Create an offline combat game with earned fictional coins.';
    const assessment = await moderation.check(prompt, true, 'gen_test', signal());
    expect(assessment.payments).toBe(0.01);
    expect(transport.mock.calls[0]![0]).toBe('https://openrouter.ai/api/alpha/decisions');
    const options = transport.mock.calls[0]![1]!;
    const sent = JSON.parse(options.body as string);
    expect(sent).toMatchObject({
      model: model.id,
      state: { prompt, modification: true },
      provider: { only: ['typesafe'], allow_fallbacks: false },
    });
    expect(Object.keys(sent.questions).sort()).toEqual([...promptIssues].sort());
    expect(sent.questions.extreme_violence.criteria.false).toContain('Ordinary combat');
    expect(sent.questions.payments.criteria.false).toContain('fictional coins');
    expect(sent.questions.external_services.criteria.false).toContain('GameSDK');
    expect(sent).not.toHaveProperty('reasoning');
    expect(sent).not.toHaveProperty('max_tokens');
    expect(sent).not.toHaveProperty('tools');
    expect(sent).not.toHaveProperty('messages');
    expect(options.redirect).toBe('error');
    expect(budget.reserve).toHaveBeenCalledWith(
      'gen_test',
      model.id,
      (new TextEncoder().encode(options.body as string).length + 2048) * model.promptPrice * 1.5,
    );
    expect(budget.settle).toHaveBeenCalledWith(7, 0.00005, 1200, 100);
  });
  it.each([-0.01, 1.01, '0.01', null])(
    'fails closed for invalid probability %s after settling usage',
    async (noul) => {
      const raw = reply();
      const { moderation, budget } = setup({
        ...raw,
        answers: { ...raw.answers, payments: { type: 'noul', noul } },
      });
      await expect(
        moderation.check('Create an arcade game.', false, 'gen_test', signal()),
      ).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' });
      expect(budget.settle).toHaveBeenCalled();
    },
  );
  it.each([
    { ...reply(), answers: {} },
    { ...reply(), answers: { ...reply().answers, invented_category: { type: 'noul', noul: 0 } } },
    { ...reply(), answers: { ...reply().answers, payments: { type: 'choice', choice: 'allow' } } },
    { ...reply(), model: 'other/model' },
    { ...reply(), usage: undefined },
    { choices: [{ message: { content: 'ALLOW' } }] },
  ])('fails closed for missing, unexpected, or ambiguous provider output', async (raw) => {
    const { moderation } = setup(raw);
    await expect(
      moderation.check('Create an arcade game.', false, 'gen_test', signal()),
    ).rejects.toThrow('could not validate');
  });
  it('makes no paid request without a budget and never exposes provider error prose', async () => {
    const { moderation, budget, transport } = setup();
    vi.mocked(budget.reserve).mockRejectedValue(
      new Error('sensitive provider or database details'),
    );
    await expect(
      moderation.check('Create an arcade game.', false, 'gen_test', signal()),
    ).rejects.toThrow('Please try again shortly');
    expect(transport).not.toHaveBeenCalled();
  });
  it('propagates cancellation to the provider', async () => {
    const { moderation, transport } = setup();
    const abort = new AbortController();
    transport.mockImplementation(async (_url, options) => {
      expect(options?.signal).toBeDefined();
      abort.abort();
      options?.signal?.throwIfAborted();
      return Response.json(reply());
    });
    await expect(
      moderation.check('Create an arcade game.', false, 'gen_test', abort.signal),
    ).rejects.toThrow('could not validate');
  });
  it('discovers decision endpoints rather than requiring coding tools or reasoning', async () => {
    const { client, transport } = setup();
    transport.mockResolvedValue(
      Response.json({
        data: {
          id: model.id,
          architecture: { output_modalities: ['decisions'] },
          endpoints: [
            {
              tag: 'typesafe',
              status: 0,
              pricing: { prompt: String(model.promptPrice), completion: '0' },
            },
          ],
        },
      }),
    );
    await expect(client.decisionModel(model.id, signal())).resolves.toEqual(model);
    expect(transport.mock.calls[0]![0]).toBe(
      `https://openrouter.ai/api/v1/models/${model.id}/endpoints`,
    );
  });
  it.each(['NaN', '-1', '0'])('rejects unbounded decision input pricing %s', async (price) => {
    const { client, transport } = setup();
    transport.mockResolvedValue(
      Response.json({
        data: {
          id: model.id,
          architecture: { output_modalities: ['decisions'] },
          endpoints: [{ tag: 'typesafe', status: 0, pricing: { prompt: price, completion: '0' } }],
        },
      }),
    );
    await expect(client.decisionModel(model.id, signal())).rejects.toThrow(
      'pricing cannot be bounded',
    );
  });
});
