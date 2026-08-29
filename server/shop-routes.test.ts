import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';

import session from 'express-session';
import type {Pool, QueryResultRow} from 'pg';

import {createApp} from './app.js';
import type {AppConfig} from './config.js';

interface QueryCall {
  text: string;
  values: unknown[];
}

type QueryHandler = (
  text: string,
  values: unknown[],
) => QueryResultRow[] | Promise<QueryResultRow[]>;

function createPool(handler: QueryHandler, calls: QueryCall[] = []): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({text, values});
      const rows = await handler(text, values);
      return {rows, rowCount: rows.length};
    },
  } as unknown as Pool;
}

function createTestConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    appUrl: new URL('http://localhost:3000'),
    port: 0,
    databaseUrl: 'postgresql://unused',
    databaseSsl: false,
    pgPoolMax: 1,
    discordClientId: '123456789',
    discordClientSecret: 'test-only',
    discordRedirectUri: 'http://localhost:3000/auth/discord/callback',
    sessionSecret: 'test-session-secret-that-is-at-least-32-characters',
    sessionTtlSeconds: 604_800,
    trustProxy: false,
  };
}

async function setAuthenticatedSession(
  store: session.MemoryStore,
  sessionId = 'shop-test-session',
  discordUserId = '9007199254740993',
): Promise<void> {
  const cookie = new session.Cookie();
  cookie.httpOnly = true;
  cookie.path = '/';
  cookie.maxAge = 604_800_000;
  await new Promise<void>((resolve, reject) => {
    store.set(sessionId, {
      cookie,
      discordUserId,
      username: 'shopper',
      globalName: null,
      avatarHash: null,
    }, (error) => error ? reject(error) : resolve());
  });
}

function sessionCookie(sessionId: string, secret: string): string {
  const signature = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');
  return `gostudy.sid=${encodeURIComponent(`s:${sessionId}.${signature}`)}`;
}

async function withServer(
  pool: Pool,
  store: session.MemoryStore,
  run: (baseUrl: string, config: AppConfig) => Promise<void>,
): Promise<void> {
  const config = createTestConfig();
  const server = createApp(config, pool, {sessionStore: store}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, config);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function authHeaders(
  store: session.MemoryStore,
  config: AppConfig,
): Promise<Record<string, string>> {
  await setAuthenticatedSession(store);
  return {Cookie: sessionCookie('shop-test-session', config.sessionSecret)};
}

function purchaseRow(requestId: string, replayed = false) {
  return {
    purchaseid: requestId,
    userid: '9007199254740993',
    item_key: 'sticky-note',
    display_name: 'Sticky Note',
    item_type: 'sticky_note',
    price_chalk: '2',
    owned_itemid: '9223372036854775806',
    chalk_transactionid: '9223372036854775805',
    chalk_balance: '7',
    replayed,
  };
}

test('Shop GET and purchase authenticate before querying data', async () => {
  const pool = createPool(() => {
    throw new Error('Shop query must not run');
  });
  await withServer(pool, new session.MemoryStore(), async (baseUrl) => {
    for (const request of [
      fetch(`${baseUrl}/api/shop`),
      fetch(`${baseUrl}/api/shop/purchase`, {method: 'POST'}),
    ]) {
      const response = await request;
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  });
});

test('Shop GET derives userid from session and returns string balance and database catalog', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => {
    if (text.includes('web_board_shop_catalog')) return [{
      item_key: 'basic-decoration',
      display_name: 'Basic Decoration',
      item_type: 'decoration',
      price_chalk: '11',
      enabled: true,
    }];
    if (text.includes('gostudy_admin_get_chalk_account')) return [{balance: '9007199254740993'}];
    throw new Error(`Unexpected query: ${text}`);
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const headers = await authHeaders(store, config);
    const response = await fetch(`${baseUrl}/api/shop?userid=1`, {headers});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), {
      chalkBalance: '9007199254740993',
      items: [{
        itemKey: 'basic-decoration',
        displayName: 'Basic Decoration',
        itemType: 'decoration',
        priceChalk: '11',
        enabled: true,
      }],
    });
  });
  assert(calls.some((call) => call.values[0] === '9007199254740993'));
  assert(!calls.some((call) => call.values[0] === '1'));
});

