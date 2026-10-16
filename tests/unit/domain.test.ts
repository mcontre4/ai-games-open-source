import { describe, it, expect } from 'vitest';
import {
  validateGamePrompt,
  validateScore,
  validateState,
  requireOwner,
} from '../../packages/domain/src/index.ts';
import { game } from '../helpers.ts';
describe('domain rules', () => {
  it('accepts game intent and legitimate modifications', () => {
    validateGamePrompt('Create a neon endless runner game.');
    validateGamePrompt('Add flying enemies to level two.');
  });
  it.each(['short', ' '.repeat(4001), 'Create a game with a \x00 control character'])(
    'rejects invalid prompt input: %s',
    (prompt) => expect(() => validateGamePrompt(prompt)).toThrow(),
  );
  it('enforces creator ownership', () => {
    expect(() => requireOwner(game, 'other')).toThrow('creator');
    requireOwner(game, game.ownerId);
  });
  it.each([-1, 1.1, Infinity, 1_000_000_001])('rejects invalid score %s', (score) =>
    expect(() => validateScore(score)).toThrow(),
  );
  it('rejects oversized saves, reserved keys and excessive depth', () => {
    expect(() => validateState({ text: 'x'.repeat(70_000) })).toThrow('64 KiB');
    expect(() => validateState(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('Reserved');
    let state: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) state = { child: state };
    expect(() => validateState(state as never)).toThrow('nested');
  });
  it('allows ordinary progression data', () =>
    validateState({ coins: 23, level: 3, inventory: ['laser'], best: 345 }));
});
