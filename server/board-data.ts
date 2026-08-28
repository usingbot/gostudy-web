import type {Pool, PoolClient, QueryResultRow} from 'pg';

export const MAX_BOARD_ITEMS = 100;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

interface BoardItemRow extends QueryResultRow {
  hour_rewardid: string | number;
  x: string | number;
  y: string | number;
  milestone_hour: string | number;
  earned_at: Date | string;
  granted_at: Date | string;
  item_key: string;
  display_name: string;
  description: string | null;
  asset_key: string;
  metadata: unknown;
}

interface CountRow extends QueryResultRow {
  item_count: string | number;
}

export interface BoardPosition {
  x: number;
  y: number;
}

export interface BoardPlacementInput extends BoardPosition {
  hourRewardId: string;
}

export interface BoardItem extends BoardPlacementInput {
  milestoneHour: number;
  earnedAt: string;
  grantedAt: string;
  itemKey: string;
  displayName: string;
  description: string | null;
  assetKey: string;
  metadata: Record<string, unknown>;
}

export class BoardValidationError extends Error {}
export class BoardItemNotOwnedError extends Error {}
export class BoardItemAlreadyPlacedError extends Error {}
export class BoardCapacityError extends Error {}
export class BoardItemNotFoundError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoUnknownProperties(
  body: Record<string, unknown>,
  allowedProperties: ReadonlySet<string>,
): void {
  if (Object.keys(body).some((property) => !allowedProperties.has(property))) {
    throw new BoardValidationError('Request body contained an unknown property');
  }
}

export function parseBoardItemId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || value.length > 19) {
    throw new BoardValidationError('hourRewardId must be a positive decimal string');
  }
  if (BigInt(value) > MAX_POSTGRES_BIGINT) {
    throw new BoardValidationError('hourRewardId is outside the PostgreSQL BIGINT range');
  }
  return value;
}

function parseCoordinate(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BoardValidationError(`${fieldName} must be a finite number between 0 and 1`);
  }
  return value;
}

export function parseBoardPlacementBody(value: unknown): BoardPlacementInput {
  if (!isRecord(value)) {
    throw new BoardValidationError('Request body must be a JSON object');
  }
  assertNoUnknownProperties(value, new Set(['hourRewardId', 'x', 'y']));
  return {
    hourRewardId: parseBoardItemId(value.hourRewardId),
    x: parseCoordinate(value.x, 'x'),
    y: parseCoordinate(value.y, 'y'),
  };
}

export function parseBoardPositionBody(value: unknown): BoardPosition {
  if (!isRecord(value)) {
    throw new BoardValidationError('Request body must be a JSON object');
  }
  assertNoUnknownProperties(value, new Set(['x', 'y']));
  return {
    x: parseCoordinate(value.x, 'x'),
    y: parseCoordinate(value.y, 'y'),
  };
}

