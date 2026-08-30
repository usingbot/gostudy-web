const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export const GUILD_BOARD_THEMES = [
  'midnight',
  'mint',
  'cork',
  'paper',
] as const;

export type GuildBoardTheme = typeof GUILD_BOARD_THEMES[number];

export const GUILD_BOARD_CAPACITIES = [
  {key: 'starter', width: 3000, height: 1800},
  {key: 'expanded', width: 4500, height: 2700},
  {key: 'large', width: 6000, height: 3600},
  {key: 'mega', width: 9000, height: 5400},
] as const;

export interface GuildBoardThemeInput {
  theme: GuildBoardTheme;
  expectedRevision: string;
}

export interface GuildBoardCapacityInput {
  width: number;
  height: number;
  expectedRevision: string;
}

export class GuildBoardValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactProperties(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

export function isGuildBoardTheme(value: unknown): value is GuildBoardTheme {
  return typeof value === 'string'
    && (GUILD_BOARD_THEMES as readonly string[]).includes(value);
}

export function isGuildBoardCapacity(width: unknown, height: unknown): boolean {
  return typeof width === 'number'
    && Number.isInteger(width)
    && typeof height === 'number'
    && Number.isInteger(height)
    && GUILD_BOARD_CAPACITIES.some(
      (capacity) => capacity.width === width && capacity.height === height,
    );
}

export function parseGuildBoardRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new GuildBoardValidationError('expectedRevision must be a decimal string');
  }
  let revision: bigint;
  try {
    revision = BigInt(value);
  } catch {
    throw new GuildBoardValidationError('expectedRevision was invalid');
  }
  if (revision > MAX_SIGNED_BIGINT) {
    throw new GuildBoardValidationError('expectedRevision exceeds PostgreSQL BIGINT');
  }
  return value;
}

export function parseGuildBoardThemeBody(value: unknown): GuildBoardThemeInput {
  if (!isRecord(value)
    || !hasExactProperties(value, ['expectedRevision', 'theme'])
    || !isGuildBoardTheme(value.theme)) {
    throw new GuildBoardValidationError('guild board body was invalid');
  }
  return {
    theme: value.theme,
    expectedRevision: parseGuildBoardRevision(value.expectedRevision),
  };
}

export function parseGuildBoardCapacityBody(value: unknown): GuildBoardCapacityInput {
  if (!isRecord(value)
    || !hasExactProperties(value, ['expectedRevision', 'height', 'width'])
    || !isGuildBoardCapacity(value.width, value.height)) {
    throw new GuildBoardValidationError('guild board capacity body was invalid');
  }
  return {
    width: value.width as number,
    height: value.height as number,
    expectedRevision: parseGuildBoardRevision(value.expectedRevision),
  };
}
