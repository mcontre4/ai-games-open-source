import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  safeAnalytics,
  type AnalyticsPort,
  type AnalyticsProperties,
} from '../../../packages/application/src/analytics.ts';
import type { ClockPort } from '../../../packages/application/src/ports.ts';
import { idSchema } from '../../../packages/contracts/src/index.ts';
const mutations: Record<string, string> = {
  'PUT /me/profile': 'account_profile_updated',
  'DELETE /blocks/:creatorId': 'creator_unblocked',
  'POST /games': 'game_creation_requested',
  'POST /games/:id/modify': 'game_modification_requested',
  'DELETE /games/:id': 'game_deleted',
  'DELETE /library/:id': 'game_removed_from_library',
  'PUT /games/:id/save': 'game_save_updated',
  'POST /games/:id/score': 'game_score_submitted',
  'POST /games/:id/share': 'game_share_created',
  'POST /shares/accept': 'game_share_accepted',
  'DELETE /shares/:id': 'game_share_revoked',
  'DELETE /generations/:id': 'generation_cancel_requested',
  'POST /games/:id/report': 'game_reported',
  'POST /blocks': 'creator_blocked',
  'GET /games/:id/versions/:versionId/download': 'game_package_downloaded',
};
export function registerRequestAnalytics(
  app: FastifyInstance,
  port: AnalyticsPort | undefined,
  clock: ClockPort,
) {
  const analytics = safeAnalytics(port);
  const requests = new WeakMap<object, { start: number; userId?: string }>();
  const context = (req: FastifyRequest): AnalyticsProperties => ({
    request_id: req.id,
    method: req.method,
    route: req.routeOptions.url ?? 'unmatched',
    authenticated: Boolean(requests.get(req)?.userId),
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-ID', req.id);
    requests.set(req, { start: Date.parse(clock.now()) });
  });
  app.addHook('onResponse', async (req, reply) => {
    const state = requests.get(req);
    analytics.capture('api_request_completed', state?.userId ?? `anonymous:${req.id}`, {
      ...context(req),
      status_code: reply.statusCode,
      duration_ms: Math.max(0, Date.parse(clock.now()) - (state?.start ?? Date.parse(clock.now()))),
    });
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const distinctId = requests.get(req)?.userId ?? `anonymous:${req.id}`;
    if (reply.statusCode >= 400) {
      let code = 'HTTP_ERROR';
      try {
        code = JSON.parse(typeof payload === 'string' ? payload : '{}').code ?? code;
      } catch {
        /* Non-JSON response. */
      }
      analytics.capture('api_request_failed', distinctId, {
        ...context(req),
        status_code: reply.statusCode,
        error_code: code,
      });
      return payload;
    }
    const event = mutations[`${req.method} ${req.routeOptions.url}`];
    if (!event) return payload;
    let output: Record<string, unknown> = {};
    try {
      output = JSON.parse(typeof payload === 'string' ? payload : '{}');
    } catch {
      /* ZIP/empty response. */
    }
    const params = req.params as Record<string, unknown>;
    const body = req.body as Record<string, unknown> | undefined;
    const validId = (value: unknown) => {
      const result = idSchema.safeParse(value);
      return result.success ? result.data : undefined;
    };
    const properties: AnalyticsProperties = { ...context(req) };
    if (req.routeOptions.url?.startsWith('/games'))
      properties.game_id = validId(params.id ?? output.gameId);
    if (event === 'game_share_accepted') properties.game_id = validId(output.id);
    if (event === 'game_removed_from_library') properties.game_id = validId(params.id);
    if (event === 'game_share_revoked') properties.share_id = validId(params.id);
    if (event === 'generation_cancel_requested') properties.generation_id = validId(params.id);
    if (output.generationId) properties.generation_id = validId(output.generationId);
    if (event === 'game_package_downloaded') properties.version_id = validId(params.versionId);
    if (event === 'game_save_updated') {
      properties.version_id = validId(output.versionId);
      properties.revision = typeof output.revision === 'number' ? output.revision : undefined;
      properties.schema_version =
        typeof output.schemaVersion === 'number' ? output.schemaVersion : undefined;
    }
    if (event === 'game_score_submitted') {
      properties.version_id = validId(body?.versionId);
      properties.score = typeof body?.score === 'number' ? body.score : undefined;
    }
    if (event === 'game_share_created') properties.share_id = validId(output.id);
    if (event === 'creator_blocked')
      properties.creator_id =
        typeof body?.creatorId === 'string' && /^[0-9a-f-]{36}$/.test(body.creatorId)
          ? body.creatorId
          : undefined;
    if (event === 'creator_unblocked')
      properties.creator_id =
        typeof params.creatorId === 'string' && /^[0-9a-f-]{36}$/.test(params.creatorId)
          ? params.creatorId
          : undefined;
    analytics.capture(event, distinctId, properties);
    return payload;
  });
  return {
    authenticated(req: object, userId: string) {
      const state = requests.get(req);
      if (state) state.userId = userId;
      analytics.identify(userId);
    },
    exception(req: FastifyRequest, error: unknown) {
      analytics.exception(error, requests.get(req)?.userId ?? `anonymous:${req.id}`, context(req));
    },
  };
}
