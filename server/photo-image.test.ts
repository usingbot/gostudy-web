import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import {
  MAX_PHOTO_INPUT_PIXELS,
  MAX_PHOTO_UPLOAD_BYTES,
  normalizePhotoFrameImage,
  PhotoImageValidationError,
} from './photo-image.js';

async function solid(
  format: 'jpeg' | 'png' | 'webp',
  width = 32,
  height = 20,
): Promise<Buffer> {
  const image = sharp({
    create: {width, height, channels: 3, background: {r: 30, g: 80, b: 140}},
  });
  return image[format]().toBuffer();
}

test('JPEG, PNG, and WebP inputs always normalize to metadata-free WebP', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const normalized = await normalizePhotoFrameImage(await solid(format));
    const metadata = await sharp(normalized.bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(normalized.byteSize, normalized.bytes.length);
    assert.match(normalized.contentSha256, /^[0-9a-f]{64}$/);
  }
});

test('normalization auto-orients, bounds dimensions, preserves aspect, and never enlarges', async () => {
  const oriented = await sharp({
    create: {width: 40, height: 20, channels: 3, background: 'red'},
  }).jpeg().withMetadata({orientation: 6}).toBuffer();
  const normalizedOrientation = await normalizePhotoFrameImage(oriented);
  assert.deepEqual(
    [normalizedOrientation.width, normalizedOrientation.height],
    [20, 40],
  );
  assert.equal((await sharp(normalizedOrientation.bytes).metadata()).orientation, undefined);

  const large = await normalizePhotoFrameImage(await solid('png', 2000, 1000));
  assert.deepEqual([large.width, large.height], [1600, 800]);
  const small = await normalizePhotoFrameImage(await solid('jpeg', 20, 10));
  assert.deepEqual([small.width, small.height], [20, 10]);
});

test('SVG, GIF, corrupt bytes, fake media types, and animated images are rejected by decoding', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const gif = await sharp({
    create: {width: 10, height: 10, channels: 3, background: 'blue'},
  }).gif().toBuffer();
  for (const bytes of [svg, gif, Buffer.from('not a jpeg'), Buffer.from([0xff, 0xd8, 0xff])]) {
    await assert.rejects(normalizePhotoFrameImage(bytes), PhotoImageValidationError);
  }
});

test('upload byte and decoded pixel limits reject resource-exhaustion inputs', async () => {
  await assert.rejects(
    normalizePhotoFrameImage(Buffer.alloc(MAX_PHOTO_UPLOAD_BYTES + 1)),
    PhotoImageValidationError,
  );
  const side = Math.floor(Math.sqrt(MAX_PHOTO_INPUT_PIXELS)) + 2;
  const compressedHuge = await solid('png', side, side);
  assert(compressedHuge.length < MAX_PHOTO_UPLOAD_BYTES);
  await assert.rejects(normalizePhotoFrameImage(compressedHuge), PhotoImageValidationError);
});
