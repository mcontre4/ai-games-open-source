export const analyticsEvents: Record<string, string> = {
  account_profile_updated:
    'API successfully persisted account profile settings. Profile contents and usernames are excluded.',
  creator_unblocked: 'API successfully removed a creator block.',
  api_request_completed:
    'Every API response, with method, route template, status, duration and server request ID. Authenticated requests use the verified account UUID.',
  api_request_failed:
    'Every API response with HTTP status >=400; distinguishes expected input/auth/rate-limit errors from server failures.',
  client_api_request_completed:
    'Host-app HTTP response and network latency, correlated with the server request ID.',
  client_api_request_failed:
    'Host-app HTTP failure or network error, including offline/timeout failures.',
  account_created:
    'Authoritative auth.users insertion, delivered by the durable outbox with the original timestamp. No email or profile contents.',
  account_updated:
    'Auth database email, confirmation or profile metadata changed. Only account UUID and confirmation boolean leave the database.',
  account_deleted:
    'Authoritative auth.users deletion. This event does not automatically erase historical PostHog data.',
  account_signed_in:
    'Host app transitions to a signed-in account; token refreshes do not count as a new login.',
  account_signed_out: 'Host app signs out, captured before resetting the PostHog identity.',
  account_signup_submitted:
    'Supabase accepted the signup request. This is not proof of a created account; account_created is authoritative.',
  account_auth_failed:
    'A host-app sign-in or sign-up operation failed. Credentials and error messages are excluded.',
  account_recovery_requested: 'Supabase accepted a password recovery request.',
  account_recovery_opened: 'Host app entered the password recovery flow.',
  account_password_updated: 'Supabase accepted a password update; the password is never captured.',
  game_creation_requested:
    'API successfully reserved and queued a new game; does not mean a playable game exists yet.',
  game_modification_requested:
    'API successfully reserved and queued a modification of an existing game.',
  generation_preflight_started:
    'Live worker picked up the job; queue_wait_ms is scheduling time before image-model availability checks.',
  generation_preflight_completed:
    'Live image-model availability checks completed; duration_ms measures preflight latency.',
  generation_moderation_started: 'Typed Jev moderation began inside the generation use case.',
  generation_moderation_completed:
    'Typed moderation accepted the request; duration_ms measures moderation latency. Decisions and prompt contents are excluded.',
  generation_started:
    'Generation pipeline began. queue_wait_ms includes time since reservation, including preflight.',
  generation_stage_changed:
    'A pipeline stage transition completed; stage_duration_ms measures time spent in the previous stage. Repairs can revisit stages.',
  generation_validation_failed:
    'Build or validation attempt failed; attempt is zero-based and the job may still be repaired.',
  generation_repair_started: 'Worker is starting a bounded repair after validation failed.',
  generation_completed:
    'Signed package was published. duration_ms is pipeline time; total_duration_ms includes queue and preflight. Includes immutable version ID and package size.',
  generation_failed:
    'Terminal generation or preflight failure, or abandoned worker job reclaimed. Never contains prompts or provider messages.',
  generation_cancelled:
    'Pipeline observed a cancelled job. No failure exception is recorded for expected cancellation.',
  generation_cancel_requested:
    'API successfully handled a cancellation request; separate from worker observation.',
  game_created: 'Generation published the first playable game version.',
  game_updated: 'Generation published a new immutable version of an existing game.',
  game_deleted: 'API successfully removed a game.',
  game_removed_from_library: 'API successfully removed a game from the account library.',
  game_package_downloaded:
    'API successfully served signed package bytes, not proof that installation completed.',
  game_download_completed:
    'Host app verified and installed a generated package. Includes download/install latency.',
  game_download_removed: 'Host app successfully removed a downloaded game.',
  game_save_updated:
    'API persisted a cloud save and returned its new revision. Save contents are excluded.',
  game_save_local_updated:
    'Host app persisted local game progress, including offline play. Save contents are excluded.',
  game_save_conflict:
    'Host app observed a revision conflict and retained independent local/cloud saves.',
  game_score_submitted: 'API accepted a player score for an immutable game version.',
  game_score_local_updated: 'Host app accepted a local score, which may be synchronized later.',
  game_share_created:
    'API created an invitation. Analytics contains its ID, never the invitation token.',
  game_share_accepted: 'API accepted an invitation and granted access to the game.',
  game_share_revoked: 'API revoked an invitation.',
  game_reported: 'API accepted a game report. Report text is excluded.',
  creator_blocked: 'API accepted an account block of another creator.',
  game_play_started:
    'Native game successfully answered a validated SDK request. One event per play session. first_play is relative to the current installation.',
  game_play_paused: 'A started play session moved out of the foreground.',
  game_play_resumed: 'A started play session returned to the foreground.',
  game_play_ended:
    'Started play session closed. active_duration_ms excludes background time. Hard process termination may have no end event.',
  game_play_failed:
    'Player load/process/runtime/bridge/persistence error. Bounded to five reports per session; no raw game-controlled text.',
  app_opened: 'Host app initialized its account session.',
  app_foregrounded: 'Host app became active.',
  app_backgrounded:
    'Host app became inactive/backgrounded and initiated a buffered telemetry flush.',
  screen_viewed:
    'Expo Router route template changed. Dynamic IDs, share tokens and recovery parameters are excluded.',
};
export interface PlannedInsight {
  name: string;
  description: string;
  query: Record<string, unknown>;
}
export interface PlannedDashboard {
  name: string;
  description: string;
  insights: PlannedInsight[];
}
export function posthogPlan(environment = 'production'): PlannedDashboard[] {
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(environment)) throw new Error('Invalid dashboard environment.');
  const scope = `timestamp >= now() - INTERVAL 30 DAY AND properties.environment = '${environment}' AND coalesce(toString(properties.fixture), 'false') != 'true'`;
  const sql = (name: string, description: string, query: string): PlannedInsight => ({
    name: `AI Games · ${name} (${environment})`,
    description,
    query: {
      kind: 'DataVisualizationNode',
      display: 'ActionsTable',
      source: { kind: 'HogQLQuery', query },
    },
  });
  const daily = (events: string[]) =>
    `SELECT toDate(timestamp) AS day, event, count() AS events FROM events WHERE ${scope} AND event IN (${events.map((e) => `'${e}'`).join(',')}) GROUP BY day,event ORDER BY day DESC,event LIMIT 180`;
  return [
    {
      name: `AI Games · Product (${environment})`,
      description:
        'Account growth, creations, actual players, repeat plays, engagement, downloads, saves and sharing. Deterministic samples excluded.',
      insights: [
        sql(
          'Accounts and login',
          'Authoritative signup counts and login transitions.',
          daily([
            'account_created',
            'account_updated',
            'account_profile_updated',
            'account_deleted',
            'account_signed_in',
          ]),
        ),
        sql(
          'Creation and modification',
          'Requested versus published games; separate create and modify events.',
          daily([
            'game_creation_requested',
            'game_modification_requested',
            'game_created',
            'game_updated',
          ]),
        ),
        sql(
          'Daily active players',
          'Unique PostHog distinct IDs that actually started a game, excluding samples.',
          `SELECT toDate(timestamp) AS day,count(DISTINCT distinct_id) AS players,count() AS plays FROM events WHERE ${scope} AND event='game_play_started' GROUP BY day ORDER BY day DESC LIMIT 30`,
        ),
        sql(
          'First and repeat plays',
          'First play is per installation; account/game/version IDs support cross-device analysis.',
          `SELECT toDate(timestamp) AS day,properties.first_play AS first_play,count() AS plays FROM events WHERE ${scope} AND event='game_play_started' GROUP BY day,first_play ORDER BY day DESC LIMIT 60`,
        ),
        sql(
          'Who played which game',
          'Account distinct ID, game/version/creator IDs, play count and last play. No email or player name.',
          `SELECT distinct_id AS player,properties.game_id AS game,properties.version_id AS version,properties.creator_id AS creator,count() AS plays,max(timestamp) AS last_play FROM events WHERE ${scope} AND event='game_play_started' GROUP BY player,game,version,creator ORDER BY last_play DESC LIMIT 100`,
        ),
        sql(
          'Play duration',
          'Foreground seconds for completed sessions. Crashes and force quits may lack an end event.',
          `SELECT properties.game_id AS game,count() AS ended_sessions,avg(toFloat(properties.active_duration_ms))/1000 AS mean_seconds,quantile(0.95)(toFloat(properties.active_duration_ms))/1000 AS p95_seconds FROM events WHERE ${scope} AND event='game_play_ended' GROUP BY game ORDER BY ended_sessions DESC LIMIT 50`,
        ),
        sql(
          'Downloads saves and shares',
          'Successful cloud and host-app actions.',
          daily([
            'game_download_completed',
            'game_save_updated',
            'game_save_local_updated',
            'game_share_created',
            'game_share_accepted',
          ]),
        ),
      ],
    },
    {
      name: `AI Games · Reliability (${environment})`,
      description:
        'API volume and latency, HTTP errors, generation scheduling/stages/repairs/latency, player failures and PostHog exceptions.',
      insights: [
        sql(
          'API traffic and latency',
          'All endpoint calls by method and route template, with median/p95 latency in milliseconds.',
          `SELECT properties.method AS method,properties.route AS route,count() AS calls,quantile(0.5)(toFloat(properties.duration_ms)) AS p50_ms,quantile(0.95)(toFloat(properties.duration_ms)) AS p95_ms FROM events WHERE ${scope} AND event='api_request_completed' GROUP BY method,route ORDER BY calls DESC LIMIT 100`,
        ),
        sql(
          'API failure rate',
          '4xx and 5xx responses divided by all endpoint completions; expected input/auth failures are distinct from 5xx.',
          `SELECT properties.route AS route,count() AS calls,countIf(toInt(properties.status_code)>=500) AS server_errors,countIf(toInt(properties.status_code)>=400 AND toInt(properties.status_code)<500) AS client_errors,countIf(toInt(properties.status_code)>=500)/count() AS server_error_rate FROM events WHERE ${scope} AND event='api_request_completed' GROUP BY route ORDER BY server_errors DESC LIMIT 100`,
        ),
        sql(
          'Generation total latency',
          'Reservation to published playable package, including queue and preflight. Separate create/modify.',
          `SELECT properties.kind AS kind,count() AS published,quantile(0.5)(toFloat(properties.total_duration_ms))/1000 AS p50_seconds,quantile(0.95)(toFloat(properties.total_duration_ms))/1000 AS p95_seconds FROM events WHERE ${scope} AND event='generation_completed' GROUP BY kind LIMIT 10`,
        ),
        sql(
          'Queue wait',
          'Time from reservation to worker preflight start, measured separately from generation.',
          `SELECT properties.kind AS kind,count() AS started,quantile(0.95)(toFloat(properties.queue_wait_ms))/1000 AS p95_seconds FROM events WHERE ${scope} AND event='generation_preflight_started' GROUP BY kind LIMIT 10`,
        ),
        sql(
          'Generation stage latency',
          'Previous-stage duration by kind and stage; repeated build/testing stages expose repair cost.',
          `SELECT properties.kind AS kind,properties.previous_stage AS stage,count() AS transitions,avg(toFloat(properties.stage_duration_ms))/1000 AS mean_seconds,quantile(0.95)(toFloat(properties.stage_duration_ms))/1000 AS p95_seconds FROM events WHERE ${scope} AND event='generation_stage_changed' GROUP BY kind,stage ORDER BY p95_seconds DESC LIMIT 50`,
        ),
        sql(
          'Generation outcomes and repairs',
          'Terminal failures/cancellations and intermediate repairs are counted separately.',
          daily([
            'generation_completed',
            'generation_failed',
            'generation_cancelled',
            'generation_repair_started',
          ]),
        ),
        sql(
          'Errors by operation',
          'PostHog exceptions and player failures, split by service and operation. Error Tracking groups the underlying exceptions.',
          `SELECT event,properties.service AS service,properties.operation AS operation,count() AS reports FROM events WHERE ${scope} AND event IN ('$exception','game_play_failed','client_api_request_failed','game_save_conflict') GROUP BY event,service,operation ORDER BY reports DESC LIMIT 100`,
        ),
      ],
    },
  ];
}
