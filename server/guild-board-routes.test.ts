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
  userId: string,
  manageableGuildIds: string[] = [],
): Promise<void> {
  const cookie = new session.Cookie();
  cookie.httpOnly = true;
  cookie.path = '/';
  cookie.maxAge = 604_800_000;
  await new Promise<void>((resolve, reject) => {
    store.set(sessionId, {
      cookie,
      discordUserId: userId,
      username: 'board-route-user',
      globalName: null,
      avatarHash: null,
      manageableGuildIds,
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

function boardBody(overrides: Record<string, unknown> = {}) {
  return {theme: 'mint', expectedRevision: '0', ...overrides};
}

function capacityBody(overrides: Record<string, unknown> = {}) {
  return {width: 4500, height: 2700, expectedRevision: '1', ...overrides};
}

function mutationHeaders(cookie: string, origin = 'http://localhost:3000') {
  return {Cookie: cookie, Origin: origin, 'Content-Type': 'application/json'};
}

test('public board is anonymous, returns exact default DTO, and never opens a session or creates a row', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [{theme_key: null, width_units: null, height_units: null, revision: null}], calls);
  const store = new session.MemoryStore();
  let sessionReads = 0;
  const originalGet = store.get.bind(store);
  store.get = (sessionId, callback) => {
    sessionReads += 1;
    originalGet(sessionId, callback);
  };
  await withServer(pool, store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/servers/study-forum/board`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /^public, max-age=60/);
    assert.deepEqual(await response.json(), {
      board: {theme: 'midnight', width: 3000, height: 1800, revision: '0', objects: []},
    });
  });
  assert.equal(sessionReads, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /publication\.slug = \$1::text/);
  assert.match(calls[0].text, /guild\.active = TRUE/);
  assert.match(calls[0].text, /publication\.is_public = TRUE/);
  assert.doesNotMatch(calls[0].text, /INSERT|UPDATE|DELETE/);
  assert.deepEqual(calls[0].values, ['study-forum']);
});

test('public board returns persisted safe theme while hidden, inactive, unknown, and malformed slugs share 404', async () => {
  await withServer(
    createPool(() => [{theme_key: 'paper', width_units: 6000, height_units: 3600, revision: '8'}]),
    new session.MemoryStore(),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/servers/study-forum/board`);
      assert.deepEqual(await response.json(), {board: {theme: 'paper', width: 6000, height: 3600, revision: '8', objects: []}});
    },
  );

  for (const slug of ['hidden-study', 'inactive-study', 'unknown-study']) {
    await withServer(createPool(() => []), new session.MemoryStore(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/servers/${slug}/board`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {error: 'SERVER_NOT_FOUND'});
    });
  }

  const calls: QueryCall[] = [];
  await withServer(createPool(() => {
    throw new Error('malformed slug must not query');
  }, calls), new session.MemoryStore(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/servers/Not--Canonical/board`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {error: 'SERVER_NOT_FOUND'});
  });
  assert.equal(calls.length, 0);
});

test('admin board endpoints authenticate before database or body handling', async () => {
  const pool = createPool(() => {
    throw new Error('database must not be queried');
  });
  await withServer(pool, new session.MemoryStore(), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board/theme`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(boardBody()),
    })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board/capacity`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(capacityBody()),
    })).status, 401);
  });
});

test('Discord-manageable user reads default and saves with session actor plus optimistic revision', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => {
    if (text.includes('web_user_roles')) return [];
    if (text.includes('web_upsert_guild_board_theme')) return [{theme_key: 'mint', width_units: 3000, height_units: 1800, revision: '1'}];
    if (text.includes('LEFT JOIN public.web_guild_boards')) return [{theme_key: null, width_units: null, height_units: null, revision: null}];
    throw new Error('unexpected query');
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'board-session', '100', ['500']);
    const cookie = sessionCookie('board-session', config.sessionSecret);
    const getResponse = await fetch(`${baseUrl}/api/admin/servers/500/board`, {
      headers: {Cookie: cookie},
    });
    assert.deepEqual(await getResponse.json(), {board: {theme: 'midnight', width: 3000, height: 1800, revision: '0'}});

    const putResponse = await fetch(`${baseUrl}/api/admin/servers/500/board/theme`, {
      method: 'PUT',
      headers: mutationHeaders(cookie),
      body: JSON.stringify(boardBody()),
    });
    assert.equal(putResponse.status, 200);
    assert.deepEqual(await putResponse.json(), {board: {theme: 'mint', width: 3000, height: 1800, revision: '1'}});
  });
  const mutation = calls.find((call) => call.text.includes('web_upsert_guild_board_theme'));
  assert.deepEqual(mutation?.values, ['500', 'mint', '0', '100']);
});

