# Security policy

## Report privately

Do not disclose vulnerabilities, credentials or exploit details in public issues. Use [GitHub private vulnerability reporting](https://github.com/mcontre4/ai-games-open-source/security/advisories/new). Include the affected commit, impact, minimal reproduction and a suggested mitigation if available. Use synthetic data and redact all credentials. If private reporting is unavailable, contact the repository owner through their GitHub profile to arrange a private channel before sharing details.

This project is maintained on a best-effort basis. Security fixes target the latest `main`; older snapshots have no separate support commitment.

## Credential handling

- Root `.env.development` and `.env.production` hold server credentials and stay out of Git. Prefer a secret manager for deployments.
- Mobile `EXPO_PUBLIC_*` values are embedded in the app. Only public endpoints, the Supabase anonymous key, public package verification key and optional public analytics ingestion key belong there.
- Provider keys, service-role keys, database passwords, private signing keys and analytics management credentials never belong in mobile builds, game archives, agent sandboxes, screenshots or logs.
- Local setup creates independent signing keys under ignored `work/keys`. Never reuse them for production. Keep production keys and artifact backups together and restrict access.
- A leaked secret must be revoked or rotated first. Removing its file or rewriting history does not revoke access. Check Git history, other branches, releases, CI logs and artifacts before publishing a previously private repository.

`pnpm secrets:check` runs a redacted Gitleaks history scan. CI also scans tracked files, including compressed packages. The public repository starts from a clean snapshot and has no secret-scanner allowlist or imported private history. No automated scan can prove the absence of every possible secret.

See [the threat boundaries and operational limits](docs/SECURITY.md) and [publication audit](docs/OPEN_SOURCE_AUDIT.md). Hosted operators must configure their own spending limits, attestation, backups, moderation process and privacy policy.
