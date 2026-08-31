import assert from 'node:assert/strict';
import test from 'node:test';

import type {Pool, QueryResultRow} from 'pg';

import {
  addGuildBoardAsset,
  deleteGuildBoardObject,
  expandGuildBoard,
  getAdminGuildBoard,
  getGuildBoardAssets,
  getPublicGuildBoard,
  reorderGuildBoardObject,
  updateGuildBoardObject,
  upsertGuildBoardTheme,
} from './guild-board-data.js';
import {
  GuildBoardValidationError,
  parseGuildBoardAssetPlacementBody,
  parseGuildBoardDeleteBody,
  parseGuildBoardLayerBody,
  parseGuildBoardObjectTransformBody,
} from './guild-board-validation.js';

interface QueryCall {
  text: string;
  values: unknown[];
}

function createPool(
  handler: (text: string, values: unknown[]) => QueryResultRow[],
  calls: QueryCall[] = [],
): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({text, values});
      const rows = handler(text, values);
      return {rows, rowCount: rows.length};
    },
  } as unknown as Pool;
}

const virtualBoardRow = {
  theme_key: null,
  width_units: null,
  height_units: null,
  revision: null,
};

const persistedBoardRow = {
  theme_key: 'cork',
  width_units: 3000,
  height_units: 1800,
  revision: '7',
};

function emojiObjectRow(overrides: Record<string, unknown> = {}) {
  return {
    ...persistedBoardRow,
    objectid: '42',
    asset_kind: 'emoji',
    asset_id: '700',
    x_units: 1200,
    y_units: 500,
    size_units: 180,
    rotation_degrees: '-8.00',
    z_index: '12',
    asset_available: true,
    emoji_animated: true,
    sticker_format_type: null,
    ...overrides,
  };
}

test('public board is independently gated by active registry, public publication, and canonical slug', async () => {
  const calls: QueryCall[] = [];
  const board = await getPublicGuildBoard(createPool(() => [virtualBoardRow], calls), 'study-forum');
  assert.deepEqual(board, {theme: 'midnight', width: 3000, height: 1800, revision: '0', objects: []});
  assert.match(calls[0].text, /guild\.active = TRUE/);
  assert.match(calls[0].text, /publication\.is_public = TRUE/);
  assert.match(calls[0].text, /publication\.slug = \$1::text/);
  assert.match(calls[0].text, /LEFT JOIN public\.web_guild_board_objects/);
  assert.match(calls[0].text, /ORDER BY board_object\.z_index, board_object\.objectid/);
  assert.deepEqual(calls[0].values, ['study-forum']);
  assert.equal(calls[0].text.includes('study-forum'), false);
});

test('public DTO returns ordered trusted artwork and omits unavailable assets and private identity', async () => {
  const board = await getPublicGuildBoard(createPool(() => [
    emojiObjectRow({
      asset_kind: 'sticker',
      asset_id: '800',
      emoji_animated: null,
      sticker_format_type: 4,
    }),
    emojiObjectRow({
      objectid: '43',
      asset_id: '701',
      asset_available: false,
      emoji_animated: null,
      z_index: '13',
    }),
  ]), 'study-forum');
  assert.deepEqual(board, {
    theme: 'cork',
    width: 3000,
    height: 1800,
    revision: '7',
    objects: [{
      id: '42',
      kind: 'sticker',
      url: 'https://media.discordapp.net/stickers/800.gif?size=320',
      x: 1200,
      y: 500,
      size: 180,
      rotation: -8,
      zIndex: '12',
    }],
  });
  assert.deepEqual(Object.keys(board!.objects[0]).sort(), [
    'id', 'kind', 'rotation', 'size', 'url', 'x', 'y', 'zIndex',
  ]);
});