test('ordinary web admin has no global guild override while Go Study owner does', async () => {
  for (const role of ['admin', 'owner'] as const) {
    const calls: QueryCall[] = [];
    const pool = createPool((text) => {
      if (text.includes('web_user_roles')) return [{role}];
      if (text.includes('LEFT JOIN public.web_guild_boards')) return [{theme_key: 'cork', width_units: 3000, height_units: 1800, revision: '2'}];
      throw new Error('unexpected query');
    }, calls);
    const store = new session.MemoryStore();
    await withServer(pool, store, async (baseUrl, config) => {
      await setAuthenticatedSession(store, `role-${role}`, '100', ['999']);
      const response = await fetch(`${baseUrl}/api/admin/servers/500/board`, {
        headers: {Cookie: sessionCookie(`role-${role}`, config.sessionSecret)},
      });
      assert.equal(response.status, role === 'owner' ? 200 : 403);
    });
    assert.equal(calls.some((call) => call.text.includes('LEFT JOIN public.web_guild_boards')), role === 'owner');
  }
});

test('Go Study platform owner expands capacity with fixed dimensions, revision, and session actor', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => {
    if (text.includes('web_user_roles')) return [{role: 'owner'}];
    if (text.includes('web_expand_guild_board')) {
      return [{theme_key: 'cork', width_units: 4500, height_units: 2700, revision: '2'}];
    }
    throw new Error('unexpected query');
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'capacity-owner', '100');
    const response = await fetch(`${baseUrl}/api/admin/servers/500/board/capacity`, {
      method: 'PUT',
      headers: mutationHeaders(sessionCookie('capacity-owner', config.sessionSecret)),
      body: JSON.stringify(capacityBody()),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      board: {theme: 'cork', width: 4500, height: 2700, revision: '2'},
    });
  });
  const mutation = calls.find((call) => call.text.includes('web_expand_guild_board'));
  assert.deepEqual(mutation?.values, ['500', 4500, 2700, '1', '100']);
});

test('guild managers and ordinary Go Study admins cannot call capacity expansion', async () => {
  for (const role of ['user', 'admin'] as const) {
    const calls: QueryCall[] = [];
    const pool = createPool((text) => text.includes('web_user_roles') && role === 'admin'
      ? [{role: 'admin'}]
      : [], calls);
    const store = new session.MemoryStore();
    await withServer(pool, store, async (baseUrl, config) => {
      await setAuthenticatedSession(store, `capacity-${role}`, '100', ['500']);
      const response = await fetch(`${baseUrl}/api/admin/servers/500/board/capacity`, {
        method: 'PUT',
        headers: mutationHeaders(sessionCookie(`capacity-${role}`, config.sessionSecret)),
        body: JSON.stringify(capacityBody()),
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {error: 'GUILD_BOARD_CAPACITY_FORBIDDEN'});
    });
    assert.equal(calls.some((call) => call.text.includes('web_expand_guild_board')), false);
  }
});

test('capacity expansion requires exact origin, JSON, fixed pairs, and strict fields', async () => {
  const pool = createPool(() => []);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'strict-capacity', '100');
    const cookie = sessionCookie('strict-capacity', config.sessionSecret);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board/capacity`, {
      method: 'PUT', headers: mutationHeaders(cookie, 'https://evil.example'), body: JSON.stringify(capacityBody()),
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board/capacity`, {
      method: 'PUT', headers: {Cookie: cookie, Origin: config.appUrl.origin}, body: JSON.stringify(capacityBody()),
    })).status, 415);
    for (const body of [
      capacityBody({width: 4501}),
      capacityBody({height: 2701}),
      capacityBody({role: 'owner'}),
      capacityBody({expectedRevision: 1}),
    ]) {
      const response = await fetch(`${baseUrl}/api/admin/servers/500/board/capacity`, {
        method: 'PUT', headers: mutationHeaders(cookie), body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {error: 'INVALID_GUILD_BOARD_CAPACITY'});
    }
  });
});

