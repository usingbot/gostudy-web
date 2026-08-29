import type {Pool, PoolClient, QueryResultRow} from 'pg';

export const MAX_BOARD_ITEMS = 100;
export const MAX_STICKY_NOTE_WORDS = 250;
export const MAX_STICKY_NOTE_CHARACTERS = 2000;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

type ShopObjectType = 'decoration' | 'sticky_note' | 'gif' | 'photo_frame';

interface BoardObjectRow extends QueryResultRow {
  board_objectid: string | number;
  source_type: string;
  hour_rewardid: string | number | null;
  owned_itemid: string | number | null;
  object_type: string;
  x: string | number;
  y: string | number;
  milestone_hour: string | number | null;
  earned_at: Date | string | null;
  granted_at: Date | string | null;
  reward_item_key: string | null;
  reward_display_name: string | null;
  reward_description: string | null;
  reward_asset_key: string | null;
  reward_metadata: unknown;
  shop_item_key: string | null;
  shop_display_name: string | null;
  shop_item_type: string | null;
  sticky_body: string | null;
  gif_giphy_id: string | null;
}

interface CountRow extends QueryResultRow {
  item_count: string | number;
}

interface ShopOwnershipRow extends QueryResultRow {
  item_key: string;
  display_name: string;
  item_type: string;
}

interface BoardPositionRow extends QueryResultRow {
  board_objectid: string | number;
  x: string | number;
  y: string | number;
}

interface StickyNoteRow extends QueryResultRow {
  owned_itemid: string | number;
  body: string;
}

interface BoardGifRow extends QueryResultRow {
  owned_itemid: string | number;
  giphy_id: string;
}

export interface BoardPosition {
  x: number;
  y: number;
}

export interface RewardBoardPlacementInput extends BoardPosition {
  hourRewardId: string;
}

export interface ShopBoardPlacementInput extends BoardPosition {
  ownedItemId: string;
}

interface BoardObjectBase extends BoardPosition {
  boardObjectId: string;
}

export interface RewardBoardObject extends BoardObjectBase {
  source: 'reward';
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

export interface ShopBoardObject extends BoardObjectBase {
  source: 'shop';
  ownedItemId: string;
  itemKey: string;
  displayName: string;
  itemType: ShopObjectType;
  body?: string;
  gif?: BoardGif | null;
}

export type BoardObject = RewardBoardObject | ShopBoardObject;

export interface BoardPositionResult extends BoardPosition {
  boardObjectId: string;
}

export interface StickyNoteContent {
  ownedItemId: string;
  body: string;
}

export interface BoardGif {
  giphyId: string;
}

export interface BoardGifSelection extends BoardGif {
  ownedItemId: string;
}

export class BoardValidationError extends Error {}
export class BoardItemNotOwnedError extends Error {}
export class BoardItemUnsupportedError extends Error {}
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

function parseBigintId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || value.length > 19) {
    throw new BoardValidationError(`${fieldName} must be a positive decimal string`);
  }
  if (BigInt(value) > MAX_POSTGRES_BIGINT) {
    throw new BoardValidationError(`${fieldName} is outside the PostgreSQL BIGINT range`);
  }
  return value;
}

export function parseBoardItemId(value: unknown): string {
  return parseBigintId(value, 'hourRewardId');
}

export function parseBoardObjectId(value: unknown): string {
  return parseBigintId(value, 'boardObjectId');
}

export function parseOwnedItemId(value: unknown): string {
  return parseBigintId(value, 'ownedItemId');
}

export function parseGiphyId(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BoardValidationError('giphyId was invalid');
  }
  return value;
}

export function parseGiphySelectionBody(value: unknown): string {
  if (!isRecord(value)) {
    throw new BoardValidationError('Request body must be a JSON object');
  }
  assertNoUnknownProperties(value, new Set(['giphyId']));
  return parseGiphyId(value.giphyId);
}

function parseCoordinate(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BoardValidationError(`${fieldName} must be a finite number between 0 and 1`);
  }
  return value;
}

