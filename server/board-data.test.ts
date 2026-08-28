import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';

import session from 'express-session';
import type {Pool, QueryResultRow} from 'pg';

import {createApp} from './app.js';
import {
  BoardCapacityError,
  BoardItemAlreadyPlacedError,
  BoardItemNotFoundError,
  BoardItemNotOwnedError,
  BoardValidationError,
  createBoardItem,
  getBoardItems,
  MAX_BOARD_ITEMS,
  parseBoardItemId,
  parseBoardPlacementBody,
  parseBoardPositionBody,
  updateBoardItem,
} from './board-data.js';
import type {AppConfig} from './config.js';

interface QueryCall {
  text: string;
  values: unknown[];
  transactional: boolean;
}

type QueryHandler = (
  text: string,
  values: unknown[],
) => QueryResultRow[] | Promise<QueryResultRow[]>;

function createPool(
  queryHandler: QueryHandler,
  transactionHandler: QueryHandler = queryHandler,
  calls: QueryCall[] = [],
  onRelease: () => void = () => undefined,
): Pool {
  const execute = async (handler: QueryHandler, transactional: boolean, text: string, values: unknown[] = []) => {
    calls.push({text, values, transactional});
    const rows = await handler(text, values);
    return {rows, rowCount: rows.length};
  };
  return {
    query: (text: string, values: unknown[] = []) => execute(queryHandler, false, text, values),
    connect: async () => ({
      query: (text: string, values: unknown[] = []) => execute(transactionHandler, true, text, values),
      release: onRelease,
    }),
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

function makeBoardRow(hourRewardId: string, x = 0.25, y = 0.6, itemKey = 'coffee') {
  return {
    hour_rewardid: hourRewardId,
    x,
    y,
    milestone_hour: '42',
    earned_at: new Date('2026-08-20T10:00:00.000Z'),
    granted_at: new Date('2026-08-20T10:00:01.000Z'),
    item_key: itemKey,
    display_name: 'Coffee',
    description: 'Study fuel',
    asset_key: 'rewards/coffee',
    metadata: {rarity: 'common'},
  };
}

async function setAuthenticatedSession(
  store: session.MemoryStore,
  sessionId: string,
  discordUserId: string,
): Promise<void> {
  const cookie = new session.Cookie();
  cookie.httpOnly = true;
  cookie.path = '/';
  cookie.maxAge = 604_800_000;
  await new Promise<void>((resolve, reject) => {
    store.set(sessionId, {
      cookie,
      discordUserId,
      username: 'board-test-user',
      globalName: null,
      avatarHash: null,
    }, (error) => error ? reject(error) : resolve());
  });
}

function createSessionCookie(sessionId: string, secret: string): string {
  const signature = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');
  return `gostudy.sid=${encodeURIComponent(`s:${sessionId}.${signature}`)}`;
}

async function withTestServer(
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

function successfulPlacementHandler(row = makeBoardRow('9223372036854775806')): QueryHandler {
  return (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return [];
    }
    if (text.includes('SELECT 1') && text.includes('gostudy_user_inventory')) {
      return [{owned: 1}];
    }
    if (text.includes('INSERT INTO public.web_study_boards')) {
      return [];
    }
    if (text.includes('FOR UPDATE')) {
      return [{userid: '123456789'}];
    }
    if (text.includes('FROM public.web_study_board_items') && text.includes('SELECT 1')) {
      return [];
    }
    if (text.includes('count(*) AS item_count')) {
      return [{item_count: '0'}];
    }
    if (text.includes('WITH owned_item AS')) {
      return [row];
    }
    if (text.includes('UPDATE public.web_study_boards')) {
      return [];
    }
    throw new Error(`Unexpected transactional query: ${text}`);
  };
}

test('unauthenticated board APIs return 401 before parsing or querying', async () => {
  const pool = createPool(() => {
    throw new Error('Board query must not run');
  });
  await withTestServer(pool, new session.MemoryStore(), async (baseUrl) => {
    const requests: Array<[string, RequestInit | undefined]> = [
      ['/api/board', undefined],
      ['/api/board/items', {method: 'POST'}],
      ['/api/board/items/1', {method: 'PATCH'}],
      ['/api/board/items/1', {method: 'DELETE'}],
    ];
    for (const [path, options] of requests) {
      const response = await fetch(`${baseUrl}${path}`, options);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  });
});

test('authenticated GET returns an empty board and scopes the query to the session userid', async () => {
  const sessionUserId = '123456789';
  const calls: QueryCall[] = [];
  const pool = createPool(() => [], undefined, calls);
  const store = new session.MemoryStore();
  const sessionId = 'empty-board-session';
  await setAuthenticatedSession(store, sessionId, sessionUserId);

  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/board?userid=999`, {
      headers: {Cookie: createSessionCookie(sessionId, config.sessionSecret)},
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), {items: []});
  });
  assert.deepEqual(calls[0].values, [sessionUserId]);
  assert.match(calls[0].text, /board_item\.userid = \$1::bigint/);
  assert.match(calls[0].text, /reward\.userid = \$1::bigint/);
});

test('owned item placement is transactional and preserves BIGINT precision', async () => {
  const calls: QueryCall[] = [];
  let released = false;
  const pool = createPool(
    () => [],
    successfulPlacementHandler(),
    calls,
    () => { released = true; },
  );
  const item = await createBoardItem(pool, '123456789', {
    hourRewardId: '9223372036854775806',
    x: 0.25,
    y: 0.6,
  });

  assert.equal(item.hourRewardId, '9223372036854775806');
  assert.equal(item.x, 0.25);
  assert.equal(calls[0].text, 'BEGIN');
  assert.equal(calls.at(-1)?.text, 'COMMIT');
  assert(released);
  const insert = calls.find((call) => call.text.includes('WITH owned_item AS'));
  assert.deepEqual(insert?.values, ['123456789', '9223372036854775806', 0.25, 0.6]);
  assert.match(insert?.text ?? '', /gostudy_user_inventory/);
  assert.match(insert?.text ?? '', /gostudy_hour_rewards/);
  assert.match(insert?.text ?? '', /gostudy_reward_catalog/);
  assert(calls.some((call) => call.text.includes('FOR UPDATE')));
});

test('owned item placement API returns 201 and uses the authenticated userid', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [], successfulPlacementHandler(makeBoardRow('55')), calls);
  const store = new session.MemoryStore();
  const sessionId = 'placement-board-session';
  await setAuthenticatedSession(store, sessionId, '123456789');

  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/board/items`, {
      method: 'POST',
      headers: {
        Cookie: createSessionCookie(sessionId, config.sessionSecret),
        Origin: config.appUrl.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({hourRewardId: '55', x: 0.25, y: 0.6}),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json() as {hourRewardId: string};
    assert.equal(body.hourRewardId, '55');
  });
  const ownershipCall = calls.find((call) => call.text.includes('gostudy_user_inventory'));
  assert.deepEqual(ownershipCall?.values.slice(0, 2), ['123456789', '55']);
});

test('foreign inventory item placement is rejected and rolled back', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [], (text) => {
    if (text === 'BEGIN' || text === 'ROLLBACK') {
      return [];
    }
    if (text.includes('gostudy_user_inventory')) {
      return [];
    }
    throw new Error('No later write should run for foreign inventory');
  }, calls);

  await assert.rejects(
    createBoardItem(pool, '123456789', {hourRewardId: '55', x: 0, y: 1}),
    BoardItemNotOwnedError,
  );
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
  assert(!calls.some((call) => call.text.includes('INSERT INTO public.web_study_boards')));
});

test('duplicate placement is rejected before the capacity check', async () => {
  const calls: QueryCall[] = [];
  const baseHandler = successfulPlacementHandler();
  const pool = createPool(() => [], (text, values) => {
    if (text.includes('FROM public.web_study_board_items') && text.includes('SELECT 1')) {
      return [{placed: 1}];
    }
    return baseHandler(text, values);
  }, calls);

  await assert.rejects(
    createBoardItem(pool, '123456789', {hourRewardId: '55', x: 0, y: 1}),
    BoardItemAlreadyPlacedError,
  );
  assert(!calls.some((call) => call.text.includes('count(*) AS item_count')));
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
});

test('board placement enforces the 100-item capacity under the board row lock', async () => {
  const calls: QueryCall[] = [];
  const baseHandler = successfulPlacementHandler();
  const pool = createPool(() => [], (text, values) => {
    if (text.includes('count(*) AS item_count')) {
      return [{item_count: String(MAX_BOARD_ITEMS)}];
    }
    return baseHandler(text, values);
  }, calls);

  await assert.rejects(
    createBoardItem(pool, '123456789', {hourRewardId: '55', x: 0.5, y: 0.5}),
    BoardCapacityError,
  );
  const lockIndex = calls.findIndex((call) => call.text.includes('FOR UPDATE'));
  const countIndex = calls.findIndex((call) => call.text.includes('count(*) AS item_count'));
  assert(lockIndex >= 0 && countIndex > lockIndex);
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
});

test('capacity failures return a client-safe conflict response', async () => {
  const baseHandler = successfulPlacementHandler(makeBoardRow('55'));
  const pool = createPool(() => [], (text, values) => {
    if (text.includes('count(*) AS item_count')) {
      return [{item_count: String(MAX_BOARD_ITEMS)}];
    }
    return baseHandler(text, values);
  });
  const store = new session.MemoryStore();
  const sessionId = 'capacity-board-session';
  await setAuthenticatedSession(store, sessionId, '123456789');

  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/board/items`, {
      method: 'POST',
      headers: {
        Cookie: createSessionCookie(sessionId, config.sessionSecret),
        Origin: config.appUrl.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({hourRewardId: '55', x: 0.5, y: 0.5}),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Study Board capacity reached',
      code: 'BOARD_CAPACITY_REACHED',
      limit: MAX_BOARD_ITEMS,
    });
  });
});

test('board rows preserve duplicate catalog items as distinct inventory instances', async () => {
  const pool = createPool(() => [
    makeBoardRow('9223372036854775806', 0.1, 0.2),
    makeBoardRow('9223372036854775805', 0.8, 0.7),
  ]);
  const items = await getBoardItems(pool, '123456789');
  assert.deepEqual(items.map((item) => item.hourRewardId), [
    '9223372036854775806',
    '9223372036854775805',
  ]);
  assert.deepEqual(items.map((item) => item.itemKey), ['coffee', 'coffee']);
});

test('board input validation rejects imprecise IDs, invalid coordinates, and unknown properties', () => {
  assert.equal(parseBoardItemId('9223372036854775807'), '9223372036854775807');
  for (const value of ['0', '-1', '1.5', '1e3', '+1', '9223372036854775808', 123]) {
    assert.throws(() => parseBoardItemId(value), BoardValidationError);
  }
  for (const body of [
    {x: -0.1, y: 0.5},
    {x: 0.5, y: 1.1},
    {x: '0.5', y: 0.5},
    {x: Number.NaN, y: 0.5},
    {x: Number.POSITIVE_INFINITY, y: 0.5},
    {x: 0.5, y: 0.5, userid: '999'},
  ]) {
    assert.throws(() => parseBoardPositionBody(body), BoardValidationError);
  }
  assert.throws(
    () => parseBoardPlacementBody({hourRewardId: '1', x: 0, y: 0, assetKey: 'https://example.com'}),
    BoardValidationError,
  );
});

test('PATCH is scoped by session userid and returns not found for unowned placements', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [], undefined, calls);
  await assert.rejects(
    updateBoardItem(pool, '123456789', '55', {x: 0.2, y: 0.3}),
    BoardItemNotFoundError,
  );
  assert.deepEqual(calls[0].values, ['123456789', '55', 0.2, 0.3]);
  assert.match(calls[0].text, /board_item\.userid = \$1::bigint/);
  assert.match(calls[0].text, /reward\.userid = \$1::bigint/);
});

test('DELETE is userid-scoped and idempotently returns 204', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [], undefined, calls);
  const store = new session.MemoryStore();
  const sessionId = 'delete-board-session';
  await setAuthenticatedSession(store, sessionId, '123456789');

  await withTestServer(pool, store, async (baseUrl, config) => {
    const headers = {
      Cookie: createSessionCookie(sessionId, config.sessionSecret),
      Origin: config.appUrl.origin,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/board/items/9223372036854775806`, {
        method: 'DELETE',
        headers,
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].values, ['123456789', '9223372036854775806']);
  assert.match(calls[0].text, /WHERE userid = \$1::bigint/);
});

test('state-changing board APIs require the configured application Origin', async () => {
  const pool = createPool(() => {
    throw new Error('Origin rejection must happen before board data access');
  });
  const store = new session.MemoryStore();
  const sessionId = 'origin-board-session';
  await setAuthenticatedSession(store, sessionId, '123456789');

  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/board/items/1`, {
      method: 'DELETE',
      headers: {
        Cookie: createSessionCookie(sessionId, config.sessionSecret),
        Origin: 'https://attacker.example',
      },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {error: 'Invalid request origin'});
  });
});

test('placement rolls back and releases its client when a database operation fails', async () => {
  const calls: QueryCall[] = [];
  let released = false;
  const baseHandler = successfulPlacementHandler();
  const pool = createPool(() => [], (text, values) => {
    if (text.includes('count(*) AS item_count')) {
      throw new Error('database operation failed');
    }
    return baseHandler(text, values);
  }, calls, () => { released = true; });

  await assert.rejects(
    createBoardItem(pool, '123456789', {hourRewardId: '55', x: 0.2, y: 0.3}),
    /database operation failed/,
  );
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
  assert(released);
});
