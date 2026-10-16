import { generateKeyPairSync } from 'node:crypto';
import { SignedPackager } from '../packages/adapters/src/packager.ts';
import type { Game } from '../packages/domain/src/index.ts';
export const game: Game = {
  id: 'game_testing',
  ownerId: 'user-one',
  title: 'Testing game',
  description: 'A test game',
  orientation: 'portrait',
  currentVersionId: 'ver_testing',
  public: false,
  fixture: false,
  createdAt: '2026-10-10T00:00:00Z',
};
export function signing() {
  const pair = generateKeyPairSync('ed25519');
  return {
    packager: new SignedPackager(
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
  };
}
export const smallFiles = {
  'index.html': new TextEncoder().encode(
    '<!doctype html><html><head></head><body><script src="game.js"></script></body></html>',
  ),
  'game.js': new TextEncoder().encode('console.log("game")'),
  'assets/background.png': new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDZsAAAAASUVORK5CYII=',
      'base64',
    ),
  ),
};
