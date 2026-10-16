import { unzipSync, strFromU8 } from 'fflate';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { ed25519 } from '@noble/curves/ed25519';
import { manifestSchema, type Manifest } from '../../contracts/src/index.ts';
export const PACKAGE_LIMIT = 30 * 1024 * 1024;
export const allowedExtensions = new Set([
  'html',
  'js',
  'css',
  'json',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'woff2',
  'mp3',
  'ogg',
  'wav',
]);
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function validPath(path: string): boolean {
  return (
    path.length <= 180 &&
    /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) &&
    !path.split('/').some((p) => p === '.' || p === '..' || p === '') &&
    !path.includes('\\') &&
    allowedExtensions.has(path.split('.').pop() ?? '')
  );
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function hash(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}
export function unsignedManifest(manifest: Manifest): string {
  const { signature: _signature, ...body } = manifest;
  return canonical(body);
}
// Preflight the central directory BEFORE allocating/decompressing any entries.
export function preflightZip(zip: Uint8Array): void {
  if (zip.byteLength > PACKAGE_LIMIT || zip.byteLength < 22)
    throw new Error('Invalid package size.');
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (
    end < 0 ||
    v.getUint16(end + 4, true) !== 0 ||
    v.getUint16(end + 6, true) !== 0 ||
    end + 22 + v.getUint16(end + 20, true) !== zip.length
  )
    throw new Error('Invalid ZIP directory.');
  const count = v.getUint16(end + 10, true),
    directory = v.getUint32(end + 16, true),
    size = v.getUint32(end + 12, true);
  if (count < 1 || count > 257 || v.getUint16(end + 8, true) !== count || directory + size !== end)
    throw new Error('ZIP entry limit or directory mismatch.');
  let offset = directory,
    total = 0;
  const names = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || v.getUint32(offset, true) !== 0x02014b50)
      throw new Error('Malformed ZIP entry.');
    const compressed = v.getUint32(offset + 20, true),
      expanded = v.getUint32(offset + 24, true),
      nameLength = v.getUint16(offset + 28, true),
      extra = v.getUint16(offset + 30, true),
      comment = v.getUint16(offset + 32, true),
      attrs = v.getUint32(offset + 38, true),
      local = v.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extra + comment > end) throw new Error('Truncated ZIP entry.');
    const name = strFromU8(zip.subarray(offset + 46, offset + 46 + nameLength));
    if (
      !validPath(name) ||
      names.has(name) ||
      ((attrs >>> 16) & 0xf000) === 0xa000 ||
      v.getUint16(offset + 8, true) & 1 ||
      ![0, 8].includes(v.getUint16(offset + 10, true))
    )
      throw new Error('Unsafe ZIP entry.');
    if (
      expanded > 10 * 1024 * 1024 ||
      (expanded > 1024 * 1024 && expanded > compressed * 200) ||
      (total += expanded) > PACKAGE_LIMIT
    )
      throw new Error('Decompression limit exceeded.');
    if (local + 30 > directory || v.getUint32(local, true) !== 0x04034b50)
      throw new Error('Invalid local ZIP header.');
    const ln = v.getUint16(local + 26, true),
      le = v.getUint16(local + 28, true);
    if (
      strFromU8(zip.subarray(local + 30, local + 30 + ln)) !== name ||
      local + 30 + ln + le + compressed > directory
    )
      throw new Error('ZIP header mismatch.');
    const range = { start: local, end: local + 30 + ln + le + compressed };
    if (ranges.some((r) => range.start < r.end && range.end > r.start))
      throw new Error('Overlapping ZIP entries.');
    ranges.push(range);
    names.add(name);
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end) throw new Error('ZIP directory length mismatch.');
}
export function verifyPackage(
  zip: Uint8Array,
  publicKeyHex: string,
  expected?: { gameId: string; versionId: string; checksum: string },
): { manifest: Manifest; files: Record<string, Uint8Array> } {
  preflightZip(zip);
  if (expected && hash(zip) !== expected.checksum) throw new Error('Package checksum mismatch.');
  const files = unzipSync(zip);
  const raw = files['manifest.json'];
  if (!raw || raw.byteLength > 100 * 1024) throw new Error('Manifest missing or too large.');
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(raw)));
  if (
    !ed25519.verify(
      hexToBytes(manifest.signature),
      new TextEncoder().encode(unsignedManifest(manifest)),
      hexToBytes(publicKeyHex),
    )
  )
    throw new Error('Invalid manifest signature.');
  if (
    expected &&
    (manifest.gameId !== expected.gameId || manifest.versionId !== expected.versionId)
  )
    throw new Error('Wrong game or version.');
  if (Object.keys(files).length !== manifest.assets.length + 1)
    throw new Error('Unexpected package files.');
  const names = new Set<string>();
  let total = 0;
  for (const asset of manifest.assets) {
    if (!validPath(asset.path) || asset.path === 'manifest.json' || names.has(asset.path))
      throw new Error('Invalid manifest path.');
    names.add(asset.path);
    const bytes = files[asset.path];
    if (!bytes || bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
      throw new Error(`Invalid asset: ${asset.path}`);
    total += bytes.length;
  }
  if (total !== manifest.packageSize || !names.has('index.html') || !names.has('game.js'))
    throw new Error('Incomplete game package.');
  const html = strFromU8(files['index.html']!);
  if (!html.includes(CSP)) throw new Error('Missing enforced content security policy.');
  return { manifest, files };
}
