import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../../../domain/src/index.ts';
import type { GenerationCallPort, GatewayPort } from '../../../application/src/ports.ts';
import type { OpenRouterClient, CodingModel } from './openrouter.ts';
import {
  codexResponsesInput,
  codexResponse,
  codexResponseStream,
  responsesBody,
} from './codex-protocol.ts';
const chatBody = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
            content: z
              .union([
                z.string(),
                z.array(z.object({ type: z.literal('text'), text: z.string() }).strict()),
              ])
              .nullable(),
            tool_calls: z.array(z.unknown()).optional(),
            tool_call_id: z.string().optional(),
            name: z.string().optional(),
          })
          .passthrough(),
      )
      .max(120),
    tools: z.array(z.unknown()).max(30).optional(),
    tool_choice: z.unknown().optional(),
    temperature: z.number().min(0).max(2).optional(),
    model: z.string().optional(),
    stream: z.boolean().optional(),
    max_tokens: z.number().optional(),
    max_completion_tokens: z.number().optional(),
    stream_options: z.unknown().optional(),
  })
  .strict();
export class ControlledGateway implements GatewayPort {
  private failures = new Map<string, Error>();
  private checkpointSavers = new Map<string, () => Promise<void>>();
  private grants = new Map<
    string,
    {
      jobId: string;
      expires: number;
      client: OpenRouterClient;
      model: CodingModel;
    }
  >();
  // Responses includes opaque reasoning plus complete file-write arguments.
  // OpenRouterClient separately bounds and prices the normalized request.
  private app = Fastify({ bodyLimit: 500_000, logger: false });
  constructor(
    private client: OpenRouterClient,
    private model: CodingModel,
    private port: number,
    private timeoutMs: number,
    private calls?: GenerationCallPort,
    private route?: (jobId: string) => Promise<{ client: OpenRouterClient; model: CodingModel }>,
  ) {}
  async start() {
    this.app.post('/v1/responses', async (req, reply) => {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const grant = token ? this.grants.get(token) : undefined;
      if (!grant || grant.expires < Date.now())
        return reply.code(401).send({ error: { message: 'Expired generation grant.' } });
      const body = responsesBody.parse(req.body);
      await this.checkpointSavers.get(grant.jobId)?.();
      await this.calls?.record(grant.jobId, body, undefined);
      const controller = new AbortController();
      reply.raw.once('close', () => controller.abort());
      const raw = await grant.client.responses(
        grant.jobId,
        grant.model,
        codexResponsesInput(body),
        AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(Math.max(1, grant.expires - Date.now())),
        ]),
      );
      this.failures.delete(grant.jobId);
      await this.calls?.record(grant.jobId, body, raw);
      const response = codexResponse(raw, grant.model.id);
      if (!body.stream) return response;
      return reply
        .header('Content-Type', 'text/event-stream')
        .header('Cache-Control', 'no-store')
        .send(codexResponseStream(response));
    });
    this.app.post('/v1/chat/completions', async (req, reply) => {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const grant = token ? this.grants.get(token) : undefined;
      if (!grant || grant.expires < Date.now())
        return reply.code(401).send({ error: { message: 'Expired generation grant.' } });
      const parsed = chatBody.parse(req.body);
      await this.checkpointSavers.get(grant.jobId)?.();
      await this.calls?.record(grant.jobId, parsed, undefined);
      const {
        model: _model,
        stream: _stream,
        max_tokens: _tokens,
        max_completion_tokens: _completion,
        stream_options: _options,
        ...body
      } = parsed;
      const raw = await grant.client.chat(
        grant.jobId,
        grant.model,
        body,
        AbortSignal.timeout(this.timeoutMs),
      );
      this.failures.delete(grant.jobId);
      await this.calls?.record(grant.jobId, parsed, raw);
      if (!_stream) return raw;
      // Chat consumers use SSE. Upstream is intentionally non-streaming
      // for exact cost settlement; expose its bounded result as protocol-valid SSE.
      const completion = z
        .object({
          id: z.string().optional(),
          choices: z.array(
            z.object({
              message: z
                .object({
                  content: z.string().nullable().optional(),
                  tool_calls: z.array(z.record(z.string(), z.unknown())).optional(),
                })
                .passthrough(),
              finish_reason: z.string().nullable().optional(),
            }),
          ),
          usage: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .parse(raw);
      const choice = completion.choices[0];
      if (!choice) throw new Error('Empty model result.');
      const common = {
        id: completion.id || 'controlled-completion',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: grant.model.id,
      };
      const delta = {
        role: 'assistant',
        content: choice.message.content ?? null,
        ...(choice.message.tool_calls
          ? { tool_calls: choice.message.tool_calls.map((call, index) => ({ ...call, index })) }
          : {}),
      };
      const chunks = [
        { ...common, choices: [{ index: 0, delta, finish_reason: null }] },
        {
          ...common,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason:
                choice.finish_reason || (choice.message.tool_calls ? 'tool_calls' : 'stop'),
            },
          ],
        },
        { ...common, choices: [], usage: completion.usage },
      ];
      return reply
        .header('Content-Type', 'text/event-stream')
        .header('Cache-Control', 'no-store')
        .send(
          chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        );
    });
    this.app.post('/v1/checkpoint', async (req, reply) => {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const grant = token ? this.grants.get(token) : undefined;
      if (!grant || grant.expires < Date.now())
        return reply.code(401).send({ error: 'Expired generation grant.' });
      const save = this.checkpointSavers.get(grant.jobId);
      if (!save) return reply.code(503).send({ error: 'Checkpoint not ready.' });
      await save();
      return reply.code(204).send();
    });
    this.app.get('/health', async () => ({ ok: true }));
    this.app.setErrorHandler((error, req, reply) => {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const grant = token ? this.grants.get(token) : undefined;
      if (grant && error instanceof Error) this.failures.set(grant.jobId, error);
      console.error(
        JSON.stringify({
          event: 'inference_rejected',
          reason:
            error instanceof Error ? error.message.slice(0, 1000) : 'Unknown inference failure.',
        }),
      );
      return reply
        .code(error instanceof DomainError && error.code === 'MODEL_TEMPORARY' ? 429 : 400)
        .send({
          error: { message: 'Generation interrupted. Progress is retained by the worker.' },
        });
    });
    await this.app.listen({ port: this.port, host: '0.0.0.0' });
  }
  async register(jobId: string) {
    const route = (await this.route?.(jobId)) ?? { client: this.client, model: this.model };
    this.failures.delete(jobId);
    const token = randomBytes(32).toString('hex');
    this.grants.set(token, { jobId, expires: Date.now() + this.timeoutMs, ...route });
    return {
      url: `http://gateway:4101/v1`,
      token,
      model: route.model.id,
      checkpoints: Boolean(this.calls),
    };
  }
  failure(jobId: string) {
    return this.failures.get(jobId);
  }
  checkpoint(jobId: string, save: () => Promise<void>) {
    this.checkpointSavers.set(jobId, save);
  }
  revoke(id: string) {
    this.failures.delete(id);
    this.checkpointSavers.delete(id);
    for (const [token, grant] of this.grants) if (grant.jobId === id) this.grants.delete(token);
  }
  stop() {
    return this.app.close();
  }
}