test('capacity revision conflict maps to a safe 409 response', async () => {
  const pool = createPool((text) => {
    if (text.includes('web_user_roles')) return [{role: 'owner'}];
    if (text.includes('web_expand_guild_board')) {
      throw Object.assign(new Error('stale'), {code: 'GGB01'});
    }
    return [];
  });
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'capacity-conflict', '100');
    const response = await fetch(`${baseUrl}/api/admin/servers/500/board/capacity`, {
      method: 'PUT',
      headers: mutationHeaders(sessionCookie('capacity-conflict', config.sessionSecret)),
      body: JSON.stringify(capacityBody()),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {error: 'GUILD_BOARD_REVISION_CONFLICT'});
  });
});

test('board mutations enforce origin, JSON, exact fields, fixed theme, string revision, and body limit', async () => {
  const pool = createPool(() => []);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'strict-board', '100', ['500']);
    const cookie = sessionCookie('strict-board', config.sessionSecret);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board/theme`, {
      method: 'PUT', headers: mutationHeaders(cookie, 'https://evil.example'), body: JSON.stringify(boardBody()),
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board/theme`, {
      method: 'PUT', headers: {Cookie: cookie, Origin: config.appUrl.origin}, body: JSON.stringify(boardBody()),
    })).status, 415);
    for (const body of [
      boardBody({actor: '100'}),
      boardBody({theme: 'https://example.com/theme.png'}),
      boardBody({expectedRevision: 0}),
      boardBody({expectedRevision: '-1'}),
    ]) {
      const response = await fetch(`${baseUrl}/api/admin/servers/500/board/theme`, {
        method: 'PUT', headers: mutationHeaders(cookie), body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {error: 'INVALID_GUILD_BOARD'});
    }
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500/board/theme`, {
      method: 'PUT', headers: mutationHeaders(cookie), body: JSON.stringify(boardBody({padding: 'x'.repeat(17_000)})),
    })).status, 413);
  });
});

test('stale revision and inactive guild database errors map to stable safe responses', async () => {
  for (const [code, status, responseCode] of [
    ['GGB01', 409, 'GUILD_BOARD_REVISION_CONFLICT'],
    ['GSG01', 403, 'GUILD_NOT_ACTIVE'],
  ] as const) {
    const pool = createPool((text) => {
      if (text.includes('web_user_roles')) return [];
      if (text.includes('web_upsert_guild_board_theme')) throw Object.assign(new Error('database error'), {code});
      return [];
    });
    const store = new session.MemoryStore();
    await withServer(pool, store, async (baseUrl, config) => {
      await setAuthenticatedSession(store, `error-${code}`, '100', ['500']);
      const response = await fetch(`${baseUrl}/api/admin/servers/500/board/theme`, {
        method: 'PUT',
        headers: mutationHeaders(sessionCookie(`error-${code}`, config.sessionSecret)),
        body: JSON.stringify(boardBody()),
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), {error: responseCode});
    });
  }
});

test('inactive or unknown admin board and malformed guild IDs fail safely', async () => {
  const pool = createPool((text) => text.includes('web_user_roles') ? [] : []);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'missing-board', '100', ['500']);
    const cookie = sessionCookie('missing-board', config.sessionSecret);
    const missing = await fetch(`${baseUrl}/api/admin/servers/500/board`, {headers: {Cookie: cookie}});
    assert.equal(missing.status, 403);
    assert.deepEqual(await missing.json(), {error: 'GUILD_NOT_ACTIVE'});
    const malformed = await fetch(`${baseUrl}/api/admin/servers/not-a-guild/board`, {headers: {Cookie: cookie}});
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {error: 'INVALID_GUILD_BOARD_REQUEST'});
  });
});
