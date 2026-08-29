import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import session from 'express-session';
import type {Pool, QueryResultRow} from 'pg';

import {createApp} from './app.js';
import type {AppConfig} from './config.js';

const USER_ID = '123456789';
const OWNED_ITEM_ID = '77';
const GIPHY_ID = 'syntacticallyValidButMissing123';

type PoolHandler = (text: string, values: unknown[]) => QueryResultRow[];

function createPool(handler: PoolHandler = () => []): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      const rows = handler(text, values);
      return {rows, rowCount: rows.length};
    },
  } as unknown as Pool;
}

function createConfig(): AppConfig {
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

async function setSession(store: session.MemoryStore, sessionId: string): Promise<void> {
  const cookie = new session.Cookie();
  cookie.httpOnly = true;
  cookie.path = '/';
  cookie.maxAge = 604_800_000;
  await new Promise<void>((resolve, reject) => {
    store.set(sessionId, {
      cookie,
      discordUserId: USER_ID,
      username: 'gif-route-user',
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
  run: (baseUrl: string, authHeaders: Record<string, string>) => Promise<void>,
): Promise<void> {
  const config = createConfig();
  const store = new session.MemoryStore();
  const sessionId = `gif-route-${Math.random()}`;
  await setSession(store, sessionId);
  const server = createApp(config, pool, {sessionStore: store}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, {
      Cookie: sessionCookie(sessionId, config.sessionSecret),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function gifSlotPool(events: string[] = []): Pool {
  return createPool((text, values) => {
    if (text.includes('SELECT owned.item_key')) {
      events.push('ownership');
      assert.deepEqual(values, [USER_ID, OWNED_ITEM_ID]);
      return [{item_key: 'gif-slot', display_name: 'GIF Slot', item_type: 'gif'}];
    }
    if (text.includes('public.web_upsert_board_gif')) {
      events.push('persist');
      assert.deepEqual(values, [OWNED_ITEM_ID, USER_ID, GIPHY_ID]);
      assert.doesNotMatch(text, /title|url|width|height/i);
      return [{owned_itemid: OWNED_ITEM_ID, giphy_id: GIPHY_ID}];
    }
    throw new Error(`Unexpected query: ${text}`);
  });
}

function configuredGifBoardRow() {
  return {
    board_objectid: '88',
    source_type: 'shop',
    hour_rewardid: null,
    owned_itemid: OWNED_ITEM_ID,
    object_type: 'gif',
    x: 0.25,
    y: 0.5,
    milestone_hour: null,
    earned_at: null,
    granted_at: null,
    reward_item_key: null,
    reward_display_name: null,
    reward_description: null,
    reward_asset_key: null,
    reward_metadata: null,
    shop_item_key: 'gif-slot',
    shop_display_name: 'GIF Slot',
    shop_item_type: 'gif',
    sticky_body: '',
    gif_giphy_id: GIPHY_ID,
  };
}

test('Go Study has no GIPHY read client or proxy route', async () => {
  const [appSource, configSource] = await Promise.all([
    readFile('server/app.ts', 'utf8'),
    readFile('server/config.ts', 'utf8'),
  ]);
  assert.doesNotMatch(appSource, /createGiphyClient|GiphyFetch|\.search\(|\.getById|\.getByIds/);
  assert.doesNotMatch(appSource, /app\.(?:get|post|put|patch)\(['"]\/api\/giphy/);
  assert.doesNotMatch(configSource, /GIPHY_API_KEY|giphyApiKey/);

  let queried = false;
  await withServer(createPool(() => { queried = true; return []; }), async (baseUrl, authHeaders) => {
    const response = await fetch(`${baseUrl}/api/giphy/search?q=cat`, {headers: authHeaders});
    assert.equal(response.status, 404);
  });
  assert.equal(queried, false);
});

test('GIF selection rejects unauthenticated requests before parsing or querying', async () => {
  let queried = false;
  const config = createConfig();
  const server = createApp(config, createPool(() => { queried = true; return []; }), {
    sessionStore: new session.MemoryStore(),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/board/gifs/77`, {
      method: 'PUT',
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(queried, false);
});

test('board load returns only persisted GIPHY identity without server hydration', async () => {
  const pool = createPool((text, values) => {
    assert.match(text, /FROM public\.web_study_board_objects/);
    assert.doesNotMatch(text, /gif_title|preview_url|render_url|gif_width|gif_height/);
    assert.deepEqual(values, [USER_ID]);
    return [configuredGifBoardRow()];
  });
  await withServer(pool, async (baseUrl, authHeaders) => {
    const response = await fetch(`${baseUrl}/api/board`, {headers: authHeaders});
    assert.equal(response.status, 200);
    const body = await response.json() as {items: Array<{gif: unknown}>};
    assert.deepEqual(body.items[0].gif, {giphyId: GIPHY_ID});
    assert.doesNotMatch(JSON.stringify(body), /api_key|previewUrl|renderUrl|media\.giphy/i);
  });
});

test('GIF selection requires exact application Origin and JSON media type', async () => {
  await withServer(gifSlotPool(), async (baseUrl, authHeaders) => {
    const missingOrigin = await fetch(`${baseUrl}/api/board/gifs/${OWNED_ITEM_ID}`, {
      method: 'PUT',
      headers: {...authHeaders, 'Content-Type': 'application/json'},
      body: JSON.stringify({giphyId: GIPHY_ID}),
    });
    assert.equal(missingOrigin.status, 403);

    const wrongType = await fetch(`${baseUrl}/api/board/gifs/${OWNED_ITEM_ID}`, {
      method: 'PUT',
      headers: {...authHeaders, Origin: 'http://localhost:3000', 'Content-Type': 'text/plain'},
      body: JSON.stringify({giphyId: GIPHY_ID}),
    });
    assert.equal(wrongType.status, 415);
  });
});

test('selection accepts only giphyId and rejects arbitrary URL metadata', async () => {
  let queried = false;
  await withServer(createPool(() => { queried = true; return []; }), async (baseUrl, authHeaders) => {
    for (const body of [
      {giphyId: GIPHY_ID, renderUrl: 'https://evil.invalid/a.gif'},
      {giphyId: GIPHY_ID, title: 'Forged'},
      {giphyId: GIPHY_ID, width: 320, height: 240},
    ]) {
      const response = await fetch(`${baseUrl}/api/board/gifs/${OWNED_ITEM_ID}`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as {code: string}).code, 'INVALID_GIF_SELECTION');
    }
  });
  assert.equal(queried, false);
});

test('selection rejects invalid canonical GIPHY IDs before ownership lookup', async () => {
  let queried = false;
  await withServer(createPool(() => { queried = true; return []; }), async (baseUrl, authHeaders) => {
    for (const giphyId of ['', 'has space', '../path', 'x'.repeat(129)]) {
      const response = await fetch(`${baseUrl}/api/board/gifs/${OWNED_ITEM_ID}`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'Content-Type': 'application/json'},
        body: JSON.stringify({giphyId}),
      });
      assert.equal(response.status, 400);
    }
  });
  assert.equal(queried, false);
});

test('syntactically valid nonexistent GIPHY ID persists without any provider call', async () => {
  const events: string[] = [];
  await withServer(gifSlotPool(events), async (baseUrl, authHeaders) => {
    const response = await fetch(`${baseUrl}/api/board/gifs/${OWNED_ITEM_ID}`, {
      method: 'PUT',
      headers: {...authHeaders, Origin: 'http://localhost:3000', 'Content-Type': 'application/json'},
      body: JSON.stringify({giphyId: GIPHY_ID}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ownedItemId: OWNED_ITEM_ID, giphyId: GIPHY_ID});
  });
  assert.deepEqual(events, ['ownership', 'persist']);
});

test('foreign and non-GIF owned items are rejected before persistence', async () => {
  for (const [rows, status, code] of [
    [[], 404, 'GIF_SLOT_NOT_FOUND'],
    [[{item_key: 'sticky-note', display_name: 'Sticky Note', item_type: 'sticky_note'}], 409, 'BOARD_ITEM_NOT_GIF_SLOT'],
  ] as const) {
    let persisted = false;
    const pool = createPool((text) => {
      if (text.includes('SELECT owned.item_key')) return [...rows];
      persisted = true;
      return [];
    });
    await withServer(pool, async (baseUrl, authHeaders) => {
      const response = await fetch(`${baseUrl}/api/board/gifs/${OWNED_ITEM_ID}`, {
        method: 'PUT',
        headers: {...authHeaders, Origin: 'http://localhost:3000', 'Content-Type': 'application/json'},
        body: JSON.stringify({giphyId: GIPHY_ID}),
      });
      assert.equal(response.status, status);
      assert.equal((await response.json() as {code: string}).code, code);
    });
    assert.equal(persisted, false);
  }
});

test('GIF APIs never return a GIPHY key or media URL', async () => {
  await withServer(gifSlotPool(), async (baseUrl, authHeaders) => {
    const response = await fetch(`${baseUrl}/api/board/gifs/${OWNED_ITEM_ID}`, {
      method: 'PUT',
      headers: {...authHeaders, Origin: 'http://localhost:3000', 'Content-Type': 'application/json'},
      body: JSON.stringify({giphyId: GIPHY_ID}),
    });
    const body = await response.text();
    assert.doesNotMatch(body, /api_key|VITE_GIPHY|GIPHY_API_KEY|https?:\/\//i);
  });
});
