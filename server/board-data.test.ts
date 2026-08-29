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
  BoardItemUnsupportedError,
  BoardValidationError,
  countStickyNoteCharacters,
  countStickyNoteWords,
  createBoardItem,
  createShopBoardItem,
  deleteBoardObject,
  getBoardItems,
  MAX_BOARD_ITEMS,
  parseBoardItemId,
  parseBoardObjectId,
  parseBoardPlacementBody,
  parseBoardPositionBody,
  parseGiphyId,
  parseGiphySelectionBody,
  parseOwnedItemId,
  parseShopBoardPlacementBody,
  parseStickyNoteBody,
  updateBoardObject,
  updateStickyNote,
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
  const execute = async (
    handler: QueryHandler,
    transactional: boolean,
    text: string,
    values: unknown[] = [],
  ) => {
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

function makeRewardRow(
  hourRewardId = '9223372036854775806',
  boardObjectId = '9223372036854775807',
  x = 0.25,
  y = 0.6,
) {
  return {
    board_objectid: boardObjectId,
    source_type: 'reward',
    hour_rewardid: hourRewardId,
    owned_itemid: null,
    object_type: 'reward_decoration',
    x,
    y,
    milestone_hour: '42',
    earned_at: new Date('2026-08-20T10:00:00.000Z'),
    granted_at: new Date('2026-08-20T10:00:01.000Z'),
    reward_item_key: 'coffee',
    reward_display_name: 'Coffee',
    reward_description: 'Study fuel',
    reward_asset_key: 'rewards/coffee',
    reward_metadata: {rarity: 'common'},
    shop_item_key: null,
    shop_display_name: null,
    shop_item_type: null,
    sticky_body: null,
    gif_giphy_id: null,
  };
}

function makeShopRow(
  itemType: 'sticky_note' | 'decoration' | 'gif' | 'photo_frame' = 'sticky_note',
  ownedItemId = '9223372036854775805',
  boardObjectId = '9223372036854775804',
  body = 'Review chapter four',
) {
  return {
    board_objectid: boardObjectId,
    source_type: 'shop',
    hour_rewardid: null,
    owned_itemid: ownedItemId,
    object_type: itemType,
    x: 0.7,
    y: 0.2,
    milestone_hour: null,
    earned_at: null,
    granted_at: null,
    reward_item_key: null,
    reward_display_name: null,
    reward_description: null,
    reward_asset_key: null,
    reward_metadata: null,
    shop_item_key: itemType === 'sticky_note'
      ? 'sticky-note'
      : itemType === 'decoration'
        ? 'basic-decoration'
        : itemType === 'gif'
          ? 'gif-slot'
          : 'photo-frame',
    shop_display_name: itemType === 'sticky_note'
      ? 'Sticky Note'
      : itemType === 'decoration'
        ? 'Basic Decoration'
        : itemType === 'gif'
          ? 'GIF Slot'
          : 'Photo Frame',
    shop_item_type: itemType,
    sticky_body: itemType === 'sticky_note' ? body : '',
    gif_giphy_id: null,
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

function rewardPlacementHandler(row = makeRewardRow()): QueryHandler {
  return (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return [];
    if (text.includes('SELECT 1') && text.includes('gostudy_user_inventory')) return [{owned: 1}];
    if (text.includes('SELECT 1') && text.includes('web_study_board_objects')) return [];
    if (text.includes('INSERT INTO public.web_study_boards')) return [];
    if (text.includes('FOR UPDATE')) return [{userid: '123456789'}];
    if (text.includes('count(*) AS item_count')) return [{item_count: '0'}];
    if (text.includes('WITH owned_reward AS')) return [row];
    if (text.includes('UPDATE public.web_study_boards')) return [];
    throw new Error(`Unexpected reward placement query: ${text}`);
  };
}

function shopPlacementHandler(
  itemType: 'sticky_note' | 'decoration' | 'gif' | 'photo_frame',
  row = makeShopRow(itemType),
): QueryHandler {
  return (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return [];
    if (text.includes('SELECT owned.item_key') && text.includes('catalog.item_type')) {
      return [{
        item_key: itemType === 'sticky_note' ? 'sticky-note' : itemType === 'decoration' ? 'basic-decoration' : itemType,
        display_name: 'Purchased Item',
        item_type: itemType,
      }];
    }
    if (text.includes('SELECT 1') && text.includes('web_study_board_objects')) return [];
    if (text.includes('INSERT INTO public.web_study_boards')) return [];
    if (text.includes('FOR UPDATE')) return [{userid: '123456789'}];
    if (text.includes('count(*) AS item_count')) return [{item_count: '0'}];
    if (text.includes('WITH owned_shop_item AS')) return [row];
    if (text.includes('UPDATE public.web_study_boards')) return [];
    throw new Error(`Unexpected shop placement query: ${text}`);
  };
}

test('all board APIs reject unauthenticated requests before parsing or querying', async () => {
  const pool = createPool(() => { throw new Error('Board query must not run'); });
  await withTestServer(pool, new session.MemoryStore(), async (baseUrl) => {
    const requests: Array<[string, RequestInit | undefined]> = [
      ['/api/board', undefined],
      ['/api/board/items', {method: 'POST'}],
      ['/api/board/owned-items', {method: 'POST'}],
      ['/api/board/objects/1', {method: 'PATCH'}],
      ['/api/board/objects/1', {method: 'DELETE'}],
      ['/api/board/sticky-notes/1', {method: 'PATCH'}],
    ];
    for (const [path, options] of requests) {
      const response = await fetch(`${baseUrl}${path}`, options);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  });
});

test('GET returns reward and Sticky Note objects as an exact-ID discriminated union', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [makeRewardRow(), makeShopRow()], undefined, calls);
  const items = await getBoardItems(pool, '123456789');
  assert.deepEqual(items[0], {
    boardObjectId: '9223372036854775807',
    source: 'reward',
    hourRewardId: '9223372036854775806',
    x: 0.25,
    y: 0.6,
    milestoneHour: 42,
    earnedAt: '2026-08-20T10:00:00.000Z',
    grantedAt: '2026-08-20T10:00:01.000Z',
    itemKey: 'coffee',
    displayName: 'Coffee',
    description: 'Study fuel',
    assetKey: 'rewards/coffee',
    metadata: {rarity: 'common'},
  });
  assert.deepEqual(items[1], {
    boardObjectId: '9223372036854775804',
    source: 'shop',
    ownedItemId: '9223372036854775805',
    itemKey: 'sticky-note',
    displayName: 'Sticky Note',
    itemType: 'sticky_note',
    body: 'Review chapter four',
    x: 0.7,
    y: 0.2,
  });
  assert.deepEqual(calls[0].values, ['123456789']);
  assert.match(calls[0].text, /board_object\.userid = \$1::bigint/);
  assert.match(calls[0].text, /reward\.userid = \$1::bigint/);
  assert.match(calls[0].text, /owned_item\.userid = \$1::bigint/);
  assert.match(calls[0].text, /web_sticky_notes/);
});

test('GET returns persisted GIF identity and an unconfigured GIF Slot as null', async () => {
  const configured = {
    ...makeShopRow('gif', '70', '80'),
    gif_giphy_id: 'focus123',
  };
  const items = await getBoardItems(
    createPool(() => [configured, makeShopRow('gif', '71', '81')]),
    '123456789',
  );
  assert.deepEqual(items[0], {
    boardObjectId: '80',
    source: 'shop',
    ownedItemId: '70',
    itemKey: 'gif-slot',
    displayName: 'GIF Slot',
    itemType: 'gif',
    gif: {
      giphyId: 'focus123',
    },
    x: 0.7,
    y: 0.2,
  });
  assert.equal(items[1].source === 'shop' ? items[1].gif : undefined, null);
});

test('GIPHY selection validation accepts only one canonical ID field', () => {
  assert.equal(parseGiphyId('xT4uQ_abc-123'), 'xT4uQ_abc-123');
  assert.equal(parseGiphySelectionBody({giphyId: 'focus123'}), 'focus123');
  for (const value of ['', 'has space', '../path', 'x'.repeat(129), 123]) {
    assert.throws(() => parseGiphyId(value), BoardValidationError);
  }
  assert.throws(
    () => parseGiphySelectionBody({giphyId: 'focus123', renderUrl: 'https://evil.invalid'}),
    BoardValidationError,
  );
});

test('legacy reward placement stays transactional, ownership-checked, and BIGINT-exact', async () => {
  const calls: QueryCall[] = [];
  let released = false;
  const item = await createBoardItem(
    createPool(() => [], rewardPlacementHandler(), calls, () => { released = true; }),
    '123456789',
    {hourRewardId: '9223372036854775806', x: 0.25, y: 0.6},
  );
  assert.equal(item.source, 'reward');
  assert.equal(item.boardObjectId, '9223372036854775807');
  assert.equal(item.hourRewardId, '9223372036854775806');
  assert.equal(calls[0].text, 'BEGIN');
  assert.equal(calls.at(-1)?.text, 'COMMIT');
  assert(released);
  const insert = calls.find((call) => call.text.includes('WITH owned_reward AS'));
  assert.deepEqual(insert?.values, ['123456789', '9223372036854775806', 0.25, 0.6]);
  assert.match(insert?.text ?? '', /'reward_decoration'/);
});

test('owned Sticky Note and Basic Decoration placement derives type from ownership and costs no Chalk', async () => {
  for (const itemType of ['sticky_note', 'decoration'] as const) {
    const calls: QueryCall[] = [];
    const item = await createShopBoardItem(
      createPool(() => [], shopPlacementHandler(itemType, makeShopRow(itemType)), calls),
      '123456789',
      {ownedItemId: '9223372036854775805', x: 0.7, y: 0.2},
    );
    assert.equal(item.source, 'shop');
    assert.equal(item.itemType, itemType);
    assert.equal(item.ownedItemId, '9223372036854775805');
    assert(calls.every((call) => !/chalk|purchase/i.test(call.text)));
    const insert = calls.find((call) => call.text.includes('WITH owned_shop_item AS'));
    assert.deepEqual(insert?.values, ['123456789', '9223372036854775805', 0.7, 0.2]);
    assert.doesNotMatch(insert?.text ?? '', /\$5/);
  }
});

test('foreign owned item is rejected before any board write', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [], (text) => {
    if (text === 'BEGIN' || text === 'ROLLBACK') return [];
    if (text.includes('SELECT owned.item_key')) return [];
    throw new Error('No later query should run');
  }, calls);
  await assert.rejects(
    createShopBoardItem(pool, '123456789', {ownedItemId: '55', x: 0, y: 1}),
    BoardItemNotOwnedError,
  );
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
  assert(!calls.some((call) => call.text.includes('INSERT INTO public.web_study_boards')));
});