export function parseBoardPlacementBody(value: unknown): RewardBoardPlacementInput {
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

export function parseShopBoardPlacementBody(value: unknown): ShopBoardPlacementInput {
  if (!isRecord(value)) {
    throw new BoardValidationError('Request body must be a JSON object');
  }
  assertNoUnknownProperties(value, new Set(['ownedItemId', 'x', 'y']));
  return {
    ownedItemId: parseOwnedItemId(value.ownedItemId),
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

export function countStickyNoteWords(body: string): number {
  const trimmed = body.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

export function countStickyNoteCharacters(body: string): number {
  return Array.from(body).length;
}

export function parseStickyNoteBody(value: unknown): string {
  if (!isRecord(value)) {
    throw new BoardValidationError('Request body must be a JSON object');
  }
  assertNoUnknownProperties(value, new Set(['body']));
  if (typeof value.body !== 'string') {
    throw new BoardValidationError('body must be a string');
  }
  if (countStickyNoteCharacters(value.body) > MAX_STICKY_NOTE_CHARACTERS) {
    throw new BoardValidationError('Sticky Note exceeds the character limit');
  }
  if (countStickyNoteWords(value.body) > MAX_STICKY_NOTE_WORDS) {
    throw new BoardValidationError('Sticky Note exceeds the word limit');
  }
  return value.body;
}

function parsePositiveBigint(value: string | number, fieldName: string): string {
  const parsed = String(value);
  if (!/^[1-9]\d*$/.test(parsed) || BigInt(parsed) > MAX_POSTGRES_BIGINT) {
    throw new Error(`${fieldName} was not a positive PostgreSQL BIGINT`);
  }
  return parsed;
}

function parseSafeNonNegativeInteger(value: string | number, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} was outside the supported integer range`);
  }
  return parsed;
}

function parseSafePositiveInteger(value: string | number, fieldName: string): number {
  const parsed = parseSafeNonNegativeInteger(value, fieldName);
  if (parsed === 0) {
    throw new Error(`${fieldName} must be positive`);
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

function parseStoredPosition(row: {x: string | number; y: string | number}): BoardPosition {
  const x = Number(row.x);
  const y = Number(row.y);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
    throw new Error('Stored board coordinates were invalid');
  }
  return {x, y};
}

function isShopObjectType(value: string): value is ShopObjectType {
  return value === 'decoration'
    || value === 'sticky_note'
    || value === 'gif'
    || value === 'photo_frame';
}

function mapStoredGif(row: BoardObjectRow): BoardGif | null {
  if (row.gif_giphy_id === null) {
    return null;
  }
  return {giphyId: row.gif_giphy_id};
}

function mapBoardObjectRow(row: BoardObjectRow): BoardObject {
  const boardObjectId = parsePositiveBigint(row.board_objectid, 'board_objectid');
  const position = parseStoredPosition(row);
  if (row.source_type === 'reward') {
    if (row.object_type !== 'reward_decoration'
      || row.hour_rewardid === null
      || row.milestone_hour === null
      || row.earned_at === null
      || row.granted_at === null
      || row.reward_item_key === null
      || row.reward_display_name === null
      || row.reward_asset_key === null) {
      throw new Error('Stored reward board object was incomplete');
    }
    return {
      boardObjectId,
      source: 'reward',
      hourRewardId: parsePositiveBigint(row.hour_rewardid, 'hour_rewardid'),
      ...position,
      milestoneHour: parseSafeNonNegativeInteger(row.milestone_hour, 'milestone_hour'),
      earnedAt: parseTimestamp(row.earned_at, 'earned_at'),
      grantedAt: parseTimestamp(row.granted_at, 'granted_at'),
      itemKey: row.reward_item_key,
      displayName: row.reward_display_name,
      description: row.reward_description,
      assetKey: row.reward_asset_key,
      metadata: parseMetadata(row.reward_metadata),
    };
  }
  if (row.source_type === 'shop') {
    if (row.owned_itemid === null
      || !isShopObjectType(row.object_type)
      || row.shop_item_type !== row.object_type
      || row.shop_item_key === null
      || row.shop_display_name === null) {
      throw new Error('Stored shop board object was incomplete');
    }
    return {
      boardObjectId,
      source: 'shop',
      ownedItemId: parsePositiveBigint(row.owned_itemid, 'owned_itemid'),
      ...position,
      itemKey: row.shop_item_key,
      displayName: row.shop_display_name,
      itemType: row.object_type,
      ...(row.object_type === 'sticky_note' ? {body: row.sticky_body ?? ''} : {}),
      ...(row.object_type === 'gif' ? {gif: mapStoredGif(row)} : {}),
    };
  }
  throw new Error('Stored board source type was invalid');
}

function mapBoardPositionRow(row: BoardPositionRow): BoardPositionResult {
  return {
    boardObjectId: parsePositiveBigint(row.board_objectid, 'board_objectid'),
    ...parseStoredPosition(row),
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

async function lockBoardAndCheckCapacity(client: PoolClient, discordUserId: string): Promise<void> {
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
  const countResult = await client.query<CountRow>(
    `SELECT count(*) AS item_count
       FROM public.web_study_board_objects
      WHERE userid = $1::bigint`,
    [discordUserId],
  );
  const itemCount = Number(countResult.rows[0]?.item_count);
  if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
    throw new Error('Board object count was invalid');
  }
  if (itemCount >= MAX_BOARD_ITEMS) {
    throw new BoardCapacityError('Study Board capacity reached');
  }
}

export async function getBoardItems(pool: Pool, discordUserId: string): Promise<BoardObject[]> {
  const result = await pool.query<BoardObjectRow>(
    `SELECT board_object.board_objectid,
            board_object.source_type,
            board_object.hour_rewardid,
            board_object.owned_itemid,
            board_object.object_type,
            board_object.x,
            board_object.y,
            reward.milestone_hour,
            reward.earned_at,
            reward_inventory.granted_at,
            reward_catalog.item_key AS reward_item_key,
            reward_catalog.display_name AS reward_display_name,
            reward_catalog.description AS reward_description,
            reward_catalog.asset_key AS reward_asset_key,
            reward_catalog.metadata AS reward_metadata,
            shop_catalog.item_key AS shop_item_key,
            shop_catalog.display_name AS shop_display_name,
            shop_catalog.item_type AS shop_item_type,
            sticky_note.body AS sticky_body,
            board_gif.giphy_id AS gif_giphy_id
       FROM public.web_study_board_objects AS board_object
       LEFT JOIN public.gostudy_user_inventory AS reward_inventory
         ON board_object.source_type = 'reward'
        AND reward_inventory.hour_rewardid = board_object.hour_rewardid
       LEFT JOIN public.gostudy_hour_rewards AS reward
         ON reward.rewardid = reward_inventory.hour_rewardid
       LEFT JOIN public.gostudy_reward_catalog AS reward_catalog
         ON reward_catalog.catalog_itemid = reward_inventory.catalog_itemid
       LEFT JOIN public.web_owned_board_items AS owned_item
         ON board_object.source_type = 'shop'
        AND owned_item.owned_itemid = board_object.owned_itemid
       LEFT JOIN public.web_board_shop_catalog AS shop_catalog
         ON shop_catalog.item_key = owned_item.item_key
       LEFT JOIN public.web_sticky_notes AS sticky_note
         ON sticky_note.owned_itemid = owned_item.owned_itemid
        AND sticky_note.userid = board_object.userid
       LEFT JOIN public.web_board_gifs AS board_gif
         ON board_gif.owned_itemid = owned_item.owned_itemid
        AND board_gif.userid = board_object.userid
      WHERE board_object.userid = $1::bigint
        AND (
          (board_object.source_type = 'reward'
            AND reward.userid = $1::bigint
            AND reward_catalog.catalog_itemid IS NOT NULL)
          OR
          (board_object.source_type = 'shop'
            AND owned_item.userid = $1::bigint
            AND shop_catalog.item_type = board_object.object_type)
        )
      ORDER BY board_object.created_at ASC, board_object.board_objectid ASC`,
    [discordUserId],
  );
  return result.rows.map(mapBoardObjectRow);
}

export async function createBoardItem(
  pool: Pool,
  discordUserId: string,
  input: RewardBoardPlacementInput,
): Promise<RewardBoardObject> {
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
    const duplicate = await client.query(
      `SELECT 1
         FROM public.web_study_board_objects
        WHERE source_type = 'reward'
          AND hour_rewardid = $1::bigint
        LIMIT 1`,
      [input.hourRewardId],
    );
    if (duplicate.rows.length > 0) {
      throw new BoardItemAlreadyPlacedError('Inventory item is already on a board');
    }
    await lockBoardAndCheckCapacity(client, discordUserId);
    const insertResult = await client.query<BoardObjectRow>(
      `WITH owned_reward AS (
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
       ), inserted_object AS (
         INSERT INTO public.web_study_board_objects (
           userid, source_type, hour_rewardid, object_type, x, y
         )
         SELECT $1::bigint, 'reward', owned_reward.hour_rewardid,
                'reward_decoration', $3::double precision, $4::double precision
           FROM owned_reward
         RETURNING board_objectid, source_type, hour_rewardid, owned_itemid,
                   object_type, x, y
       )
       SELECT inserted_object.*,
              owned_reward.milestone_hour,
              owned_reward.earned_at,
              owned_reward.granted_at,
              owned_reward.item_key AS reward_item_key,
              owned_reward.display_name AS reward_display_name,
              owned_reward.description AS reward_description,
              owned_reward.asset_key AS reward_asset_key,
              owned_reward.metadata AS reward_metadata,
              NULL::text AS shop_item_key,
              NULL::text AS shop_display_name,
              NULL::text AS shop_item_type,
              NULL::text AS sticky_body,
              NULL::text AS gif_giphy_id
         FROM inserted_object
         JOIN owned_reward USING (hour_rewardid)`,
      [discordUserId, input.hourRewardId, input.x, input.y],
    );
    if (insertResult.rows.length === 0) {
      throw new BoardItemNotOwnedError('Inventory ownership changed during placement');
    }
    const item = mapBoardObjectRow(insertResult.rows[0]);
    if (item.source !== 'reward') {
      throw new Error('Reward placement returned a shop object');
    }
    await client.query(
      `UPDATE public.web_study_boards SET updated_at = now() WHERE userid = $1::bigint`,
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

export async function createShopBoardItem(
  pool: Pool,
  discordUserId: string,
  input: ShopBoardPlacementInput,
): Promise<ShopBoardObject> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ownership = await client.query<ShopOwnershipRow>(
      `SELECT owned.item_key, catalog.display_name, catalog.item_type
         FROM public.web_owned_board_items AS owned
         JOIN public.web_board_shop_catalog AS catalog
           ON catalog.item_key = owned.item_key
        WHERE owned.owned_itemid = $2::bigint
          AND owned.userid = $1::bigint`,
      [discordUserId, input.ownedItemId],
    );
    if (ownership.rows.length === 0) {
      throw new BoardItemNotOwnedError('Owned board item was not found for the current user');
    }
    const itemType = ownership.rows[0].item_type;
    if (itemType !== 'sticky_note' && itemType !== 'decoration' && itemType !== 'gif') {
      throw new BoardItemUnsupportedError('Owned board item is not placeable in this chapter');
    }
    const duplicate = await client.query(
      `SELECT 1
         FROM public.web_study_board_objects
        WHERE source_type = 'shop'
          AND owned_itemid = $1::bigint
        LIMIT 1`,
      [input.ownedItemId],
    );
    if (duplicate.rows.length > 0) {
      throw new BoardItemAlreadyPlacedError('Owned item is already on a board');
    }
    await lockBoardAndCheckCapacity(client, discordUserId);
    const insertResult = await client.query<BoardObjectRow>(
      `WITH owned_shop_item AS (
         SELECT owned.owned_itemid, owned.item_key,
                catalog.display_name, catalog.item_type
           FROM public.web_owned_board_items AS owned
           JOIN public.web_board_shop_catalog AS catalog
             ON catalog.item_key = owned.item_key
          WHERE owned.owned_itemid = $2::bigint
            AND owned.userid = $1::bigint
            AND catalog.item_type IN ('sticky_note', 'decoration', 'gif')
       ), inserted_object AS (
         INSERT INTO public.web_study_board_objects (
           userid, source_type, owned_itemid, object_type, x, y
         )
         SELECT $1::bigint, 'shop', owned_shop_item.owned_itemid,
                owned_shop_item.item_type, $3::double precision, $4::double precision
           FROM owned_shop_item
         RETURNING board_objectid, source_type, hour_rewardid, owned_itemid,
                   object_type, x, y
       )
       SELECT inserted_object.*,
              NULL::bigint AS milestone_hour,
              NULL::timestamptz AS earned_at,
              NULL::timestamptz AS granted_at,
              NULL::text AS reward_item_key,
              NULL::text AS reward_display_name,
              NULL::text AS reward_description,
              NULL::text AS reward_asset_key,
              NULL::jsonb AS reward_metadata,
              owned_shop_item.item_key AS shop_item_key,
              owned_shop_item.display_name AS shop_display_name,
              owned_shop_item.item_type AS shop_item_type,
              COALESCE(sticky_note.body, '') AS sticky_body,
              board_gif.giphy_id AS gif_giphy_id
         FROM inserted_object
         JOIN owned_shop_item USING (owned_itemid)
         LEFT JOIN public.web_sticky_notes AS sticky_note
           ON sticky_note.owned_itemid = inserted_object.owned_itemid
          AND sticky_note.userid = $1::bigint
         LEFT JOIN public.web_board_gifs AS board_gif
           ON board_gif.owned_itemid = inserted_object.owned_itemid
          AND board_gif.userid = $1::bigint`,
      [discordUserId, input.ownedItemId, input.x, input.y],
    );
    if (insertResult.rows.length === 0) {
      throw new BoardItemNotOwnedError('Owned item changed during placement');
    }
    const item = mapBoardObjectRow(insertResult.rows[0]);
    if (item.source !== 'shop') {
      throw new Error('Shop placement returned a reward object');
    }
    await client.query(
      `UPDATE public.web_study_boards SET updated_at = now() WHERE userid = $1::bigint`,
      [discordUserId],
    );
    await client.query('COMMIT');
    return item;
  } catch (error) {
    await rollback(client);
    if (isUniqueViolation(error)) {
      throw new BoardItemAlreadyPlacedError('Owned item is already on a board');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateBoardObject(
  pool: Pool,
  discordUserId: string,
  boardObjectId: string,
  position: BoardPosition,
): Promise<BoardPositionResult> {
  const result = await pool.query<BoardPositionRow>(
    `WITH updated_object AS (
       UPDATE public.web_study_board_objects
          SET x = $3::double precision, y = $4::double precision, updated_at = now()
        WHERE board_objectid = $2::bigint AND userid = $1::bigint
       RETURNING board_objectid, x, y
     ), touched_board AS (
       UPDATE public.web_study_boards SET updated_at = now()
        WHERE userid = $1::bigint AND EXISTS (SELECT 1 FROM updated_object)
     )
     SELECT board_objectid, x, y FROM updated_object`,
    [discordUserId, boardObjectId, position.x, position.y],
  );
  if (result.rows.length === 0) {
    throw new BoardItemNotFoundError('Board object was not found for the current user');
  }
  return mapBoardPositionRow(result.rows[0]);
}

export async function updateBoardItem(
  pool: Pool,
  discordUserId: string,
  hourRewardId: string,
  position: BoardPosition,
): Promise<BoardPositionResult> {
  const result = await pool.query<BoardPositionRow>(
    `WITH updated_object AS (
       UPDATE public.web_study_board_objects AS board_object
          SET x = $3::double precision, y = $4::double precision, updated_at = now()
         FROM public.gostudy_user_inventory AS inventory
         JOIN public.gostudy_hour_rewards AS reward
           ON reward.rewardid = inventory.hour_rewardid
        WHERE board_object.source_type = 'reward'
          AND board_object.hour_rewardid = $2::bigint
          AND board_object.userid = $1::bigint
          AND inventory.hour_rewardid = board_object.hour_rewardid
          AND reward.userid = $1::bigint
       RETURNING board_object.board_objectid, board_object.x, board_object.y
     ), touched_board AS (
       UPDATE public.web_study_boards SET updated_at = now()
        WHERE userid = $1::bigint AND EXISTS (SELECT 1 FROM updated_object)
     )
     SELECT board_objectid, x, y FROM updated_object`,
    [discordUserId, hourRewardId, position.x, position.y],
  );
  if (result.rows.length === 0) {
    throw new BoardItemNotFoundError('Reward board object was not found for the current user');
  }
  return mapBoardPositionRow(result.rows[0]);
}

export async function deleteBoardObject(
  pool: Pool,
  discordUserId: string,
  boardObjectId: string,
): Promise<void> {
  await pool.query(
    `WITH removed_object AS (
       DELETE FROM public.web_study_board_objects
        WHERE userid = $1::bigint AND board_objectid = $2::bigint
       RETURNING userid
     ), touched_board AS (
       UPDATE public.web_study_boards SET updated_at = now()
        WHERE userid = $1::bigint AND EXISTS (SELECT 1 FROM removed_object)
     )
     SELECT count(*) FROM removed_object`,
    [discordUserId, boardObjectId],
  );
}

export async function deleteBoardItem(
  pool: Pool,
  discordUserId: string,
  hourRewardId: string,
): Promise<void> {
  await pool.query(
    `WITH removed_object AS (
       DELETE FROM public.web_study_board_objects
        WHERE userid = $1::bigint
          AND source_type = 'reward'
          AND hour_rewardid = $2::bigint
       RETURNING userid
     ), touched_board AS (
       UPDATE public.web_study_boards SET updated_at = now()
        WHERE userid = $1::bigint AND EXISTS (SELECT 1 FROM removed_object)
     )
     SELECT count(*) FROM removed_object`,
    [discordUserId, hourRewardId],
  );
}

export async function updateStickyNote(
  pool: Pool,
  discordUserId: string,
  ownedItemId: string,
  body: string,
): Promise<StickyNoteContent> {
  const result = await pool.query<StickyNoteRow>(
    `SELECT owned_itemid, body
       FROM public.web_upsert_sticky_note($1::bigint, $2::bigint, $3::text)`,
    [ownedItemId, discordUserId, body],
  );
  if (result.rows.length !== 1) {
    throw new Error('Sticky Note update returned an invalid row count');
  }
  return {
    ownedItemId: parsePositiveBigint(result.rows[0].owned_itemid, 'owned_itemid'),
    body: result.rows[0].body,
  };
}

export async function assertGifSlotOwned(
  pool: Pool,
  discordUserId: string,
  ownedItemId: string,
): Promise<void> {
  const result = await pool.query<ShopOwnershipRow>(
    `SELECT owned.item_key, catalog.display_name, catalog.item_type
       FROM public.web_owned_board_items AS owned
       JOIN public.web_board_shop_catalog AS catalog
         ON catalog.item_key = owned.item_key
      WHERE owned.owned_itemid = $2::bigint
        AND owned.userid = $1::bigint`,
    [discordUserId, ownedItemId],
  );
  if (result.rows.length === 0) {
    throw new BoardItemNotOwnedError('GIF Slot was not found for the current user');
  }
  if (result.rows[0].item_key !== 'gif-slot' || result.rows[0].item_type !== 'gif') {
    throw new BoardItemUnsupportedError('Owned item is not a GIF Slot');
  }
}

export async function updateBoardGif(
  pool: Pool,
  discordUserId: string,
  ownedItemId: string,
  giphyId: string,
): Promise<BoardGifSelection> {
  const result = await pool.query<BoardGifRow>(
    `SELECT owned_itemid, giphy_id
       FROM public.web_upsert_board_gif(
         $1::bigint,
         $2::bigint,
         $3::text
       )`,
    [
      ownedItemId,
      discordUserId,
      giphyId,
    ],
  );
  if (result.rows.length !== 1) {
    throw new Error('Board GIF update returned an invalid row count');
  }
  const row = result.rows[0];
  return {
    ownedItemId: parsePositiveBigint(row.owned_itemid, 'owned_itemid'),
    giphyId: row.giphy_id,
  };
}
