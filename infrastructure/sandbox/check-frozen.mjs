import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const frozen = [
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'index.html',
  'src/main.ts',
  'src/sdk.ts',
  'src/style.css',
];
const starter =
  process.env.GAME_VIEW && process.env.GAME_VIEW !== '2d' ? '/opt/starter-3d' : '/opt/starter';
if (starter.endsWith('-3d')) frozen.push('src/runtime.ts');
for (const path of frozen) {
  const sum = (value) => createHash('sha256').update(value).digest('hex');
  if (sum(readFileSync(`/workspace/${path}`)) !== sum(readFileSync(`${starter}/${path}`)))
    throw new Error(`Protected starter file changed: ${path}`);
}
