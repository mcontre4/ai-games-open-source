# Environments and configuration

`APP_ENV` selects development or production. `NODE_ENV` controls tooling optimizations only; Expo can change it during export. Launchers validate the selected environment before starting and copy only allowlisted public values to mobile.

## Local development

Follow the [README](../README.md#quick-start). `pnpm setup:local` creates ignored, mode-0600 root and mobile `.env.development` files and independent signing keys under `work/keys`. It preserves existing configuration, including a developer's provider key and explicit limit switches; it does not overwrite them with template defaults on each run.

Local defaults: API `http://127.0.0.1:4100`, Supabase `http://127.0.0.1:54321`, database `127.0.0.1:54322`, test mail UI `http://127.0.0.1:54324`. Published Supabase ports bind loopback. Android emulator loopback is mapped to `10.0.2.2`. Physical devices require intentionally reachable private-network or development HTTPS services. Local Auth allows `aigames-dev://auth` and `aigames-dev://recovery`.

For migration from older checkouts, development launchers accept legacy `.env` files only if `.env.development` is absent and the targets validate as local. Production never reads them. No existing credential file is deleted automatically.

## Your production deployment

No deployed endpoint or project key is bundled. Prepare your own configuration:

```sh
# On your production server:
cp .env.production.example .env.production
chmod 600 .env.production
# Locally, for your mobile build:
cp environments/production.mobile.env.example apps/mobile/.env.production
chmod 600 apps/mobile/.env.production
```

Fill the required values using an editor or secret manager. The templates intentionally cannot run without your values. Server credentials include a dedicated database URL, Supabase service-role key, provider key, private signing-key path and persistent private artifact path. Mobile accepts only the `mobilePublicKeys` allowlist in `packages/config/src/environment.ts`.

Mobile URLs must be public HTTPS endpoints without embedded credentials, queries or fragments. Supply your own public Supabase anonymous key and 32-byte Ed25519 verification key as hex. The private signing key, service-role key and provider key stay server-side. Production fails before launch when configuration is missing or invalid; it never falls back to local services or a maintainer preset.

Use independent development and production Auth projects, provider keys, signing keys, databases and artifact roots. Keep an existing deployment's keys and artifact root together when upgrading. This repository's setup does not rotate or redeploy your services.

### EAS builds

Link your own Expo project. In its production EAS environment, configure the public values from the mobile template, including `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_PACKAGE_SIGNING_KEY` and `EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER`. The checked-in profiles contain environment markers and protective switches only. Local ignored files are for the root launchers; EAS must be configured separately. Supply private upload/signing credentials through build-provider secret storage. Never add them to app extras or `EXPO_PUBLIC_*`.

## Commands and identities

| Command                                                 | Target                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                                              | Local API, worker and Expo together                            |
| `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:mobile`    | Individual local processes                                     |
| `pnpm ios`, `pnpm android`                              | Native development build                                       |
| `pnpm dev:ios`, `pnpm dev:android`                      | Metro at localhost:8084 for an installed dev client            |
| `pnpm prod` / `pnpm prod:mobile`                        | Dev-client tooling against your configured production services |
| `pnpm prod:ios`, `pnpm prod:android`                    | Native Release build for your production services              |
| `pnpm prod:api`, `pnpm prod:worker`, `pnpm prod:server` | Production server processes, on your server                    |
| `pnpm build:dev`, `pnpm build:prod`                     | Selected Expo export                                           |
| `pnpm db:migrate:dev`, `pnpm db:migrate:prod`           | Explicit migration target                                      |

`prod:mobile` does not deploy a backend or produce a store binary. The native launchers regenerate ignored projects with `expo prebuild --clean`; preserve custom code in tracked modules/plugins. Development uses `com.aigames.creator.dev` / `aigames-dev`, while production uses `com.aigames.creator` / `aigames`. Choose your own identifiers and matching server verification settings before distribution. Separate app identities isolate authentication, SQLite, downloads and analytics persistence.

Launchers disable automatic Expo dotenv loading, discard inherited application variables and keep OS/native tooling variables. The Metro cache key includes selected public settings. Production disables development transport exceptions.

## Protective defaults and budgets

All switches below default to `true` in the schema and both server templates. Previously configured environments retain their explicit values; review them during upgrades. Set a switch to `false` only deliberately in your private server configuration and restart both API and worker.

| Switch                                  | Default enforcement                                         |
| --------------------------------------- | ----------------------------------------------------------- |
| `GENERATION_DAILY_LIMIT_ENABLED`        | 5 creations/account/UTC day                                 |
| `MODIFICATION_DAILY_LIMIT_ENABLED`      | 5 modifications/account/UTC day                             |
| `GENERATION_CONCURRENT_LIMIT_ENABLED`   | One active generation/account                               |
| `GENERATION_CREDITS_ENABLED`            | Reserve and charge the account's available internal credits |
| `OPENROUTER_JOB_COST_LIMIT_ENABLED`     | $10/job, configurable                                       |
| `OPENROUTER_DAILY_COST_LIMIT_ENABLED`   | $100/server/UTC day, configurable                           |
| `OPENROUTER_ESTIMATED_COST_ENABLED`     | Reserve conservative inference estimates before paid calls  |
| `API_RATE_LIMIT_ENABLED`                | Global and endpoint-specific HTTP throttling                |
| `APP_INTEGRITY_CHALLENGE_LIMIT_ENABLED` | At most 20 pending verification challenges/account          |

Actual provider costs remain recorded even if a limit is disabled. Jobs retain their original charging and estimate-settlement policies. Late settlement follows the original job day; disabling charging does not erase history or replenish provider funding. Uncertain provider bills retain reservations and stop further inference. An application estimate cannot guarantee the final provider bill: set an independent provider-side limit too.

Internal credits default to 15/day, reset at midnight UTC and do not roll over. One credit equals $1 of recorded AI usage. The operator funds the provider account; this is no hosted credit entitlement. Persistent administrative grants are server-only, require an audit reason and use stable unique IDs for idempotency. Normal client roles cannot create grants.

Generation timeouts, repair counts, worker concurrency, context/output limits, sandbox resource bounds and package/bridge validation remain independent operational controls. Configure Apple/Google verification in production; local fixtures use an explicit loopback-only `local-development` mode. See [APP_INTEGRITY.md](APP_INTEGRITY.md).

## Tests and optional analytics

Test harnesses reject production markers and public database/Auth destinations. They clear live provider keys and disable telemetry. Tests must never target production. Paid generation/moderation commands are separate, explicit development-only operations.

`POSTHOG_ENABLED` and `EXPO_PUBLIC_POSTHOG_ENABLED` default to `false` in templates. Enable only after configuring your own project, ingestion key, retention and privacy policy. `analytics:preview` and `analytics:configure` target development; `:prod` variants select production. A preview does not create hosted resources. Source-map/symbol uploads require explicit private build credentials. See [ANALYTICS.md](ANALYTICS.md).