function parseSafeNonNegativeInteger(value: string | number, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} was outside the supported integer range`);
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
  if (!isRecord(value)) {
    throw new Error('Reward metadata must be a JSON object');
  }
  return value;
}

function mapBoardItemRow(row: BoardItemRow): BoardItem {
  const hourRewardId = String(row.hour_rewardid);
  if (!/^[1-9]\d*$/.test(hourRewardId)) {
    throw new Error('hour_rewardid was not a positive decimal string');
  }
  const x = Number(row.x);
  const y = Number(row.y);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
    throw new Error('Stored board coordinates were invalid');
  }
  return {
    hourRewardId,
    x,
    y,
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '23505';
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original database failure while the client is released below.
  }
}

export async function getBoardItems(pool: Pool, discordUserId: string): Promise<BoardItem[]> {
  const result = await pool.query<BoardItemRow>(
    `SELECT board_item.hour_rewardid,
            board_item.x,
            board_item.y,
            reward.milestone_hour,
            reward.earned_at,
            inventory.granted_at,
            catalog.item_key,
            catalog.display_name,
            catalog.description,
            catalog.asset_key,
            catalog.metadata
       FROM public.web_study_board_items AS board_item
       JOIN public.gostudy_user_inventory AS inventory
         ON inventory.hour_rewardid = board_item.hour_rewardid
       JOIN public.gostudy_hour_rewards AS reward
         ON reward.rewardid = inventory.hour_rewardid
       JOIN public.gostudy_reward_catalog AS catalog
         ON catalog.catalog_itemid = inventory.catalog_itemid
      WHERE board_item.userid = $1::bigint
        AND reward.userid = $1::bigint
      ORDER BY board_item.created_at ASC, board_item.hour_rewardid ASC`,
    [discordUserId],
  );
  return result.rows.map(mapBoardItemRow);
}

export async function createBoardItem(
  pool: Pool,
  discordUserId: string,
  input: BoardPlacementInput,
): Promise<BoardItem> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownership = await client.query(
      `SELECT 1
         FROM public.gostudy_user_inventory AS inventory
         JOIN public.gostudy_hour_rewards AS reward
           ON reward.rewardid = inventory.hour_rewardid
         JOIN public.gostudy_reward_catalog AS catalog
           ON catalog.catalog_itemid = inventory.catalog_itemid
        WHERE inventory.hour_rewardid = $2::bigint
          AND reward.userid = $1::bigint
        LIMIT 1`,
      [discordUserId, input.hourRewardId],
    );
    if (ownership.rows.length === 0) {
      throw new BoardItemNotOwnedError('Inventory item is not owned by the current user');
    }

    await client.query(
      `INSERT INTO public.web_study_boards (userid)
       VALUES ($1::bigint)
       ON CONFLICT (userid) DO NOTHING`,
      [discordUserId],
    );
    await client.query(
      `SELECT userid
         FROM public.web_study_boards
        WHERE userid = $1::bigint
        FOR UPDATE`,
      [discordUserId],
    );

    const duplicate = await client.query(
      `SELECT 1
         FROM public.web_study_board_items
        WHERE hour_rewardid = $1::bigint
        LIMIT 1`,
      [input.hourRewardId],
    );
    if (duplicate.rows.length > 0) {
      throw new BoardItemAlreadyPlacedError('Inventory item is already on a board');
    }

    const countResult = await client.query<CountRow>(
      `SELECT count(*) AS item_count
         FROM public.web_study_board_items
        WHERE userid = $1::bigint`,
      [discordUserId],
    );
    const itemCount = Number(countResult.rows[0]?.item_count);
    if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
      throw new Error('Board item count was invalid');
    }
    if (itemCount >= MAX_BOARD_ITEMS) {
      throw new BoardCapacityError('Study Board capacity reached');
    }

    const insertResult = await client.query<BoardItemRow>(
      `WITH owned_item AS (
         SELECT inventory.hour_rewardid,
                reward.milestone_hour,
                reward.earned_at,
                inventory.granted_at,
                catalog.item_key,
                catalog.display_name,
                catalog.description,
                catalog.asset_key,
                catalog.metadata
           FROM public.gostudy_user_inventory AS inventory
           JOIN public.gostudy_hour_rewards AS reward
             ON reward.rewardid = inventory.hour_rewardid
           JOIN public.gostudy_reward_catalog AS catalog
             ON catalog.catalog_itemid = inventory.catalog_itemid
          WHERE inventory.hour_rewardid = $2::bigint
            AND reward.userid = $1::bigint
       ), inserted_item AS (
         INSERT INTO public.web_study_board_items (hour_rewardid, userid, x, y)
         SELECT owned_item.hour_rewardid, $1::bigint, $3::double precision, $4::double precision
           FROM owned_item
         RETURNING hour_rewardid, x, y
       )
       SELECT inserted_item.hour_rewardid,
              inserted_item.x,
              inserted_item.y,
              owned_item.milestone_hour,
              owned_item.earned_at,
              owned_item.granted_at,
              owned_item.item_key,
              owned_item.display_name,
              owned_item.description,
              owned_item.asset_key,
              owned_item.metadata
         FROM inserted_item
         JOIN owned_item USING (hour_rewardid)`,
      [discordUserId, input.hourRewardId, input.x, input.y],
    );
    if (insertResult.rows.length === 0) {
      throw new BoardItemNotOwnedError('Inventory ownership changed during placement');
    }
    const item = mapBoardItemRow(insertResult.rows[0]);

    await client.query(
      `UPDATE public.web_study_boards
          SET updated_at = now()
        WHERE userid = $1::bigint`,
      [discordUserId],
    );
    await client.query('COMMIT');
    return item;
  } catch (error) {
    await rollback(client);
    if (isUniqueViolation(error)) {
      throw new BoardItemAlreadyPlacedError('Inventory item is already on a board');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateBoardItem(
  pool: Pool,
  discordUserId: string,
  hourRewardId: string,
  position: BoardPosition,
): Promise<BoardItem> {
  const result = await pool.query<BoardItemRow>(
    `WITH updated_item AS (
       UPDATE public.web_study_board_items AS board_item
          SET x = $3::double precision,
              y = $4::double precision,
              updated_at = now()
         FROM public.gostudy_user_inventory AS inventory
         JOIN public.gostudy_hour_rewards AS reward
           ON reward.rewardid = inventory.hour_rewardid
         JOIN public.gostudy_reward_catalog AS catalog
           ON catalog.catalog_itemid = inventory.catalog_itemid
        WHERE board_item.hour_rewardid = $2::bigint
          AND board_item.userid = $1::bigint
          AND inventory.hour_rewardid = board_item.hour_rewardid
          AND reward.userid = $1::bigint
       RETURNING board_item.hour_rewardid,
                 board_item.x,
                 board_item.y,
                 reward.milestone_hour,
                 reward.earned_at,
                 inventory.granted_at,
                 catalog.item_key,
                 catalog.display_name,
                 catalog.description,
                 catalog.asset_key,
                 catalog.metadata
     ), touched_board AS (
       UPDATE public.web_study_boards
          SET updated_at = now()
        WHERE userid = $1::bigint
          AND EXISTS (SELECT 1 FROM updated_item)
     )
     SELECT * FROM updated_item`,
    [discordUserId, hourRewardId, position.x, position.y],
  );
  if (result.rows.length === 0) {
    throw new BoardItemNotFoundError('Board item was not found for the current user');
  }
  return mapBoardItemRow(result.rows[0]);
}

export async function deleteBoardItem(
  pool: Pool,
  discordUserId: string,
  hourRewardId: string,
): Promise<void> {
  await pool.query(
    `WITH removed_item AS (
       DELETE FROM public.web_study_board_items
        WHERE userid = $1::bigint
          AND hour_rewardid = $2::bigint
       RETURNING userid
     ), touched_board AS (
       UPDATE public.web_study_boards
          SET updated_at = now()
        WHERE userid = $1::bigint
          AND EXISTS (SELECT 1 FROM removed_item)
     )
     SELECT count(*) FROM removed_item`,
    [discordUserId, hourRewardId],
  );
}
