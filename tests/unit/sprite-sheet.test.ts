import { expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareSpriteSheet } from '../../packages/adapters/src/generation/sprite-sheet.ts';

// Explicit deterministic artwork to verify image processing, never a live result.
async function sheet(background = '#ff00ff', missing = -1) {
  const subjects = await Promise.all(
    ['#245e98', '#836328', '#f5c64c', '#4b803e'].map(async (color) =>
      sharp({ create: { width: 80, height: 140, channels: 4, background: color } })
        .png()
        .toBuffer(),
    ),
  );
  return sharp({ create: { width: 512, height: 768, channels: 4, background } })
    .composite(
      subjects.flatMap((input, i) =>
        i === missing
          ? []
          : [
              {
                input,
                left: (i % 2) * 256 + 88,
                top: Math.floor(i / 2) * 384 + 122,
              },
            ],
      ),
    )
    .png()
    .toBuffer();
}

it('extracts all four non-square provider cells into ordered transparent frames without distortion', async () => {
  const png = await prepareSpriteSheet(await sheet());
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: 1024, height: 1024, channels: 4 });
  for (const [i, color] of [
    [0, [36, 94, 152]],
    [1, [131, 99, 40]],
    [2, [245, 198, 76]],
    [3, [75, 128, 62]],
  ] as const) {
    const corner = (Math.floor(i / 2) * 512 * 1024 + (i % 2) * 512) * 4;
    const center = ((Math.floor(i / 2) * 512 + 256) * 1024 + (i % 2) * 512 + 256) * 4;
    expect(data[corner + 3]).toBe(0);
    expect([...data.subarray(center, center + 3)]).toEqual(color);
    // 80:140 source aspect survives trimming/resizing into a square frame.
    expect(data[center - 230 * 4 + 3]).toBe(0);
    expect(data[center - 100 * 4 + 3]).toBe(255);
  }
});

it.each([
  ['missing subject', '#ff00ff', 2],
  ['unremovable matte', '#eeeeee', -1],
] as const)(
  'rejects %s instead of publishing broken sprite cutouts',
  async (_name, background, missing) => {
    await expect(prepareSpriteSheet(await sheet(background, missing))).rejects.toMatchObject({
      code: 'IMAGE_QUALITY',
    });
  },
);

it('preserves interior magenta details that are enclosed by a subject', async () => {
  const base = await sheet();
  const detail = await sharp({
    create: { width: 10, height: 10, channels: 4, background: '#ff00ff' },
  })
    .png()
    .toBuffer();
  const input = await sharp(base)
    .composite([{ input: detail, left: 123, top: 187 }])
    .png()
    .toBuffer();
  const { data } = await sharp(await prepareSpriteSheet(input))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const center = (256 * 1024 + 256) * 4;
  expect([...data.subarray(center, center + 4)]).toEqual([255, 0, 255, 255]);
});

it('leaves unrequested frames transparent even when the provider invents extra subjects', async () => {
  const { data } = await sharp(await prepareSpriteSheet(await sheet(), false, [0]))
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data[(256 * 1024 + 256) * 4 + 3]).toBe(255);
  for (const [x, y] of [
    [768, 256],
    [256, 768],
    [768, 768],
  ])
    expect(data[(y! * 1024 + x!) * 4 + 3]).toBe(0);
});

// Deterministic regression for the production sheets whose axolotl tail crossed
// the exact halfway cut. Keep paid provider bytes in private replay evidence.
async function shiftedSheet(axis: 'x' | 'y', clipped = false, oversized = false) {
  const tall = await sharp({
    create: { width: 80, height: oversized ? 370 : 270, channels: 4, background: '#245e98' },
  })
    .png()
    .toBuffer();
  const small = await sharp({
    create: { width: 80, height: 80, channels: 4, background: '#836328' },
  })
    .png()
    .toBuffer();
  const input = await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#ff00ff' },
  })
    .composite([
      { input: tall, left: 80, top: clipped ? 0 : 20 },
      { input: small, left: 350, top: 80 },
      { input: small, left: 80, top: 420 },
      { input: small, left: 350, top: 420 },
    ])
    .png()
    .toBuffer();
  return axis === 'x' ? sharp(input).rotate(90).png().toBuffer() : input;
}

it.each(['x', 'y'] as const)(
  'finds a clear %s gutter and preserves the complete subject crossing the nominal cut',
  async (axis) => {
    const { data, info } = await sharp(await prepareSpriteSheet(await shiftedSheet(axis)))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 1024, height: 1024, channels: 4 });
    // Rotation puts the tall blue subject in the top-right frame.
    const frameX = axis === 'x' ? 512 : 0;
    const points =
      axis === 'y'
        ? [
            [frameX + 256, 20],
            [frameX + 256, 490],
          ]
        : [
            [frameX + 20, 256],
            [frameX + 490, 256],
          ];
    for (const [x, y] of points)
      expect([...data.subarray((y! * 1024 + x!) * 4, (y! * 1024 + x!) * 4 + 4)]).toEqual([
        36, 94, 152, 255,
      ]);
    for (const [x, y] of [
      [0, 0],
      [512, 0],
      [0, 512],
      [512, 512],
    ])
      expect(data[(y! * 1024 + x!) * 4 + 3]).toBe(0);
  },
);

it('rejects a clipped subject even when a nearby gutter exists', async () => {
  await expect(prepareSpriteSheet(await shiftedSheet('y', true))).rejects.toThrow(
    'Sprite frame 0 is clipped at its boundary',
  );
});

it('rejects layouts that require moving the gutter beyond the bounded central region', async () => {
  await expect(prepareSpriteSheet(await shiftedSheet('y', false, true))).rejects.toThrow(
    'no clear horizontal gutter',
  );
});

it('identifies an empty required frame separately from clipping and matte failures', async () => {
  await expect(prepareSpriteSheet(await sheet('#ff00ff', 0))).rejects.toThrow(
    'Sprite frame 0 has no visible subject',
  );
});
