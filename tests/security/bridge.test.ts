import { it, expect, describe } from 'vitest';
import {
  HandleGameMessage,
  type BridgePersistence,
} from '../../packages/application/src/bridge.ts';
import { verifyPackage } from '../../packages/game-sdk/src/package.ts';
import { signing, game, smallFiles } from '../helpers.ts';
import type { Save, Json } from '../../packages/domain/src/index.ts';
describe('untrusted game bridge', () => {
  async function setup() {
    const { packager, publicKey } = signing();
    const manifest = verifyPackage(
      (await packager.package(game, 'ver_testing', smallFiles)).bytes,
      publicKey,
    ).manifest;
    const calls: { account: string; gameId: string; state?: Json; score?: number }[] = [];
    const persistence: BridgePersistence = {
      load: async (account, gameId) => {
        calls.push({ account, gameId });
        return null as Save | null;
      },
      save: async (account, m, state) => {
        calls.push({ account, gameId: m.gameId, state });
      },
      score: async (account, m, score) => {
        calls.push({ account, gameId: m.gameId, score });
      },
    };
    return {
      calls,
      manifest,
      bridge: new HandleGameMessage(
        persistence,
        { accountId: 'host-account', manifest, playerName: 'Player' },
        () => 1000,
      ),
    };
  }
  it('derives scope exclusively from the authenticated host', async () => {
    const { bridge, calls } = await setup();
    expect(
      await bridge.execute(
        JSON.stringify({ protocol: 1, id: 'a', type: 'saveState', state: { coins: 8 } }),
      ),
    ).toMatchObject({ ok: true });
    expect(calls).toEqual([{ account: 'host-account', gameId: game.id, state: { coins: 8 } }]);
  });
  it.each([
    { type: 'saveState', state: {}, userId: 'other' },
    { type: 'loadState', gameId: 'other' },
    { type: 'camera' },
    { type: 'execute', command: 'rm -rf /' },
    { type: 'submitScore', score: -1 },
  ])('rejects forged or malformed request %o', async (request) => {
    const { bridge } = await setup();
    await expect(
      bridge.execute(JSON.stringify({ protocol: 1, id: 'a', ...request })),
    ).rejects.toThrow();
  });
  it('enforces capabilities and duplicate correlation IDs', async () => {
    const { bridge, manifest } = await setup();
    manifest.capabilities = [];
    expect(await bridge.execute('{"protocol":1,"id":"a","type":"loadState"}')).toMatchObject({
      ok: false,
    });
    await expect(bridge.execute('{"protocol":1,"id":"a","type":"loadState"}')).rejects.toThrow(
      'Duplicate',
    );
  });
  it('bounds message size and request rate', async () => {
    const { bridge } = await setup();
    await expect(bridge.execute('x'.repeat(80_000))).rejects.toThrow('large');
    for (let i = 0; i < 30; i++)
      await bridge.execute(JSON.stringify({ protocol: 1, id: String(i), type: 'getPlayer' }));
    await expect(
      bridge.execute('{"protocol":1,"id":"overflow","type":"getPlayer"}'),
    ).rejects.toThrow('Too many');
  });
});
