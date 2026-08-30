import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchAdminGuildBoard,
  fetchPublicGuildBoard,
  GuildBoardsApiError,
  saveAdminGuildBoardCapacity,
  saveAdminGuildBoardTheme,
} from './guildBoards.js';

test('public board fetch is anonymous while admin board fetch is same-origin authenticated', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{input: string | URL | Request; init?: RequestInit}> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({input, init});
    return Response.json({board: {theme: 'midnight', width: 3000, height: 1800, revision: '0', objects: []}});
  };
  try {
    await fetchPublicGuildBoard('study forum');
    await fetchAdminGuildBoard('500');
    assert.equal(String(requests[0].input), '/api/servers/study%20forum/board');
    assert.equal(requests[0].init?.credentials, 'omit');
    assert.equal(String(requests[1].input), '/api/admin/servers/500/board');
    assert.equal(requests[1].init?.credentials, 'same-origin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('board save sends only fixed theme and optimistic expected revision', async () => {
  const originalFetch = globalThis.fetch;
  let request: {input: string | URL | Request; init?: RequestInit} | null = null;
  globalThis.fetch = async (input, init) => {
    request = {input, init};
    return Response.json({board: {theme: 'paper', width: 3000, height: 1800, revision: '4'}});
  };
  const input = {theme: 'paper', expectedRevision: '3'} as const;
  try {
    assert.deepEqual(await saveAdminGuildBoardTheme('500', input), {theme: 'paper', width: 3000, height: 1800, revision: '4'});
    assert.equal(String(request!.input), '/api/admin/servers/500/board/theme');
    assert.equal(request!.init?.method, 'PUT');
    assert.equal(request!.init?.credentials, 'same-origin');
    assert.equal(request!.init?.body, JSON.stringify(input));
    assert.deepEqual(Object.keys(JSON.parse(String(request!.init?.body))).sort(), ['expectedRevision', 'theme']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('board API preserves the safe revision-conflict code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({error: 'GUILD_BOARD_REVISION_CONFLICT'}, {status: 409});
  try {
    await assert.rejects(
      saveAdminGuildBoardTheme('500', {theme: 'mint', expectedRevision: '1'}),
      (error: unknown) => error instanceof GuildBoardsApiError
        && error.status === 409
        && error.code === 'GUILD_BOARD_REVISION_CONFLICT',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capacity expansion sends only a fixed pair and optimistic revision', async () => {
  const originalFetch = globalThis.fetch;
  let request: {input: string | URL | Request; init?: RequestInit} | null = null;
  globalThis.fetch = async (input, init) => {
    request = {input, init};
    return Response.json({board: {theme: 'mint', width: 4500, height: 2700, revision: '2'}});
  };
  const input = {width: 4500, height: 2700, expectedRevision: '1'};
  try {
    await saveAdminGuildBoardCapacity('500', input);
    assert.equal(String(request!.input), '/api/admin/servers/500/board/capacity');
    assert.equal(request!.init?.body, JSON.stringify(input));
    assert.deepEqual(Object.keys(JSON.parse(String(request!.init?.body))).sort(), ['expectedRevision', 'height', 'width']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
