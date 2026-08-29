import assert from 'node:assert/strict';
import test from 'node:test';

import {ApiError} from './productData.js';
import {purchaseBoardShopItem} from './shop.js';

test('Shop client submits only item key and retained request ID, never a price', async () => {
  const originalFetch = globalThis.fetch;
  const requestId = '7cc98552-2ed4-4c49-b68c-23424d56c171';
  const calls: Array<{input: string; init?: RequestInit}> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({input: String(input), init});
    return new Response(JSON.stringify({
      purchaseId: requestId,
      userId: '123',
      itemKey: 'sticky-note',
      displayName: 'Sticky Note',
      itemType: 'sticky_note',
      priceChalk: '2',
      ownedItemId: '10',
      chalkTransactionId: '20',
      chalkBalance: '7',
      replayed: calls.length > 1,
    }), {status: 200, headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  try {
    await purchaseBoardShopItem('sticky-note', requestId);
    await purchaseBoardShopItem('sticky-note', requestId);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 2);
  assert(calls.every((call) => call.input === '/api/shop/purchase'));
  assert(calls.every((call) => call.init?.body === JSON.stringify({itemKey: 'sticky-note', requestId})));
  assert(calls.every((call) => !String(call.init?.body).includes('price')));
});

test('Shop client exposes stable server error code for friendly handling', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({error: 'INSUFFICIENT_CHALK'}),
    {status: 409, headers: {'Content-Type': 'application/json'}},
  )) as typeof fetch;
  try {
    await assert.rejects(
      purchaseBoardShopItem('sticky-note', '7cc98552-2ed4-4c49-b68c-23424d56c171'),
      (error: unknown) => error instanceof ApiError
        && error.status === 409
        && error.code === 'INSUFFICIENT_CHALK',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
