import type {Pool, QueryResultRow} from 'pg';

export const DEFAULT_INVENTORY_LIMIT = 20;
export const MAX_INVENTORY_LIMIT = 50;
const RECENT_INVENTORY_LIMIT = 4;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

interface RewardAccountRow extends QueryResultRow {
  verified_seconds: string | number;
}

interface InventoryRow extends QueryResultRow {
  hour_rewardid: string | number;
  milestone_hour: string | number;
  earned_at: Date | string;
  granted_at: Date | string;
  item_key: string;
  display_name: string;
  description: string | null;
  asset_key: string;
  metadata: unknown;
}

interface CatalogRow extends QueryResultRow {
  item_key: string;
  display_name: string;
  description: string | null;
  asset_key: string;
  metadata: unknown;
  active: boolean;
}

export interface InventoryItem {
  hourRewardId: string;
  milestoneHour: number;
  earnedAt: string;
  grantedAt: string;
  itemKey: string;
  displayName: string;
  description: string | null;
  assetKey: string;
  metadata: Record<string, unknown>;
}

export interface InventoryPage {
  items: InventoryItem[];
  nextCursor: string | null;
}

export interface InventoryPagination {
  limit: number;
  cursor: string | null;
}

export interface DashboardData {
  verifiedSeconds: number;
  completedHours: number;
  progressSeconds: number;
  secondsToNextMilestone: number;
  recentInventory: InventoryItem[];
}

export interface CatalogItem {
  itemKey: string;
  displayName: string;
  description: string | null;
  assetKey: string;
  metadata: Record<string, unknown>;
  active: boolean;
}

export class PaginationValidationError extends Error {}

function parseSafeNonNegativeInteger(value: string | number, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} was outside the supported integer range`);
  }
  return parsed;
}

function parseBigintId(value: string | number, fieldName: string): string {
  const parsed = String(value);
  if (!/^\d+$/.test(parsed)) {
    throw new Error(`${fieldName} was not a decimal string`);
  }
  return parsed;
}

function parseTimestamp(value: Date | string, fieldName: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${fieldName} was not a valid timestamp`);
  }
  return parsed.toISOString();
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Reward metadata must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function mapInventoryRow(row: InventoryRow): InventoryItem {
  return {
    hourRewardId: parseBigintId(row.hour_rewardid, 'hour_rewardid'),
    milestoneHour: parseSafeNonNegativeInteger(row.milestone_hour, 'milestone_hour'),
    earnedAt: parseTimestamp(row.earned_at, 'earned_at'),
    grantedAt: parseTimestamp(row.granted_at, 'granted_at'),
    itemKey: row.item_key,
    displayName: row.display_name,
    description: row.description,
    assetKey: row.asset_key,
    metadata: parseMetadata(row.metadata),
  };
}

function parseCursor(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new PaginationValidationError('cursor must be a positive decimal string');
  }
  if (BigInt(value) > MAX_POSTGRES_BIGINT) {
    throw new PaginationValidationError('cursor is outside the PostgreSQL BIGINT range');
  }
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_INVENTORY_LIMIT;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new PaginationValidationError('limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_INVENTORY_LIMIT) {
    throw new PaginationValidationError(`limit must not exceed ${MAX_INVENTORY_LIMIT}`);
  }
  return parsed;
}

export function parseInventoryPagination(query: Record<string, unknown>): InventoryPagination {
  return {
    limit: parseLimit(query.limit),
    cursor: parseCursor(query.cursor),
  };
}

export function calculateDashboardProgress(verifiedSeconds: number) {
  if (!Number.isSafeInteger(verifiedSeconds) || verifiedSeconds < 0) {
    throw new Error('verifiedSeconds must be a non-negative safe integer');
  }
  const completedHours = Math.floor(verifiedSeconds / 3600);
  const progressSeconds = verifiedSeconds % 3600;
  return {
    completedHours,
    progressSeconds,
    secondsToNextMilestone: progressSeconds === 0 ? 3600 : 3600 - progressSeconds,
  };
}

export async function getInventoryPage(
  pool: Pool,
  discordUserId: string,
  pagination: InventoryPagination,
): Promise<InventoryPage> {
  const result = await pool.query<InventoryRow>(
    `SELECT ui.hour_rewardid,
            hr.milestone_hour,
            hr.earned_at,
            ui.granted_at,
            catalog.item_key,
            catalog.display_name,
            catalog.description,
            catalog.asset_key,
            catalog.metadata
       FROM public.gostudy_user_inventory AS ui
       JOIN public.gostudy_hour_rewards AS hr
         ON hr.rewardid = ui.hour_rewardid
       JOIN public.gostudy_reward_catalog AS catalog
         ON catalog.catalog_itemid = ui.catalog_itemid
      WHERE hr.userid = $1::bigint
        AND ($2::bigint IS NULL OR hr.rewardid < $2::bigint)
      ORDER BY hr.rewardid DESC
      LIMIT $3`,
    [discordUserId, pagination.cursor, pagination.limit + 1],
  );

  const hasMore = result.rows.length > pagination.limit;
  const items = result.rows.slice(0, pagination.limit).map(mapInventoryRow);
  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.hourRewardId ?? null : null,
  };
}

export async function getDashboardData(pool: Pool, discordUserId: string): Promise<DashboardData> {
  const [accountResult, inventoryPage] = await Promise.all([
    pool.query<RewardAccountRow>(
      `SELECT verified_seconds
         FROM public.gostudy_reward_accounts
        WHERE userid = $1::bigint
        LIMIT 1`,
      [discordUserId],
    ),
    getInventoryPage(pool, discordUserId, {limit: RECENT_INVENTORY_LIMIT, cursor: null}),
  ]);

  const verifiedSeconds = accountResult.rows.length === 0
    ? 0
    : parseSafeNonNegativeInteger(accountResult.rows[0].verified_seconds, 'verified_seconds');
  return {
    verifiedSeconds,
    ...calculateDashboardProgress(verifiedSeconds),
    recentInventory: inventoryPage.items,
  };
}

export async function getCatalog(pool: Pool): Promise<CatalogItem[]> {
  const result = await pool.query<CatalogRow>(
    `SELECT item_key,
            display_name,
            description,
            asset_key,
            metadata,
            active
       FROM public.gostudy_reward_catalog
      ORDER BY selection_order ASC, catalog_itemid ASC`,
  );

  return result.rows.map((row) => ({
    itemKey: row.item_key,
    displayName: row.display_name,
    description: row.description,
    assetKey: row.asset_key,
    metadata: parseMetadata(row.metadata),
    active: row.active,
  }));
}
