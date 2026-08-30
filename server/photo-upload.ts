import Busboy from 'busboy';
import type {Request} from 'express';

import {MAX_PHOTO_UPLOAD_BYTES} from './photo-image.js';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export interface ParsedPhotoUpload {
  bytes: Buffer;
  expectedRevision: string;
}

export class PhotoUploadValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_MULTIPART' | 'INVALID_REVISION' | 'FILE_TOO_LARGE',
  ) {
    super(message);
  }
}

export function parseExpectedPhotoRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value) || value.length > 19) {
    throw new PhotoUploadValidationError('Photo revision was invalid', 'INVALID_REVISION');
  }
  if (BigInt(value) > MAX_POSTGRES_BIGINT) {
    throw new PhotoUploadValidationError('Photo revision was outside BIGINT range', 'INVALID_REVISION');
  }
  return value;
}

export function parseSinglePhotoUpload(request: Request): Promise<ParsedPhotoUpload> {
  const expectedRevision = parseExpectedPhotoRevision(request.get('X-Photo-Revision'));

  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fieldNameSize: 64,
          fieldSize: 1,
          fields: 0,
          // Busboy emits `limit` when the configured byte is reached, so use
          // one sentinel byte to allow an exact 5 MiB file and reject above it.
          fileSize: MAX_PHOTO_UPLOAD_BYTES + 1,
          files: 1,
          // Busboy emits partsLimit when the configured count is reached.
          // Two means the first part is accepted and any second part is rejected.
          parts: 2,
          headerPairs: 50,
        },
      });
    } catch {
      reject(new PhotoUploadValidationError('Multipart body was invalid', 'INVALID_MULTIPART'));
      return;
    }

    const chunks: Buffer[] = [];
    let fileCount = 0;
    let byteCount = 0;
    let validationError: PhotoUploadValidationError | null = null;
    let settled = false;

    const fail = (error: PhotoUploadValidationError) => {
      validationError ??= error;
    };

    parser.on('file', (fieldName, stream) => {
      fileCount += 1;
      if (fieldName !== 'image' || fileCount !== 1) {
        fail(new PhotoUploadValidationError('Exactly one image file is required', 'INVALID_MULTIPART'));
      }
      stream.on('limit', () => {
        fail(new PhotoUploadValidationError('Photo file exceeded 5 MiB', 'FILE_TOO_LARGE'));
      });
      stream.on('data', (chunk: Buffer) => {
        byteCount += chunk.length;
        if (byteCount <= MAX_PHOTO_UPLOAD_BYTES) {
          chunks.push(chunk);
        }
      });
      stream.on('error', () => {
        fail(new PhotoUploadValidationError('Multipart file stream failed', 'INVALID_MULTIPART'));
      });
    });
    parser.on('field', () => {
      fail(new PhotoUploadValidationError('Unexpected multipart field', 'INVALID_MULTIPART'));
    });
    parser.on('filesLimit', () => {
      fail(new PhotoUploadValidationError('Multiple files are not allowed', 'INVALID_MULTIPART'));
    });
    parser.on('fieldsLimit', () => {
      fail(new PhotoUploadValidationError('Multipart fields are not allowed', 'INVALID_MULTIPART'));
    });
    parser.on('partsLimit', () => {
      fail(new PhotoUploadValidationError('Unexpected multipart part', 'INVALID_MULTIPART'));
    });
    parser.on('error', () => {
      fail(new PhotoUploadValidationError('Multipart body was invalid', 'INVALID_MULTIPART'));
    });
    parser.on('close', () => {
      if (settled) return;
      settled = true;
      if (validationError) {
        reject(validationError);
        return;
      }
      if (fileCount !== 1 || byteCount === 0) {
        reject(new PhotoUploadValidationError('Exactly one non-empty image is required', 'INVALID_MULTIPART'));
        return;
      }
      resolve({bytes: Buffer.concat(chunks, byteCount), expectedRevision});
    });
    request.once('aborted', () => {
      if (!settled) {
        settled = true;
        reject(new PhotoUploadValidationError('Upload was aborted', 'INVALID_MULTIPART'));
      }
    });
    request.pipe(parser);
  });
}
