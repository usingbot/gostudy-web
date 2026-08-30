import {createHash} from 'node:crypto';

import sharp from 'sharp';

import type {SanitizedPhoto} from './photo-storage.js';

export const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_DIMENSION = 1600;
export const MAX_PHOTO_INPUT_PIXELS = 24_000_000;

const ACCEPTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class PhotoImageValidationError extends Error {}

export async function normalizePhotoFrameImage(input: Buffer): Promise<SanitizedPhoto> {
  if (input.length === 0 || input.length > MAX_PHOTO_UPLOAD_BYTES) {
    throw new PhotoImageValidationError('Photo input size was invalid');
  }

  try {
    const decoder = sharp(input, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: MAX_PHOTO_INPUT_PIXELS,
    });
    const metadata = await decoder.metadata();
    if (!metadata.format || !ACCEPTED_INPUT_FORMATS.has(metadata.format)) {
      throw new PhotoImageValidationError('Photo format was unsupported');
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new PhotoImageValidationError('Animated or multi-page images are unsupported');
    }
    if (!metadata.width || !metadata.height) {
      throw new PhotoImageValidationError('Photo dimensions were invalid');
    }

    const {data, info} = await decoder
      .rotate()
      .resize({
        width: MAX_PHOTO_DIMENSION,
        height: MAX_PHOTO_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({quality: 85, effort: 4})
      .toBuffer({resolveWithObject: true});

    if (info.format !== 'webp'
      || info.width < 1
      || info.width > MAX_PHOTO_DIMENSION
      || info.height < 1
      || info.height > MAX_PHOTO_DIMENSION
      || data.length < 1
      || data.length > MAX_PHOTO_OUTPUT_BYTES) {
      throw new PhotoImageValidationError('Normalized photo output was invalid');
    }

    return {
      bytes: data,
      width: info.width,
      height: info.height,
      byteSize: data.length,
      contentSha256: createHash('sha256').update(data).digest('hex'),
    };
  } catch (error) {
    if (error instanceof PhotoImageValidationError) {
      throw error;
    }
    throw new PhotoImageValidationError('Photo could not be decoded');
  }
}
