import sharp from 'sharp';

// Small visual references keep the stateless CLI history within its existing
// request/context budget. Original package artwork remains untouched.
export async function visualPreview(bytes: Uint8Array): Promise<Uint8Array> {
  for (const [size, quality] of [
    [512, 55],
    [384, 45],
    [256, 35],
  ] as const) {
    const preview = await sharp(bytes, { limitInputPixels: 16_000_000 })
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#e8e8e8' })
      .jpeg({ quality })
      .toBuffer();
    if (preview.byteLength <= 9000) return preview;
  }
  throw new Error('Visual reference exceeds its bounded size.');
}

// Independent scene review needs enough pixels to judge actor silhouettes and HUD
// labels. Do not shrink detailed games to the CLI artwork-history thumbnail budget.
export async function gameReviewPreview(bytes: Uint8Array): Promise<Uint8Array> {
  for (const quality of [80, 70, 60, 50]) {
    const preview = await sharp(bytes, { limitInputPixels: 16_000_000 })
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#e8e8e8' })
      .jpeg({ quality })
      .toBuffer();
    if (preview.byteLength <= 32_000) return preview;
  }
  throw new Error('Game review capture exceeds its bounded size.');
}
