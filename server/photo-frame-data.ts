import type {Pool, QueryResultRow} from 'pg';

import type {SanitizedPhoto} from './photo-storage.js';

interface OwnershipRow extends QueryResultRow {
  item_key: string;
  item_type: string;
}

interface ReplacedPhotoRow extends QueryResultRow {
  owned_itemid: string | number;
  object_key: string;
  width: string | number;
  height: string | number;
  byte_size: string | number;
  content_sha256: string;
  revision: string | number;
  old_object_key: string | null;
}

export interface ReplacedPhotoFrameImage {
  ownedItemId: string;
  objectKey: string;
  width: number;
  height: number;
  byteSize: number;
  contentSha256: string;
  revision: string;
  oldObjectKey: string | null;
}

export class PhotoFrameNotOwnedError extends Error {}
export class PhotoFrameWrongTypeError extends Error {}

function parsePositiveBigint(value: string | number, fieldName: string): string {
  const parsed = String(value);
  if (!/^[1-9]\d*$/.test(parsed)) {
    throw new Error(`${fieldName} was not a positive BIGINT`);
  }
  return parsed;
}

function parsePositiveInteger(value: string | number, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} was not a positive integer`);
  }
  return parsed;
}

export async function assertPhotoFrameOwned(
  pool: Pool,
  userId: string,
  ownedItemId: string,
): Promise<void> {
  const result = await pool.query<OwnershipRow>(
    `SELECT owned.item_key, catalog.item_type
       FROM public.web_owned_board_items AS owned
       JOIN public.web_board_shop_catalog AS catalog
         ON catalog.item_key = owned.item_key
      WHERE owned.owned_itemid = $2::bigint
        AND owned.userid = $1::bigint`,
    [userId, ownedItemId],
  );
  if (result.rows.length === 0) {
    throw new PhotoFrameNotOwnedError('Photo Frame was not found for the current user');
  }
  if (result.rows[0].item_key !== 'photo-frame'
    || result.rows[0].item_type !== 'photo_frame') {
    throw new PhotoFrameWrongTypeError('Owned item is not a Photo Frame');
  }
}

export async function replacePhotoFrameImage(
  pool: Pool,
  userId: string,
  ownedItemId: string,
  objectKey: string,
  photo: SanitizedPhoto,
  expectedRevision: string,
): Promise<ReplacedPhotoFrameImage> {
  const result = await pool.query<ReplacedPhotoRow>(
    `SELECT owned_itemid,
            object_key,
            width,
            height,
            byte_size,
            content_sha256,
            revision,
            old_object_key
       FROM public.web_replace_photo_frame_image(
         $1::bigint,
         $2::bigint,
         $3::text,
         $4::integer,
         $5::integer,
         $6::bigint,
         $7::text,
         $8::bigint
       )`,
    [
      ownedItemId,
      userId,
      objectKey,
      photo.width,
      photo.height,
      photo.byteSize,
      photo.contentSha256,
      expectedRevision,
    ],
  );
  if (result.rows.length !== 1) {
    throw new Error('Photo Frame replacement returned an invalid row count');
  }
  const row = result.rows[0];
  return {
    ownedItemId: parsePositiveBigint(row.owned_itemid, 'owned_itemid'),
    objectKey: row.object_key,
    width: parsePositiveInteger(row.width, 'width'),
    height: parsePositiveInteger(row.height, 'height'),
    byteSize: parsePositiveInteger(row.byte_size, 'byte_size'),
    contentSha256: row.content_sha256,
    revision: parsePositiveBigint(row.revision, 'revision'),
    oldObjectKey: row.old_object_key,
  };
}
