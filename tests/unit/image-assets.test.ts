import { expect, it, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index.ts';
import {
  OpenRouterImages,
  type OpenRouterClient,
} from '../../packages/adapters/src/ai/openrouter.ts';

it('requests a sprite layout rather than environment scenery and retries one malformed paid image', async () => {
  const image = vi
    .fn()
    .mockRejectedValueOnce(new DomainError('IMAGE_QUALITY', 'Bad matte'))
    .mockResolvedValue(new Uint8Array([7]));
  const port = new OpenRouterImages({ image } as unknown as OpenRouterClient, 'fixture-model');
  const signal = AbortSignal.timeout(1000);
  expect(
    await port.create('Explicit sprite subjects fixture.', 'gen_fixture', signal, {
      orientation: 'portrait',
      quality: 'premium',
      kind: 'sprites',
    }),
  ).toEqual(new Uint8Array([7]));
  expect(image).toHaveBeenCalledTimes(2);
  expect(image.mock.calls[0]![2]).toContain('2 by 2 grid');
  expect(image.mock.calls[0]![2]).toContain('#FF00FF');
  expect(image.mock.calls[0]![4]).toMatchObject({ kind: 'sprites' });
  expect(image.mock.calls[1]![0]).toBe('gen_fixture');
});

it.each(['background-quality', 'provider-budget', 'repeated-sprite-quality'])(
  'bounds artwork retries for %s',
  async (failure) => {
    const image = vi
      .fn()
      .mockRejectedValue(
        new DomainError(
          failure === 'provider-budget' ? 'BUDGET' : 'IMAGE_QUALITY',
          'Explicit failure fixture',
        ),
      );
    const port = new OpenRouterImages({ image } as unknown as OpenRouterClient, 'fixture-model');
    await expect(
      port.create('Fixture direction', 'gen_fixture', AbortSignal.timeout(1000), {
        orientation: 'portrait',
        quality: 'premium',
        kind: failure === 'background-quality' ? 'background' : 'sprites',
      }),
    ).rejects.toThrow('Explicit failure fixture');
    expect(image).toHaveBeenCalledTimes(failure === 'repeated-sprite-quality' ? 2 : 1);
  },
);
