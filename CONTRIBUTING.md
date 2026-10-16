# Contributing to AI Games

Bug reports, documentation, accessibility improvements and code contributions are welcome. Read the [README](README.md) and [local setup](docs/LOCAL_DEVELOPMENT.md), then open a focused pull request. Discuss substantial changes in an issue first so the scope is clear.

## Development

Use Node 22.12 or newer and the pnpm version pinned in `package.json`. Docker runs local Supabase and isolated game builds. Native work needs Xcode/CocoaPods or Java 17+/Android SDK. Install Chromium with `pnpm exec playwright install chromium` (`--with-deps` on Linux).

Follow the README setup, create a branch, and keep changes focused. Do not commit `.env` files, keys, downloaded artifacts, generated native folders, personal test accounts or provider responses. The setup script creates your own local keys. Fixtures and screenshot data must remain clearly separate from live AI generation.

## Architecture

Dependencies flow from presentation to application to domain. Application owns ports; adapters implement them. Domain imports no infrastructure or UI. Give each use case one public `execute` method and inject time, identities, repositories and external services. Credentials stay in trusted services, never game packages or agent sandboxes. See [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Before a pull request

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm secrets:check  # requires Gitleaks 8.30.1+
```

Integration tests need the local database, Auth and sandbox image. Stop your development worker while they run so it cannot consume fixture jobs. Do not run local tests against production. Report missing prerequisites as blocked; browser checks do not establish native behavior, and fixtures do not establish live AI generation. Paid generation is opt-in and requires your own funded provider key.

Update docs for behavior or configuration changes. For UI changes, include screenshots with synthetic accounts; run `pnpm screenshots` to refresh the public gallery. Use `pnpm exec prettier --check <changed-files>` for formatting. The installed Git hook also runs typecheck, lint and unit/security tests.

Describe the concrete behavior changed, the checks run and any remaining limits. Never attach private environment files, raw provider responses or database exports to an issue or pull request. Use the [private security process](SECURITY.md) for vulnerabilities.

## License and conduct

By contributing, you agree to make your contribution available under the project's [MIT license](LICENSE). Keep upstream notices and confirm you have the right to contribute any asset. Be respectful, assume good intent, give actionable feedback and avoid harassment or disclosure of personal information. Maintainers may remove abusive content or close disruptive contributions.
