# App integrity and guest ownership

The API defaults to required app verification. Apple App Attest verifies the iOS installation’s key and request assertions; Google Play Integrity verifies Android app recognition, signing certificate, device integrity, Play license and request hash. This raises the cost of unauthorized API use. An authorized player can still copy downloaded content; attestation is not copy protection or proof of a unique human.

## Request protocol

Every API route except `/health` authenticates a current Supabase session, including anonymous sessions. `/integrity/challenges` and `/integrity/instances` bootstrap verification and require authentication without an existing assertion. All other routes require verification, including generation, downloads and guest claiming. Bootstrap routes have rate limits; each identity can hold at most 20 pending challenges.

Challenges are random 256-bit values, expire after two minutes and belong to one identity and purpose. iOS enrolls an Apple-verified public key for that identity. Each request signs the shared serialization `[1, nonce, userId, SHA256(accessToken), method, pathWithQuery, canonicalJsonBody]`. Android supplies the base64url SHA256 of that serialization as its standard request hash. Google tokens are decoded by Google from the server, never trusted as client JSON.

Verification binds the session, method, exact path/query and body. The database atomically consumes the challenge and advances the Apple counter. Concurrent replay accepts at most one request. Registered keys cannot be reassigned or reset. Apple certificate validity, chain, app identity and production environment are checked. Android requires `PLAY_RECOGNIZED`, a pinned Play App Signing certificate, `MEETS_DEVICE_INTEGRITY`, `LICENSED` and a fresh matching request hash. Missing configuration or unavailable verification fails closed.

Mobile calls are serialized so Apple counters arrive in order during polling and synchronization. Private ZIP downloads already checked identity, game access and the selected immutable version; they now also require app verification and retain `Cache-Control: private, no-store`. Artifacts remain in private server storage.

## Guest generation and account linking

The app creates a real Supabase anonymous identity after age confirmation. Server quotas, credits, ownership and app verification apply. Before creating a game or changing the Auth session, it obtains a random guest claim credential and persists it in native SecureStore. The database stores only its hash. Game packages and agent sandboxes receive neither this credential nor session credentials.

After signup or sign-in, the registered account submits the credential with its own verified request. The server confirms that the source is anonymous and the destination is registered; a supplied source ID is never accepted as proof. One transaction moves owned games, queued/completed jobs, invitations, saves, scores, memberships, hidden entries and reports. Existing destination progress wins on conflicts. The whole daily credit ledger moves too, preserving spending, active holds and historical charges, including charges for deleted games. Login grants no extra allowance; late inference settlement follows the transferred job.

Claiming is idempotent for the chosen account and rejects another account. Generation locks prevent reservation during transfer. Old guest sessions are revoked, and restrictive RLS policies deny already-issued guest JWTs after transfer. A retained receipt enforces revocation. The credit trigger permits only the server-recorded transfer and keeps accounting valid during account deletion.

The app transfers account-scoped local installations/progress after server success. It retains the credential until both operations finish, binds retries to the chosen account and retries after restart. Failed linking is shown in the library. Anonymous Auth must be enabled in Supabase; production still needs signup abuse controls, rate limits and provider spending limits.

## Configuration and release verification

### Temporary inactive mode

Production templates and EAS profiles require app verification by default. For a deliberate private testing deployment only, set `APP_INTEGRITY_MODE=disabled` in your server’s private `.env.production` and restart the API/worker to match `EXPO_PUBLIC_APP_INTEGRITY_MODE=disabled` in the mobile build. This explicit switch disables both Apple App Attest and Android Play Integrity; their implementation and stored keys remain intact. Missing mode values still default to `required`, and unknown values are rejected.

Inactive builds omit the Apple App Attest entitlement, including an entitlement inherited from an older native configuration, and send authenticated API requests without native proofs. Rebuild with `pnpm prod:ios --device` to regenerate the native project. A development signing certificate is still required for installation on an iPhone; a Personal Team can sign this inactive build. Supabase authentication, ownership checks, package signatures, rate limits and credit/provider budgets remain enforced. `/health` reports `appIntegrityRequired=false` while the switch is inactive.

