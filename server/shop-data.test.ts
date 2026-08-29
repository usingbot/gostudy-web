import assert from 'node:assert/strict';
import test from 'node:test';

import type {Pool, QueryResultRow} from 'pg';

import {
  getBoardShop,
  getOwnedShopItems,
  purchaseBoardShopItem,
} from './shop-data.js';

interface QueryCall {
  text: string;
  values: unknown[];
}

function createPool(
  handler: (text: string, values: unknown[]) => QueryResultRow[],
  calls: QueryCall[] = [],
): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({text, values});
      return {rows: handler(text, values)};
    },
  } as unknown as Pool;
}

test('Shop GET reads enabled database catalog prices and a narrow Chalk balance', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => {
    if (text.includes('web_board_shop_catalog')) {
      return [{
        item_key: 'sticky-note',
        display_name: 'Sticky Note',
        item_type: 'sticky_note',
        price_chalk: '17',
        enabled: true,
      }];
    }
    if (text.includes('gostudy_admin_get_chalk_account')) return [{balance: '9007199254740993'}];
    throw new Error(`Unexpected query: ${text}`);
  }, calls);

  assert.deepEqual(await getBoardShop(pool, '123'), {
    chalkBalance: '9007199254740993',
    items: [{
      itemKey: 'sticky-note',
      displayName: 'Sticky Note',
      itemType: 'sticky_note',
      priceChalk: '17',
      enabled: true,
    }],
  });
  assert(calls.some((call) => call.text.includes('WHERE enabled = TRUE')));
  assert(calls.some((call) => call.values[0] === '123'));
});

test('purchase sends only server identity, item key, and request ID to the web function', async () => {
  const calls: QueryCall[] = [];
  const requestId = '7cc98552-2ed4-4c49-b68c-23424d56c171';
  const pool = createPool(() => [{
    purchaseid: requestId,
    userid: '9223372036854775807',
    item_key: 'photo-frame',
    display_name: 'Photo Frame',
    item_type: 'photo_frame',
    price_chalk: '5',
    owned_itemid: '9223372036854775806',
    chalk_transactionid: '9223372036854775805',
    chalk_balance: '9007199254740993',
    replayed: false,
  }], calls);

  const result = await purchaseBoardShopItem(pool, '9223372036854775807', {
    itemKey: 'photo-frame',
    requestId,
  });
  assert.equal(result.ownedItemId, '9223372036854775806');
  assert.equal(result.chalkBalance, '9007199254740993');
  assert.deepEqual(calls[0].values, ['9223372036854775807', 'photo-frame', requestId]);
  assert.match(calls[0].text, /public\.web_purchase_board_item/);
  assert.doesNotMatch(calls[0].text, /gostudy_purchase_board_item_chalk|\$4/);
});

test('owned Shop inventory preserves duplicate instances and BIGINT IDs as strings', async () => {
  const pool = createPool(() => [
    {
      owned_itemid: '9223372036854775807',
      item_key: 'sticky-note',
      display_name: 'Sticky Note',
      item_type: 'sticky_note',
      acquired_at: new Date('2026-08-29T10:00:00.000Z'),
    },
    {
      owned_itemid: '9223372036854775806',
      item_key: 'sticky-note',
      display_name: 'Sticky Note',
      item_type: 'sticky_note',
      acquired_at: new Date('2026-08-29T09:00:00.000Z'),
    },
  ]);
  const items = await getOwnedShopItems(pool, '123');
  assert.deepEqual(items.map((item) => item.ownedItemId), [
    '9223372036854775807',
    '9223372036854775806',
  ]);
  assert(items.every((item) => item.source === 'shop' && item.itemKey === 'sticky-note'));
});
