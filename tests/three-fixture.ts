import { mkdir, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'vite';
import type { GameView } from '../packages/domain/src/index.ts';
import { analyzeGameSource } from '../packages/adapters/src/generation/static-analysis.ts';
import { watercolorDirection } from './art-direction-fixture.ts';

/** Real Three.js bundles using the production frozen host and explicit fixture gameplay. */
export async function threeFixture(view: Exclude<GameView, '2d'>) {
  const root = resolve('work/three-fixtures', view);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'public/assets'), { recursive: true });
  try {
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const source = (await readFile('tests/fixtures/three-game.ts', 'utf8'))
    .replace('../../packages/game-template/src/sdk', './sdk')
    .replace('../../infrastructure/sandbox/three-runtime', './runtime');
  analyzeGameSource(source, view);
  await writeFile(join(root, 'src/Game.ts'), source);
  for (const [from, to] of [
    ['infrastructure/sandbox/starter-three-main.ts', 'src/main.ts'],
    ['infrastructure/sandbox/three-runtime.ts', 'src/runtime.ts'],
    ['infrastructure/sandbox/starter-index.html', 'index.html'],
    ['infrastructure/sandbox/starter-style.css', 'src/style.css'],
    ['packages/game-template/src/sdk.ts', 'src/sdk.ts'],
  ])
    await writeFile(join(root, to!), await readFile(from!));
  await writeFile(
    join(root, 'public/assets/background.png'),
    await readFile('packages/game-template/public/assets/background.png'),
  );
  await writeFile(
    join(root, 'public/game.json'),
    JSON.stringify({
      title: `Explicit ${view} fixture`,
      description: 'Deterministic offline runtime test, never a live AI game.',
      artDirection: watercolorDirection,
      view,
    }),
  );
  await build({
    configFile: false,
    root,
    base: './',
    logLevel: 'silent',
    build: {
      outDir: 'dist',
      assetsInlineLimit: 0,
      rollupOptions: {
        output: { entryFileNames: 'game.js', assetFileNames: 'assets/[name]-[hash][extname]' },
      },
    },
  });
  const files: Record<string, Uint8Array> = {};
  const dist = join(root, 'dist');
  for (const item of await readdir(dist, { recursive: true, withFileTypes: true }))
    if (item.isFile())
      files[join(item.parentPath, item.name).substring(dist.length + 1)] = await readFile(
        join(item.parentPath, item.name),
      );
  return { files, source };
}
