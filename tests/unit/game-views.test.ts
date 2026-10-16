import { it, expect, vi } from 'vitest';
import { createGameSchema } from '../../packages/contracts/src/index.ts';
import { CreateGame } from '../../packages/application/src/games.ts';
import type { GameRepository, GenerationRepository } from '../../packages/application/src/ports.ts';
import { instructionsForView } from '../../packages/adapters/src/ai/codex.ts';
import { game } from '../helpers.ts';

it('defaults old create requests to 2D and rejects unsupported views', () => {
  expect(createGameSchema.parse({ prompt: 'A forest puzzle game' }).view).toBe('2d');
  for (const view of ['2d', '3d', 'isometric'])
    expect(createGameSchema.parse({ prompt: 'A forest puzzle game', view }).view).toBe(view);
  expect(() => createGameSchema.parse({ prompt: 'A forest puzzle game', view: 'unity' })).toThrow();
});
it.each(['2d', '3d', 'isometric'] as const)(
  'persists %s and preserves it across modifications',
  async (view) => {
    const reserve = vi.fn();
    const usecase = new CreateGame(
      { accessible: async () => ({ ...game, view }) } as unknown as GameRepository,
      { reserve } as unknown as GenerationRepository,
      { next: (prefix) => `${prefix}_test`, token: () => '', hash: () => '' },
      { now: () => game.createdAt },
      { available: true, newLimit: 5, modifyLimit: 5, jobCap: 1, dailyCap: 10 },
    );
    await usecase.execute(game.ownerId, {
      prompt: 'A forest puzzle game',
      orientation: 'portrait',
      view,
    });
    expect(reserve.mock.calls[0]![0].game.view).toBe(view);
    await usecase.execute(game.ownerId, {
      prompt: 'Add more forest trees',
      orientation: 'landscape',
      view: '2d',
      gameId: game.id,
    });
    expect(reserve.mock.calls[1]![0].game).toBeNull();
    expect(reserve.mock.calls[1]![0].generation).toMatchObject({
      gameId: game.id,
      kind: 'modify',
      baseVersionId: game.currentVersionId,
    });
  },
);
it('chooses actual 3D instructions and the matching camera', () => {
  expect(instructionsForView('2d')).toContain('Phaser CANVAS');
  expect(instructionsForView('3d')).toContain('Selected view: 3d');
  expect(instructionsForView('isometric')).toContain('Selected view: isometric');
  expect(instructionsForView('isometric')).toContain('actual 3D geometry');
});
