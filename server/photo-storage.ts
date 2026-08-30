import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

import type {R2Config} from './config.js';

const STORAGE_TIMEOUT_MS = 15_000;
const SIGNED_READ_EXPIRY_SECONDS = 30 * 60;

export interface SanitizedPhoto {
  bytes: Buffer;
  width: number;
  height: number;
  byteSize: number;
  contentSha256: string;
}

export interface PhotoStorage {
  putSanitizedImage(objectKey: string, photo: SanitizedPhoto): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  signReadUrl(objectKey: string): Promise<string>;
}

export class PhotoStorageError extends Error {
  constructor(
    public readonly operation: 'put' | 'delete' | 'sign',
    options?: ErrorOptions,
  ) {
    super('Photo storage operation failed', options);
  }
}

export function getR2Origin(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function createR2PhotoStorage(config: R2Config): PhotoStorage {
  const client = new S3Client({
    region: 'auto',
    endpoint: getR2Origin(config.accountId),
    // Keep presigned reads on the exact account origin allowed by the CSP.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  async function sendWithTimeout(
    operation: 'put' | 'delete',
    command: PutObjectCommand | DeleteObjectCommand,
  ): Promise<void> {
    try {
      await client.send(command, {abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS)});
    } catch (error) {
      throw new PhotoStorageError(operation, {cause: error});
    }
  }

  return {
    async putSanitizedImage(objectKey, photo) {
      await sendWithTimeout('put', new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: photo.bytes,
        ContentLength: photo.byteSize,
        ContentType: 'image/webp',
        ContentDisposition: 'inline',
        // Generated keys are unique, but never overwrite if a collision occurs.
        IfNoneMatch: '*',
        Metadata: {
          'content-sha256': photo.contentSha256,
        },
      }));
    },

    async deleteObject(objectKey) {
      await sendWithTimeout('delete', new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      }));
    },

    async signReadUrl(objectKey) {
      try {
        return await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            ResponseContentType: 'image/webp',
            ResponseContentDisposition: 'inline',
          }),
          {
            expiresIn: SIGNED_READ_EXPIRY_SECONDS,
          },
        );
      } catch (error) {
        throw new PhotoStorageError('sign', {cause: error});
      }
    },
  };
}
