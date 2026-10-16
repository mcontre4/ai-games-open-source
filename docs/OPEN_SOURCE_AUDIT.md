# Open-source publication audit

Prepared on 2026-10-15 for the MIT release. This is a repository publication and configuration review, not a penetration-test certification.

## Source and configuration changes

- Added the MIT license, package license metadata, contributor guide, private security reporting instructions, issue/PR templates and upstream engine notices.
- Rebuilt the README around setup, actual usage, architecture, commands, troubleshooting and self-hosted deployment.
- Removed the deployed production mobile preset and its duplicated EAS endpoints/public project keys. Operators now supply their own configuration. Missing production files fail before startup.
- Preserved the existing owner's public mobile settings only in ignored local configuration; no live deployment or private credential was changed.
- Enabled account quotas, internal credit accounting, estimated-cost reservations, per-job/daily spending caps, rate limits and challenge limits by default. Existing explicitly configured private environments retain their values.
- Disabled telemetry by default and required production app verification in templates/EAS profiles.
- Expanded ignore rules for credential/signing files. CI now runs on pushes/PRs with read-only repository permission, secret scans and the existing full verification suite. CI uses local infrastructure and deterministic/unbilled fixtures, without provider credentials.

## Secret review

Gitleaks **8.30.1**, downloaded from the upstream release with its archive checksum verified, scanned **85 nonempty commits** across all local refs (90 total commits at audit start). The unfiltered history scan found **six matches**: the previously deployed **public Supabase anonymous JWT** and **public Ed25519 package verification key**, duplicated in the mobile preset and EAS profiles. The JWT's role is `anon`; it is not a service-role credential. Neither public value is a private signing key or provider credential.

The owner chose a **new public repository with a clean initial snapshot**, rather than rewriting the private repository. No original commits, branches, reflogs, deployment presets or historical ignore fingerprints are imported. The public source contains neither deployed value and uses **no Gitleaks allowlist**. The original repository and all of its history stay private and unchanged on GitHub.

A separate exact-value comparison checked local private environment credentials and private signing material against **1,962 historical objects**, including the contents of ZIP blobs. It found **zero matches**. Only credential-source names and counts were reported; no values were logged. Scan reports and preparation tools remain under ignored `work/open-source-audit/`.

The exported proposed public source tree also passed Gitleaks with **archive depth 2** and **decode depth 2**, covering bundled game ZIP content as well as text files. Screenshots contain synthetic identities and balances; no real session, personal email, management UI or private endpoint was captured.

The private repository had two published branches, no releases, no issues/PRs and no Actions runs/artifacts at inspection time. Its history is not force-pushed or made public. The public destination is [mcontre4/ai-games-open-source](https://github.com/mcontre4/ai-games-open-source), created from the verified source tree with its own root commit. Repository links, issue reporting, security reporting and package metadata target this new destination. Public commit author metadata uses a GitHub noreply address.

Automated scans and comparisons reduce exposure risk; they cannot establish that every possible secret or sensitive datum is absent. Private credentials should always be rotated if any exposure is discovered. Public anonymous and verification keys do not confer server signing or service-role access.

## Verification

| Check                                             | Result                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; lockfile remains compatible                                       |
| `pnpm typecheck`                                  | Passed for server/packages and mobile                                     |
| `pnpm lint`                                       | Passed, including architectural boundaries                                |
| `pnpm test`                                       | 293 unit/security tests passed                                            |
| `pnpm test:integration`                           | 54 tests passed                                                           |
| `pnpm test:e2e`                                   | 34 tests passed                                                           |
| `pnpm screenshots`                                | Four capture scenarios passed; 16 actual UI/runtime PNGs reviewed         |
| Gitleaks current files/archives                   | Passed without suppressing current file matches                           |
| Gitleaks original history                         | No private-secret findings; six reviewed historical public-key matches    |
| Known local private-value comparison              | Zero matches in historical objects/archives                               |
| `pnpm test:mobile`                                | **BLOCKED**: `maestro: command not found`                                 |
| Physical-device production attestation            | **BLOCKED**: required signed device/distribution verification unavailable |
| Live AI generation                                | **Not run**: paid provider checks are outside this publication run        |

The screenshot harness uses reserved `.invalid` Auth/API URLs, blocks external traffic and runs game files offline through the application bridge. Its demo generation states and 3D/isometric runtime fixtures are not presented as live AI results. Native, live-provider and hosted CI results must be verified separately; local checks do not claim a hosted Actions pass.

## Publication procedure

Export the verified tracked tree into a separate checkout, initialize a new `main` branch, scan its files/ZIP content and complete one-commit history without an allowlist, then push it to the new public repository. Do not copy `.git`, environment files, private keys, build caches, accounts or `work/` into the new repository. The original private remote and branch history remain untouched. A private Git bundle backup is retained outside the public source.

All five required checks passed on the source changes. Screenshots were visually reviewed and every local document/image target was checked. GitHub Actions verification is separate from these local results; do not claim a hosted pass until the new repository's workflow completes. If any credential exposure is discovered later, revoke/rotate it before attempting history removal.
