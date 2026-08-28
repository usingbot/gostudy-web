import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';

import session from 'express-session';
import type {Pool, QueryResultRow} from 'pg';

import {createApp} from './app.js';
import type {AppConfig} from './config.js';
import {
  calculateDashboardProgress,
  getDashboardData,
  getInventoryPage,
  MAX_INVENTORY_LIMIT,
  PaginationValidationError,
  parseInventoryPagination,
} from './product-data.js';

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
      return {rows: await handler(text, values)};
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

function makeInventoryRow(hourRewardId: string, itemKey = 'coffee', isNew = false) {
  return {
    hour_rewardid: hourRewardId,
    milestone_hour: '42',
    earned_at: new Date('2026-08-20T10:00:00.000Z'),
    granted_at: new Date('2026-08-20T10:00:01.000Z'),
    item_key: itemKey,
    display_name: 'Coffee',
    description: 'Study fuel',
    asset_key: 'rewards/coffee',
    metadata: {rarity: 'common'},
    is_new: isNew,
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
      username: 'test-user',
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

test('unauthenticated product APIs return 401 without querying product data', async () => {
  const pool = createPool(() => {
    throw new Error('Product query must not run');
  });
  const store = new session.MemoryStore();

  await withTestServer(pool, store, async (baseUrl) => {
    for (const path of ['/api/dashboard', '/api/inventory', '/api/catalog']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  });
});

test('dashboard calculations handle milestone boundaries', () => {
  const cases = [
    [3599, {completedHours: 0, progressSeconds: 3599, secondsToNextMilestone: 1}],
    [3600, {completedHours: 1, progressSeconds: 0, secondsToNextMilestone: 3600}],
    [3601, {completedHours: 1, progressSeconds: 1, secondsToNextMilestone: 3599}],
    [7200, {completedHours: 2, progressSeconds: 0, secondsToNextMilestone: 3600}],
  ] as const;

  for (const [verifiedSeconds, expected] of cases) {
    assert.deepEqual(calculateDashboardProgress(verifiedSeconds), expected);
  }
});

test('dashboard returns zero seconds and empty recent inventory when the account is absent', async () => {
  const pool = createPool(() => []);
  const dashboard = await getDashboardData(pool, '123456789');

  assert.deepEqual(dashboard, {
    verifiedSeconds: 0,
    completedHours: 0,
    progressSeconds: 0,
    secondsToNextMilestone: 3600,
    recentInventory: [],
    newRewardCount: 0,
  });
});

test('dashboard counts only rewards without a per-reward seen row', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => {
    if (text.includes('gostudy_reward_accounts')) {
      return [{verified_seconds: '3601'}];
    }
    if (text.includes('count(*) AS new_reward_count')) {
      return [{new_reward_count: '2'}];
    }
    if (text.includes('gostudy_user_inventory')) {
      return [makeInventoryRow('10', 'coffee', true)];
    }
    throw new Error(`Unexpected query: ${text}`);
  }, calls);

  const dashboard = await getDashboardData(pool, '123456789');
  assert.equal(dashboard.newRewardCount, 2);
  assert.equal(dashboard.recentInventory[0].isNew, true);
  const countCall = calls.find((call) => call.text.includes('new_reward_count'));
  assert.deepEqual(countCall?.values, ['123456789']);
  assert.match(countCall?.text ?? '', /NOT EXISTS/);
  assert.match(countCall?.text ?? '', /seen\.hour_rewardid = reward\.rewardid/);
});

test('pagination validates bounds and PostgreSQL BIGINT cursors', () => {
  assert.deepEqual(parseInventoryPagination({}), {limit: 20, cursor: null});
  assert.deepEqual(
    parseInventoryPagination({limit: String(MAX_INVENTORY_LIMIT), cursor: '9223372036854775807'}),
    {limit: MAX_INVENTORY_LIMIT, cursor: '9223372036854775807'},
  );

  for (const query of [
    {limit: '0'},
    {limit: String(MAX_INVENTORY_LIMIT + 1)},
    {limit: '1.5'},
    {limit: ['10', '20']},
    {cursor: '0'},
    {cursor: '-1'},
    {cursor: '1 OR 1=1'},
    {cursor: '9223372036854775808'},
  ]) {
    assert.throws(() => parseInventoryPagination(query), PaginationValidationError);
  }
});

test('inventory preserves duplicate instances and BIGINT IDs as strings', async () => {
  const rows = [
    makeInventoryRow('9223372036854775806'),
    makeInventoryRow('9223372036854775805'),
  ];
  const calls: QueryCall[] = [];
  const pool = createPool(() => rows, calls);
  const page = await getInventoryPage(pool, '123456789', {limit: 10, cursor: null});

  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items.map((item) => item.hourRewardId), [
    '9223372036854775806',
    '9223372036854775805',
  ]);
  assert.deepEqual(page.items.map((item) => item.itemKey), ['coffee', 'coffee']);
  assert.deepEqual(page.items.map((item) => item.isNew), [false, false]);
  assert.equal(calls[0].values[0], '123456789');
  assert.match(calls[0].text, /WHERE hr\.userid = \$1::bigint/);
  assert.match(calls[0].text, /web_reward_seen_rewards/);
  assert.match(calls[0].text, /NOT EXISTS/);
});

