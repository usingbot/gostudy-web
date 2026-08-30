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
      username: 'admin-test-user',
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

function mutationRow() {
  const createdAt = new Date('2026-08-29T12:00:00.000Z');
  return {
    transactionid: '301',
    userid: '200',
    amount: '10',
    balance_after: '110',
    transaction_type: 'admin_grant',
    actor_userid: '100',
    reason: 'Correction',
    created_at: createdAt,
    idempotency_key: 'unused',
    reference_type: null,
    reference_id: null,
    reversal_of_transactionid: null,
    account_balance: '110',
    account_lifetime_credited: '110',
    account_lifetime_debited: '0',
    account_created_at: createdAt,
    account_updated_at: createdAt,
    replayed: false,
  };
}

async function authenticatedHeaders(
  store: session.MemoryStore,
  config: AppConfig,
  sessionId = 'admin-session',
): Promise<Record<string, string>> {
  await setAuthenticatedSession(store, sessionId, '100');
  return {Cookie: sessionCookie(sessionId, config.sessionSecret)};
}

test('admin endpoints authenticate before reading request data or the database', async () => {
  const pool = createPool(() => {
    throw new Error('database must not be queried');
  });
  await withServer(pool, new session.MemoryStore(), async (baseUrl) => {
    for (const request of [
      fetch(`${baseUrl}/api/admin/me`),
      fetch(`${baseUrl}/api/admin/users?query=123`),
      fetch(`${baseUrl}/api/admin/users/not-an-id/chalk/grant`, {method: 'POST'}),
    ]) {
      const response = await request;
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  });
});

test('self returns current database role while protected routes deny normal users', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [], calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const headers = await authenticatedHeaders(store, config);
    const self = await fetch(`${baseUrl}/api/admin/me`, {headers});
    assert.equal(self.status, 200);
    assert.deepEqual(await self.json(), {
      role: 'user',
      capabilities: {
        accessAdmin: false,
        searchUsers: false,
        viewChalk: false,
        adjustChalk: false,
        manageTester: false,
        manageAdmin: false,
        manageOwner: false,
      },
      canManageGuildPublishing: false,
    });
    const denied = await fetch(`${baseUrl}/api/admin/users?query=200`, {headers});
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), {error: 'ADMIN_ACCESS_REQUIRED'});
  });
  assert.equal(calls.filter((call) => call.text.includes('web_user_roles')).length, 2);
});

test('self returns owner, admin, and tester capabilities from the current role row', async () => {
  const roles = new Map([
    ['101', 'owner'],
    ['102', 'admin'],
    ['103', 'tester'],
  ]);
  const pool = createPool((_text, values) => [{role: roles.get(String(values[0]))}]);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    for (const [userId, expectedRole] of roles) {
      const sessionId = `role-${expectedRole}`;
      await setAuthenticatedSession(store, sessionId, userId);
      const response = await fetch(`${baseUrl}/api/admin/me`, {
        headers: {Cookie: sessionCookie(sessionId, config.sessionSecret)},
      });
      assert.equal(response.status, 200);
      const body = await response.json() as {role: string; capabilities: {accessAdmin: boolean}};
      assert.equal(body.role, expectedRole);
      assert.equal(body.capabilities.accessAdmin, expectedRole !== 'tester');
      if (expectedRole === 'tester') {
        const denied = await fetch(`${baseUrl}/api/admin/users/200/chalk/grant`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie(sessionId, config.sessionSecret),
            Origin: config.appUrl.origin,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: '10',
            reason: 'Forbidden',
            requestId: '123e4567-e89b-42d3-a456-426614174000',
          }),
        });
        assert.equal(denied.status, 403);
      }
    }
  });
});

test('exact-ID search returns an unknown valid user without fabricating identity', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text, values) => {
    if (text.includes('web_user_roles') && values[0] === '100') return [{role: 'owner'}];
    return [];
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const headers = await authenticatedHeaders(store, config);
    const response = await fetch(`${baseUrl}/api/admin/users?query=9223372036854775807`, {headers});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {users: [{
      userid: '9223372036854775807',
      identity: null,
      role: 'user',
    }]});
  });
  assert(calls.some((call) => call.text.includes('web_sessions')));
  assert(calls.some((call) => call.values[0] === '9223372036854775807'));
});

