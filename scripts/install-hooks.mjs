import { existsSync, writeFileSync, chmodSync } from 'node:fs';
if (existsSync('.git/hooks')) {
  writeFileSync(
    '.git/hooks/pre-commit',
    '#!/bin/sh\nset -e\npnpm typecheck\npnpm lint\npnpm test\n',
  );
  chmodSync('.git/hooks/pre-commit', 0o755);
}
