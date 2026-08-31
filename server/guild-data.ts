import type {Pool, QueryResultRow} from 'pg';

import type {GuildPublicationInput} from './guild-validation.js';

interface GuildRow extends QueryResultRow {
  guildid: unknown;
  name: unknown;
  icon_hash: unknown;
  banner_hash: unknown;
  description: unknown;
  member_count: unknown;
  active: unknown;
  slug: unknown;
  is_public: unknown;
  invite_code: unknown;
  tags: unknown;
}

export interface GuildPublicationSettings {
  slug: string;
  isPublic: boolean;
  inviteUrl: string | null;
  tags: string[];
}

export interface GuildSummary {
  guildid: string;
  name: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  memberCount: number | null;
  active: boolean;
  publication: GuildPublicationSettings | null;
}

export interface PublicGuildSummary {
  slug: string;
  name: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  memberCount: number | null;
  inviteUrl: string | null;
  tags: string[];
}

const GUILD_SELECT = `
  SELECT guild.guildid,
         guild.name,
         guild.icon_hash,
         guild.banner_hash,
         guild.description,
         guild.member_count,
         guild.active,
         publication.slug,
         publication.is_public,
         publication.invite_code,
         COALESCE(
           array_agg(tag.tag ORDER BY tag.sort_order)
             FILTER (WHERE tag.tag IS NOT NULL),
           ARRAY[]::text[]
         ) AS tags
    FROM public.gostudy_guilds AS guild
    LEFT JOIN public.web_guild_publications AS publication
      ON publication.guildid = guild.guildid
    LEFT JOIN public.web_guild_tags AS tag
      ON tag.guildid = guild.guildid`;

const GUILD_GROUP_BY = `
   GROUP BY guild.guildid,
            guild.name,
            guild.icon_hash,
            guild.banner_hash,
            guild.description,
            guild.member_count,
            guild.active,
            publication.slug,
            publication.is_public,
            publication.invite_code`;

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Database ${fieldName} was invalid`);
  }
  return value;
}

function readNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  return readString(value, fieldName);
}

function readNullableText(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Database ${fieldName} was invalid`);
  }
  return value;
}

function readMemberCount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Database member_count was invalid');
  }
  return value;
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    throw new Error('Database guild tags were invalid');
  }
  return value as string[];
}

export function discordGuildAssetUrl(
  kind: 'icons' | 'banners',
  guildId: string,
  hash: string | null,
): string | null {
  if (!hash) return null;
  const extension = hash.startsWith('a_') ? 'gif' : 'webp';
  const size = kind === 'icons' ? '128' : '1024';
  return `https://cdn.discordapp.com/${kind}/${guildId}/${hash}.${extension}?size=${size}`;
}

export const DISCORD_RENDERABLE_STICKER_FORMATS = [1, 2, 4] as const;

export function discordEmojiAssetUrl(emojiId: string, animated: boolean): string {
  if (!/^[1-9]\d*$/.test(emojiId)) {
    throw new Error('Database emoji ID was invalid');
  }
  const extension = animated ? 'gif' : 'png';
  return `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=1024&quality=lossless`;
}

export function discordStickerAssetUrl(
  stickerId: string,
  formatType: number,
): string | null {
  if (!/^[1-9]\d*$/.test(stickerId)) {
    throw new Error('Database sticker ID was invalid');
  }
  if (formatType === 1 || formatType === 2) {
    return `https://cdn.discordapp.com/stickers/${stickerId}.png?size=320`;
  }
  if (formatType === 4) {
    return `https://media.discordapp.net/stickers/${stickerId}.gif?size=320`;
  }
  return null;
}

