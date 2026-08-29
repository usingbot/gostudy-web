import type {Pool, QueryResultRow} from 'pg';

import type {ShopPurchaseInput} from './shop-validation.js';

export type BoardShopItemType = 'decoration' | 'sticky_note' | 'gif' | 'photo_frame';

interface ShopCatalogRow extends QueryResultRow {
  item_key: string;
  display_name: string;
  item_type: string;
  price_chalk: string | number;
  enabled: boolean;
}

interface ChalkBalanceRow extends QueryResultRow {
  balance: string | number;
}

interface ShopPurchaseRow extends QueryResultRow {
  purchaseid: string;
  userid: string | number;
  item_key: string;
  display_name: string;
  item_type: string;
  price_chalk: string | number;
  owned_itemid: string | number;
  chalk_transactionid: string | number;
  chalk_balance: string | number;
  replayed: boolean;
}

interface OwnedShopItemRow extends QueryResultRow {
  owned_itemid: string | number;
  item_key: string;
  display_name: string;
  item_type: string;
  acquired_at: Date | string;
}

export interface BoardShopCatalogItem {
  itemKey: string;
  displayName: string;
  itemType: BoardShopItemType;
  priceChalk: string;
  enabled: boolean;
}

export interface BoardShopData {
  chalkBalance: string;
  items: BoardShopCatalogItem[];
}

export interface BoardShopPurchaseResult {
  purchaseId: string;
  userId: string;
  itemKey: string;
  displayName: string;
  itemType: BoardShopItemType;
  priceChalk: string;
  ownedItemId: string;
  chalkTransactionId: string;
  chalkBalance: string;
  replayed: boolean;
}

export interface OwnedShopItem {
  source: 'shop';
  ownedItemId: string;
  itemKey: string;
  displayName: string;
  itemType: BoardShopItemType;
  acquiredAt: string;
}

function parseBigint(value: string | number, fieldName: string, allowZero = false): string {
  const parsed = String(value);
  const pattern = allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  if (!pattern.test(parsed)) {
    throw new Error(`${fieldName} was not a canonical BIGINT`);
  }
  return parsed;
}

function parseItemType(value: string): BoardShopItemType {
  if (value !== 'decoration'
      && value !== 'sticky_note'
      && value !== 'gif'
      && value !== 'photo_frame') {
    throw new Error('Board Shop item type was invalid');
  }
  return value;
}

function parseTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error('Board Shop timestamp was invalid');
  }
  return parsed.toISOString();
}

function mapCatalogItem(row: ShopCatalogRow): BoardShopCatalogItem {
  if (typeof row.enabled !== 'boolean') {
    throw new Error('Board Shop enabled state was invalid');
  }
  return {
    itemKey: row.item_key,
    displayName: row.display_name,
    itemType: parseItemType(row.item_type),
    priceChalk: parseBigint(row.price_chalk, 'price_chalk'),
    enabled: row.enabled,
  };
}

export async function getBoardShop(pool: Pool, userId: string): Promise<BoardShopData> {
  const [catalogResult, accountResult] = await Promise.all([
    pool.query<ShopCatalogRow>(
      `SELECT item_key,
              display_name,
              item_type,
              price_chalk,
              enabled
         FROM public.web_board_shop_catalog
        WHERE enabled = TRUE
        ORDER BY sort_order ASC, item_key ASC`,
    ),
    pool.query<ChalkBalanceRow>(
      `SELECT balance
         FROM public.gostudy_admin_get_chalk_account($1::bigint)`,
      [userId],
    ),
  ]);
  if (accountResult.rows.length !== 1) {
    throw new Error('Chalk account function returned an invalid row count');
  }
  return {
    chalkBalance: parseBigint(accountResult.rows[0].balance, 'chalk balance', true),
    items: catalogResult.rows.map(mapCatalogItem),
  };
}

export async function purchaseBoardShopItem(
  pool: Pool,
  userId: string,
  input: ShopPurchaseInput,
): Promise<BoardShopPurchaseResult> {
  const result = await pool.query<ShopPurchaseRow>(
    `SELECT purchaseid,
            userid,
            item_key,
            display_name,
            item_type,
            price_chalk,
            owned_itemid,
            chalk_transactionid,
            chalk_balance,
            replayed
       FROM public.web_purchase_board_item(
         $1::bigint,
         $2::text,
         $3::text
       )`,
    [userId, input.itemKey, input.requestId],
  );
  if (result.rows.length !== 1) {
    throw new Error('Board Shop purchase function returned an invalid row count');
  }
  const row = result.rows[0];
  if (typeof row.replayed !== 'boolean') {
    throw new Error('Board Shop replay state was invalid');
  }
  return {
    purchaseId: row.purchaseid,
    userId: parseBigint(row.userid, 'userid'),
    itemKey: row.item_key,
    displayName: row.display_name,
    itemType: parseItemType(row.item_type),
    priceChalk: parseBigint(row.price_chalk, 'price_chalk'),
    ownedItemId: parseBigint(row.owned_itemid, 'owned_itemid'),
    chalkTransactionId: parseBigint(row.chalk_transactionid, 'chalk_transactionid'),
    chalkBalance: parseBigint(row.chalk_balance, 'chalk_balance', true),
    replayed: row.replayed,
  };
}

export async function getOwnedShopItems(pool: Pool, userId: string): Promise<OwnedShopItem[]> {
  const result = await pool.query<OwnedShopItemRow>(
    `SELECT owned.owned_itemid,
            owned.item_key,
            catalog.display_name,
            catalog.item_type,
            owned.acquired_at
       FROM public.web_owned_board_items AS owned
       JOIN public.web_board_shop_catalog AS catalog
         ON catalog.item_key = owned.item_key
      WHERE owned.userid = $1::bigint
      ORDER BY owned.acquired_at DESC, owned.owned_itemid DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    source: 'shop',
    ownedItemId: parseBigint(row.owned_itemid, 'owned_itemid'),
    itemKey: row.item_key,
    displayName: row.display_name,
    itemType: parseItemType(row.item_type),
    acquiredAt: parseTimestamp(row.acquired_at),
  }));
}