test('GIF Slot is placeable before a GIF is selected', async () => {
  const item = await createShopBoardItem(
    createPool(() => [], shopPlacementHandler('gif')),
    '123456789',
    {ownedItemId: '55', x: 0.5, y: 0.5},
  );
  assert.equal(item.itemType, 'gif');
  assert.equal(item.gif, null);
});

test('Photo Frame remains owned but unplaceable', async () => {
  const calls: QueryCall[] = [];
  await assert.rejects(
    createShopBoardItem(
      createPool(() => [], shopPlacementHandler('photo_frame'), calls),
      '123456789',
      {ownedItemId: '55', x: 0.5, y: 0.5},
    ),
    BoardItemUnsupportedError,
  );
  assert(!calls.some((call) => call.text.includes('web_study_board_objects') && call.text.includes('INSERT')));
});

test('strict placement bodies never accept forged userid or object type', () => {
  assert.deepEqual(parseBoardPlacementBody({hourRewardId: '1', x: 0, y: 1}), {
    hourRewardId: '1', x: 0, y: 1,
  });
  assert.deepEqual(parseShopBoardPlacementBody({ownedItemId: '2', x: 1, y: 0}), {
    ownedItemId: '2', x: 1, y: 0,
  });
  for (const body of [
    {ownedItemId: '2', objectType: 'sticky_note', x: 0, y: 0},
    {ownedItemId: '2', userid: '999', x: 0, y: 0},
    {hourRewardId: '1', assetKey: 'https://evil.invalid', x: 0, y: 0},
  ]) {
    assert.throws(
      () => 'ownedItemId' in body ? parseShopBoardPlacementBody(body) : parseBoardPlacementBody(body),
      BoardValidationError,
    );
  }
});

