import assert from 'node:assert/strict';
import test from 'node:test';

import type {Pool} from 'pg';

import {
  hasManageableActiveGuild,
  mayManageGuild,
  readSessionManageableGuildIds,
} from './guild-auth.js';

test('session authorization accepts only canonical unique BIGINT guild IDs', () => {
  assert.deepEqual(
    readSessionManageableGuildIds(['10', '10', '0', 20, '9223372036854775808']),
    ['10'],
  );
  assert.deepEqual(readSessionManageableGuildIds({guildid: '10'}), []);
});

test('only a Discord-authorized guild or Go Study owner override may be managed', () => {
  assert.equal(mayManageGuild('user', ['10'], '10'), true);
  assert.equal(mayManageGuild('admin', ['10'], '20'), false);
  assert.equal(mayManageGuild('user', [], '10'), false);
  assert.equal(mayManageGuild('owner', [], '999'), true);
});

test('active registry intersection controls whether a session has publishing access', async () => {
  const calls: Array<{text: string; values: unknown[]}> = [];
  const pool = {
    query: async (text: string, values: unknown[]) => {
      calls.push({text, values});
      return {rows: [{exists: true}], rowCount: 1};
    },
  } as unknown as Pool;
  assert.equal(await hasManageableActiveGuild(pool, 'user', ['10']), true);
  assert.deepEqual(calls[0].values, [false, ['10']]);
  assert.match(calls[0].text, /guild\.active = TRUE/);
  assert.match(calls[0].text, /ANY\(\$2::bigint\[\]\)/);
  await hasManageableActiveGuild(pool, 'owner', []);
  assert.deepEqual(calls[1].values, [true, []]);
});
