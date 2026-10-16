import { safeAnalytics, type AnalyticsPort } from './analytics.ts';
/** A play begins when the host receives a validated SDK message, not when a screen opens. */
export function playSession(
  analytics: AnalyticsPort,
  input: {
    accountId: string;
    gameId: string;
    versionId: string;
    ownerId: string;
    fixture: boolean;
    firstPlay: boolean;
    sessionId: string;
  },
  now: () => number,
) {
  const port = safeAnalytics(analytics);
  const metadata = {
    game_id: input.gameId,
    version_id: input.versionId,
    creator_id: input.ownerId,
    fixture: input.fixture,
    first_play: input.firstPlay,
    play_session_id: input.sessionId,
    source: input.fixture ? 'fixture' : 'generated',
  };
  let errorCount = 0;
  let started = false,
    ended = false,
    active = true;
  let activeSince = now(),
    duration = 0;
  return {
    ready() {
      if (started || ended) return;
      started = true;
      activeSince = now();
      port.capture('game_play_started', input.accountId, metadata);
    },
    activity(isActive: boolean) {
      if (ended || active === isActive) return;
      if (started && active) duration += Math.max(0, now() - activeSince);
      active = isActive;
      activeSince = now();
      if (started)
        port.capture(active ? 'game_play_resumed' : 'game_play_paused', input.accountId, metadata);
    },
    error(error: unknown, operation = 'game_player') {
      if (ended || ++errorCount > 5) return;
      port.capture('game_play_failed', input.accountId, { ...metadata, operation });
      port.exception(error, input.accountId, { ...metadata, operation });
    },
    end(reason = 'exit') {
      if (ended) return;
      ended = true;
      if (!started) return;
      if (active) duration += Math.max(0, now() - activeSince);
      port.capture('game_play_ended', input.accountId, {
        ...metadata,
        active_duration_ms: duration,
        end_reason: reason,
      });
    },
  };
}