test('duplicate placement is safely rejected and the 100-object count includes both sources', async () => {
  const duplicateHandler = rewardPlacementHandler();
  await assert.rejects(
    createBoardItem(createPool(() => [], (text, values) => (
      text.includes('SELECT 1') && text.includes('web_study_board_objects')
        ? [{placed: 1}]
        : duplicateHandler(text, values)
    )), '123456789', {hourRewardId: '55', x: 0, y: 0}),
    BoardItemAlreadyPlacedError,
  );

  const calls: QueryCall[] = [];
  const capacityHandler = shopPlacementHandler('sticky_note');
  await assert.rejects(
    createShopBoardItem(createPool(() => [], (text, values) => (
      text.includes('count(*) AS item_count')
        ? [{item_count: String(MAX_BOARD_ITEMS)}]
        : capacityHandler(text, values)
    ), calls), '123456789', {ownedItemId: '55', x: 0, y: 0}),
    BoardCapacityError,
  );
  const count = calls.find((call) => call.text.includes('count(*) AS item_count'));
  assert.match(count?.text ?? '', /FROM public\.web_study_board_objects/);
  assert.doesNotMatch(count?.text ?? '', /source_type/);
  assert(calls.findIndex((call) => call.text.includes('FOR UPDATE')) < calls.indexOf(count!));
});

