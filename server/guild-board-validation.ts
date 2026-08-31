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

export type GuildBoardAssetKind = 'emoji' | 'sticker';
export type GuildBoardLayerAction = 'front' | 'back';

export interface GuildBoardObjectGeometryInput {
  x: number;
  y: number;
  size: number;
  rotation: number;
  expectedRevision: string;
}

export interface GuildBoardAssetPlacementInput extends GuildBoardObjectGeometryInput {
  assetKind: GuildBoardAssetKind;
  assetId: string;
}

export interface GuildBoardLayerInput {
  action: GuildBoardLayerAction;
  expectedRevision: string;
}

export interface GuildBoardDeleteInput {
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

export function parseGuildBoardObjectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new GuildBoardValidationError('guild board object ID was invalid');
  }
  let objectId: bigint;
  try {
    objectId = BigInt(value);
  } catch {
    throw new GuildBoardValidationError('guild board object ID was invalid');
  }
  if (objectId > MAX_SIGNED_BIGINT) {
    throw new GuildBoardValidationError('guild board object ID exceeds PostgreSQL BIGINT');
  }
  return value;
}

function isGuildBoardAssetKind(value: unknown): value is GuildBoardAssetKind {
  return value === 'emoji' || value === 'sticker';
}

function isGuildBoardCoordinate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isGuildBoardSize(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 48
    && value <= 720;
}

function isGuildBoardRotation(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= -180
    && value <= 180
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

function parseGuildBoardGeometry(
  value: Record<string, unknown>,
): GuildBoardObjectGeometryInput {
  if (!isGuildBoardCoordinate(value.x)
    || !isGuildBoardCoordinate(value.y)
    || !isGuildBoardSize(value.size)
    || !isGuildBoardRotation(value.rotation)) {
    throw new GuildBoardValidationError('guild board object geometry was invalid');
  }
  return {
    x: value.x,
    y: value.y,
    size: value.size,
    rotation: value.rotation,
    expectedRevision: parseGuildBoardRevision(value.expectedRevision),
  };
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

export function parseGuildBoardAssetPlacementBody(
  value: unknown,
): GuildBoardAssetPlacementInput {
  if (!isRecord(value)
    || !hasExactProperties(value, [
      'assetId',
      'assetKind',
      'expectedRevision',
      'rotation',
      'size',
      'x',
      'y',
    ])
    || !isGuildBoardAssetKind(value.assetKind)) {
    throw new GuildBoardValidationError('guild board asset placement body was invalid');
  }
  return {
    assetKind: value.assetKind,
    assetId: parseGuildBoardObjectId(value.assetId),
    ...parseGuildBoardGeometry(value),
  };
}

export function parseGuildBoardObjectTransformBody(
  value: unknown,
): GuildBoardObjectGeometryInput {
  if (!isRecord(value)
    || !hasExactProperties(value, [
      'expectedRevision',
      'rotation',
      'size',
      'x',
      'y',
    ])) {
    throw new GuildBoardValidationError('guild board object transform body was invalid');
  }
  return parseGuildBoardGeometry(value);
}

export function parseGuildBoardLayerBody(value: unknown): GuildBoardLayerInput {
  if (!isRecord(value)
    || !hasExactProperties(value, ['action', 'expectedRevision'])
    || (value.action !== 'front' && value.action !== 'back')) {
    throw new GuildBoardValidationError('guild board object layer body was invalid');
  }
  return {
    action: value.action,
    expectedRevision: parseGuildBoardRevision(value.expectedRevision),
  };
}

export function parseGuildBoardDeleteBody(value: unknown): GuildBoardDeleteInput {
  if (!isRecord(value)
    || !hasExactProperties(value, ['expectedRevision'])) {
    throw new GuildBoardValidationError('guild board object delete body was invalid');
  }
  return {expectedRevision: parseGuildBoardRevision(value.expectedRevision)};
}
