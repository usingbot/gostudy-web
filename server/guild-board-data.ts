import type {Pool, QueryResultRow} from 'pg';

import {
  discordEmojiAssetUrl,
  discordStickerAssetUrl,
} from './guild-data.js';
import {
  isGuildBoardTheme,
  isGuildBoardCapacity,
  type GuildBoardAssetPlacementInput,
  type GuildBoardCapacityInput,
  type GuildBoardDeleteInput,
  type GuildBoardLayerInput,
  type GuildBoardObjectGeometryInput,
  type GuildBoardThemeInput,
  type GuildBoardTheme,
} from './guild-board-validation.js';

export const DEFAULT_GUILD_BOARD_THEME: GuildBoardTheme = 'midnight';
export const DEFAULT_GUILD_BOARD_WIDTH = 3000;
export const DEFAULT_GUILD_BOARD_HEIGHT = 1800;

type GuildBoardAssetKind = 'emoji' | 'sticker';

interface GuildBoardRow extends QueryResultRow {
  theme_key: unknown;
  width_units: unknown;
  height_units: unknown;
  revision: unknown;
  objectid?: unknown;
  asset_kind?: unknown;
  asset_id?: unknown;
  x_units?: unknown;
  y_units?: unknown;
  size_units?: unknown;
  rotation_degrees?: unknown;
  z_index?: unknown;
  asset_available?: unknown;
  emoji_animated?: unknown;
  sticker_format_type?: unknown;
}

interface EmojiAssetRow extends QueryResultRow {
  asset_id: unknown;
  name: unknown;
  animated: unknown;
}

interface StickerAssetRow extends QueryResultRow {
  asset_id: unknown;
  name: unknown;
  format_type: unknown;
}

export interface GuildBoardObjectGeometry {
  x: number;
  y: number;
  size: number;
  rotation: number;
  zIndex: string;
}

export interface PublicGuildBoardObject extends GuildBoardObjectGeometry {
  id: string;
  kind: GuildBoardAssetKind;
  url: string;
}

export interface AdminGuildBoardObject extends GuildBoardObjectGeometry {
  id: string;
  kind: GuildBoardAssetKind;
  assetId: string;
  url: string | null;
  available: boolean;
}

export interface PublicGuildBoard {
  theme: GuildBoardTheme;
  width: number;
  height: number;
  revision: string;
  objects: PublicGuildBoardObject[];
}

export interface AdminGuildBoard {
  theme: GuildBoardTheme;
  width: number;
  height: number;
  revision: string;
  objects: AdminGuildBoardObject[];
}

export interface GuildBoardEmojiAsset {
  id: string;
  name: string;
  animated: boolean;
  url: string;
}

export interface GuildBoardStickerAsset {
  id: string;
  name: string;
  formatType: number;
  url: string;
}

export interface GuildBoardAssets {
  emojis: GuildBoardEmojiAsset[];
  stickers: GuildBoardStickerAsset[];
}

const BOARD_OBJECT_SELECT = `
       board.theme_key,
       board.width_units,
       board.height_units,
       board.revision,
       board_object.objectid,
       board_object.asset_kind,
       board_object.asset_id,
       board_object.x_units,
       board_object.y_units,
       board_object.size_units,
       board_object.rotation_degrees,
       board_object.z_index,
       COALESCE(
         CASE board_object.asset_kind
           WHEN 'emoji' THEN emoji.available
           WHEN 'sticker' THEN sticker.available
           ELSE FALSE
         END,
         FALSE
       ) AS asset_available,
       emoji.animated AS emoji_animated,
       sticker.format_type AS sticker_format_type`;

const BOARD_OBJECT_JOINS = `
  LEFT JOIN public.web_guild_boards AS board
    ON board.guildid = guild.guildid
  LEFT JOIN public.web_guild_board_objects AS board_object
    ON board_object.guildid = board.guildid
  LEFT JOIN public.gostudy_guild_emojis AS emoji
    ON board_object.asset_kind = 'emoji'
   AND emoji.emojiid = board_object.asset_id
   AND emoji.guildid = guild.guildid
  LEFT JOIN public.gostudy_guild_stickers AS sticker
    ON board_object.asset_kind = 'sticker'
   AND sticker.stickerid = board_object.asset_id
   AND sticker.guildid = guild.guildid`;

function readRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('Database guild board revision was invalid');
  }
  return value;
}

function readPositiveBigint(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`Database ${fieldName} was invalid`);
  }
  return value;
}

function readInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Database ${fieldName} was invalid`);
  }
  return value;
}

function readRotation(value: unknown): number {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error('Database guild board object rotation was invalid');
  }
  const rotation = Number(value);
  if (!Number.isFinite(rotation) || rotation < -180 || rotation > 180) {
    throw new Error('Database guild board object rotation was invalid');
  }
  return rotation;
}

function readAssetKind(value: unknown): GuildBoardAssetKind {
  if (value !== 'emoji' && value !== 'sticker') {
    throw new Error('Database guild board object asset kind was invalid');
  }
  return value;
}

function readName(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Database ${fieldName} was invalid`);
  }
  return value;
}

function mapBoardState(row: GuildBoardRow): Omit<AdminGuildBoard, 'objects'> {
  if (row.theme_key === null
    && row.width_units === null
    && row.height_units === null
    && row.revision === null) {
    return {
      theme: DEFAULT_GUILD_BOARD_THEME,
      width: DEFAULT_GUILD_BOARD_WIDTH,
      height: DEFAULT_GUILD_BOARD_HEIGHT,
      revision: '0',
    };
  }
  if (!isGuildBoardTheme(row.theme_key)) {
    throw new Error('Database guild board theme was invalid');
  }
  if (!isGuildBoardCapacity(row.width_units, row.height_units)) {
    throw new Error('Database guild board capacity was invalid');
  }
  return {
    theme: row.theme_key,
    width: row.width_units as number,
    height: row.height_units as number,
    revision: readRevision(row.revision),
  };
}

function mapAdminObject(row: GuildBoardRow): AdminGuildBoardObject {
  const id = readPositiveBigint(row.objectid, 'guild board object ID');
  const assetId = readPositiveBigint(row.asset_id, 'guild board asset ID');
  const kind = readAssetKind(row.asset_kind);
  if (typeof row.asset_available !== 'boolean') {
    throw new Error('Database guild board asset availability was invalid');
  }

  let url: string | null = null;
  let available = row.asset_available;
  if (kind === 'emoji') {
    if (available && typeof row.emoji_animated === 'boolean') {
      url = discordEmojiAssetUrl(assetId, row.emoji_animated);
    } else {
      available = false;
    }
  } else {
    const formatType = row.sticker_format_type;
    if (available && typeof formatType === 'number' && Number.isSafeInteger(formatType)) {
      url = discordStickerAssetUrl(assetId, formatType);
    }
    if (!url) available = false;
  }

  return {
    id,
    kind,
    assetId,
    url,
    available,
    x: readInteger(row.x_units, 'guild board object x'),
    y: readInteger(row.y_units, 'guild board object y'),
    size: readInteger(row.size_units, 'guild board object size'),
    rotation: readRotation(row.rotation_degrees),
    zIndex: readPositiveBigint(row.z_index, 'guild board object z-index'),
  };
}

function mapAdminBoard(rows: GuildBoardRow[]): AdminGuildBoard {
  if (!rows[0]) throw new Error('Database guild board query returned no row');
  return {
    ...mapBoardState(rows[0]),
    objects: rows
      .filter((row) => row.objectid !== null && row.objectid !== undefined)
      .map(mapAdminObject),
  };
}

function mapPublicBoard(rows: GuildBoardRow[]): PublicGuildBoard {
  const adminBoard = mapAdminBoard(rows);
  return {
    ...mapBoardState(rows[0]),
    objects: adminBoard.objects.flatMap((object) => object.available && object.url
      ? [{
          id: object.id,
          kind: object.kind,
          url: object.url,
          x: object.x,
          y: object.y,
          size: object.size,
          rotation: object.rotation,
          zIndex: object.zIndex,
        }]
      : []),
  };
}