test('generic dragging persists one normalized position scoped by object and session IDs', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool(() => [{board_objectid: '9223372036854775807', x: 0.125, y: 0.875}], undefined, calls);
  assert.deepEqual(await updateBoardObject(
    pool,
    '123456789',
    '9223372036854775807',
    {x: 0.125, y: 0.875},
  ), {boardObjectId: '9223372036854775807', x: 0.125, y: 0.875});
  assert.deepEqual(calls[0].values, ['123456789', '9223372036854775807', 0.125, 0.875]);
  assert.match(calls[0].text, /board_objectid = \$2::bigint AND userid = \$1::bigint/);

  await assert.rejects(
    updateBoardObject(createPool(() => []), '123456789', '1', {x: 0, y: 0}),
    BoardItemNotFoundError,
  );
});

test('BIGINT and coordinate validation reject imprecise or non-normalized input', () => {
  for (const parser of [parseBoardItemId, parseBoardObjectId, parseOwnedItemId]) {
    assert.equal(parser('9223372036854775807'), '9223372036854775807');
    for (const value of ['0', '-1', '1.5', '1e3', '+1', '9223372036854775808', 123]) {
      assert.throws(() => parser(value), BoardValidationError);
    }
  }
  for (const body of [
    {x: -0.1, y: 0.5},
    {x: 0.5, y: 1.1},
    {x: '0.5', y: 0.5},
    {x: Number.NaN, y: 0.5},
    {x: 0.5, y: 0.5, userid: '999'},
  ]) {
    assert.throws(() => parseBoardPositionBody(body), BoardValidationError);
  }
});

test('removing a shop object deletes only its placement, preserving ownership and note text', async () => {
  const calls: QueryCall[] = [];
  await deleteBoardObject(createPool(() => [], undefined, calls), '123456789', '77');
  assert.deepEqual(calls[0].values, ['123456789', '77']);
  assert.match(calls[0].text, /DELETE FROM public\.web_study_board_objects/);
  assert.doesNotMatch(calls[0].text, /DELETE FROM public\.web_owned_board_items/);
  assert.doesNotMatch(calls[0].text, /DELETE FROM public\.web_sticky_notes/);
  assert.doesNotMatch(calls[0].text, /refund|chalk/i);
});

test('Sticky Note validation accepts empty/plain text and exact boundaries', () => {
  assert.equal(parseStickyNoteBody({body: ''}), '');
  const htmlLike = '<script>alert("literal")</script> **not markdown**';
  assert.equal(parseStickyNoteBody({body: htmlLike}), htmlLike);
  const words250 = Array.from({length: 250}, () => 'word').join(' ');
  const words251 = `${words250} extra`;
  assert.equal(countStickyNoteWords(words250), 250);
  assert.equal(parseStickyNoteBody({body: words250}), words250);
  assert.throws(() => parseStickyNoteBody({body: words251}), BoardValidationError);
  assert.equal(countStickyNoteCharacters('😀'), 1);
  assert.equal(parseStickyNoteBody({body: 'x'.repeat(2000)}).length, 2000);
  assert.throws(() => parseStickyNoteBody({body: 'x'.repeat(2001)}), BoardValidationError);
  assert.throws(() => parseStickyNoteBody({body: '', markdown: true}), BoardValidationError);
});

