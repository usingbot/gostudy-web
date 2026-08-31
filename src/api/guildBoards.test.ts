import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAdminGuildBoardObject,
  deleteAdminGuildBoardObject,
  fetchAdminGuildBoard,
  fetchAdminGuildBoardAssets,
  fetchPublicGuildBoard,
  GuildBoardsApiError,
  parseRetryAfterSeconds,
  reorderAdminGuildBoardObject,
  saveAdminGuildBoardCapacity,
  saveAdminGuildBoardTheme,
  updateAdminGuildBoardObject,
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

test('board API exposes Retry-After on 429 and never retries automatically', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json(
      {error: 'RATE_LIMITED'},
      {status: 429, headers: {'Retry-After': '7'}},
    );
  };
  try {
    await assert.rejects(
      updateAdminGuildBoardObject('500', '42', {
        x: 1, y: 2, size: 180, rotation: 0, expectedRevision: '3',
      }),
      (error: unknown) => error instanceof GuildBoardsApiError
        && error.status === 429
        && error.code === 'RATE_LIMITED'
        && error.retryAfterSeconds === 7,
    );
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Retry-After accepts delta seconds or an HTTP date and rejects malformed values', () => {
  const now = Date.parse('2026-08-31T00:00:00.000Z');
  assert.equal(parseRetryAfterSeconds('12', now), 12);
  assert.equal(parseRetryAfterSeconds('Mon, 31 Aug 2026 00:00:05 GMT', now), 5);
  assert.equal(parseRetryAfterSeconds('not-a-delay', now), null);
  assert.equal(parseRetryAfterSeconds(null, now), null);
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

test('asset picker uses only the authenticated admin guild route', async () => {
  const originalFetch = globalThis.fetch;
  let request: {input: string | URL | Request; init?: RequestInit} | null = null;
  globalThis.fetch = async (input, init) => {
    request = {input, init};
    return Response.json({emojis: [], stickers: []});
  };
  try {
    assert.deepEqual(await fetchAdminGuildBoardAssets('500'), {emojis: [], stickers: []});
    assert.equal(String(request!.input), '/api/admin/servers/500/board/assets');
    assert.equal(request!.init?.credentials, 'same-origin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('object clients submit identity or geometry only with mandatory optimistic revision', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{input: string | URL | Request; init?: RequestInit}> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({input, init});
    return Response.json({board: {theme: 'cork', width: 3000, height: 1800, revision: '2', objects: []}});
  };
  try {
    await addAdminGuildBoardObject('500', {
      assetKind: 'emoji', assetId: '700', x: 10, y: 20, size: 180,
      rotation: 0, expectedRevision: '0',
    });
    await updateAdminGuildBoardObject('500', '42', {
      x: 30, y: 40, size: 200, rotation: -8.5, expectedRevision: '1',
    });
    await reorderAdminGuildBoardObject('500', '42', {
      action: 'front', expectedRevision: '2',
    });
    await deleteAdminGuildBoardObject('500', '42', '3');

    assert.equal(String(requests[0].input), '/api/admin/servers/500/board/objects');
    assert.equal(requests[0].init?.method, 'POST');
    assert.deepEqual(Object.keys(JSON.parse(String(requests[0].init?.body))).sort(), [
      'assetId', 'assetKind', 'expectedRevision', 'rotation', 'size', 'x', 'y',
    ]);
    assert.equal(String(requests[1].input), '/api/admin/servers/500/board/objects/42/transform');
    assert.equal(requests[1].init?.method, 'PUT');
    assert.deepEqual(Object.keys(JSON.parse(String(requests[1].init?.body))).sort(), [
      'expectedRevision', 'rotation', 'size', 'x', 'y',
    ]);
    assert.equal(String(requests[2].input), '/api/admin/servers/500/board/objects/42/layer');
    assert.deepEqual(JSON.parse(String(requests[2].init?.body)), {action: 'front', expectedRevision: '2'});
    assert.equal(String(requests[3].input), '/api/admin/servers/500/board/objects/42');
    assert.equal(requests[3].init?.method, 'DELETE');
    assert.deepEqual(JSON.parse(String(requests[3].init?.body)), {expectedRevision: '3'});
    assert.ok(requests.every((request) => request.init?.credentials === 'same-origin'));
    assert.ok(requests.every((request) => request.init?.headers
      && (request.init.headers as Record<string, string>)['Content-Type'] === 'application/json'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
