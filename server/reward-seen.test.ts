import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import session from 'express-session';
import type {Pool, QueryResultRow} from 'pg';

import {createApp} from './app.js';
import type {AppConfig} from './config.js';
import {
  markRewardsSeen,
  MAX_SEEN_REWARD_IDS,
  parseMarkRewardsSeenBody,
  RewardSeenOwnershipError,
  RewardSeenValidationError,
} from './reward-seen.js';

interface QueryCall {
  text: string;
  values: unknown[];
}

type QueryHandler = (
  text: string,
  values: unknown[],
) => QueryResultRow[] | Promise<QueryResultRow[]>;

function createTransactionalPool(
  transactionHandler: QueryHandler,
  calls: QueryCall[] = [],
  onRelease: () => void = () => undefined,
): Pool {
  return {
    query: async () => {
      throw new Error('Unexpected non-transactional query');
    },
    connect: async () => ({
      query: async (text: string, values: unknown[] = []) => {
        calls.push({text, values});
        const rows = await transactionHandler(text, values);
        return {rows, rowCount: rows.length};
      },
      release: onRelease,
    }),
  } as unknown as Pool;
}

function ownedRewardsHandler(ownedRewardIds: readonly string[]): QueryHandler {
  return (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return [];
    }
    if (text.includes('SELECT reward.rewardid AS hour_rewardid')) {
      return ownedRewardIds.map((hourRewardId) => ({hour_rewardid: hourRewardId}));
    }
    if (text.includes('INSERT INTO public.web_reward_seen_rewards')) {
      return [];
    }
    throw new Error(`Unexpected transaction query: ${text}`);
  };
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
      username: 'reward-test-user',
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

function readMigration(): string {
  return readFileSync(resolve('migrations/0003_create_reward_seen_rewards.sql'), 'utf8');
}

test('migration creates the per-reward seen table and exact historical baseline', () => {
  const sql = readMigration();
  const lockIndex = sql.indexOf('LOCK TABLE public.gostudy_hour_rewards IN SHARE MODE;');
  const createIndex = sql.indexOf('CREATE TABLE public.web_reward_seen_rewards');
  const baselineIndex = sql.indexOf('INSERT INTO public.web_reward_seen_rewards');
  assert.equal(sql.trimStart().startsWith('BEGIN;'), true);
  assert(lockIndex > 0 && createIndex > lockIndex && baselineIndex > createIndex);
  assert.match(sql, /PRIMARY KEY \(userid, hour_rewardid\)/);
  assert.match(sql, /SELECT\s+userid,\s+rewardid\s+FROM public\.gostudy_hour_rewards/s);
  assert.match(sql, /WHERE userid > 0\s+AND rewardid > 0;/s);
  assert.match(sql, /GRANT SELECT, INSERT\s+ON TABLE public\.web_reward_seen_rewards\s+TO gostudy_web;/s);
  assert.doesNotMatch(sql, /\bREFERENCES\b|GRANT[^;]*(?:UPDATE|DELETE)/i);
  assert.equal(sql.trimEnd().endsWith('COMMIT;'), true);
});

test('historical baseline naturally creates no rows for a user with no rewards', () => {
  const sql = readMigration();
  assert.match(sql, /INSERT INTO public\.web_reward_seen_rewards[\s\S]*SELECT\s+userid,\s+rewardid[\s\S]*FROM public\.gostudy_hour_rewards/);
  assert.doesNotMatch(sql, /gostudy_reward_accounts|LEFT JOIN|generate_series/i);
});

test('mark-seen body accepts canonical positive BIGINT IDs including the exact maximum', () => {
  assert.deepEqual(parseMarkRewardsSeenBody({
    rewardIds: ['1', '9223372036854775807'],
  }), {rewardIds: ['1', '9223372036854775807']});
});

test('mark-seen body rejects empty, oversized, duplicate, malformed, and unknown input', () => {
  const oversized = Array.from({length: MAX_SEEN_REWARD_IDS + 1}, (_, index) => String(index + 1));
  const invalidBodies: unknown[] = [
    null,
    [],
    {},
    {rewardIds: []},
    {rewardIds: oversized},
    {rewardIds: ['1', '1']},
    {rewardIds: ['0']},
    {rewardIds: ['-1']},
    {rewardIds: [' 1']},
    {rewardIds: ['01']},
    {rewardIds: ['1.0']},
    {rewardIds: ['1e3']},
    {rewardIds: ['9223372036854775808']},
    {rewardIds: [1]},
    {rewardIds: ['1'], userid: '999'},
  ];
  for (const body of invalidBodies) {
    assert.throws(() => parseMarkRewardsSeenBody(body), RewardSeenValidationError);
  }
});

