import { expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { prepareLocalGameFiles } from '../../packages/adapters/src/local-game-files.ts';
import { signing, game, smallFiles } from '../helpers.ts';
import { verifyPackage } from '../../packages/game-sdk/src/package.ts';

it('signs exactly the local-file output used for validation, without altering artwork', async () => {
  const source = `const image = new Image(); image.src = './assets/background.png'; // assets/background.png\nconst ordinary='not-an-asset';`;
  const input = { ...smallFiles, 'game.js': strToU8(source) };
  const original = input['game.js'].slice();
  const local = prepareLocalGameFiles(input);
  const js = new TextDecoder().decode(local['game.js']);
  expect(js).toContain('data:image/png;base64,');
  expect(js).toContain('// assets/background.png');
  expect(js).toContain("const ordinary='not-an-asset'");
  expect(local['assets/background.png']).toEqual(input['assets/background.png']);
  expect(input['game.js']).toEqual(original);
  expect(prepareLocalGameFiles(local)).toEqual(local);
  const { packager, publicKey } = signing();
  const packed = await packager.package(game, 'ver_local_files', input);
  const verified = verifyPackage(packed.bytes, publicKey);
  for (const [path, bytes] of Object.entries(local)) expect(verified.files[path]).toEqual(bytes);
});

it('keeps expansion inside the existing per-file package bound', () => {
  expect(() =>
    prepareLocalGameFiles({
      ...smallFiles,
      'assets/large.png': new Uint8Array(6 * 1024 * 1024),
      'game.js': strToU8("const a='assets/large.png', b='assets/large.png';"),
    }),
  ).toThrow('Package exceeds limits');
});

it('rejects out-of-scope filesystem paths before preparing a browser workspace', () => {
  expect(() => prepareLocalGameFiles({ ...smallFiles, '../escape.js': strToU8('') })).toThrow(
    'Invalid output path',
  );
});
