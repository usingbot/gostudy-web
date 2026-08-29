import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addBoardItem,
  addShopBoardItem,
  moveBoardObject,
  removeBoardObject,
  updateStickyNote,
} from './board.js';

test('board client uses distinct reward/shop placement bodies and never sends forged type or Chalk', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{input: string; init?: RequestInit}> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({input: String(input), init});
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
  try {
    await addBoardItem('9223372036854775807', {x: 0, y: 1});
    await addShopBoardItem('9223372036854775806', {x: 1, y: 0});
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].input, '/api/board/items');
  assert.equal(calls[0].init?.body, JSON.stringify({hourRewardId: '9223372036854775807', x: 0, y: 1}));
  assert.equal(calls[1].input, '/api/board/owned-items');
  assert.equal(calls[1].init?.body, JSON.stringify({ownedItemId: '9223372036854775806', x: 1, y: 0}));
  assert.doesNotMatch(String(calls[1].init?.body), /userid|objectType|itemType|chalk|price/i);
});

test('one drag release call produces one generic PATCH with normalized position', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{input: string; init?: RequestInit}> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({input: String(input), init});
    return new Response(JSON.stringify({boardObjectId: '99', x: 0.2, y: 0.8}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
  try {
    await moveBoardObject('99', {x: 0.2, y: 0.8});
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, '/api/board/objects/99');
  assert.equal(calls[0].init?.method, 'PATCH');
  assert.equal(calls[0].init?.body, JSON.stringify({x: 0.2, y: 0.8}));
});

test('removal targets only a placement and Sticky Note save sends strict text body', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{input: string; init?: RequestInit}> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({input: String(input), init});
    if (init?.method === 'DELETE') return new Response(null, {status: 204});
    return new Response(JSON.stringify({ownedItemId: '88', body: '<b>literal</b>'}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
  try {
    await removeBoardObject('77');
    await updateStickyNote('88', '<b>literal</b>');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].input, '/api/board/objects/77');
  assert.equal(calls[0].init?.method, 'DELETE');
  assert.equal(calls[1].input, '/api/board/sticky-notes/88');
  assert.equal(calls[1].init?.body, JSON.stringify({body: '<b>literal</b>'}));
});
