# API

Fastify JSON API at configured base URL. Except `/health`, every route requires `Authorization: Bearer <real Supabase access token>`. The server verifies claims/signature/current Auth user and the current session row; forged, expired and signed-out tokens are rejected. Client-supplied identities are rejected by strict schemas. JSON body limit 80 KiB. Most limits return 429; unauthenticated 401; unauthorized private resources 404; ownership violations 403; validation 400; unavailable AI 503. Errors have `{code,message}` and no raw internal diagnostic/credential.

Anonymous Supabase sessions can generate after age confirmation. In required mode, all authenticated routes except the two integrity bootstrap endpoints also require `X-App-Integrity-Nonce`, `X-App-Integrity-Platform`, `X-App-Integrity-Proof` and, on iOS, `X-App-Integrity-Key`. Proofs are bound to the request and access token. See [APP_INTEGRITY.md](APP_INTEGRITY.md).

| Method / path                | Input and result                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/integrity/challenges` | `{purpose: "register" or "request"}` → `{nonce,expiresAt}`; Auth required                                                                            |
| POST `/integrity/instances`  | `{nonce,keyId,proof}`; Apple-verified enrollment; 204                                                                                                |
| POST `/guest/claim-token`    | Anonymous identity only; `{guestId,token}`; persist securely before changing session                                                                 |
| POST `/me/claim-guest`       | Registered identity `{token}` → `{guestId,gameIds}`; idempotent account-scoped transfer of ownership/history/progress/usage; revokes source sessions |

`/health` also returns `appIntegrityRequired`. Verification returns `APP_INTEGRITY_REQUIRED` (403) or `APP_INTEGRITY_UNAVAILABLE` (503); invalid guest claims return `GUEST_CLAIM_INVALID` (403).

| Method / path                                 | Input and result                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET `/health`                                 | `{ok,aiAvailable,playerVersion}`; credential presence is not proof of funded/available models                            |
| GET `/me`                                     | Verified account id/email                                                                                                |
| GET `/me/profile`                             | Account profile and saved privacy/sync preferences                                                                       |
| GET `/me/credits`                             | `{dailyAllowance,available,spent,held,resetsAt}` for the authenticated account; private/no-store                         |
| PUT `/me/profile`                             | `{username,displayName,bio,avatarId,profileVisible,autoSync,leaderboardVisible}`; normalized profile; 409 USERNAME_TAKEN |
| GET `/profiles/:username`                     | Visible creator identity/bio and only games accessible to the viewer; 404 for hidden/blocked profiles                    |
| GET `/me/export`                              | Account-scoped cloud profile, games, saves, scores, reports, memberships, jobs and blocks                                |
| GET `/blocks`                                 | This account's blocked creator identities                                                                                |
| DELETE `/blocks/:creatorId`                   | Unblock for this account; 204                                                                                            |
| DELETE `/me`                                  | Delete account and owned data; 204                                                                                       |
| GET `/games`                                  | Accessible personal/public/shared library                                                                                |
| POST `/games`                                 | `{prompt,orientation,view?}`; 202 `{gameId,generationId,generation}`                                                     |
| GET `/games/:id`                              | Game, immutable versions and leaderboard                                                                                 |
| DELETE `/games/:id`                           | Creator soft deletion and cancellation; 204                                                                              |
| DELETE `/library/:id`                         | Hide/remove personal library entry; 204                                                                                  |
| POST `/games/:id/modify`                      | Creator `{prompt}`; 202 `{gameId,generationId,generation}`                                                               |
| GET `/games/:id/versions/:versionId/download` | Auth/access-checked ZIP with length and X-Package-SHA256; private/no-store                                               |
| GET `/games/:id/save`                         | This account's save or null                                                                                              |
| PUT `/games/:id/save`                         | `{versionId,schemaVersion,baseRevision,state}`; updated save/revision; stale 409 REVISION_CONFLICT                       |
| POST `/games/:id/score`                       | `{versionId,score}`; validated maximum score for this account; 204                                                       |
| POST `/games/:id/share`                       | Creator invitation id/token/expiry                                                                                       |
| GET `/games/:id/shares`                       | Creator invitation status and member ids                                                                                 |
| POST `/shares/accept`                         | `{token}`; add membership and return accessible game                                                                     |
| DELETE `/shares/:id`                          | Creator revocation; 204                                                                                                  |
| GET `/generations`                            | This account's recent jobs                                                                                               |
| GET `/generations/:id`                        | This account's job, including prompt, kind, stage and error                                                              |
| DELETE `/generations/:id`                     | Cancel this account's job; 204                                                                                           |
| POST `/games/:id/report`                      | `{reason,detail}`; persists review report; 204                                                                           |
| POST `/blocks`                                | `{creatorId}`; block that creator; 204                                                                                   |

Save example:

```json
{
  "versionId": "ver_0123456789abcdef0123456789abcdef",
  "schemaVersion": 1,
  "baseRevision": 2,
  "state": { "level": 3, "coins": 20, "best": 1020 }
}
```

Create and modify responses include the reserved queued generation so the client can immediately show the submitted prompt and job status.

A 202 response means the request is queued, not approved by moderation. The worker checks both new ideas and modifications with Jev before any artwork or coding. A rejected request becomes `failed`; `GET /generations/:id` returns a fixed explanation in `error`, shown on the creation screen. Uncertain decisions ask the user to clarify the gameplay; unavailable moderation asks them to retry. Previous playable versions remain available. Failed validation counts toward the daily request quota; any moderation inference already consumed is deducted from credits.

Every account receives **15 free credits per UTC calendar day**, with **1 credit = $1 of AI cost** and fractional precision to six decimal places. Unused credits do not roll over. The backend reads a separate day of accounting after midnight, so no cron or client-side reset is needed. `resetsAt` is the next UTC midnight in ISO format. A generation's costs and holds belong to the UTC day it starts, including settlement after midnight.

Create and modify reserve at most the server's job cap or the account's remaining credits, whichever is smaller. `held` is the unspent part of active job budgets; `spent` includes billed usage and conservative reservations awaiting or missing provider cost data. Each inference replaces its estimate with the actual reported cost once. Completion, failure, cancellation, abandoned-job cleanup and game deletion release unused holds without refunding incurred costs. Deleting games does not reset credit usage. An exhausted account receives `429 CREDITS_EXHAUSTED`; inference beyond the reserved job budget receives `429 JOB_BUDGET`. If provider usage is unavailable, its estimate stays charged rather than permitting unbounded spending. Existing request quotas and the platform's spending cap still apply. Credit purchases and manual resets are not implemented.

Poll generation stage rather than showing synthetic progress: queued → designing → artwork → coding → building → testing → packaging → ready, with failed/cancelled terminal states and bounded repairs returning to coding. Modification applies the same quota, ownership, sandbox and publication rules. Quota days use UTC. Sharing changes access; it never transfers another player's progress.

Creation `view` is `2d` (default), `3d` or `isometric`. Isometric uses an actual 3D orthographic scene. Game responses include the saved view. Modification retains the game's existing view; unsupported view values are rejected.

`POST /generations/:id/retry` (creator authorization) returns 202 `{gameId,generationId,generation}`. It resumes a failed creation using saved progress and creates one successor atomically. Repeated requests return the same successor. Other users receive 404; nonfailed jobs and unresolved provider bills receive 409; normal usage limits still apply. Generation responses include optional `progressSaved` and `retryOf`, never source/context keys or provider conversations.