test('admin read uses the shared GIF sticker helper and preserves unavailable placements for deletion', async () => {
  const board = await getAdminGuildBoard(createPool(() => [
    emojiObjectRow({
      asset_kind: 'sticker',
      asset_id: '800',
      emoji_animated: null,
      sticker_format_type: 4,
    }),
    emojiObjectRow({
      objectid: '43',
      asset_id: '701',
      asset_available: false,
      emoji_animated: null,
      z_index: '13',
    }),
  ]), '500');
  assert.deepEqual(board, {
    theme: 'cork',
    width: 3000,
    height: 1800,
    revision: '7',
    objects: [{
      id: '42',
      kind: 'sticker',
      assetId: '800',
      url: 'https://media.discordapp.net/stickers/800.gif?size=320',
      available: true,
      x: 1200,
      y: 500,
      size: 180,
      rotation: -8,
      zIndex: '12',
    }, {
      id: '43',
      kind: 'emoji',
      assetId: '701',
      url: null,
      available: false,
      x: 1200,
      y: 500,
      size: 180,
      rotation: -8,
      zIndex: '13',
    }],
  });
  assert.deepEqual(
    await getAdminGuildBoard(createPool(() => [virtualBoardRow]), '500'),
    {theme: 'midnight', width: 3000, height: 1800, revision: '0', objects: []},
  );
  assert.equal(await getAdminGuildBoard(createPool(() => []), '500'), null);
});

test('asset picker queries only the active target guild, available assets, and renderable sticker formats', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => text.includes('gostudy_guild_emojis')
    ? [{asset_id: '700', name: 'party_blob', animated: true}]
    : [{asset_id: '800', name: 'Study sticker', format_type: 4}], calls);
  assert.deepEqual(await getGuildBoardAssets(pool, '500'), {
    emojis: [{
      id: '700',
      name: 'party_blob',
      animated: true,
      url: 'https://cdn.discordapp.com/emojis/700.gif?size=1024&quality=lossless',
    }],
    stickers: [{
      id: '800',
      name: 'Study sticker',
      formatType: 4,
      url: 'https://media.discordapp.net/stickers/800.gif?size=320',
    }],
  });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.text, /guild\.guildid = \$1::bigint/);
    assert.match(call.text, /guild\.active = TRUE/);
    assert.match(call.text, /available = TRUE/);
    assert.deepEqual(call.values, ['500']);
  }
  assert.match(calls[1].text, /format_type IN \(1, 2, 4\)/);
});

test('theme and capacity mutations pass the session actor and then return canonical objects', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => text.includes('web_upsert_guild_board_theme')
    || text.includes('web_expand_guild_board')
    ? [{board_revision: '8'}]
    : [emojiObjectRow({revision: '8'})], calls);

  const themed = await upsertGuildBoardTheme(pool, '500', '100', {
    theme: 'mint',
    expectedRevision: '7',
  });
  const expanded = await expandGuildBoard(pool, '500', '100', {
    width: 4500,
    height: 2700,
    expectedRevision: '7',
  });
  assert.equal(themed.objects.length, 1);
  assert.equal(expanded.objects.length, 1);
  assert.deepEqual(calls[0].values, ['500', 'mint', '7', '100']);
  assert.deepEqual(calls[2].values, ['500', 4500, 2700, '7', '100']);
});

test('all object mutations call only their narrow functions and refetch canonical board state', async () => {
  const calls: QueryCall[] = [];
  const pool = createPool((text) => text.includes('public.web_') && text.includes('mutation.board_revision')
    ? [{board_revision: '8'}]
    : [emojiObjectRow({revision: '8'})], calls);

  await addGuildBoardAsset(pool, '500', '100', {
    assetKind: 'emoji', assetId: '700', x: 12, y: 34, size: 180,
    rotation: -8, expectedRevision: '7',
  });
  await updateGuildBoardObject(pool, '500', '42', '100', {
    x: 20, y: 40, size: 200, rotation: 12.5, expectedRevision: '8',
  });
  await reorderGuildBoardObject(pool, '500', '42', '100', {
    action: 'front', expectedRevision: '9',
  });
  await deleteGuildBoardObject(pool, '500', '42', '100', {expectedRevision: '10'});

  const mutationCalls = calls.filter((call) => call.text.includes('mutation.board_revision'));
  assert.equal(mutationCalls.length, 4);
  assert.match(mutationCalls[0].text, /web_add_guild_board_asset/);
  assert.deepEqual(mutationCalls[0].values, ['500', 'emoji', '700', 12, 34, 180, -8, '7', '100']);
  assert.match(mutationCalls[1].text, /web_update_guild_board_object/);
  assert.deepEqual(mutationCalls[1].values, ['500', '42', 20, 40, 200, 12.5, '8', '100']);
  assert.match(mutationCalls[2].text, /web_reorder_guild_board_object/);
  assert.deepEqual(mutationCalls[2].values, ['500', '42', 'front', '9', '100']);
  assert.match(mutationCalls[3].text, /web_delete_guild_board_object/);
  assert.deepEqual(mutationCalls[3].values, ['500', '42', '10', '100']);
});