test('Sticky Note update is parameterized with session ownership and preserves exact text', async () => {
  const calls: QueryCall[] = [];
  const literal = '<b>plain</b>\nsecond line';
  const result = await updateStickyNote(
    createPool(() => [{owned_itemid: '9223372036854775807', body: literal}], undefined, calls),
    '123456789',
    '9223372036854775807',
    literal,
  );
  assert.deepEqual(result, {ownedItemId: '9223372036854775807', body: literal});
  assert.deepEqual(calls[0].values, ['9223372036854775807', '123456789', literal]);
  assert.match(calls[0].text, /web_upsert_sticky_note\(\$1::bigint, \$2::bigint, \$3::text\)/);
});

test('board writes require same origin, JSON where applicable, and return safe Sticky Note errors', async () => {
  const store = new session.MemoryStore();
  const sessionId = 'secure-board-session';
  await setAuthenticatedSession(store, sessionId, '123456789');
  const foreignError = Object.assign(new Error('private'), {code: 'GSB04'});
  const pool = createPool((text) => {
    if (text.includes('web_upsert_sticky_note')) throw foreignError;
    throw new Error('Origin/content type rejection must happen before data access');
  });
  await withTestServer(pool, store, async (baseUrl, config) => {
    const cookie = createSessionCookie(sessionId, config.sessionSecret);
    const badOrigin = await fetch(`${baseUrl}/api/board/objects/1`, {
      method: 'DELETE',
      headers: {Cookie: cookie, Origin: 'https://attacker.invalid'},
    });
    assert.equal(badOrigin.status, 403);

    const wrongType = await fetch(`${baseUrl}/api/board/sticky-notes/1`, {
      method: 'PATCH',
      headers: {Cookie: cookie, Origin: config.appUrl.origin, 'Content-Type': 'text/plain'},
      body: '{}',
    });
    assert.equal(wrongType.status, 415);

    const foreign = await fetch(`${baseUrl}/api/board/sticky-notes/1`, {
      method: 'PATCH',
      headers: {Cookie: cookie, Origin: config.appUrl.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({body: 'private'}),
    });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await foreign.json(), {error: 'Sticky Note not found'});
  });
});

test('Sticky Note endpoint enforces strict 16 KiB JSON and rejects non-Sticky instances safely', async () => {
  const store = new session.MemoryStore();
  const sessionId = 'sticky-limits-session';
  await setAuthenticatedSession(store, sessionId, '123456789');
  const nonStickyError = Object.assign(new Error('private'), {code: 'GSB05'});
  let queryCount = 0;
  const pool = createPool(() => {
    queryCount += 1;
    throw nonStickyError;
  });
  await withTestServer(pool, store, async (baseUrl, config) => {
    const headers = {
      Cookie: createSessionCookie(sessionId, config.sessionSecret),
      Origin: config.appUrl.origin,
      'Content-Type': 'application/json',
    };
    const unknownProperty = await fetch(`${baseUrl}/api/board/sticky-notes/1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({body: '', html: true}),
    });
    assert.equal(unknownProperty.status, 400);
    assert.equal(queryCount, 0);

    const oversized = await fetch(`${baseUrl}/api/board/sticky-notes/1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({body: 'x'.repeat(17_000)}),
    });
    assert.equal(oversized.status, 413);
    assert.equal(queryCount, 0);

    const nonSticky = await fetch(`${baseUrl}/api/board/sticky-notes/1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({body: 'plain'}),
    });
    assert.equal(nonSticky.status, 409);
    assert.deepEqual(await nonSticky.json(), {error: 'Owned item is not a Sticky Note'});
    assert.equal(queryCount, 1);
  });
});

test('legacy reward Add to Board route remains available while shop uses a separate strict route', async () => {
  const calls: QueryCall[] = [];
  const handler = rewardPlacementHandler(makeRewardRow('55', '66'));
  const pool = createPool(() => [], handler, calls);
  const store = new session.MemoryStore();
  const sessionId = 'legacy-placement-session';
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
    assert.equal((await response.json() as {source: string}).source, 'reward');
  });
  assert(calls.some((call) => call.text.includes('gostudy_user_inventory')));
});

test('transaction failures roll back and release the client', async () => {
  const calls: QueryCall[] = [];
  let released = false;
  const handler = rewardPlacementHandler();
  await assert.rejects(
    createBoardItem(createPool(() => [], (text, values) => {
      if (text.includes('count(*) AS item_count')) throw new Error('database operation failed');
      return handler(text, values);
    }, calls, () => { released = true; }), '123456789', {hourRewardId: '55', x: 0.2, y: 0.3}),
    /database operation failed/,
  );
  assert.equal(calls.at(-1)?.text, 'ROLLBACK');
  assert(released);
});
