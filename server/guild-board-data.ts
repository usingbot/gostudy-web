import type {Pool, QueryResultRow} from 'pg';

import {
  isGuildBoardTheme,
  isGuildBoardCapacity,
  type GuildBoardCapacityInput,
  type GuildBoardThemeInput,
  type GuildBoardTheme,
} from './guild-board-validation.js';


export const DEFAULT_GUILD_BOARD_THEME: GuildBoardTheme = 'midnight';
export const DEFAULT_GUILD_BOARD_WIDTH = 3000;
export const DEFAULT_GUILD_BOARD_HEIGHT = 1800;

interface GuildBoardRow extends QueryResultRow {
  theme_key: unknown;
  width_units: unknown;
  height_units: unknown;
  revision: unknown;
}

export interface PublicGuildBoard {
  theme: GuildBoardTheme;
  width: number;
  height: number;
  revision: string;
  objects: Record<string, unknown>[];
}

export interface AdminGuildBoard {
  theme: GuildBoardTheme;
  width: number;
  height: number;
  revision: string;
}

function readRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('Database guild board revision was invalid');
  }
  return value;
}

function mapBoard(row: GuildBoardRow): AdminGuildBoard {
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

export async function getPublicGuildBoard(
  pool: Pool,
  slug: string,
): Promise<PublicGuildBoard | null> {
  const result = await pool.query<GuildBoardRow>(
    `SELECT board.theme_key,
            board.width_units,
            board.height_units,
            board.revision
       FROM public.gostudy_guilds AS guild
       JOIN public.web_guild_publications AS publication
         ON publication.guildid = guild.guildid
       LEFT JOIN public.web_guild_boards AS board
         ON board.guildid = guild.guildid
      WHERE guild.active = TRUE
        AND publication.is_public = TRUE
        AND publication.slug = $1::text`,
    [slug],
  );
  if (!result.rows[0]) return null;
  return {...mapBoard(result.rows[0]), objects: []};
}

export async function getAdminGuildBoard(
  pool: Pool,
  guildId: string,
): Promise<AdminGuildBoard | null> {
  const result = await pool.query<GuildBoardRow>(
    `SELECT board.theme_key,
            board.width_units,
            board.height_units,
            board.revision
       FROM public.gostudy_guilds AS guild
       LEFT JOIN public.web_guild_boards AS board
         ON board.guildid = guild.guildid
      WHERE guild.active = TRUE
        AND guild.guildid = $1::bigint`,
    [guildId],
  );
  return result.rows[0] ? mapBoard(result.rows[0]) : null;
}

export async function upsertGuildBoardTheme(
  pool: Pool,
  guildId: string,
  actorUserId: string,
  input: GuildBoardThemeInput,
): Promise<AdminGuildBoard> {
  const result = await pool.query<GuildBoardRow>(
    `SELECT board.theme_key,
            board.width_units,
            board.height_units,
            board.revision
       FROM public.web_upsert_guild_board_theme(
         $1::bigint,
         $2::text,
         $3::bigint,
         $4::bigint
       ) AS board`,
    [guildId, input.theme, input.expectedRevision, actorUserId],
  );
  if (!result.rows[0]) {
    throw new Error('Guild board mutation returned no row');
  }
  return mapBoard(result.rows[0]);
}

export async function expandGuildBoard(
  pool: Pool,
  guildId: string,
  actorUserId: string,
  input: GuildBoardCapacityInput,
): Promise<AdminGuildBoard> {
  const result = await pool.query<GuildBoardRow>(
    `SELECT board.theme_key,
            board.width_units,
            board.height_units,
            board.revision
       FROM public.web_expand_guild_board(
         $1::bigint,
         $2::integer,
         $3::integer,
         $4::bigint,
         $5::bigint
       ) AS board`,
    [guildId, input.width, input.height, input.expectedRevision, actorUserId],
  );
  if (!result.rows[0]) {
    throw new Error('Guild board capacity mutation returned no row');
  }
  return mapBoard(result.rows[0]);
}