To reactivate verification, provision the Apple/Google verification configuration below, set both mode variables to `required`, update your private public-mobile configuration and EAS environment, restart the server and rebuild/re-sign the mobile app. The rebuilt iOS app includes the App Attest entitlement again. Coordinate client and server activation so an inactive client is not rejected unexpectedly.

Apply migrations through `202610110006_guest_credit_transfers.sql`. Existing databases need both the integrity/guest schema (`005`) and credit-transfer trigger (`006`). Supabase Auth needs `enable_anonymous_sign_ins=true`; restart/reconfigure an existing Auth service to activate it. Coordinate any restart of a shared service.

For production, configure:

- Server: `APP_ENV=production`, `APP_INTEGRITY_MODE=required`, `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID=com.aigames.creator`, `APPLE_APP_ATTEST_ENVIRONMENT=production`, `ANDROID_PACKAGE_NAME=com.aigames.creator` and `ANDROID_CERTIFICATE_SHA256_DIGESTS` (comma-separated base64url SHA256 digests of Play App Signing certificates).
- Google: enable/link Play Integrity for the Play application and Google Cloud project. Supply least-privilege server Application Default Credentials for token decoding, using workload identity or `GOOGLE_APPLICATION_CREDENTIALS`. Keep these credentials out of Expo and games. Provision sufficient verification quota for polling.
- Mobile: `EXPO_PUBLIC_APP_ENV=production`, `EXPO_PUBLIC_APP_INTEGRITY_MODE=required` and `EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER`. Keep your private mobile configuration and production EAS environment aligned when filling the project number.
- Apple: enable App Attest for the signing identity. Required-mode native configuration includes its environment entitlement; rebuild/re-sign after changing the switch or adding the native module. Development builds have the separate `.dev` identity; development verification entitlements are rejected by the production verifier.

`@expo/app-integrity` requires a native build; Expo Go, browsers and iOS simulators cannot establish production App Attest trust. Android’s required Play license expects distribution through Play, including a suitable test track. Unsupported devices receive an error and do not downgrade verification.

Local fixtures explicitly set `APP_INTEGRITY_MODE=local-development` and its public equivalent. The server allows this only on loopback outside production; the client allows local hosts outside production. Reserved `.invalid` fixture URLs are accepted only by the internal test bundle (`APP_ENV=test`, `CI=1`). Production rejects `local-development`; the separate `disabled` switch above must be explicit. Normal launchers expose development and production only.

Native verification requires a physical iOS device and a Play-distributed Android build: enroll, create as a guest, download, save, sign up/sign in, restart, confirm ownership/progress, test invalid proofs and revoke old sessions. Test real AI creation/modification separately with a funded provider and running worker. Automated fixtures do not establish either outcome.

## Architecture and evidence

Application-owned ports/use cases live in `packages/application`: challenge issuance, enrollment, request verification, client proof generation and guest claims. Postgres, Apple/Google and Expo/SecureStore adapters implement the boundaries. Fastify and mobile presentation coordinate them; the domain imports no native/provider implementation.

Security tests verify actual P-256 assertions with explicitly test-enrolled keys, forged enrollment, request/session tampering, expiration, counter rollback and replay. Database/API integration uses real Supabase/Postgres authorization for private packages, concurrent replay, atomic/idempotent ownership transfer, quotas, late credit settlement and RLS revocation. Browser tests explicitly inject Auth/API fixtures for guest creation, signup/sign-in, reload and interrupted-transfer recovery. Local guest integration fixtures mark isolated Auth users anonymous because the shared Auth daemon predates the setting; live anonymous Auth and native platform attestation remain separate checks.

References: [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity), [Google standard requests](https://developer.android.com/google/play/integrity/standard), [Google verdicts](https://developer.android.com/google/play/integrity/verdicts), [Expo App Integrity](https://docs.expo.dev/versions/v54.0.0/sdk/app-integrity/).
