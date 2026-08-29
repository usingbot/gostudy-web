import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseShopPurchaseBody,
  ShopValidationError,
} from './shop-validation.js';

test('Shop purchase body accepts only a canonical item key and lowercase UUIDv4', () => {
  const valid = {
    itemKey: 'sticky-note',
    requestId: '7cc98552-2ed4-4c49-b68c-23424d56c171',
  };
  assert.deepEqual(parseShopPurchaseBody(valid), valid);

  for (const body of [
    null,
    [],
    {},
    {...valid, priceChalk: '2'},
    {...valid, userid: '123'},
    {...valid, requestId: '7CC98552-2ED4-4C49-B68C-23424D56C171'},
    {...valid, requestId: '7cc98552-2ed4-1c49-b68c-23424d56c171'},
  ]) {
    assert.throws(() => parseShopPurchaseBody(body), ShopValidationError);
  }
});

test('Shop item keys reject noncanonical or unbounded forms', () => {
  const requestId = '7cc98552-2ed4-4c49-b68c-23424d56c171';
  for (const itemKey of [
    '',
    'Sticky-Note',
    'sticky_note',
    '-sticky-note',
    'sticky--note',
    'sticky-note-',
    'a'.repeat(65),
    1,
  ]) {
    assert.throws(
      () => parseShopPurchaseBody({itemKey, requestId}),
      (error: unknown) => error instanceof ShopValidationError && error.code === 'INVALID_ITEM',
    );
  }
});
