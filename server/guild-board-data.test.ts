import assert from 'node:assert/strict';
import test from 'node:test';

import type {Pool, QueryResultRow} from 'pg';

import {
  expandGuildBoard,
  getAdminGuildBoard,
  getPublicGuildBoard,
  upsertGuildBoardTheme,
} from './guild-board-data.js';

function poolReturning(rows: QueryResultRow[], calls: Array<{text: string; values: unknown[]}>): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({text, values});
      return {rows, rowCount: rows.length};
    },
  } as unknown as Pool;
}

test('public board is independently gated by active registry, public publication, and canonical slug', async () => {
  const calls: Array<{text: string; values: unknown[]}> = [];
  const board = await getPublicGuildBoard(
    poolReturning([{theme_key: null, width_units: null, height_units: null, revision: null}], calls),
    'study-forum',
  );
  assert.deepEqual(board, {theme: 'midnight', width: 3000, height: 1800, revision: '0', objects: []});
  assert.match(calls[0].text, /guild\.active = TRUE/);
  assert.match(calls[0].text, /publication\.is_public = TRUE/);
  assert.match(calls[0].text, /publication\.slug = \$1::text/);
  assert.match(calls[0].text, /LEFT JOIN public\.web_guild_boards/);
  assert.deepEqual(calls[0].values, ['study-forum']);
  assert.equal(calls[0].text.includes('study-forum'), false);
});

test('persisted board maps only public theme, revision, and the empty Chapter 7D object list', async () => {
  const board = await getPublicGuildBoard(
    poolReturning([{theme_key: 'cork', width_units: 6000, height_units: 3600, revision: '7'}], []),
    'study-forum',
  );
  assert.deepEqual(board, {theme: 'cork', width: 6000, height: 3600, revision: '7', objects: []});
  assert.deepEqual(Object.keys(board!).sort(), ['height', 'objects', 'revision', 'theme', 'width']);
});

test('admin read defaults without mutation and rejects inactive or unknown guilds as null', async () => {
  assert.deepEqual(
    await getAdminGuildBoard(poolReturning([{theme_key: null, width_units: null, height_units: null, revision: null}], []), '500'),
    {theme: 'midnight', width: 3000, height: 1800, revision: '0'},
  );
  assert.equal(await getAdminGuildBoard(poolReturning([], []), '500'), null);
});

test('admin mutation passes server-derived actor and expected revision to the narrow function', async () => {
  const calls: Array<{text: string; values: unknown[]}> = [];
  const result = await upsertGuildBoardTheme(
    poolReturning([{theme_key: 'mint', width_units: 4500, height_units: 2700, revision: '2'}], calls),
    '500',
    '100',
    {theme: 'mint', expectedRevision: '1'},
  );
  assert.deepEqual(result, {theme: 'mint', width: 4500, height: 2700, revision: '2'});
  assert.match(calls[0].text, /public\.web_upsert_guild_board_theme/);
  assert.deepEqual(calls[0].values, ['500', 'mint', '1', '100']);
});

test('invalid database board values fail closed', async () => {
  await assert.rejects(
    getAdminGuildBoard(poolReturning([{theme_key: 'custom-url', width_units: 3000, height_units: 1800, revision: '1'}], []), '500'),
    /theme was invalid/,
  );
  await assert.rejects(
    getAdminGuildBoard(poolReturning([{theme_key: 'paper', width_units: 3000, height_units: 1800, revision: 1}], []), '500'),
    /revision was invalid/,
  );
  await assert.rejects(
    getAdminGuildBoard(poolReturning([{theme_key: 'paper', width_units: 3001, height_units: 1800, revision: '1'}], []), '500'),
    /capacity was invalid/,
  );
});

test('capacity expansion passes fixed dimensions, expected revision, and session actor only', async () => {
  const calls: Array<{text: string; values: unknown[]}> = [];
  const board = await expandGuildBoard(
    poolReturning([{theme_key: 'paper', width_units: 9000, height_units: 5400, revision: '9'}], calls),
    '500',
    '100',
    {width: 9000, height: 5400, expectedRevision: '8'},
  );
  assert.deepEqual(board, {theme: 'paper', width: 9000, height: 5400, revision: '9'});
  assert.match(calls[0].text, /public\.web_expand_guild_board/);
  assert.deepEqual(calls[0].values, ['500', 9000, 5400, '8', '100']);
});