export async function getPublicGuildBoard(
  pool: Pool,
  slug: string,
): Promise<PublicGuildBoard | null> {
  const result = await pool.query<GuildBoardRow>(
    `SELECT ${BOARD_OBJECT_SELECT}
       FROM public.gostudy_guilds AS guild
       JOIN public.web_guild_publications AS publication
         ON publication.guildid = guild.guildid
       ${BOARD_OBJECT_JOINS}
      WHERE guild.active = TRUE
        AND publication.is_public = TRUE
        AND publication.slug = $1::text
      ORDER BY board_object.z_index, board_object.objectid`,
    [slug],
  );
  return result.rows[0] ? mapPublicBoard(result.rows) : null;
}

export async function getAdminGuildBoard(
  pool: Pool,
  guildId: string,
): Promise<AdminGuildBoard | null> {
  const result = await pool.query<GuildBoardRow>(
    `SELECT ${BOARD_OBJECT_SELECT}
       FROM public.gostudy_guilds AS guild
       ${BOARD_OBJECT_JOINS}
      WHERE guild.active = TRUE
        AND guild.guildid = $1::bigint
      ORDER BY board_object.z_index, board_object.objectid`,
    [guildId],
  );
  return result.rows[0] ? mapAdminBoard(result.rows) : null;
}

export async function getGuildBoardAssets(
  pool: Pool,
  guildId: string,
): Promise<GuildBoardAssets> {
  const [emojiResult, stickerResult] = await Promise.all([
    pool.query<EmojiAssetRow>(
      `SELECT emoji.emojiid AS asset_id,
              emoji.name,
              emoji.animated
         FROM public.gostudy_guilds AS guild
         JOIN public.gostudy_guild_emojis AS emoji
           ON emoji.guildid = guild.guildid
        WHERE guild.guildid = $1::bigint
          AND guild.active = TRUE
          AND emoji.available = TRUE
        ORDER BY pg_catalog.lower(emoji.name), emoji.emojiid`,
      [guildId],
    ),
    pool.query<StickerAssetRow>(
      `SELECT sticker.stickerid AS asset_id,
              sticker.name,
              sticker.format_type
         FROM public.gostudy_guilds AS guild
         JOIN public.gostudy_guild_stickers AS sticker
           ON sticker.guildid = guild.guildid
        WHERE guild.guildid = $1::bigint
          AND guild.active = TRUE
          AND sticker.available = TRUE
          AND sticker.format_type IN (1, 2, 4)
        ORDER BY pg_catalog.lower(sticker.name), sticker.stickerid`,
      [guildId],
    ),
  ]);

  return {
    emojis: emojiResult.rows.map((row) => {
      const id = readPositiveBigint(row.asset_id, 'emoji ID');
      if (typeof row.animated !== 'boolean') {
        throw new Error('Database emoji animation state was invalid');
      }
      return {
        id,
        name: readName(row.name, 'emoji name'),
        animated: row.animated,
        url: discordEmojiAssetUrl(id, row.animated),
      };
    }),
    stickers: stickerResult.rows.map((row) => {
      const id = readPositiveBigint(row.asset_id, 'sticker ID');
      const formatType = readInteger(row.format_type, 'sticker format type');
      const url = discordStickerAssetUrl(id, formatType);
      if (!url) throw new Error('Database sticker format was not renderable');
      return {
        id,
        name: readName(row.name, 'sticker name'),
        formatType,
        url,
      };
    }),
  };
}

async function readCanonicalBoardAfterMutation(
  pool: Pool,
  guildId: string,
): Promise<AdminGuildBoard> {
  const board = await getAdminGuildBoard(pool, guildId);
  if (!board) throw new Error('Guild board mutation returned an inactive or missing board');
  return board;
}

