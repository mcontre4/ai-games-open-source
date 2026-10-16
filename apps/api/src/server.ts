import { registerRequestAnalytics } from './analytics.ts';
import { GetCreditBalance } from '../../../packages/application/src/credits.ts';
import type { AnalyticsPort } from '../../../packages/application/src/analytics.ts';
import Fastify, { type FastifyRequest } from 'fastify';
import type { AppIntegrityDependencies } from '../../../packages/application/src/integrity-ports.ts';
import {
  IssueIntegrityChallenge,
  RegisterAppInstance,
  VerifyAppRequest,
} from '../../../packages/application/src/integrity.ts';
import {
  IssueGuestClaim,
  ClaimGuestGames,
  type GuestAccountRepository,
} from '../../../packages/application/src/guests.ts';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError, z } from 'zod';
import { DomainError, requireOwner } from '../../../packages/domain/src/index.ts';
import {
  gameMetadataSchema,
  createGameSchema,
  modifyGameSchema,
  saveSchema,
  scoreSchema,
  reportSchema,
  idSchema,
  profileUpdateSchema,
} from '../../../packages/contracts/src/index.ts';
import {
  GetAccountProfile,
  UpdateAccountProfile,
  GetCreatorProfile,
  ListBlockedCreators,
  UnblockCreator,
  ExportAccountData,
} from '../../../packages/application/src/profiles.ts';
import {
  UpdateGameMetadata,
  CreateGame,
  ListUserGames,
  GetGame,
  DownloadGame,
  SaveGameProgress,
  LoadGameProgress,
  SubmitGameScore,
  ShareGame,
  AcceptGameShare,
  RevokeGameShare,
  DeleteGame,
  CancelGeneration,
  RetryGeneration,
} from '../../../packages/application/src/games.ts';
import type {
  AuthPort,
  ClockPort,
  GameRepository,
  GenerationRepository,
  IdPort,
  ProgressRepository,
  SharingRepository,
  StoragePort,
  ProfileRepository,
  CreditRepository,
} from '../../../packages/application/src/ports.ts';
import type { GenerationPolicy } from '../../../packages/application/src/games.ts';
export interface ServerDependencies {
  apiRateLimitEnabled?: boolean;
  analytics?: AnalyticsPort;
  auth: AuthPort;
  integrity: AppIntegrityDependencies;
  guests: GuestAccountRepository;
  profiles: ProfileRepository;
  credits: CreditRepository;
  games: GameRepository;
  generations: GenerationRepository;
  progress: ProgressRepository;
  shares: SharingRepository;
  storage: StoragePort;
  ids: IdPort;
  clock: ClockPort;
  policy: GenerationPolicy;
}
export async function createServer(d: ServerDependencies, logging = false) {
  const app = Fastify({
    logger: logging
      ? {
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-app-integrity-proof',
            'password',
            'token',
            'key',
          ],
        }
      : false,
    bodyLimit: 80 * 1024,
    trustProxy: false,
  });
  const telemetry = registerRequestAnalytics(app, d.analytics, d.clock);
  await app.register(cors, { origin: false });
  if (d.apiRateLimitEnabled ?? true)
    await app.register(rateLimit, { global: true, max: 120, timeWindow: 60_000 });
  const identities = new WeakMap<object, Awaited<ReturnType<AuthPort['authenticate']>>>();
  const user = async (req: { headers: { authorization?: string } }) => {
    const existing = identities.get(req);
    if (existing) return existing;
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.', 401);
    const authenticated = await d.auth.authenticate(token);
    identities.set(req, authenticated);
    telemetry.authenticated(req, authenticated.id);
    return authenticated;
  };
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Check the request fields.' });
    if (error instanceof DomainError) {
      if (error.status >= 500) telemetry.exception(req, error);
      return reply.code(error.status).send({ code: error.code, message: error.message });
    }
    const statusCode =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode === 429)
      return reply
        .code(429)
        .send({ code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' });
    if (statusCode >= 500) telemetry.exception(req, error);
    app.log.error({ event: 'request_failed' }, 'request failed');
    return reply
      .code(statusCode)
      .send({ code: 'SERVER_ERROR', message: 'The request could not be completed.' });
  });
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const route = req.routeOptions.url;
    if (!route || route === '/health') return;
    const u = await user(req);
    if (!d.integrity)
      throw new DomainError(
        'APP_INTEGRITY_UNAVAILABLE',
        'App verification is not configured.',
        503,
      );
    if (
      !d.integrity.enabled ||
      route === '/integrity/challenges' ||
      route === '/integrity/instances'
    )
      return;
    const proof = z
      .object({
        nonce: z.string().regex(/^[a-zA-Z0-9_-]{32,100}$/),
        platform: z.enum(['ios', 'android']),
        proof: z.string().min(16).max(16000),
        keyId: z.string().min(16).max(200).optional(),
      })
      .safeParse({
        nonce: req.headers['x-app-integrity-nonce'],
        platform: req.headers['x-app-integrity-platform'],
        proof: req.headers['x-app-integrity-proof'],
        keyId: req.headers['x-app-integrity-key'],
      });
    if (!proof.success)
      throw new DomainError(
        'APP_INTEGRITY_REQUIRED',
        'This request needs verification from the official app. Please try again.',
        403,
      );
    await new VerifyAppRequest(
      d.integrity.repository,
      d.integrity.verifier,
      d.ids,
      d.clock,
    ).execute(u.id, {
      ...proof.data,
      token: req.headers.authorization!.slice(7),
      method: req.method,
      path: req.raw.url!,
      body: req.body,
    });
  });
  const id = (value: unknown) => idSchema.parse(value);
  app.get('/health', async () => ({
    ok: true,
    aiAvailable: d.policy.available,
    playerVersion: 1,
    appIntegrityRequired: d.integrity?.enabled !== false,
  }));
  app.post(
    '/integrity/challenges',
    { config: { rateLimit: { max: 60, timeWindow: 60_000 } } },
    async (req) => {
      const input = z
        .object({ purpose: z.enum(['register', 'request']) })
        .strict()
        .parse(req.body);
      return new IssueIntegrityChallenge(d.integrity.repository, d.ids, d.clock).execute(
        (await user(req)).id,
        input.purpose,
      );
    },
  );
  app.post(
    '/integrity/instances',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) => {
      const input = z
        .object({
          nonce: z.string().regex(/^[a-zA-Z0-9_-]{32,100}$/),
          keyId: z.string().min(16).max(200),
          proof: z.string().min(16).max(64000),
        })
        .strict()
        .parse(req.body);
      await new RegisterAppInstance(d.integrity.repository, d.integrity.verifier, d.clock).execute(
        (await user(req)).id,
        input,
      );
      return reply.code(204).send();
    },
  );
  app.post(
    '/guest/claim-token',
    {
      onRequest: async (req) => {
        // Older native clients label this bodyless request as JSON. Keep the body
        // absent (including for attestation) while allowing them to obtain a claim.
        if (
          req.headers['content-type']?.split(';')[0]?.trim() === 'application/json' &&
          !req.headers['transfer-encoding'] &&
          (req.headers['content-length'] === undefined || req.headers['content-length'] === '0')
        )
          delete req.headers['content-type'];
      },
    },
    async (req) => new IssueGuestClaim(d.guests, d.ids).execute(await user(req)),
  );
  app.post('/me/claim-guest', async (req) => {
    const input = z
      .object({ token: z.string().regex(/^[a-zA-Z0-9_-]{32,100}$/) })
      .strict()
      .parse(req.body);
    return new ClaimGuestGames(d.guests, d.ids).execute(await user(req), input.token);
  });
  app.get('/me', async (req) => {
    const u = await user(req);
    return { id: u.id, email: u.email };
  });
  app.get('/me/profile', async (req) =>
    new GetAccountProfile(d.profiles).execute((await user(req)).id),
  );
  app.get('/me/credits', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return new GetCreditBalance(d.credits, d.clock).execute((await user(req)).id);
  });
  app.put('/me/profile', async (req) =>
    new UpdateAccountProfile(d.profiles).execute(
      (await user(req)).id,
      profileUpdateSchema.parse(req.body),
    ),
  );
  app.get('/me/export', async (req) =>
    new ExportAccountData(d.profiles).execute((await user(req)).id),
  );
  app.get<{ Params: { username: string } }>('/profiles/:username', async (req) =>
    new GetCreatorProfile(d.profiles, d.games).execute(
      (await user(req)).id,
      z
        .string()
        .toLowerCase()
        .regex(/^[a-z0-9_]{4,25}$/)
        .parse(req.params.username),
    ),
  );
  app.get('/blocks', async (req) =>
    new ListBlockedCreators(d.profiles).execute((await user(req)).id),
  );
  app.delete<{ Params: { creatorId: string } }>('/blocks/:creatorId', async (req, reply) => {
    await new UnblockCreator(d.profiles).execute(
      (await user(req)).id,
      z.uuid().parse(req.params.creatorId),
    );
    return reply.code(204).send();
  });
  app.delete('/me', async (req, reply) => {
    await d.auth.deleteAccount((await user(req)).id);
    return reply.code(204).send();
  });
  app.get('/games', async (req) => new ListUserGames(d.games).execute((await user(req)).id));
  const creator = async (req: { headers: { authorization?: string } }) => {
    const u = await user(req);
    if (!u.ageConfirmed)
      throw new DomainError(
        'AGE_REQUIRED',
        'Confirm you are 16 or older before creating games.',
        403,
      );
    return u;
  };
  app.post(
    '/games',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) =>
      reply
        .code(202)
        .send(
          await new CreateGame(d.games, d.generations, d.ids, d.clock, d.policy).execute(
            (await creator(req)).id,
            createGameSchema.parse(req.body),
          ),
        ),
  );
  app.get<{ Params: { id: string } }>('/games/:id', async (req) =>
    new GetGame(d.games, d.progress).execute((await user(req)).id, id(req.params.id)),
  );
  app.patch<{ Params: { id: string } }>('/games/:id', async (req) =>
    new UpdateGameMetadata(d.games).execute(
      (await user(req)).id,
      id(req.params.id),
      gameMetadataSchema.parse(req.body),
    ),
  );
  app.delete<{ Params: { id: string } }>('/games/:id', async (req, reply) => {
    await new DeleteGame(d.games).execute((await user(req)).id, id(req.params.id));
    return reply.code(204).send();
  });
  app.delete<{ Params: { id: string } }>('/library/:id', async (req, reply) => {
    await d.games.removeFromLibrary(id(req.params.id), (await user(req)).id);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>(
    '/games/:id/modify',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) => {
      const u = await creator(req);
      const gameId = id(req.params.id);
      const game = await d.games.accessible(gameId, u.id);
      const input = modifyGameSchema.parse(req.body);
      return reply.code(202).send(
        await new CreateGame(d.games, d.generations, d.ids, d.clock, d.policy).execute(u.id, {
          ...input,
          orientation: game.orientation,
          gameId,
        }),
      );
    },
  );
  app.get<{ Params: { id: string; versionId: string } }>(
    '/games/:id/versions/:versionId/download',
    async (req, reply) => {
      const v = await new DownloadGame(d.games).execute(
        (await user(req)).id,
        id(req.params.id),
        id(req.params.versionId),
      );
      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Length', v.packageBytes)
        .header('X-Package-SHA256', v.checksum)
        .header('Cache-Control', 'private, no-store');
      return Buffer.from(await d.storage.get(v.artifactKey));
    },
  );
  app.get<{ Params: { id: string } }>('/games/:id/save', async (req) =>
    new LoadGameProgress(d.games, d.progress).execute((await user(req)).id, id(req.params.id)),
  );
  app.put<{ Params: { id: string } }>('/games/:id/save', async (req) =>
    new SaveGameProgress(d.games, d.progress).execute(
      (await user(req)).id,
      id(req.params.id),
      saveSchema.parse(req.body),
    ),
  );
  app.post<{ Params: { id: string } }>('/games/:id/score', async (req, reply) => {
    await new SubmitGameScore(d.games, d.progress).execute(
      (await user(req)).id,
      id(req.params.id),
      scoreSchema.parse(req.body),
    );
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/games/:id/share', async (req) =>
    new ShareGame(d.games, d.shares, d.ids, d.clock).execute(
      (await user(req)).id,
      id(req.params.id),
    ),
  );
  app.get<{ Params: { id: string } }>('/games/:id/shares', async (req) => {
    const u = await user(req);
    requireOwner(await d.games.accessible(id(req.params.id), u.id), u.id);
    return d.shares.list(req.params.id);
  });
  app.post('/shares/accept', async (req) => {
    const { token } = z
      .object({ token: z.string().regex(/^[a-zA-Z0-9_-]{32,100}$/) })
      .strict()
      .parse(req.body);
    return new AcceptGameShare(d.shares, d.ids, d.clock).execute((await user(req)).id, token);
  });
  app.delete<{ Params: { id: string } }>('/shares/:id', async (req, reply) => {
    await new RevokeGameShare(d.shares).execute((await user(req)).id, id(req.params.id));
    return reply.code(204).send();
  });
  app.get('/generations', async (req) => d.generations.list((await user(req)).id));
  app.get<{ Params: { id: string } }>('/generations/:id', async (req) => {
    const j = await d.generations.get(id(req.params.id));
    if (j.userId !== (await user(req)).id)
      throw new DomainError('NOT_FOUND', 'Generation not found.', 404);
    return j;
  });
  app.post<{ Params: { id: string } }>('/generations/:id/retry', async (req, reply) => {
    return reply
      .code(202)
      .send(
        await new RetryGeneration(d.games, d.generations, d.ids, d.clock, d.policy).execute(
          (await creator(req)).id,
          id(req.params.id),
        ),
      );
  });
  app.delete<{ Params: { id: string } }>('/generations/:id', async (req, reply) => {
    await new CancelGeneration(d.generations).execute((await user(req)).id, id(req.params.id));
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/games/:id/report', async (req, reply) => {
    const input = reportSchema.parse(req.body);
    await d.games.report(id(req.params.id), (await user(req)).id, input.reason, input.detail);
    return reply.code(204).send();
  });
  app.post('/blocks', async (req, reply) => {
    const { creatorId } = z.object({ creatorId: z.uuid() }).strict().parse(req.body);
    await d.games.block((await user(req)).id, creatorId);
    return reply.code(204).send();
  });
  return app;
}
