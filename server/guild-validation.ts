const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVITE_PATTERN = /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)([A-Za-z0-9-]{2,64})$/;
const INVISIBLE_TAG_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export const MAX_GUILD_TAGS = 5;
export const MAX_GUILD_TAG_LENGTH = 24;

export interface GuildPublicationInput {
  slug: string;
  isPublic: boolean;
  inviteCode: string | null;
  tags: string[];
}

export class GuildPublicationValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactProperties(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}

export function parseGuildId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new GuildPublicationValidationError('guildid must be a positive decimal string');
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new GuildPublicationValidationError('guildid was invalid');
  }
  if (parsed > MAX_SIGNED_BIGINT) {
    throw new GuildPublicationValidationError('guildid exceeds PostgreSQL BIGINT');
  }
  return value;
}

export function parseGuildSlug(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 3
    || value.length > 64
    || !SLUG_PATTERN.test(value)) {
    throw new GuildPublicationValidationError('slug must be canonical lowercase ASCII');
  }
  return value;
}

export function parseDiscordInvite(value: unknown): string | null {
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new GuildPublicationValidationError('invite must be a canonical Discord URL');
  }
  const match = INVITE_PATTERN.exec(value);
  if (!match) {
    throw new GuildPublicationValidationError('invite must be a canonical Discord URL');
  }
  return match[1];
}

export function parseGuildTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_GUILD_TAGS) {
    throw new GuildPublicationValidationError('tags must contain at most five values');
  }
  const tags = value.map((candidate) => {
    if (typeof candidate !== 'string') {
      throw new GuildPublicationValidationError('tag must be plain text');
    }
    const tag = candidate.trim().normalize('NFC');
    const visibleLength = [...tag].length;
    if (visibleLength < 1
      || visibleLength > MAX_GUILD_TAG_LENGTH
      || INVISIBLE_TAG_CHARACTER.test(tag)) {
      throw new GuildPublicationValidationError('tag must contain 1 to 24 visible characters');
    }
    return tag;
  });
  const comparisonKeys = new Set<string>();
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (comparisonKeys.has(key)) {
      throw new GuildPublicationValidationError('tags must be unique case-insensitively');
    }
    comparisonKeys.add(key);
  }
  return tags;
}

export function parseGuildPublicationBody(value: unknown): GuildPublicationInput {
  if (!isRecord(value)
    || !hasExactProperties(value, ['invite', 'isPublic', 'slug', 'tags'])
    || typeof value.isPublic !== 'boolean') {
    throw new GuildPublicationValidationError('publication body was invalid');
  }
  return {
    slug: parseGuildSlug(value.slug),
    isPublic: value.isPublic,
    inviteCode: parseDiscordInvite(value.invite),
    tags: parseGuildTags(value.tags),
  };
}
