# Testing and verification

Tests distinguish deterministic fixtures, real local infrastructure, native behavior and paid provider calls. A passing fixture or browser flow does not prove native platform verification or live AI generation.

## Required checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
# Equivalent combined command:
pnpm verify
```

| Check         | Scope                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck     | Server/packages and mobile TypeScript projects                                                                                    |
| Lint          | ESLint and dependency-direction/use-case boundary checks                                                                          |
| Unit/security | Domain/application behavior, archive/signature validation, bridge bounds, inference policy, redaction, native adapters with mocks |
| Integration   | Real local Supabase Auth/Postgres/RLS, queues, credits, checkpoints, Docker containment and browser validation                    |
| Browser E2E   | Exported Expo UI, real local profile flow, actual signed offline Phaser/Three.js packages, saves and controls                     |

### Integration prerequisites

Start Docker, then run the following for a fresh development environment:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev:infra
pnpm setup:local
pnpm db:migrate
pnpm fixture:build
pnpm fixture:seed
pnpm sandbox:build
```

Use `--with-deps` when installing Chromium on Linux. Fixture seeding re-signs the sample with your local key and updates the bundled sample metadata/ZIP/cover; review those generated changes before committing. Do not commit local signing keys.

Stop any development worker during integration checks so it cannot consume fixture jobs. Tests refuse production environment markers and nonlocal DB/Auth hosts, clear provider credentials and disable telemetry. Integration cleanup removes only its own test records and containers. Do not start tests with production secrets or against a production deployment.

Browser ports default to 8094 (Expo UI) and 4173 (profile harness). Override both when needed:

```sh
CREATION_UI_PORT=8394 PROFILE_UI_PORT=4373 pnpm test:e2e
```

## Screenshots

`pnpm screenshots` runs the dedicated [documentation harness](SCREENSHOTS.md). It exports the actual app with reserved `.invalid` API/Auth URLs, uses synthetic account fixtures, blocks external network destinations and captures actual offline runtime gameplay. It needs Chromium but no Supabase, provider key or live account. Its four capture scenarios are separate from E2E test totals.

## Native verification

```sh
pnpm test:mobile
```

Install Maestro and a custom native client first. Native YAML flows cover account/profile operations, the sample and offline restarts. Screenshots of the browser export do not verify native SQLite, WebView isolation, platform attestation or store signing.

Required production verification needs a physical iOS device with App Attest and a Play-distributed Android build with Play Integrity. Exercise enrollment, guest creation, linking, download, offline play, sync, invalid/replayed proofs and account changes. A simulator cannot establish production App Attest trust. See [APP_INTEGRITY.md](APP_INTEGRITY.md).

## Live AI checks: opt-in and paid

```sh
pnpm test:generation:live
pnpm test:moderation:live
```

Supply your own funded server-only OpenRouter key in root `.env.development`. Run local services, a rebuilt sandbox image and the worker for generation. The moderation evaluation does not dispatch artwork or coding. Review budgets and provider eligibility before starting. Results, screenshots, provider usage and evaluation output stay in ignored `work/`; inspect them for sensitive data before sharing.

A live result must identify what was actually exercised: moderation, art, coding, build, validation, signed publication, download and modification as applicable. Health responses and deterministic images are not substitutes. Never claim a live pass when credentials, funding, providers or native devices are unavailable.

## Secret checks

Install Gitleaks 8.30.1 or newer, then run `pnpm secrets:check`. It scans Git history with full redaction. CI also scans an exported tracked tree with archive and encoded-content inspection. Review a match privately; never suppress a whole credential-bearing file. The public repository starts from a clean snapshot with no imported private history and no scanner allowlist. See [publication audit](OPEN_SOURCE_AUDIT.md) and [SECURITY.md](../SECURITY.md).

## Current evidence

The preceding native-path repair passed typecheck, lint, **293 unit/security**, **54 integration** and **34 browser E2E** tests. The open-source preparation rerun is recorded in [OPEN_SOURCE_AUDIT.md](OPEN_SOURCE_AUDIT.md).

Automated native verification is **BLOCKED** in this environment because Maestro is unavailable. Physical-device production verification remains **BLOCKED** without the required signed devices/distribution setup. Live generation is **not run** as part of publication preparation; automated checks use deterministic fixtures and unbilled transport data. Earlier private deployment experiments are not a reproducible guarantee for a new operator's models, account or infrastructure.