test('owned rewards are marked in one transaction using exact string IDs', async () => {
  const calls: QueryCall[] = [];
  let released = false;
  const rewardIds = ['100', '9223372036854775807'];
  const pool = createTransactionalPool(
    ownedRewardsHandler(rewardIds),
    calls,
    () => { released = true; },
  );
  await markRewardsSeen(pool, '123456789', rewardIds);

  assert.equal(calls[0].text, 'BEGIN');
  assert.equal(calls.at(-1)?.text, 'COMMIT');
  assert(released);
  const ownershipCall = calls.find((call) => call.text.includes('FOR SHARE'));
  const insertCall = calls.find((call) => call.text.includes('ON CONFLICT'));
  assert.deepEqual(ownershipCall?.values, ['123456789', rewardIds]);
  assert.deepEqual(insertCall?.values, ['123456789', rewardIds]);
  assert.match(insertCall?.text ?? '', /reward\.userid = \$1::bigint/);
  assert.match(insertCall?.text ?? '', /ON CONFLICT \(userid, hour_rewardid\) DO NOTHING/);
});

test('mixed owned and foreign reward IDs reject atomically before any insert', async () => {
  const calls: QueryCall[] = [];
  const pool = createTransactionalPool(ownedRewardsHandler(['100']), calls);
  await assert.rejects(
    markRewardsSeen(pool, '123456789', ['100', '200']),
    RewardSeenOwnershipError,
  );
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
  assert(!calls.some((call) => call.text.includes('INSERT INTO public.web_reward_seen_rewards')));
});

test('repeated and concurrent mark-seen requests are harmless and conflict-safe', async () => {
  const calls: QueryCall[] = [];
  const pool = createTransactionalPool(ownedRewardsHandler(['100']), calls);
  await Promise.all([
    markRewardsSeen(pool, '123456789', ['100']),
    markRewardsSeen(pool, '123456789', ['100']),
  ]);
  const inserts = calls.filter((call) => call.text.includes('INSERT INTO public.web_reward_seen_rewards'));
  assert.equal(inserts.length, 2);
  for (const insert of inserts) {
    assert.match(insert.text, /ON CONFLICT \(userid, hour_rewardid\) DO NOTHING/);
  }
  assert.equal(calls.filter((call) => call.text === 'COMMIT').length, 2);
});

test('mark-seen API requires authentication before parsing or database access', async () => {
  const pool = createTransactionalPool(() => {
    throw new Error('Database must not be accessed');
  });
  await withTestServer(pool, new session.MemoryStore(), async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/rewards/seen`, {
      method: 'POST',
      headers: {
        Origin: config.appUrl.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({rewardIds: ['1']}),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  });
});

test('mark-seen API enforces the configured application Origin', async () => {
  const pool = createTransactionalPool(() => {
    throw new Error('Database must not be accessed');
  });
  const store = new session.MemoryStore();
  const sessionId = 'reward-origin-session';
  await setAuthenticatedSession(store, sessionId, '123456789');
  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/rewards/seen`, {
      method: 'POST',
      headers: {
        Cookie: createSessionCookie(sessionId, config.sessionSecret),
        Origin: 'https://attacker.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({rewardIds: ['1']}),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {error: 'Invalid request origin'});
  });
});

test('mark-seen API returns a generic 404 and rolls back a foreign reward batch', async () => {
  const calls: QueryCall[] = [];
  const pool = createTransactionalPool(ownedRewardsHandler(['100']), calls);
  const store = new session.MemoryStore();
  const sessionId = 'foreign-reward-session';
  await setAuthenticatedSession(store, sessionId, '123456789');
  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/rewards/seen`, {
      method: 'POST',
      headers: {
        Cookie: createSessionCookie(sessionId, config.sessionSecret),
        Origin: config.appUrl.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({rewardIds: ['100', '200']}),
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), {error: 'One or more rewards were not found'});
  });
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
  assert(!calls.some((call) => call.text.includes('INSERT INTO public.web_reward_seen_rewards')));
});

test('mark-seen API uses the session userid and returns success for an owned batch', async () => {
  const calls: QueryCall[] = [];
  const pool = createTransactionalPool(ownedRewardsHandler(['100', '101']), calls);
  const store = new session.MemoryStore();
  const sessionId = 'owned-reward-session';
  await setAuthenticatedSession(store, sessionId, '123456789');
  await withTestServer(pool, store, async (baseUrl, config) => {
    const response = await fetch(`${baseUrl}/api/rewards/seen`, {
      method: 'POST',
      headers: {
        Cookie: createSessionCookie(sessionId, config.sessionSecret),
        Origin: config.appUrl.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({rewardIds: ['100', '101']}),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), {success: true});
  });
  const insert = calls.find((call) => call.text.includes('INSERT INTO public.web_reward_seen_rewards'));
  assert.deepEqual(insert?.values, ['123456789', ['100', '101']]);
});
