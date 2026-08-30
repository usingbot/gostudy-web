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
      username: 'guild-route-user',
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

function guildRow(overrides: Record<string, unknown> = {}) {
  return {
    guildid: '500',
    name: 'The Study Forum',
    icon_hash: 'abcdef',
    banner_hash: null,
    description: 'A focused community',
    member_count: 120,
    active: true,
    slug: 'the-study-forum',
    is_public: true,
    invite_code: 'example',
    tags: ['Study', 'SAT'],
    ...overrides,
  };
}

function publicationBody(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'the-study-forum',
    isPublic: true,
    invite: 'https://discord.gg/example',
    tags: ['Study', 'SAT'],
    ...overrides,
  };
}

function requestHeaders(cookie: string, origin = 'http://localhost:3000') {
  return {
    Cookie: cookie,
    Origin: origin,
    'Content-Type': 'application/json',
  };
}

test('Guild Publishing routes require authentication before database or body handling', async () => {
  const pool = createPool(() => {
    throw new Error('database must not be queried');
  });
  await withServer(pool, new session.MemoryStore(), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/admin/servers`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers/500`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(publicationBody()),
    })).status, 401);
  });
});

test('manageable active guilds list with metadata and saved publication settings', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => {
    if (text.includes('web_user_roles')) return [];
    if (text.includes('FROM public.gostudy_guilds AS guild')) return [guildRow()];
    throw new Error('unexpected query');
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'list-session', '100', ['500']);
    const response = await fetch(`${baseUrl}/api/admin/servers`, {
      headers: {Cookie: sessionCookie('list-session', config.sessionSecret)},
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {guilds: Array<{name: string; memberCount: number; publication: {tags: string[]}}>};
    assert.equal(body.guilds[0].name, 'The Study Forum');
    assert.equal(body.guilds[0].memberCount, 120);
    assert.deepEqual(body.guilds[0].publication.tags, ['Study', 'SAT']);
  });
  const listCall = calls.find((call) => call.text.includes('array_agg'));
  assert.deepEqual(listCall?.values, [false, ['500']]);
});

test('Discord-authorized ordinary user saves strict publication settings successfully', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => {
    if (text.includes('web_user_roles')) return [];
    if (text.includes('web_upsert_guild_publication')) return [{}];
    if (text.includes('FROM public.gostudy_guilds AS guild')) return [guildRow()];
    throw new Error('unexpected query');
  }, calls);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'save-session', '100', ['500']);
    const response = await fetch(`${baseUrl}/api/admin/servers/500`, {
      method: 'PUT',
      headers: requestHeaders(sessionCookie('save-session', config.sessionSecret)),
      body: JSON.stringify(publicationBody()),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {guild: {publication: {inviteUrl: string}}};
    assert.equal(body.guild.publication.inviteUrl, 'https://discord.gg/example');
  });
  const mutation = calls.find((call) => call.text.includes('web_upsert_guild_publication'));
  assert.deepEqual(mutation?.values, ['500', 'the-study-forum', true, 'example', ['Study', 'SAT'], '100']);
});

test('unrelated guild and ordinary web admin receive no global override', async () => {
  for (const role of ['user', 'admin']) {
    const calls: QueryCall[] = [];
    const pool = createPool((text) => text.includes('web_user_roles') && role === 'admin'
      ? [{role: 'admin'}]
      : [], calls);
    const store = new session.MemoryStore();
    await withServer(pool, store, async (baseUrl, config) => {
      await setAuthenticatedSession(store, `denied-${role}`, '100', ['999']);
      const response = await fetch(`${baseUrl}/api/admin/servers/500`, {
        method: 'PUT',
        headers: requestHeaders(sessionCookie(`denied-${role}`, config.sessionSecret)),
        body: JSON.stringify(publicationBody()),
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {error: 'GUILD_MANAGEMENT_REQUIRED'});
    });
    assert.equal(calls.some((call) => call.text.includes('web_upsert_guild_publication')), false);
  }
});

test('Go Study owner override can save any active registered guild', async () => {
  const pool = createPool((text) => {
    if (text.includes('web_user_roles')) return [{role: 'owner'}];
    if (text.includes('web_upsert_guild_publication')) return [{}];
    if (text.includes('FROM public.gostudy_guilds AS guild')) return [guildRow()];
    return [];
  });
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'owner-session', '100');
    const response = await fetch(`${baseUrl}/api/admin/servers/500`, {
      method: 'PUT',
      headers: requestHeaders(sessionCookie('owner-session', config.sessionSecret)),
      body: JSON.stringify(publicationBody()),
    });
    assert.equal(response.status, 200);
  });
});

test('mutations require exact origin, JSON media type, body limit, and no unknown fields', async () => {
  const pool = createPool((text) => text.includes('web_user_roles') ? [] : []);
  const store = new session.MemoryStore();
  await withServer(pool, store, async (baseUrl, config) => {
    await setAuthenticatedSession(store, 'strict-session', '100', ['500']);
    const cookie = sessionCookie('strict-session', config.sessionSecret);

    const wrongOrigin = await fetch(`${baseUrl}/api/admin/servers/500`, {
      method: 'PUT', headers: requestHeaders(cookie, 'https://evil.example'), body: JSON.stringify(publicationBody()),
    });
    assert.equal(wrongOrigin.status, 403);

    const wrongType = await fetch(`${baseUrl}/api/admin/servers/500`, {
      method: 'PUT', headers: {Cookie: cookie, Origin: config.appUrl.origin}, body: JSON.stringify(publicationBody()),
    });
    assert.equal(wrongType.status, 415);

    const unknown = await fetch(`${baseUrl}/api/admin/servers/500`, {
      method: 'PUT', headers: requestHeaders(cookie), body: JSON.stringify(publicationBody({guildid: '500'})),
    });
    assert.equal(unknown.status, 400);

    const oversized = await fetch(`${baseUrl}/api/admin/servers/500`, {
      method: 'PUT', headers: requestHeaders(cookie), body: JSON.stringify(publicationBody({tags: ['x'.repeat(17_000)]})),
    });
    assert.equal(oversized.status, 413);
  });
});

test('inactive guild and slug conflicts return stable safe errors', async () => {
  for (const scenario of [
    {code: 'GSG01', status: 403, error: 'GUILD_NOT_ACTIVE'},
    {code: '23505', status: 409, error: 'GUILD_SLUG_CONFLICT'},
  ]) {
    const pool = createPool((text) => {
      if (text.includes('web_user_roles')) return [];
      if (text.includes('web_upsert_guild_publication')) throw Object.assign(new Error('private database detail'), {code: scenario.code});
      return [];
    });
    const store = new session.MemoryStore();
    await withServer(pool, store, async (baseUrl, config) => {
      await setAuthenticatedSession(store, `error-${scenario.code}`, '100', ['500']);
      const response = await fetch(`${baseUrl}/api/admin/servers/500`, {
        method: 'PUT',
        headers: requestHeaders(sessionCookie(`error-${scenario.code}`, config.sessionSecret)),
        body: JSON.stringify(publicationBody()),
      });
      assert.equal(response.status, scenario.status);
      assert.deepEqual(await response.json(), {error: scenario.error});
    });
  }
});