test('protected requests re-read the actor role from the database every time', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => text.includes('web_user_roles') ? [{role: 'owner'}] : [], calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const headers = await authenticatedHeaders(store, config);
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${baseUrl}/api/admin/role-audit?limit=1`, {headers});
      assert.equal(response.status, 200);
    }
  });
  assert.equal(calls.filter((call) => call.text.includes('web_user_roles')).length, 2);
});

test('admin mutations enforce origin, media type, strict JSON, and exact body shape', async () => {
  const pool = createPool((text) => text.includes('web_user_roles') ? [{role: 'owner'}] : []);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    const auth = await authenticatedHeaders(store, config);
    const path = `${baseUrl}/api/admin/users/200/chalk/grant`;

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
    assert.equal((await fetch(path, {
      method: 'POST',
      headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        amount: '10',
        reason: 'Correction',
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        extra: true,
      }),
    })).status, 400);
    assert.equal((await fetch(path, {
      method: 'POST',
      headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        amount: '10',
        reason: 'x'.repeat(17_000),
        requestId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    })).status, 413);
  });
});

test('valid Chalk mutations call only the narrow function and namespace idempotency', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text, values) => {
    if (text.includes('web_user_roles')) {
      return [{role: values[0] === '101' ? 'owner' : 'admin'}];
    }
    if (text.includes('gostudy_admin_grant_chalk')) {
      return [{...mutationRow(), actor_userid: values[1]}];
    }
    throw new Error(`Unexpected query: ${text}`);
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    for (const [actorUserId, requestId] of [
      ['100', '123e4567-e89b-42d3-a456-426614174000'],
      ['101', '123e4567-e89b-42d3-a456-426614174001'],
    ]) {
      const sessionId = `adjust-${actorUserId}`;
      await setAuthenticatedSession(store, sessionId, actorUserId);
      const response = await fetch(`${baseUrl}/api/admin/users/200/chalk/grant`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie(sessionId, config.sessionSecret),
          Origin: config.appUrl.origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({amount: '10', reason: 'Correction', requestId}),
      });
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json() as {transaction: {actorUserId: string}}).transaction.actorUserId,
        actorUserId,
      );
    }
  });
  const mutations = calls.filter((call) => call.text.includes('gostudy_admin_grant_chalk'));
  assert.equal(mutations.length, 2);
  assert(mutations.every((mutation) => !mutation.text.includes('gostudy_apply_chalk_transaction')));
  assert.equal(mutations[0].values[3], 'admin:100:123e4567-e89b-42d3-a456-426614174000');
  assert.equal(mutations[1].values[3], 'admin:101:123e4567-e89b-42d3-a456-426614174001');
});

test('role and Chalk database conflicts map to stable HTTP errors', async () => {
  for (const scenario of [
    {path: '/api/admin/users/200/role', code: 'GSR01', expectedStatus: 409, expectedError: 'ROLE_CHANGED', body: {
      expectedRole: 'user', role: 'tester', reason: 'QA access',
    }},
    {path: '/api/admin/users/200/chalk/deduct', code: '23514', expectedStatus: 409, expectedError: 'INSUFFICIENT_CHALK', body: {
      amount: '10', reason: 'Correction', requestId: '123e4567-e89b-42d3-a456-426614174000',
    }},
    {path: '/api/admin/users/200/chalk/grant', code: '22000', expectedStatus: 409, expectedError: 'IDEMPOTENCY_CONFLICT', body: {
      amount: '10', reason: 'Correction', requestId: '123e4567-e89b-42d3-a456-426614174000',
    }},
  ]) {
    const pool = createPool((text) => {
      if (text.includes('web_user_roles')) return [{role: 'owner'}];
      throw Object.assign(new Error('expected database conflict'), {code: scenario.code});
    });
    const store = new session.MemoryStore();
    await withServer(pool, store, async (baseUrl, config) => {
      const auth = await authenticatedHeaders(store, config, `session-${scenario.code}`);
      const response = await fetch(`${baseUrl}${scenario.path}`, {
        method: 'POST',
        headers: {...auth, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
        body: JSON.stringify(scenario.body),
      });
      assert.equal(response.status, scenario.expectedStatus);
      assert.deepEqual(await response.json(), {error: scenario.expectedError});
    });
  }
});