test('purchase enforces exact origin, JSON, body limit, and strict price-free shape', async () => {
  const pool = createPool(() => {
    throw new Error('Invalid requests must not query the database');
  });
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const auth = await authHeaders(store, config);
    const path = `${baseUrl}/api/shop/purchase`;
    assert.equal((await fetch(path, {method: 'POST', headers: auth})).status, 403);
    assert.equal((await fetch(path, {
      method: 'POST',
      headers: {...auth, Origin: 'https://foreign.example', 'Content-Type': 'application/json'},
      body: '{}',
    })).status, 403);
    assert.equal((await fetch(path, {
      method: 'POST',
      headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'text/plain'},
      body: '{}',
    })).status, 415);
    assert.equal((await fetch(path, {
      method: 'POST',
      headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
      body: '{',
    })).status, 400);
    const invalidBodies = [
      {},
      {itemKey: 'Sticky-Note', requestId: '7cc98552-2ed4-4c49-b68c-23424d56c171'},
      {itemKey: 'sticky-note', requestId: 'not-a-uuid'},
      {
        itemKey: 'sticky-note',
        requestId: '7cc98552-2ed4-4c49-b68c-23424d56c171',
        priceChalk: '1',
      },
    ];
    for (const body of invalidBodies) {
      const response = await fetch(path, {
        method: 'POST',
        headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    assert.equal((await fetch(path, {
      method: 'POST',
      headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        itemKey: `sticky-note${'x'.repeat(17_000)}`,
        requestId: '7cc98552-2ed4-4c49-b68c-23424d56c171',
      }),
    })).status, 413);
  });
});

test('purchase calls only the web function and exact retry returns one canonical result', async () => {
  const calls: QueryCall[] = [];
  let purchaseCalls = 0;
  const requestId = '7cc98552-2ed4-4c49-b68c-23424d56c171';
  const pool = createPool((text) => {
    assert.match(text, /public\.web_purchase_board_item/);
    purchaseCalls += 1;
    return [purchaseRow(requestId, purchaseCalls > 1)];
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const auth = await authHeaders(store, config);
    for (const replayed of [false, true]) {
      const response = await fetch(`${baseUrl}/api/shop/purchase`, {
        method: 'POST',
        headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({itemKey: 'sticky-note', requestId}),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as {replayed: boolean; chalkBalance: string};
      assert.equal(body.replayed, replayed);
      assert.equal(body.chalkBalance, '7');
    }
  });
  assert.equal(purchaseCalls, 2);
  assert(calls.every((call) => call.values.length === 3));
  assert(calls.every((call) => !call.text.includes('gostudy_purchase_board_item_chalk')));
});

test('purchase database failures map to safe stable errors without raw messages', async () => {
  const scenarios = [
    ['GSB01', 404, 'ITEM_NOT_FOUND'],
    ['GSB02', 409, 'ITEM_DISABLED'],
    ['23514', 409, 'INSUFFICIENT_CHALK'],
    ['GSB03', 409, 'IDEMPOTENCY_CONFLICT'],
  ] as const;
  for (const [code, status, expectedError] of scenarios) {
    const pool = createPool(() => {
      throw Object.assign(new Error('sensitive database detail'), {code});
    });
    const store = new session.MemoryStore();
    await withServer(pool, store, async (baseUrl, config) => {
      const auth = await authHeaders(store, config);
      const response = await fetch(`${baseUrl}/api/shop/purchase`, {
        method: 'POST',
        headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          itemKey: 'sticky-note',
          requestId: '7cc98552-2ed4-4c49-b68c-23424d56c171',
        }),
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), {error: expectedError});
    });
  }
});

test('Inventory returns legacy rewards and purchased Shop instances as separate collections', async () => {
  const pool = createPool((text) => {
    if (text.includes('gostudy_user_inventory')) return [{
      hour_rewardid: '50',
      milestone_hour: '1',
      earned_at: new Date('2026-08-28T10:00:00.000Z'),
      granted_at: new Date('2026-08-28T10:00:01.000Z'),
      item_key: 'coffee',
      display_name: 'Coffee',
      description: 'Study fuel',
      asset_key: 'rewards/coffee',
      metadata: {},
      is_new: false,
    }];
    if (text.includes('web_owned_board_items')) return [{
      owned_itemid: '60',
      item_key: 'sticky-note',
      display_name: 'Sticky Note',
      item_type: 'sticky_note',
      acquired_at: new Date('2026-08-29T10:00:00.000Z'),
    }];
    throw new Error(`Unexpected query: ${text}`);
  });
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const auth = await authHeaders(store, config);
    const response = await fetch(`${baseUrl}/api/inventory?limit=20`, {headers: auth});
    assert.equal(response.status, 200);
    const body = await response.json() as {
      items: Array<{hourRewardId: string}>;
      shopItems: Array<{source: string; ownedItemId: string}>;
    };
    assert.deepEqual(body.items.map((item) => item.hourRewardId), ['50']);
    assert.deepEqual(body.shopItems, [{
      source: 'shop',
      ownedItemId: '60',
      itemKey: 'sticky-note',
      displayName: 'Sticky Note',
      itemType: 'sticky_note',
      acquiredAt: '2026-08-29T10:00:00.000Z',
    }]);
  });
});