async function runGuildBoardMutation(
  pool: Pool,
  guildId: string,
  text: string,
  values: unknown[],
): Promise<AdminGuildBoard> {
  const result = await pool.query<{board_revision: unknown} & QueryResultRow>(text, values);
  if (!result.rows[0] || typeof result.rows[0].board_revision !== 'string') {
    throw new Error('Guild board mutation returned no canonical revision');
  }
  return readCanonicalBoardAfterMutation(pool, guildId);
}

export async function upsertGuildBoardTheme(
  pool: Pool,
  guildId: string,
  actorUserId: string,
  input: GuildBoardThemeInput,
): Promise<AdminGuildBoard> {
  return runGuildBoardMutation(
    pool,
    guildId,
    `SELECT board.revision AS board_revision
       FROM public.web_upsert_guild_board_theme(
         $1::bigint,
         $2::text,
         $3::bigint,
         $4::bigint
       ) AS board`,
    [guildId, input.theme, input.expectedRevision, actorUserId],
  );
}

export async function expandGuildBoard(
  pool: Pool,
  guildId: string,
  actorUserId: string,
  input: GuildBoardCapacityInput,
): Promise<AdminGuildBoard> {
  return runGuildBoardMutation(
    pool,
    guildId,
    `SELECT board.revision AS board_revision
       FROM public.web_expand_guild_board(
         $1::bigint,
         $2::integer,
         $3::integer,
         $4::bigint,
         $5::bigint
       ) AS board`,
    [guildId, input.width, input.height, input.expectedRevision, actorUserId],
  );
}

export async function addGuildBoardAsset(
  pool: Pool,
  guildId: string,
  actorUserId: string,
  input: GuildBoardAssetPlacementInput,
): Promise<AdminGuildBoard> {
  return runGuildBoardMutation(
    pool,
    guildId,
    `SELECT mutation.board_revision
       FROM public.web_add_guild_board_asset(
         $1::bigint,
         $2::text,
         $3::bigint,
         $4::integer,
         $5::integer,
         $6::integer,
         $7::numeric,
         $8::bigint,
         $9::bigint
       ) AS mutation`,
    [
      guildId,
      input.assetKind,
      input.assetId,
      input.x,
      input.y,
      input.size,
      input.rotation,
      input.expectedRevision,
      actorUserId,
    ],
  );
}

export async function updateGuildBoardObject(
  pool: Pool,
  guildId: string,
  objectId: string,
  actorUserId: string,
  input: GuildBoardObjectGeometryInput,
): Promise<AdminGuildBoard> {
  return runGuildBoardMutation(
    pool,
    guildId,
    `SELECT mutation.board_revision
       FROM public.web_update_guild_board_object(
         $1::bigint,
         $2::bigint,
         $3::integer,
         $4::integer,
         $5::integer,
         $6::numeric,
         $7::bigint,
         $8::bigint
       ) AS mutation`,
    [
      guildId,
      objectId,
      input.x,
      input.y,
      input.size,
      input.rotation,
      input.expectedRevision,
      actorUserId,
    ],
  );
}

export async function deleteGuildBoardObject(
  pool: Pool,
  guildId: string,
  objectId: string,
  actorUserId: string,
  input: GuildBoardDeleteInput,
): Promise<AdminGuildBoard> {
  return runGuildBoardMutation(
    pool,
    guildId,
    `SELECT mutation.board_revision
       FROM public.web_delete_guild_board_object(
         $1::bigint,
         $2::bigint,
         $3::bigint,
         $4::bigint
       ) AS mutation`,
    [guildId, objectId, input.expectedRevision, actorUserId],
  );
}

export async function reorderGuildBoardObject(
  pool: Pool,
  guildId: string,
  objectId: string,
  actorUserId: string,
  input: GuildBoardLayerInput,
): Promise<AdminGuildBoard> {
  return runGuildBoardMutation(
    pool,
    guildId,
    `SELECT mutation.board_revision
       FROM public.web_reorder_guild_board_object(
         $1::bigint,
         $2::bigint,
         $3::text,
         $4::bigint,
         $5::bigint
       ) AS mutation`,
    [guildId, objectId, input.action, input.expectedRevision, actorUserId],
  );
}
