# Implementation and remaining release work

The copied Python/marketing template is preserved in the initial commit. The requested system replaces it with a TypeScript/Expo monorepo.

Visual thesis: ink-black arcade library, expansive original game art, mint controls and warm off-white typography. Screens cover searchable/filterable library with a multi-game grid, create/modify, actual generation stages, offline player, version details/leaderboards/shares, real Auth/recovery, privacy/storage/sync/account controls. Interactions include entrance fade, press feedback, game parallax, particles, sound and collision/restart/pause controls.

Implemented foundations include hexagonal ports/use cases, strict contracts, real Supabase Auth/PKCE, Postgres/RLS, pg-boss persistent outbox, bounded quotas/reservations, controlled OpenRouter text/image adapters, pinned Codex CLI, hardened per-job Docker isolation, startup/periodic abandoned-job reconciliation, bounded validation/repair, immutable source/packages, Ed25519/ZIP verification, atomic native installation, scoped GameSDK, account-scoped SQLite/local-first progress, cloud revision conflicts/backup restoration, per-player high scores, sharing/revocation, reporting/blocking and account deletion. Fixtures are explicitly separate from live generation.

Creator accounts have unique case-insensitive usernames, display names, bios and ten original AI-generated creature portraits. Game attribution links to creator pages that respect game access, profile visibility and blocking. Settings cover email/password changes with reauthentication, leaderboard privacy, automatic/manual save sync, blocked creators, download management, cloud data export, sign-out and account deletion. Apply `202610110001_creator_profiles.sql` before running the updated API; portrait prompts and built-in image generation provenance are saved in `apps/mobile/assets/creatures/generation.json`.

Game creation supports illustrated 2D, 3D and 3D isometric choices. Phaser remains the 2D engine; Three.js supplies the perspective and orthographic 3D runtimes within the same signed offline package model. The view persists in Postgres and is retained by modifications. See [GAME_VIEWS.md](GAME_VIEWS.md); paid live generation and native 3D device verification remain blocked.

Still needed before calling the requested end-to-end live product complete:

- Android installed gameplay/offline/save verification. Native compilation passed, but the downloaded emulator refused to start due to insufficient free disk space. The temporary emulator/system image were removed; unrelated user data was preserved.
- Production Supabase/Postgres/SMTP, HTTPS API/artifact infrastructure, secret management, independent provider spending limits, least-privilege production DB role and firewalling of the worker gateway.
- Owned HTTPS invite domain with verified universal/App Links and fallback page. Current custom-scheme invites work only with the app installed.
- Apple/Google/Expo signing/project accounts, physical device verification, production email confirmation/recovery, store ratings/review, hosted policy/support and staffed moderation operations.

Current storage uses a private durable filesystem adapter, not a configured cloud bucket. Selected installed versions are tracked; previous version folders can accumulate and require housekeeping. A production competitive anti-cheat system is outside this offline MVP. Local guest sample progress does not automatically merge into a newly created account; accounts remain deliberately separate.

The code and deterministic tests constitute a usable local MVP foundation. External-service and distribution blockers are documented rather than substituted with fake success. See TESTING for final native and automated results.
