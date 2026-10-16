import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicKey, createHash } from 'node:crypto';
import sharp from 'sharp';
import { zipSync, type Zippable } from 'fflate';
import { SignedPackager } from '../packages/adapters/src/packager.ts';
import { configSchema } from '../packages/config/src/index.ts';
import { compose } from '../packages/adapters/src/composition.ts';
import { validateGameInBrowser } from '../packages/adapters/src/generation/browser-validation.ts';
import type { Game } from '../packages/domain/src/index.ts';
const config = configSchema.parse(process.env);
const services = compose(config);
const game: Game = {
  id: 'game_neoncomet',
  ownerId: '00000000-0000-0000-0000-000000000000',
  title: 'Neon Comet',
  description:
    'Ride the midnight skyline. Dodge the city, collect energy crystals and chase your best run.',
  orientation: 'portrait',
  currentVersionId: 'ver_neoncomet1',
  public: true,
  fixture: true,
  createdAt: '2026-10-10T00:00:00Z',
};
async function filesFrom(dir: string, path = ''): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of await readdir(join(dir, path), { withFileTypes: true })) {
    const name = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await filesFrom(dir, name));
    else files[name] = new Uint8Array(await readFile(join(dir, name)));
  }
  return files;
}
const files = await filesFrom('packages/game-template/dist');
await mkdir('work/screenshots', { recursive: true });
await validateGameInBrowser(files, 'work/screenshots/neon-comet.png');
game.currentVersionId =
  'ver_neon' +
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([path, data]) => [path, Buffer.from(data).toString('base64')]),
      ),
    )
    .update(await readFile(config.PACKAGE_PUBLIC_KEY_FILE, 'utf8'))
    .update('classic-bundle-v1')
    .digest('hex')
    .slice(0, 20);
const packageResult = await new SignedPackager(
  await readFile(config.PACKAGE_SIGNING_KEY_FILE, 'utf8'),
).package(game, game.currentVersionId!, files);
const sourceFiles: Zippable = {};
for (const [path, bytes] of Object.entries(await filesFrom('packages/game-template/src')))
  if (path === 'Game.ts') sourceFiles[`src/${path}`] = bytes;
for (const [path, bytes] of Object.entries(await filesFrom('packages/game-template/public/assets')))
  sourceFiles[`public/assets/${path}`] = bytes;
const artifactKey = `${game.id}/${game.currentVersionId}/package.zip`,
  sourceKey = `${game.id}/${game.currentVersionId}/source.zip`;
if (!(await services.storage.exists(artifactKey))) {
  await services.storage.put(artifactKey, packageResult.bytes);
  await services.storage.put(sourceKey, zipSync(sourceFiles));
}
await services.db.transaction(async (c) => {
  await c.query(
    'insert into games(id,title,description,orientation,is_public,fixture,created_at) values($1,$2,$3,$4,true,true,$5) on conflict(id) do nothing',
    [game.id, game.title, game.description, game.orientation, game.createdAt],
  );
  await c.query(
    'insert into game_versions(id,game_id,number,artifact_key,source_key,package_bytes,checksum) values($1,$2,(select coalesce(max(number),0)+1 from game_versions where game_id=$2),$3,$4,$5,$6) on conflict(id) do nothing',
    [
      game.currentVersionId,
      game.id,
      artifactKey,
      sourceKey,
      packageResult.bytes.length,
      packageResult.checksum,
    ],
  );
  await c.query('update games set current_version_id=$2 where id=$1', [
    game.id,
    game.currentVersionId,
  ]);
});
const publicKey = createPublicKey(await readFile(config.PACKAGE_PUBLIC_KEY_FILE, 'utf8'))
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('hex');
await mkdir('apps/mobile/assets', { recursive: true });
await writeFile('apps/mobile/assets/neon-comet.zip', packageResult.bytes);
await writeFile(
  'apps/mobile/assets/fixture.json',
  JSON.stringify(
    {
      game,
      versionId: game.currentVersionId,
      publicKey,
      checksum: packageResult.checksum,
      bytes: packageResult.bytes.length,
    },
    null,
    2,
  ) + '\n',
);
const cover = await sharp('packages/game-template/public/assets/background.png')
  .resize(780, 1000, { fit: 'cover' })
  .composite([
    {
      input: await sharp('packages/game-template/public/assets/city.png')
        .resize(780, 720)
        .toBuffer(),
      top: 280,
      left: 0,
    },
    {
      input: await sharp('packages/game-template/public/assets/hovercraft.png')
        .resize(420, 228)
        .toBuffer(),
      top: 365,
      left: 100,
    },
  ])
  .png()
  .toBuffer();
await writeFile('apps/mobile/assets/neon-cover.png', cover);
await services.db.close();
console.log(
  JSON.stringify({
    event: 'fixture_seeded',
    gameId: game.id,
    mode: 'deterministic_offline_fixture',
    checksum: packageResult.checksum,
  }),
);
