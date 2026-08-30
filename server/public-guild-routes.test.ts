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

function createPool(
  handler: (text: string, values: unknown[]) => QueryResultRow[],
  calls: QueryCall[],
): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({text, values});
      const rows = handler(text, values);
      return {rows, rowCount: rows.length};
    },
  } as unknown as Pool;
}

async function withServer(
  pool: Pool,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const store = new session.MemoryStore();
  let sessionReads = 0;
  const originalGet = store.get.bind(store);
  store.get = (sessionId, callback) => {
    sessionReads += 1;
    originalGet(sessionId, callback);
  };
  const server = createApp(createTestConfig(), pool, {sessionStore: store})
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`);
    assert.equal(sessionReads, 0, 'public discovery must bypass session storage');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('public server gallery works without authentication and returns only public DTO fields', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [guildRow()], calls);
  await withServer(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/servers`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /^public, max-age=60/);
    const body = await response.json() as {servers: Array<Record<string, unknown>>};
    assert.deepEqual(Object.keys(body.servers[0]).sort(), [
      'bannerUrl', 'description', 'iconUrl', 'inviteUrl',
      'memberCount', 'name', 'slug', 'tags',
    ]);
    assert.equal(body.servers[0].guildid, undefined);
    assert.equal(body.servers[0].isPublic, undefined);
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /guild\.active = TRUE/);
  assert.match(calls[0].text, /publication\.is_public = TRUE/);
  assert.deepEqual(calls[0].values, []);
});

test('public server detail is unauthenticated and uses the slug as a SQL parameter', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [guildRow()], calls);
  await withServer(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/servers/the-study-forum`);
    assert.equal(response.status, 200);
    const body = await response.json() as {server: {slug: string; inviteUrl: string}};
    assert.equal(body.server.slug, 'the-study-forum');
    assert.equal(body.server.inviteUrl, 'https://discord.gg/example');
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /publication\.slug = \$1::text/);
  assert.match(calls[0].text, /guild\.active = TRUE/);
  assert.match(calls[0].text, /publication\.is_public = TRUE/);
  assert.deepEqual(calls[0].values, ['the-study-forum']);
  assert.equal(calls[0].text.includes('the-study-forum'), false);
});

test('hidden, inactive, and unknown canonical slugs all return the same safe 404', async () => {
  for (const slug of ['hidden-study', 'inactive-study', 'unknown-study']) {
    const calls: QueryCall[] = [];
    await withServer(createPool(() => [], calls), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/servers/${slug}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {error: 'SERVER_NOT_FOUND'});
    });
    assert.deepEqual(calls[0].values, [slug]);
  }
});

test('malformed public slugs fail as 404 before any database or session access', async () => {
  for (const slug of ['AB', 'Not-Canonical', 'bad--slug', '-leading']) {
    const calls: QueryCall[] = [];
    await withServer(createPool(() => {
      throw new Error('database must not be queried');
    }, calls), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/servers/${slug}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {error: 'SERVER_NOT_FOUND'});
    });
    assert.equal(calls.length, 0);
  }
});

test('public discovery exposes GET only and leaves admin authentication intact', async () => {
  const calls: QueryCall[] = [];
  await withServer(createPool(() => [], calls), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/servers`, {method: 'POST'})).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/admin/servers`)).status, 401);
  });
  assert.equal(calls.length, 0);
});