function mapGuild(row: GuildRow): GuildSummary {
  const guildid = readString(row.guildid, 'guildid');
  const iconHash = readNullableString(row.icon_hash, 'icon_hash');
  const bannerHash = readNullableString(row.banner_hash, 'banner_hash');
  const slug = row.slug === null ? null : readString(row.slug, 'slug');
  const inviteCode = readNullableString(row.invite_code, 'invite_code');
  if (typeof row.active !== 'boolean') {
    throw new Error('Database guild active state was invalid');
  }
  if (slug !== null && typeof row.is_public !== 'boolean') {
    throw new Error('Database guild publication state was invalid');
  }
  return {
    guildid,
    name: readString(row.name, 'guild name'),
    iconUrl: discordGuildAssetUrl('icons', guildid, iconHash),
    bannerUrl: discordGuildAssetUrl('banners', guildid, bannerHash),
    description: readNullableText(row.description, 'guild description'),
    memberCount: readMemberCount(row.member_count),
    active: row.active,
    publication: slug === null ? null : {
      slug,
      isPublic: row.is_public as boolean,
      inviteUrl: inviteCode === null ? null : `https://discord.gg/${inviteCode}`,
      tags: readTags(row.tags),
    },
  };
}

export async function getManageableGuilds(
  pool: Pool,
  manageableGuildIds: readonly string[],
  ownerOverride: boolean,
): Promise<GuildSummary[]> {
  const result = await pool.query<GuildRow>(
    `${GUILD_SELECT}
      WHERE guild.active = TRUE
        AND ($1::boolean OR guild.guildid = ANY($2::bigint[]))
      ${GUILD_GROUP_BY}
      ORDER BY lower(guild.name), guild.guildid`,
    [ownerOverride, [...manageableGuildIds]],
  );
  return result.rows.map(mapGuild);
}

export async function getGuildById(pool: Pool, guildId: string): Promise<GuildSummary | null> {
  const result = await pool.query<GuildRow>(
    `${GUILD_SELECT}
      WHERE guild.active = TRUE
        AND guild.guildid = $1::bigint
      ${GUILD_GROUP_BY}`,
    [guildId],
  );
  return result.rows[0] ? mapGuild(result.rows[0]) : null;
}

export async function upsertGuildPublication(
  pool: Pool,
  guildId: string,
  actorUserId: string,
  input: GuildPublicationInput,
): Promise<GuildSummary | null> {
  await pool.query(
    `SELECT public.web_upsert_guild_publication(
       $1::bigint,
       $2::text,
       $3::boolean,
       $4::text,
       $5::text[],
       $6::bigint
     )`,
    [guildId, input.slug, input.isPublic, input.inviteCode, input.tags, actorUserId],
  );
  return getGuildById(pool, guildId);
}

export async function getPublicGuilds(pool: Pool): Promise<PublicGuildSummary[]> {
  const result = await pool.query<GuildRow>(
    `${GUILD_SELECT}
      WHERE guild.active = TRUE
        AND publication.is_public = TRUE
      ${GUILD_GROUP_BY}
      ORDER BY lower(guild.name), guild.guildid`,
  );
  return result.rows.map(mapPublicGuild);
}

function mapPublicGuild(row: GuildRow): PublicGuildSummary {
  const guild = mapGuild(row);
  if (!guild.publication) {
    throw new Error('Public guild was missing publication settings');
  }
  return {
    slug: guild.publication.slug,
    name: guild.name,
    iconUrl: guild.iconUrl,
    bannerUrl: guild.bannerUrl,
    description: guild.description,
    memberCount: guild.memberCount,
    tags: guild.publication.tags,
    inviteUrl: guild.publication.inviteUrl,
  };
}

export async function getPublicGuildBySlug(
  pool: Pool,
  slug: string,
): Promise<PublicGuildSummary | null> {
  const result = await pool.query<GuildRow>(
    `${GUILD_SELECT}
      WHERE guild.active = TRUE
        AND publication.is_public = TRUE
        AND publication.slug = $1::text
      ${GUILD_GROUP_BY}`,
    [slug],
  );
  return result.rows[0] ? mapPublicGuild(result.rows[0]) : null;
}
