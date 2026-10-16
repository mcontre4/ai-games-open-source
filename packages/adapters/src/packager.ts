import { sign, createPrivateKey, createHash } from 'node:crypto';
import { zipSync, strToU8, type Zippable } from 'fflate';
import { hash, canonical, PACKAGE_LIMIT } from '../../game-sdk/src/package.ts';
import { prepareLocalGameFiles } from './local-game-files.ts';
import type { Manifest } from '../../contracts/src/index.ts';
import type { Game } from '../../domain/src/index.ts';
import type { PackagerPort } from '../../application/src/ports.ts';
export class SignedPackager implements PackagerPort {
  constructor(private privatePem: string) {}
  async package(game: Game, versionId: string, input: Record<string, Uint8Array>) {
    const files = prepareLocalGameFiles(input, game.view ?? '2d');
    const assets = Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) }));
    const size = assets.reduce((n, a) => n + a.bytes, 0);
    if (size > PACKAGE_LIMIT || assets.some((a) => a.bytes > 10 * 1024 * 1024))
      throw new Error('Package exceeds limits.');
    const body: Omit<Manifest, 'signature'> = {
      schemaVersion: 1,
      gameId: game.id,
      versionId,
      title: game.title,
      description: game.description,
      entryPoint: 'index.html',
      orientation: game.orientation,
      supportedPlatforms: ['ios', 'android'],
      ...(game.view ? { view: game.view } : {}),
      engineVersion: (game.view ?? '2d') === '2d' ? '3.90.0' : '0.180.0',
      packageSize: size,
      assets,
      capabilities: ['state', 'score', 'player', 'gameInfo'],
      minimumPlayerVersion: 1,
      stateSchemaVersion: 1,
    };
    const signature = sign(
      null,
      Buffer.from(canonical(body)),
      createPrivateKey(this.privatePem),
    ).toString('hex');
    files['manifest.json'] = strToU8(canonical({ ...body, signature }));
    const entries: Zippable = {};
    for (const key of Object.keys(files).sort())
      entries[key] = [files[key]!, { mtime: new Date(1980, 0, 1), level: 6 }];
    const bytes = zipSync(entries);
    return { bytes, checksum: createHash('sha256').update(bytes).digest('hex') };
  }
}