test('invalid database board and object values fail closed', async () => {
  await assert.rejects(
    getAdminGuildBoard(createPool(() => [{...virtualBoardRow, theme_key: 'custom-url', width_units: 3000, height_units: 1800, revision: '1'}]), '500'),
    /theme was invalid/,
  );
  await assert.rejects(
    getAdminGuildBoard(createPool(() => [emojiObjectRow({asset_kind: 'url'})]), '500'),
    /asset kind was invalid/,
  );
  await assert.rejects(
    getAdminGuildBoard(createPool(() => [emojiObjectRow({rotation_degrees: '181.00'})]), '500'),
    /rotation was invalid/,
  );
});

test('object request validation accepts exact geometry and rejects URLs, identity swaps, and unknown fields', () => {
  assert.deepEqual(parseGuildBoardAssetPlacementBody({
    assetKind: 'sticker',
    assetId: '9223372036854775807',
    x: 0,
    y: 0,
    size: 48,
    rotation: -180,
    expectedRevision: '0',
  }), {
    assetKind: 'sticker',
    assetId: '9223372036854775807',
    x: 0,
    y: 0,
    size: 48,
    rotation: -180,
    expectedRevision: '0',
  });
  assert.deepEqual(parseGuildBoardObjectTransformBody({
    x: 2280, y: 1080, size: 720, rotation: 180, expectedRevision: '12',
  }), {x: 2280, y: 1080, size: 720, rotation: 180, expectedRevision: '12'});
  assert.deepEqual(parseGuildBoardLayerBody({action: 'back', expectedRevision: '12'}), {
    action: 'back', expectedRevision: '12',
  });
  assert.deepEqual(parseGuildBoardDeleteBody({expectedRevision: '12'}), {expectedRevision: '12'});

  for (const body of [
    {assetKind: 'emoji', assetId: '1', x: 0, y: 0, size: 180, rotation: 0, expectedRevision: '0', url: 'https://evil.example/x.png'},
    {assetKind: 'emoji', assetId: '1', x: -1, y: 0, size: 180, rotation: 0, expectedRevision: '0'},
    {assetKind: 'emoji', assetId: '1', x: 0, y: 0, size: 47, rotation: 0, expectedRevision: '0'},
    {assetKind: 'emoji', assetId: '1', x: 0, y: 0, size: 721, rotation: 0, expectedRevision: '0'},
    {assetKind: 'emoji', assetId: '1', x: 0, y: 0, size: 180, rotation: 180.001, expectedRevision: '0'},
    {assetKind: 'emoji', assetId: 1, x: 0, y: 0, size: 180, rotation: 0, expectedRevision: '0'},
  ]) {
    assert.throws(
      () => parseGuildBoardAssetPlacementBody(body),
      GuildBoardValidationError,
    );
  }
  assert.throws(
    () => parseGuildBoardObjectTransformBody({
      x: 0, y: 0, size: 180, rotation: 0, expectedRevision: '1', assetId: '2',
    }),
    GuildBoardValidationError,
  );
  assert.throws(
    () => parseGuildBoardLayerBody({action: '12', expectedRevision: '1'}),
    GuildBoardValidationError,
  );
});
