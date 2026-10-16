import { z } from 'zod';
import sharp from 'sharp';
import { prepareSpriteSheet } from '../generation/sprite-sheet.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { DomainError, activeStages } from '../../../domain/src/index.ts';
import type { ImageGenerationPort, GenerationCallPort } from '../../../application/src/ports.ts';
import type { Database } from '../postgres/db.ts';
import type { GameArtDirection, Orientation } from '../../../domain/src/index.ts';
const modelSchema = z.object({
  id: z.string(),
  architecture: z.object({ output_modalities: z.array(z.string()) }),
  supported_parameters: z.array(z.string()),
  reasoning: z.object({ supported_efforts: z.array(z.string()).nullish() }).nullish(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
    overrides: z.array(z.object({ prompt: z.string(), completion: z.string() })).optional(),
  }),
});
const modelsSchema = z.object({ data: z.array(modelSchema) });
const imageEndpointsSchema = z.object({
  endpoints: z.array(
    z.object({
      provider_tag: z.string().nullable(),
      supported_parameters: z.record(
        z.string(),
        z.object({ type: z.string(), values: z.array(z.string()).optional() }).passthrough(),
      ),
      pricing: z.array(
        z.object({
          billable: z.string(),
          unit: z.string(),
          cost_usd: z.number().finite().nonnegative(),
        }),
      ),
    }),
  ),
});
const catalogPriceSchema = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const museEndpointsSchema = z.object({
  data: z.object({
    id: z.literal('meta/muse-image'),
    architecture: z.object({ output_modalities: z.array(z.string()) }),
    endpoints: z.array(
      z.object({
        tag: z.string().min(1),
        status: z.number(),
        context_length: z.number().int().positive(),
        max_completion_tokens: z.number().int().positive().nullable(),
        pricing: z.object({
          prompt: catalogPriceSchema,
          completion: catalogPriceSchema,
          image_output: catalogPriceSchema.pipe(z.number().positive()),
        }),
      }),
    ),
  }),
});
export type CodingModel = z.infer<typeof modelSchema> & {
  providerTags?: string[];
  serviceTier?: 'priority' | 'ultrafast';
};
export type DecisionModel = { id: string; promptPrice: number };
export type DecisionQuestion = {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
};
export type CodingOptions = {
  serviceTier?: 'default' | 'priority' | 'ultrafast';
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
};
const replySchema = z
  .object({
    choices: z.array(
      z
        .object({ message: z.object({ content: z.string().nullable().optional() }).passthrough() })
        .passthrough(),
    ),
    usage: z
      .object({
        cost: z.number().nonnegative().optional(),
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();
export class InferenceBudget {
  constructor(
    private db: Database,
    private estimatedCostEnabled = true,
    private costLimitEnabled = true,
  ) {}
  async reserve(jobId: string, model: string, estimated: number): Promise<number> {
    if (!Number.isFinite(estimated) || estimated <= 0)
      throw new DomainError('MODEL_PRICING', 'Model pricing cannot be bounded.');
    // Reserve whole microdollars conservatively; use integers to compare fractional budgets.
    estimated = Math.ceil(estimated * 1_000_000) / 1_000_000;
    return this.db.transaction(async (c) => {
      const row = await c.query<{ stage: string; reserved_cost: string; charged_cost: string }>(
        'select stage,reserved_cost,charged_cost from generation_jobs where id=$1 for update',
        [jobId],
      );
      const j = row.rows[0];
      if (!j || !activeStages.includes(j.stage as (typeof activeStages)[number]))
        throw new DomainError('JOB_INACTIVE', 'Generation is no longer active.', 403);
      if (
        this.costLimitEnabled &&
        (this.estimatedCostEnabled
          ? Math.round(Number(j.charged_cost) * 1_000_000) + Math.round(estimated * 1_000_000) >
            Math.round(Number(j.reserved_cost) * 1_000_000)
          : Number(j.charged_cost) >= Number(j.reserved_cost))
      )
        throw new DomainError('JOB_BUDGET', 'This game reached its inference spending limit.', 429);
      if (
        (
          await c.query(
            'select 1 from inference_usage where generation_id=$1 and settled_at is null and (not $2::boolean or not estimated_reserved) limit 1',
            [jobId, this.estimatedCostEnabled],
          )
        ).rowCount
      )
        throw new DomainError(
          'INFERENCE_PENDING',
          'The previous inference cost has not been settled.',
          429,
        );
      if (this.estimatedCostEnabled)
        await c.query('update generation_jobs set charged_cost=charged_cost+$2 where id=$1', [
          jobId,
          estimated,
        ]);
      return (
        await c.query<{ id: number }>(
          'insert into inference_usage(generation_id,model,estimated_cost,estimated_reserved) values($1,$2,$3,$4) returning id',
          [jobId, model, estimated, this.estimatedCostEnabled],
        )
      ).rows[0]!.id;
    });
  }
  async settle(
    usageId: number,
    actual: number | undefined,
    promptTokens = 0,
    completionTokens = 0,
  ) {
    if (actual !== undefined && (!Number.isFinite(actual) || actual < 0))
      throw new DomainError('MODEL_PRICING', 'Provider returned an invalid inference cost.');
    const exceeded = await this.db.transaction(async (c) => {
      const r = await c.query<{
        generation_id: string;
        estimated_cost: string;
        settled_at: Date | null;
        estimated_reserved: boolean;
      }>(
        'select generation_id,estimated_cost,settled_at,estimated_reserved from inference_usage where id=$1 for update',
        [usageId],
      );
      const usage = r.rows[0];
      if (!usage) throw new DomainError('NOT_FOUND', 'Inference usage not found.', 404);
      if (usage.settled_at) return null;
      const estimated = Number(usage.estimated_cost);
      if (!usage.estimated_reserved && actual === undefined)
        throw new DomainError(
          'MODEL_USAGE_MISSING',
          'OpenRouter did not report the billed cost; generation stopped before another paid request.',
          503,
        );
      const charged = actual ?? estimated;
      await c.query(
        'update inference_usage set actual_cost=$2,prompt_tokens=$3,completion_tokens=$4,settled_at=now() where id=$1',
        [usageId, actual ?? null, promptTokens, completionTokens],
      );
      const job = await c.query<{ charged_cost: string; reserved_cost: string }>(
        'update generation_jobs set charged_cost=charged_cost-$2+$3 where id=$1 returning charged_cost,reserved_cost',
        [usage.generation_id, usage.estimated_reserved ? estimated : 0, charged],
      );
      if (
        this.costLimitEnabled &&
        !usage.estimated_reserved &&
        Number(job.rows[0]!.charged_cost) > Number(job.rows[0]!.reserved_cost)
      )
        return 'JOB_BUDGET';
      return this.costLimitEnabled &&
        usage.estimated_reserved &&
        actual !== undefined &&
        actual > estimated
        ? 'MODEL_PRICING_CHANGED'
        : null;
    });
    if (exceeded === 'JOB_BUDGET')
      throw new DomainError('JOB_BUDGET', 'This game reached its inference spending limit.', 429);
    if (exceeded === 'MODEL_PRICING_CHANGED')
      throw new DomainError(
        'MODEL_PRICING_CHANGED',
        'Provider exceeded the reserved estimate. Disable generation and review pricing.',
      );
  }
}
/** A received rejection is distinct from an ambiguous network disconnect. */
export class OpenRouterRequestError extends DomainError {
  constructor(
    public readonly httpStatus: number,
    detail: string,
    temporary = false,
  ) {
    super(
      httpStatus === 402
        ? temporary
          ? 'MODEL_TEMPORARY'
          : 'PROVIDER_CREDITS'
        : [408, 429, 500, 502, 503, 504].includes(httpStatus)
          ? 'MODEL_TEMPORARY'
          : 'MODEL_ERROR',
      httpStatus === 402 && temporary
        ? 'OpenRouter temporarily rejected the in-flight budget. Resume your saved creation to try again.'
        : httpStatus === 402
          ? 'OpenRouter has insufficient available funds for this request. Your progress is saved; resume after adding provider credits.'
          : `OpenRouter request failed (${httpStatus})${detail ? `: ${detail}` : '.'}`,
      503,
    );
  }
  get unbilledRejection() {
    return [400, 401, 402, 403, 404, 413, 422, 429].includes(this.httpStatus);
  }
}
export class OpenRouterClient {
  constructor(
    private key: string,
    private budget: InferenceBudget,
    private fetcher: typeof fetch = fetch,
    private options: CodingOptions = {},
    private retryClock = {
      now: () => Date.now(),
      wait: async (milliseconds: number, signal: AbortSignal) => {
        await sleep(milliseconds, undefined, { signal });
      },
    },
    private calls?: GenerationCallPort,
  ) {}
  async request(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    return this.requestAt(`/v1${path}`, body, signal);
  }
  private async requestAt(
    path: string,
    body: unknown,
    signal: AbortSignal,
    receivedGeneration?: (id: string) => Promise<void>,
  ): Promise<unknown> {
    if (!this.key)
      throw new DomainError('AI_UNAVAILABLE', 'OpenRouter key is not configured.', 503);
    const requestSignal = AbortSignal.any([
      signal,
      // Base-speed planning/review uses Chat Completions and can take as long
      // as a Codex turn. Discovery/moderation/image-specific endpoints remain short.
      AbortSignal.timeout(
        ['/v1/responses', '/v1/chat/completions'].includes(path) ? 600_000 : 120_000,
      ),
    ]);
    for (let attempt = 0; ; attempt++) {
      requestSignal.throwIfAborted();
      const response = await this.fetcher(`https://openrouter.ai/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://aigames.local',
          'X-Title': 'AI Games',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: requestSignal,
        redirect: 'error',
      });
      const providerId = response.headers.get('x-generation-id');
      if (providerId && /^gen-[a-zA-Z0-9_-]{1,120}$/.test(providerId))
        await receivedGeneration?.(providerId);
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          error?: {
            message?: unknown;
            metadata?: {
              missing_attestation_types?: unknown;
              limit_source?: unknown;
              reason?: unknown;
            };
          };
        } | null;
        const metadata = detail?.error?.metadata;
        // These rejections happen before inference/billing: reuse the same reservation.
        // Permanent credit caps and ambiguous network/provider failures are not retried.
        if (
          response.status === 402 &&
          metadata?.limit_source === 'openrouter_in_flight_budget' &&
          metadata.reason === 'in_flight_budget_exhausted' &&
          attempt < 6
        ) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
          const date = retryAfter ? Date.parse(retryAfter) : NaN;
          const delay = Number.isFinite(seconds)
            ? seconds * 1000
            : Number.isFinite(date)
              ? date - this.retryClock.now()
              : 10_000;
          if (delay >= 0 && delay <= 120_000) {
            console.log(
              JSON.stringify({
                event: 'openrouter_settlement_wait',
                attempt: attempt + 1,
                delayMs: Math.max(1000, delay),
              }),
            );
            await this.retryClock.wait(Math.max(1000, delay), requestSignal);
            continue;
          }
        }
        const attestations = metadata?.missing_attestation_types;
        if (
          response.status === 403 &&
          Array.isArray(attestations) &&
          attestations.includes('age_18plus')
        )
          throw new DomainError(
            'MODEL_ACCOUNT_REQUIRED',
            'OpenRouter requires the account owner to confirm 18+ eligibility at https://openrouter.ai/settings/preferences, then retry generation.',
            503,
          );
        const message =
          typeof detail?.error?.message === 'string' ? detail.error.message.slice(0, 300) : '';
        throw new OpenRouterRequestError(
          response.status,
          message,
          metadata?.limit_source === 'openrouter_in_flight_budget' &&
            metadata.reason === 'in_flight_budget_exhausted',
        );
      }
      const text = await response.text();
      if (text.length > 24 * 1024 * 1024) throw new Error('Provider response exceeds limit.');
      const result: unknown = JSON.parse(text);
      if (path === '/v1/responses') {
        const failed = z
          .object({
            status: z.literal('failed'),
            output: z.array(z.unknown()),
            usage: z.unknown().optional(),
            error: z.object({ code: z.string(), message: z.string() }),
          })
          .safeParse(result);
        if (failed.success) {
          const { error, output, usage } = failed.data;
          // This specific credit-verification timeout rejects inference before it starts.
          // Other failed envelopes can have ambiguous bills and must not be replayed.
          const creditVerificationTimeout =
            error.code === 'rate_limit_exceeded' &&
            error.message ===
              'OpenRouter could not verify available credits for this request in time. Retry shortly.' &&
            output.length === 0 &&
            usage == null;
          if (creditVerificationTimeout) {
            if (attempt < 6) {
              console.log(
                JSON.stringify({
                  event: 'openrouter_credit_verification_wait',
                  attempt: attempt + 1,
                  delayMs: 10_000,
                }),
              );
              await this.retryClock.wait(10_000, requestSignal);
              continue;
            }
            throw new OpenRouterRequestError(429, error.message);
          }
          throw new DomainError(
            error.code === 'rate_limit_exceeded' ? 'MODEL_TEMPORARY' : 'MODEL_ERROR',
            `OpenRouter response failed: ${error.message.slice(0, 300)}`,
            503,
          );
        }
      }
      return result;
    }
  }
  async codingModel(id: string, signal: AbortSignal): Promise<CodingModel> {
    const models = modelsSchema.parse(await this.request('/models', undefined, signal));
    const model = models.data.find((m) => m.id === id);
    if (
      !model ||
      !model.architecture.output_modalities.includes('text') ||
      !model.supported_parameters.includes('tools')
    )
      throw new DomainError(
        'MODEL_UNAVAILABLE',
        'Configure an available coding model with tool support.',
        503,
      );
    const effort = this.options.reasoningEffort;
    if (
      effort &&
      (!model.supported_parameters.some((p) => p === 'reasoning' || p === 'reasoning_effort') ||
        (model.reasoning?.supported_efforts && !model.reasoning.supported_efforts.includes(effort)))
    )
      throw new DomainError(
        'MODEL_REASONING_UNAVAILABLE',
        'Configure a coding model supporting the selected reasoning effort.',
        503,
      );
    const tier = this.options.serviceTier;
    if (!tier || tier === 'default') return model;
    const endpointSuffix = tier === 'ultrafast' ? /\/ultrafast$/ : /\/(fast|priority)$/;
    const discovery = z
      .object({
        data: z.object({
          id: z.string(),
          endpoints: z.array(
            z.object({
              tag: z.string(),
              status: z.number(),
              supported_parameters: z.array(z.string()),
              pricing: modelSchema.shape.pricing,
            }),
          ),
        }),
      })
      .parse(await this.request(`/models/${id}/endpoints`, undefined, signal));
    const endpoints = discovery.data.endpoints.filter(
      (endpoint) =>
        endpoint.status === 0 &&
        endpointSuffix.test(endpoint.tag) &&
        endpoint.supported_parameters.includes('tools'),
    );
    const prices = endpoints.flatMap((endpoint) => [
      endpoint.pricing,
      ...(endpoint.pricing.overrides ?? []),
    ]);
    if (
      discovery.data.id !== id ||
      !endpoints.length ||
      prices.some(
        (price) =>
          ![Number(price.prompt), Number(price.completion)].every(
            (value) => Number.isFinite(value) && value > 0,
          ),
      )
    )
      throw new DomainError(
        tier === 'ultrafast' ? 'MODEL_ULTRAFAST_UNAVAILABLE' : 'MODEL_PRIORITY_UNAVAILABLE',
        `${tier === 'ultrafast' ? 'Ultrafast' : 'Fast'} coding capacity or its pricing is unavailable.`,
        503,
      );
    return {
      ...model,
      serviceTier: tier,
      providerTags: endpoints.map((endpoint) => endpoint.tag),
      pricing: {
        prompt: String(Math.max(...prices.map((price) => Number(price.prompt)))),
        completion: String(Math.max(...prices.map((price) => Number(price.completion)))),
      },
    };
  }
  async decisionModel(id: string, signal: AbortSignal): Promise<DecisionModel> {
    if (!/^typesafe\/jev-[a-zA-Z0-9.-]+$/.test(id))
      throw new DomainError('MODERATION_MODEL', 'Configure a pinned Jev moderation model.', 503);
    const { data } = z
      .object({
        data: z.object({
          id: z.string(),
          architecture: z.object({ output_modalities: z.array(z.string()) }),
          endpoints: z.array(
            z.object({
              tag: z.string(),
              status: z.number(),
              pricing: z.object({ prompt: z.string(), completion: z.string() }),
            }),
          ),
        }),
      })
      .parse(await this.request(`/models/${id}/endpoints`, undefined, signal));
    const endpoints = data.endpoints.filter((endpoint) => endpoint.status === 0);
    const prices = endpoints.map((endpoint) => Number(endpoint.pricing.prompt));
    if (
      data.id !== id ||
      !data.architecture.output_modalities.includes('decisions') ||
      !endpoints.length ||
      endpoints.some(
        (endpoint) => endpoint.tag !== 'typesafe' || Number(endpoint.pricing.completion) !== 0,
      ) ||
      prices.some((price) => !Number.isFinite(price) || price <= 0)
    )
      throw new DomainError(
        'MODERATION_MODEL',
        'Jev moderation is unavailable or its pricing cannot be bounded.',
        503,
      );
    return { id, promptPrice: Math.max(...prices) };
  }
  private async paidRequest(
    jobId: string,
    usage: number,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) {
    await this.calls?.record(jobId, body, undefined);
    let raw: unknown;
    let providerGenerationId: string | undefined;
    try {
      raw = await this.requestAt(path, body, signal, async (id) => {
        providerGenerationId = id;
        // Save the ID before reading the body: a dropped connection can lose
        // the completion while OpenRouter still has its final usage receipt.
        await this.calls?.record(jobId, body, {
          providerGenerationId: id,
          usageId: usage,
          status: 'response_received',
        });
      });
    } catch (error) {
      let failure = signal.aborted
        ? signal.reason
        : error instanceof Error && error.name === 'TimeoutError'
          ? new DomainError(
              'MODEL_TIMEOUT',
              'OpenRouter timed out before reporting the request cost. Progress is saved; provider usage needs checking before retrying.',
              503,
            )
          : error;
      const rejected = failure instanceof OpenRouterRequestError && failure.unbilledRejection;
      if (providerGenerationId && !signal.aborted && !rejected) {
        const receipt = await this.generationReceipt(providerGenerationId, body, signal);
        if (receipt) {
          await this.calls?.record(jobId, body, { providerGenerationId, usageId: usage, receipt });
          await this.budget.settle(
            usage,
            receipt.total_cost,
            receipt.tokens_prompt,
            receipt.tokens_completion,
          );
          failure = new DomainError(
            'MODEL_TEMPORARY',
            'OpenRouter interrupted the response. Its completed bill is reconciled and progress is saved; the creation can resume.',
            503,
          );
        }
      }
      await this.calls?.record(jobId, body, {
        error: failure instanceof DomainError ? failure.code : 'TRANSPORT_ERROR',
        ...(providerGenerationId ? { providerGenerationId, usageId: usage } : {}),
      });
      if (rejected) await this.budget.settle(usage, 0);
      // A transport failure can follow paid inference. Without a validated final
      // receipt, retain the reservation and prevent a blind paid retry.
      throw failure;
    }
    await this.calls?.record(jobId, body, raw);
    return raw;
  }
  private async generationReceipt(id: string, body: unknown, signal: AbortSignal) {
    try {
      const receipt = z
        .object({
          data: z.object({
            id: z.string(),
            model: z.string(),
            total_cost: z.number().nonnegative(),
            finish_reason: z.enum(['stop', 'length', 'tool_calls', 'error', 'content_filter']),
            tokens_prompt: z.number().int().nonnegative(),
            tokens_completion: z.number().int().nonnegative(),
          }),
        })
        .parse(
          await this.request(
            `/generation?id=${encodeURIComponent(id)}`,
            undefined,
            AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          ),
        ).data;
      const model = z.object({ model: z.string() }).parse(body).model;
      if (receipt.id !== id || !(receipt.model === model || receipt.model.startsWith(`${model}-`)))
        return null;
      return receipt;
    } catch {
      // Missing, unfinished or mismatched receipts cannot release a reservation.
      return null;
    }
  }
  async decisions(
    jobId: string,
    model: DecisionModel,
    state: { prompt: string; modification: boolean },
    questions: Record<string, DecisionQuestion>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const body = {
      model: model.id,
      state,
      questions,
      provider: { only: ['typesafe'], allow_fallbacks: false },
    };
    const byteCount = new TextEncoder().encode(JSON.stringify(body)).length;
    if (byteCount > 24_000)
      throw new DomainError(
        'CONTEXT_LIMIT',
        'Prompt validation exceeded its bounded request size.',
      );
    // One byte per token plus question overhead is conservative for text input.
    // Jev's typed outputs are free; discovery rejects endpoints with output charges.
    const usage = await this.budget.reserve(
      jobId,
      model.id,
      (byteCount + 2048) * model.promptPrice * 1.5,
    );
    const raw = await this.paidRequest(jobId, usage, '/alpha/decisions', body, signal);
    const billed = z
      .object({
        usage: z.object({
          cost: z.number().nonnegative(),
          input_tokens: z.number().int().nonnegative(),
          output_tokens: z.number().int().nonnegative(),
        }),
      })
      .parse(raw);
    await this.budget.settle(
      usage,
      billed.usage.cost,
      billed.usage.input_tokens,
      billed.usage.output_tokens,
    );
    return raw;
  }
  async chat(
    jobId: string,
    model: CodingModel,
    body: Record<string, unknown>,
    signal: AbortSignal,
    purpose: 'text' | 'visual-review' = 'text',
  ): Promise<unknown> {
    const maxTokens = this.options.maxTokens ?? 2048;
    const {
      model: _model,
      max_tokens: _tokens,
      max_completion_tokens: _completion,
      stream: _stream,
      provider: _provider,
      reasoning: _reasoning,
      reasoning_effort: _effort,
      service_tier: _tier,
      speed: _speed,
      temperature,
      ...input
    } = body;
    const requestBody = {
      ...input,
      ...(temperature !== undefined && model.supported_parameters.includes('temperature')
        ? { temperature }
        : {}),
      model: model.id,
      ...(this.options.serviceTier && this.options.serviceTier !== 'default'
        ? { service_tier: this.options.serviceTier }
        : {}),
      stream: false,
      max_tokens: maxTokens,
      ...(this.options.reasoningEffort
        ? { reasoning: { effort: this.options.reasoningEffort } }
        : {}),
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        ...(model.providerTags ? { only: model.providerTags } : {}),
      },
    };
    return this.paidText(jobId, model, requestBody, signal, false, purpose === 'visual-review');
  }
  async responses(
    jobId: string,
    model: CodingModel,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const {
      model: _model,
      stream: _stream,
      max_output_tokens: _max,
      reasoning: _reasoning,
      provider: _provider,
      service_tier: _tier,
      speed: _speed,
      ...input
    } = body;
    return this.paidText(
      jobId,
      model,
      {
        ...input,
        model: model.id,
        ...(this.options.serviceTier && this.options.serviceTier !== 'default'
          ? { service_tier: this.options.serviceTier }
          : {}),
        stream: false,
        store: false,
        max_output_tokens: this.options.maxTokens ?? 2048,
        ...(this.options.reasoningEffort
          ? { reasoning: { effort: this.options.reasoningEffort } }
          : {}),
        provider: {
          allow_fallbacks: false,
          require_parameters: true,
          ...(model.providerTags ? { only: model.providerTags } : {}),
        },
      },
      signal,
      true,
    );
  }
  private async paidText(
    jobId: string,
    model: CodingModel,
    requestBody: Record<string, unknown>,
    signal: AbortSignal,
    responses: boolean,
    visualReview = false,
  ) {
    const tier = this.options.serviceTier;
    if (tier && tier !== 'default' && (model.serviceTier !== tier || !model.providerTags?.length))
      throw new DomainError(
        tier === 'ultrafast' ? 'MODEL_ULTRAFAST_UNAVAILABLE' : 'MODEL_PRIORITY_UNAVAILABLE',
        `Discover ${tier === 'ultrafast' ? 'Ultrafast' : 'Fast'} coding prices before inference.`,
        503,
      );
    const maxTokens = this.options.maxTokens ?? 2048;
    const byteCount = new TextEncoder().encode(JSON.stringify(requestBody)).length;
    if (byteCount > (responses || visualReview ? 400_000 : 100_000))
      throw new DomainError('CONTEXT_LIMIT', 'Agent context exceeded the bounded request size.');
    const pricePrompt =
      Math.max(
        Number(model.pricing.prompt),
        ...(model.pricing.overrides ?? []).map((p) => Number(p.prompt)),
      ) * 1.25;
    const priceOutput =
      Math.max(
        Number(model.pricing.completion),
        ...(model.pricing.overrides ?? []).map((p) => Number(p.completion)),
      ) * 1.25;
    const estimated = (byteCount + 512) * pricePrompt + maxTokens * priceOutput;
    const usage = await this.budget.reserve(jobId, model.id, estimated);
    // Estimated mode retains uncertain reservations; actual-only mode blocks another call until settlement.
    const raw = await this.paidRequest(
      jobId,
      usage,
      responses ? '/v1/responses' : '/v1/chat/completions',
      requestBody,
      signal,
    );
    const reply = responses
      ? z
          .object({
            usage: z
              .object({
                cost: z.number().nonnegative().optional(),
                input_tokens: z.number().optional(),
                output_tokens: z.number().optional(),
              })
              .optional(),
          })
          .parse(raw)
      : replySchema.parse(raw);
    const counts = reply.usage as Record<string, number> | undefined;
    await this.budget.settle(
      usage,
      counts?.cost,
      counts?.[responses ? 'input_tokens' : 'prompt_tokens'],
      counts?.[responses ? 'output_tokens' : 'completion_tokens'],
    );
    return raw;
  }

  async imageModel(modelId: string, signal: AbortSignal) {
    const discovery = imageEndpointsSchema.parse(
      await this.request(`/images/models/${modelId}/endpoints`, undefined, signal),
    );
    if (discovery.endpoints.length) return { kind: 'image-api' as const, ...discovery };
    // Muse is served by /images, but OpenRouter currently omits its provider
    // from Image API discovery. Use the same model's general catalog instead.
    if (modelId === 'meta/muse-image') {
      const model = museEndpointsSchema.parse(
        await this.request(`/models/${modelId}/endpoints`, undefined, signal),
      ).data;
      const endpoint = model.endpoints.find(
        (e) => e.status === 0 && e.max_completion_tokens !== null,
      );
      if (model.architecture.output_modalities.includes('image') && endpoint)
        return { kind: 'muse' as const, endpoint };
    }
    throw new DomainError(
      'IMAGE_MODEL_UNAVAILABLE',
      'OpenRouter exposes no image endpoint. Check 18+ confirmation and model access at https://openrouter.ai/settings/preferences, then retry.',
      503,
    );
  }

  async image(
    jobId: string,
    modelId: string,
    prompt: string,
    signal: AbortSignal,
    options: {
      orientation: Orientation;
      quality: GameArtDirection['quality'];
      kind?: 'background' | 'sprites';
      pixelArt?: boolean;
      spriteFrames?: number[];
    } = {
      orientation: 'portrait',
      quality: 'premium',
    },
  ): Promise<Uint8Array> {
    const resolution = options.quality === 'intentional-low-fi' ? '1K' : '2K';
    const aspectRatio =
      options.kind === 'sprites' ? '1:1' : options.orientation === 'portrait' ? '9:16' : '16:9';
    const discovery = await this.imageModel(modelId, signal);
    const endpoint =
      discovery.kind === 'image-api'
        ? discovery.endpoints.find(
            (e) =>
              e.provider_tag &&
              e.supported_parameters.resolution?.values?.includes(resolution) &&
              e.supported_parameters.aspect_ratio?.values?.includes(aspectRatio) &&
              e.pricing.every((p) => p.unit === 'image') &&
              e.pricing.some((p) => p.billable === 'output_image'),
          )
        : undefined;
    if (discovery.kind === 'image-api' && !endpoint)
      throw new DomainError(
        'IMAGE_MODEL_PRICING',
        'Image model must support the requested resolution/aspect ratio and bounded per-image pricing.',
        503,
      );
    const estimate =
      discovery.kind === 'muse'
        ? // Reserve the entire advertised context/output ceiling, including image
          // tokens, rather than inferring a fixed image price from the website.
          (discovery.endpoint.context_length * discovery.endpoint.pricing.prompt +
            discovery.endpoint.max_completion_tokens! *
              (discovery.endpoint.pricing.completion + discovery.endpoint.pricing.image_output)) *
          1.5
        : endpoint!.pricing
            .filter((p) => p.billable === 'output_image')
            .reduce((n, p) => n + p.cost_usd, 0) * 1.5;
    const usage = await this.budget.reserve(jobId, modelId, estimate);
    const raw = z
      .object({
        data: z
          .array(
            z.object({
              b64_json: z.string().max(20 * 1024 * 1024),
              media_type: z.string().optional(),
            }),
          )
          .min(1),
        usage: z.object({ cost: z.number().optional() }).optional(),
      })
      .parse(
        await this.paidRequest(
          jobId,
          usage,
          '/v1/images',
          {
            model: modelId,
            prompt: `${prompt.slice(0, 4000)}\nComposition: ${aspectRatio} ${options.kind === 'sprites' ? 'square sprite sheet' : options.orientation}; target resolution ${resolution}.`,
            n: 1,
            resolution,
            aspect_ratio: aspectRatio,
            provider: {
              only: [discovery.kind === 'muse' ? discovery.endpoint.tag : endpoint!.provider_tag],
              allow_fallbacks: false,
            },
          },
          signal,
        ),
      );
    await this.budget.settle(usage, raw.usage?.cost);
    const bytes = Buffer.from(raw.data[0]!.b64_json, 'base64');
    // Never pass untrusted SVG or huge decoded images to the game.
    const image = sharp(bytes, { limitInputPixels: 16_000_000 });
    const dimensions = await image.metadata();
    if (
      options.quality === 'premium' &&
      Math.min(dimensions.width ?? 0, dimensions.height ?? 0) < 1024
    )
      throw new DomainError(
        'IMAGE_QUALITY',
        'The image provider returned an undersized premium asset.',
      );
    if (options.kind === 'sprites')
      return prepareSpriteSheet(bytes, options.pixelArt, options.spriteFrames);
    return new Uint8Array(
      await image
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
  }
}
export class OpenRouterImages implements ImageGenerationPort {
  constructor(
    private client: OpenRouterClient,
    private model: string,
  ) {}
  async create(
    prompt: string,
    id: string,
    signal: AbortSignal,
    options?: {
      orientation: Orientation;
      quality: GameArtDirection['quality'];
      kind?: 'background' | 'sprites';
      pixelArt?: boolean;
      spriteFrames?: number[];
    },
  ) {
    const imagePrompt =
      options?.kind === 'sprites'
        ? `Create a production 2D game sprite sheet: a precise equal 2 by 2 grid, no visible dividers. Illustrate ONLY the non-null sprite subjects; a null subject means its entire quadrant must stay empty solid magenta, with no substitute object. Top-left player, top-right threat, bottom-left reward, bottom-right prop. One subject centered in each quadrant, fully contained with generous empty margins (at least 10% of each cell). Camera, palette, material and visual style must match the direction. All empty space must be perfectly flat solid bright magenta #FF00FF for chroma-key removal: no gradients, scenery, ground, cast shadow, text, labels, border, watermark or additional objects. Keep magenta out of the subjects. Draw recognizable crafted game assets, not primitive shape placeholders. Direction: ${prompt}`
        : `Create game environment artwork matching this game's independent art direction. Honor its theme and visual style exactly. Use refined lighting, material detail and composition at the requested quality. Leave a clear gameplay area. No text, interface, logo or watermark. Direction: ${prompt}`;
    const create = () => this.client.image(id, this.model, imagePrompt, signal, options);
    try {
      return await create();
    } catch (error) {
      // A malformed sprite layout may be retried once. Every image is separately
      // billed through the same job ledger and cancellation/deadline signal.
      if (
        options?.kind !== 'sprites' ||
        !(error instanceof DomainError) ||
        error.code !== 'IMAGE_QUALITY'
      )
        throw error;
      signal.throwIfAborted();
      return create();
    }
  }
}
