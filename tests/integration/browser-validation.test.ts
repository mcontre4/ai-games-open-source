import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { it } from 'vitest';
it('validates the explicit fixture through the production tsx runtime, including the frame sampler', async () => {
  await promisify(execFile)('pnpm', ['exec', 'tsx', 'tests/browser-validation-runtime.ts'], {
    timeout: 40000,
  });
}, 45000);
it.each([
  'unused-sprites',
  'rendered-sprites',
  'delayed-progression',
  'local-pixel-reads',
  'outside-file',
])(
  'checks browser evidence in the %s deterministic runtime fixture',
  async (mode) => {
    await promisify(execFile)(
      'pnpm',
      ['exec', 'tsx', 'tests/browser-validation-runtime.ts', mode],
      { timeout: 40000 },
    );
  },
  45000,
);
