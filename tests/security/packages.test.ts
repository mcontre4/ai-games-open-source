import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { verifyPackage, preflightZip, hash } from '../../packages/game-sdk/src/package.ts';
import { signing, game, smallFiles } from '../helpers.ts';
describe('signed offline package security', () => {
  it.each(['export const value=1;', 'console.log(import.meta.url);'])(
    'rejects module-only syntax before signing local bundles: %s',
    async (source) => {
      await expect(
        signing().packager.package(game, 'ver_testing', {
          ...smallFiles,
          'game.js': strToU8(source),
        }),
      ).rejects.toThrow();
    },
  );

  it('packages deterministically and verifies every file', async () => {
    const { packager, publicKey } = signing();
    const a = await packager.package(game, 'ver_testing', smallFiles);
    const b = await packager.package(game, 'ver_testing', smallFiles);
    expect(a.checksum).toBe(b.checksum);
    const verified = verifyPackage(a.bytes, publicKey, {
      gameId: game.id,
      versionId: 'ver_testing',
      checksum: a.checksum,
    });
    expect(verified.manifest.capabilities).toContain('state');
    expect(verified.files['game.js']).toEqual(smallFiles['game.js']);
  });
  it.each(['3d', 'isometric'] as const)(
    'signs %s engine metadata and rejects view tampering',
    async (view) => {
      const { packager, publicKey } = signing();
      const packed = await packager.package({ ...game, view }, 'ver_testing', smallFiles);
      expect(verifyPackage(packed.bytes, publicKey).manifest).toMatchObject({
        view,
        engineVersion: '0.180.0',
      });
      const files = unzipSync(packed.bytes);
      const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
      manifest.view = view === '3d' ? 'isometric' : '3d';
      files['manifest.json'] = strToU8(JSON.stringify(manifest));
      expect(() => verifyPackage(zipSync(files), publicKey)).toThrow('signature');
      manifest.view = '2d';
      files['manifest.json'] = strToU8(JSON.stringify(manifest));
      expect(() => verifyPackage(zipSync(files), publicKey)).toThrow('Engine');
    },
  );
  it.each([
    '../escape.js',
    '/absolute.js',
    'safe/../../escape.js',
    'safe\\escape.js',
    'safe//escape.js',
    'assets/run.exe',
  ])('rejects unsafe path %s', (path) =>
    expect(() => preflightZip(zipSync({ [path]: strToU8('x') }))).toThrow(),
  );
  it('rejects tampering, foreign signatures and swapped identities', async () => {
    const { packager, publicKey } = signing();
    const valid = await packager.package(game, 'ver_testing', smallFiles);
    const files = unzipSync(valid.bytes);
    files['game.js'] = strToU8('malicious()');
    expect(() => verifyPackage(zipSync(files), publicKey)).toThrow('Invalid asset');
    expect(() => verifyPackage(valid.bytes, signing().publicKey)).toThrow('signature');
    expect(() =>
      verifyPackage(valid.bytes, publicKey, {
        gameId: 'game_other',
        versionId: 'ver_testing',
        checksum: valid.checksum,
      }),
    ).toThrow('Wrong game');
    expect(() =>
      verifyPackage(valid.bytes, publicKey, {
        gameId: game.id,
        versionId: 'ver_testing',
        checksum: hash(strToU8('bad')),
      }),
    ).toThrow('checksum');
  });
  it('rejects unexpected files and corrupt manifests', async () => {
    const { packager, publicKey } = signing();
    const valid = await packager.package(game, 'ver_testing', smallFiles);
    const files = unzipSync(valid.bytes);
    files['extra.js'] = strToU8('x');
    expect(() => verifyPackage(zipSync(files), publicKey)).toThrow('Unexpected');
    files['manifest.json'] = strToU8('{');
    expect(() => verifyPackage(zipSync(files), publicKey)).toThrow();
  });
  it('rejects symlink entries before extraction', () => {
    const zip = zipSync({ 'link.js': strToU8('target') });
    const v = new DataView(zip.buffer);
    for (let i = 0; i < zip.length - 4; i++)
      if (v.getUint32(i, true) === 0x02014b50) {
        v.setUint32(i + 38, 0xa1ff0000, true);
        break;
      }
    expect(() => preflightZip(zip)).toThrow('Unsafe');
  });
  it('rejects decompression bombs and excessive file counts', () => {
    expect(() => preflightZip(zipSync({ 'huge.js': new Uint8Array(2 * 1024 * 1024) }))).toThrow(
      'Decompression',
    );
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 260; i++) files[`f${i}.js`] = strToU8('x');
    expect(() => preflightZip(zipSync(files))).toThrow('entry limit');
  });
});
