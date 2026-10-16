import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { OpenRouterGameQuality } from '../../packages/adapters/src/ai/game-quality.ts';
import {
  visualPreview,
  gameReviewPreview,
} from '../../packages/adapters/src/generation/visual-preview.ts';
import type { OpenRouterClient, CodingModel } from '../../packages/adapters/src/ai/openrouter.ts';
import type { GameQualityPort, GameVisualSnapshot } from '../../packages/application/src/ports.ts';
import { watercolorDirection } from '../art-direction-fixture.ts';

async function scenario(output = { approved: true, issues: [] as string[] }) {
  const bytes = await gameReviewPreview(
    await sharp({
      create: {
        width: 390,
        height: 844,
        channels: 3,
        background: '#ddab77',
      },
    })
      .png()
      .toBuffer(),
  );
  const visuals: GameVisualSnapshot[] = (['portrait', 'landscape'] as const).flatMap(
    (orientation) =>
      (['menu', 'play', 'later-play'] as const).map((phase) => ({ orientation, phase, bytes })),
  );
  const chat = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  return {
    input: {
      request: 'A watercolor harvest game',
      direction: watercolorDirection,
      view: '2d',
      visuals,
    } as Parameters<GameQualityPort['review']>[0],
    chat,
    reviewer: new OpenRouterGameQuality(
      { chat } as unknown as OpenRouterClient,
      { id: 'test-only' } as CodingModel,
    ),
  };
}
it('reviews six actual image inputs under the existing paid-chat bound', async () => {
  const s = await scenario();
  await expect(
    s.reviewer.review(s.input, 'gen_fixture', AbortSignal.timeout(1000)),
  ).resolves.toEqual({ approved: true, issues: [] });
  const body = (s.chat.mock.calls as unknown[][])[0]![2] as { messages: { content: unknown }[] };
  const content = body.messages[1]!.content as { type: string; image_url?: { url: string } }[];
  expect(content.filter((part) => part.type === 'image_url')).toHaveLength(6);
  expect(JSON.stringify(body).length).toBeLessThan(400_000);
  expect((s.chat.mock.calls as unknown[][])[0]![4]).toBe('visual-review');
  expect(content.find((part) => part.image_url)?.image_url?.url).toMatch(
    /^data:image\/jpeg;base64,/,
  );
});
it.each([
  { approved: true, issues: ['Actor overlaps the HUD in portrait.'] },
  { approved: false, issues: [] },
])('rejects contradictory approval instead of publishing it', async (output) => {
  const s = await scenario(output);
  await expect(
    s.reviewer.review(s.input, 'gen_fixture', AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ code: 'QUALITY_FAILED' });
});
it('fails closed without both orientations and phases before any paid request', async () => {
  const s = await scenario();
  s.input.visuals.pop();
  await expect(
    s.reviewer.review(s.input, 'gen_fixture', AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ code: 'QUALITY_FAILED' });
  expect(s.chat).not.toHaveBeenCalled();
});
it('preserves proportions and bounds the visual preview without changing source bytes', async () => {
  const image = await sharp({
    create: { width: 1200, height: 2000, channels: 3, background: '#77aabb' },
  })
    .png()
    .toBuffer();
  const before = Buffer.from(image);
  const preview = await visualPreview(image);
  const metadata = await sharp(preview).metadata();
  expect(preview.byteLength).toBeLessThanOrEqual(9000);
  expect(metadata.height).toBe(512);
  expect(metadata.width).toBe(307);
  expect(image).toEqual(before);
});

it('keeps detailed scene review at 512 pixels while retaining the smaller CLI art bound', async () => {
  const shapes = Array.from(
    { length: 900 },
    (_, i) =>
      `<rect x="${(i % 30) * 13}" y="${Math.floor(i / 30) * 28}" width="11" height="24" fill="rgb(${(i * 37) % 256},${(i * 91) % 256},${(i * 17) % 256})"/>`,
  ).join('');
  const image = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844">${shapes}</svg>`),
  )
    .png()
    .toBuffer();
  const before = Buffer.from(image),
    review = await gameReviewPreview(image),
    art = await visualPreview(image);
  expect((await sharp(review).metadata()).height).toBe(512);
  expect(review.byteLength).toBeLessThanOrEqual(32_000);
  expect(art.byteLength).toBeLessThanOrEqual(9000);
  expect((await sharp(art).metadata()).height).toBeLessThan(512);
  expect(image).toEqual(before);
});
it('rejects oversized review captures before spending on inference', async () => {
  const s = await scenario();
  s.input.visuals[0]!.bytes = new Uint8Array(32_001);
  s.input.visuals[0]!.bytes.set([0xff, 0xd8]);
  await expect(
    s.reviewer.review(s.input, 'gen_fixture', AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ code: 'QUALITY_FAILED' });
  expect(s.chat).not.toHaveBeenCalled();
});
