import sharp from 'sharp';
import { DomainError } from '../../../domain/src/index.ts';

/** Converts a provider's 2x2 matte sheet into four transparent 512px frames.
 * Only the matte connected to sheet edges is removed, preserving interior colors.
 * Generated images need not have exact dimensions; game frame dimensions do.
 */
export async function prepareSpriteSheet(
  bytes: Uint8Array,
  pixelArt = false,
  requiredFrames: readonly number[] = [0, 1, 2, 3],
): Promise<Uint8Array> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 16_000_000 })
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width < 64 || info.height < 64)
    throw new DomainError('IMAGE_QUALITY', 'Sprite sheet is too small.');
  removeMatte(data, info.width, info.height);
  // Providers place isolated subjects slightly across the nominal halfway line.
  // Find a nearby clear gutter before cutting, rather than clipping a valid tail.
  const splitX = findGutter(data, info.width, info.height, 'x');
  const splitY = findGutter(data, info.width, info.height, 'y');
  const frames: sharp.OverlayOptions[] = [];
  for (let frame = 0; frame < 4; frame++) {
    // Unrequested subjects remain transparent even if a provider invents them.
    if (!requiredFrames.includes(frame)) continue;
    const cellLeft = frame % 2 === 0 ? 0 : splitX;
    const cellTop = frame < 2 ? 0 : splitY;
    const width = frame % 2 === 0 ? splitX : info.width - splitX;
    const height = frame < 2 ? splitY : info.height - splitY;
    const cell = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      const start = ((y + cellTop) * info.width + cellLeft) * 4;
      data.copy(cell, y * width * 4, start, start + width * 4);
    }
    let left = width,
      top = height,
      right = -1,
      bottom = -1,
      visible = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (cell[(y * width + x) * 4 + 3]! < 16) continue;
        visible++;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    if (visible < width * height * 0.005)
      throw new DomainError(
        'IMAGE_QUALITY',
        `Sprite frame ${frame} has no visible subject. Generate the requested subject with clear margins.`,
      );
    if (visible > width * height * 0.85)
      throw new DomainError(
        'IMAGE_QUALITY',
        `Sprite frame ${frame} lacks a clean removable matte.`,
      );
    if (left < 2 || top < 2 || right >= width - 2 || bottom >= height - 2)
      throw new DomainError(
        'IMAGE_QUALITY',
        `Sprite frame ${frame} is clipped at its boundary. Generate a complete isolated subject with clear margins.`,
      );
    const illustration = await sharp(cell, { raw: { width, height, channels: 4 } })
      .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
      .resize(480, 480, {
        fit: 'contain',
        background: '#00000000',
        kernel: pixelArt ? 'nearest' : 'lanczos3',
      })
      .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#00000000' })
      .png()
      .toBuffer();
    frames.push({ input: illustration, left: (frame % 2) * 512, top: Math.floor(frame / 2) * 512 });
  }
  return new Uint8Array(
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: '#00000000',
      },
    })
      .composite(frames)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
}

function removeMatte(data: Buffer, width: number, height: number): void {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0,
    tail = 0;
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (visited[i]) return;
    visited[i] = 1;
    const p = i * 4,
      r = data[p]!,
      g = data[p + 1]!,
      b = data[p + 2]!;
    if (data[p + 3]! < 16 || (r > 145 && b > 145 && Math.min(r, b) - g > 75)) {
      data[p + 3] = 0;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (head < tail) {
    const i = queue[head++]!,
      x = i % width,
      y = Math.floor(i / width);
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  // Remove magenta spill adjacent to transparency, keeping enclosed details.
  for (let pass = 0; pass < 2; pass++) {
    const fringe: number[] = [];
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x,
          p = i * 4;
        if (data[p + 3]! < 16 || Math.min(data[p]!, data[p + 2]!) - data[p + 1]! <= 25) continue;
        if ([i - 1, i + 1, i - width, i + width].some((n) => data[n * 4 + 3]! < 16))
          fringe.push(p + 3);
      }
    for (const alpha of fringe) data[alpha] = 0;
  }
}

function findGutter(data: Buffer, width: number, height: number, axis: 'x' | 'y'): number {
  const size = axis === 'x' ? width : height;
  const occupied = new Uint8Array(size);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]! >= 16) occupied[axis === 'x' ? x : y] = 1;
  const midpoint = Math.floor(size / 2);
  // Bound the adjustment to 1/8 of the sheet; distant or interleaved layouts
  // cannot silently reassign subjects to different roles. Require margins on
  // both sides of the cut, not just a single transparent scan line.
  for (let distance = 0; distance <= Math.floor(size / 8); distance++)
    for (const split of distance === 0 ? [midpoint] : [midpoint - distance, midpoint + distance])
      if ([split - 2, split - 1, split, split + 1].every((i) => occupied[i] === 0)) return split;
  throw new DomainError(
    'IMAGE_QUALITY',
    `Sprite sheet has no clear ${axis === 'x' ? 'vertical' : 'horizontal'} gutter near its center. Generate separate subjects in a 2 by 2 layout with clear margins.`,
  );
}