test('inventory represents arbitrary unseen holes independently on every keyset page', async () => {
  const pool = createPool(() => [
    makeInventoryRow('100', 'coffee', true),
    makeInventoryRow('99', 'coffee', false),
    makeInventoryRow('98', 'coffee', true),
  ]);
  const page = await getInventoryPage(pool, '123456789', {limit: 3, cursor: null});
  assert.deepEqual(page.items.map(({hourRewardId, isNew}) => ({hourRewardId, isNew})), [
    {hourRewardId: '100', isNew: true},
    {hourRewardId: '99', isNew: false},
    {hourRewardId: '98', isNew: true},
  ]);
});

test('empty inventory returns an empty bounded page', async () => {
  const pool = createPool(() => []);
  const page = await getInventoryPage(pool, '123456789', {limit: 10, cursor: null});
  assert.deepEqual(page, {items: [], nextCursor: null});
});

test('inventory keyset pages are bounded and return the last visible ID as cursor', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [
    makeInventoryRow('30'),
    makeInventoryRow('20'),
    makeInventoryRow('10'),
  ], calls);
  const page = await getInventoryPage(pool, '123456789', {limit: 2, cursor: '40'});

  assert.deepEqual(page.items.map((item) => item.hourRewardId), ['30', '20']);
  assert.equal(page.nextCursor, '20');
  assert.deepEqual(calls[0].values, ['123456789', '40', 3]);
});

test('inventory API scopes data to the session userid and ignores browser userid input', async () => {
  const sessionUserId = '123456789';
  const calls: QueryCall[] = [];
  const pool = createPool(() => [
    makeInventoryRow('9223372036854775806'),
    makeInventoryRow('9223372036854775805'),
  ], calls);
  const store = new session.MemoryStore();
  const sessionId = 'authenticated-test-session';
  await setAuthenticatedSession(store, sessionId, sessionUserId);

  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/inventory?limit=2&userid=999999999`, {
      headers: {Cookie: createSessionCookie(sessionId, config.sessionSecret)},
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');

    const body = await response.json() as {
      items: Array<{hourRewardId: string; itemKey: string}>;
      nextCursor: string | null;
    };
    assert.deepEqual(body.items.map((item) => item.hourRewardId), [
      '9223372036854775806',
      '9223372036854775805',
    ]);
    assert.deepEqual(body.items.map((item) => item.itemKey), ['coffee', 'coffee']);
    assert.equal(calls[0].values[0], sessionUserId);
    assert.notEqual(calls[0].values[0], '999999999');
  });
});

test('database error details are not exposed by authenticated APIs', async () => {
  const pool = createPool(() => {
    throw new Error('sensitive database connection detail');
  });
  const store = new session.MemoryStore();
  const sessionId = 'database-error-test-session';
  await setAuthenticatedSession(store, sessionId, '123456789');
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    await withTestServer(pool, store, async (baseUrl, config) => {
      const response = await fetch(`${baseUrl}/api/dashboard`, {
        headers: {Cookie: createSessionCookie(sessionId, config.sessionSecret)},
      });
      assert.equal(response.status, 500);
      const body = await response.text();
      assert.equal(body, '{"error":"Internal server error"}');
      assert.doesNotMatch(body, /sensitive|database connection/i);
    });
  } finally {
    console.error = originalConsoleError;
  }
});
