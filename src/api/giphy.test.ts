import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  GIPHY_MAX_BATCH_IDS,
  GIPHY_SEARCH_LIMIT,
  createGiphyWebClient,
  hydrateGiphyIds,
  searchGiphy,
  selectBoardGif,
  type GiphyWebClient,
} from './giphy.js';

function makeGif(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `  ${id} title  `,
    images: {
      fixed_width_small_still: {
        url: `https://media2.giphy.com/media/${id}/100_s.gif`,
        width: 100,
        height: 80,
      },
      fixed_width: {
        url: `https://media2.giphy.com/media/${id}/200.gif`,
        width: 200,
        height: 160,
      },
    },
    ...overrides,
  };
}

function result(data: unknown[], offset = 0, totalCount = data.length) {
  return {
    data,
    pagination: {count: data.length, total_count: totalCount, offset},
  };
}

function createClient(overrides: Partial<GiphyWebClient> = {}): GiphyWebClient {
  return {
    search: async () => result([]),
    gifs: async () => result([]),
    ...overrides,
  };
}

test('search uses the browser client directly with bounded G-rated options', async () => {
  let input: {term: string; options: unknown} | null = null;
  const client = createClient({
    search: async (term, options) => {
      input = {term, options};
      return result([makeGif('first')], 24, 100);
    },
  });
  const page = await searchGiphy('  deep work  ', 24, undefined, client);
  assert.deepEqual(input, {
    term: 'deep work',
    options: {
      limit: GIPHY_SEARCH_LIMIT,
      offset: 24,
      rating: 'g',
      lang: 'en',
      sort: 'relevant',
      type: 'gifs',
    },
  });
  assert.equal(page.nextOffset, 25);

  const source = await readFile('src/api/giphy.ts', 'utf8');
  assert.match(source, /createGiphyWebClient\(readWebApiKey\(\)\)/);
  assert.doesNotMatch(source, /\/api\/giphy\/search/);
});

test('default Web client calls GIPHY from the browser without HTTP caching', async () => {
  const calls: Array<{url: URL; init?: RequestInit}> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({url: new URL(String(input)), init});
    return new Response(JSON.stringify(result([makeGif('direct')])), {
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
  const signal = new AbortController().signal;
  const client = createGiphyWebClient('browser-test-key', fetchImpl);
  await searchGiphy('focus', 0, signal, client);
  await hydrateGiphyIds(['first-id', 'second-id'], signal, client);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.origin, 'https://api.giphy.com');
  assert.equal(calls[0].url.pathname, '/v1/gifs/search');
  assert.equal(calls[0].url.searchParams.get('api_key'), 'browser-test-key');
  assert.equal(calls[0].url.searchParams.get('q'), 'focus');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.credentials, 'omit');
  assert.equal(calls[0].init?.cache, 'no-store');
  assert.equal(calls[0].init?.signal, signal);
  assert.equal(calls[1].url.origin, 'https://api.giphy.com');
  assert.equal(calls[1].url.pathname, '/v1/gifs');
  assert.equal(calls[1].url.searchParams.get('ids'), 'first-id,second-id');
  assert.equal(calls[1].init?.cache, 'no-store');
  assert.equal(calls[1].init?.signal, signal);
});

test('search preserves provider order and never filters unrenderable results', async () => {
  const data = [
    makeGif('first'),
    makeGif('no-media', {images: {}}),
    makeGif('unsafe-media', {
      images: {
        fixed_width: {url: 'https://evil.invalid/render.gif', width: 200, height: 160},
      },
    }),
    makeGif('last'),
  ];
  const page = await searchGiphy('focus', 0, undefined, createClient({
    search: async () => result(data),
  }));
  assert.deepEqual(page.items.map((gif) => gif.giphyId), [
    'first',
    'no-media',
    'unsafe-media',
    'last',
  ]);
  assert.equal(page.items.length, data.length);
  assert.equal(page.items[1].hydrationState, 'unavailable');
  assert.equal(page.items[2].media, null);
});

test('mapper uses supported still/render fallbacks without constructing URLs', async () => {
  const exactStillUrl = 'https://media2.giphy.com/media/fallback/height_s.gif?cid=web-client';
  const fallback = makeGif('fallback', {
    images: {
      fixed_width_small_still: {url: 'https://evil.invalid/still.gif'},
      fixed_height_still: {url: exactStillUrl},
      fixed_width: {url: 'https://evil.invalid/render.gif', width: 200, height: 160},
      fixed_height: {
        url: 'https://media2.giphy.com/media/fallback/height.gif',
        width: 225,
        height: 180,
      },
    },
  });
  const page = await searchGiphy('focus', 0, undefined, createClient({
    search: async () => result([fallback]),
  }));
  assert.equal(page.items[0].media?.previewUrl, exactStillUrl);
  assert.equal(page.items[0].media?.renderUrl, 'https://media2.giphy.com/media/fallback/height.gif');
  assert.equal(page.items[0].media?.width, 225);
  assert.equal(page.items[0].media?.height, 180);
});

test('empty GIPHY title receives a safe ephemeral fallback', async () => {
  const page = await searchGiphy('focus', 0, undefined, createClient({
    search: async () => result([makeGif('untitled', {title: '   '})]),
  }));
  assert.equal(page.items[0].title, 'Untitled GIF');
});

test('hydration sends up to 100 unique board IDs in one browser batch', async () => {
  const ids = Array.from({length: GIPHY_MAX_BATCH_IDS}, (_, index) => `id${index}`);
  let received: string[] = [];
  const hydrated = await hydrateGiphyIds(ids, undefined, createClient({
    gifs: async (giphyIds) => {
      received = giphyIds;
      return result(giphyIds.map((id) => makeGif(id)));
    },
  }));
  assert.deepEqual(received, ids);
  assert.equal(hydrated.size, 100);
  assert.equal(hydrated.get('id99')?.media?.renderUrl, 'https://media2.giphy.com/media/id99/200.gif');
});

test('missing syntactically valid ID hydrates as unavailable without changing identity', async () => {
  const hydrated = await hydrateGiphyIds([GIPHY_ID], undefined, createClient({
    gifs: async () => result([]),
  }));
  assert.equal(hydrated.has(GIPHY_ID), false);
});

const GIPHY_ID = 'syntacticallyValidButMissing123';

test('hydration rejects more than 100 IDs before calling GIPHY', async () => {
  let called = false;
  const ids = Array.from({length: GIPHY_MAX_BATCH_IDS + 1}, (_, index) => `id${index}`);
  await assert.rejects(hydrateGiphyIds(ids, undefined, createClient({
    gifs: async () => {
      called = true;
      return result([]);
    },
  })), /invalid/);
  assert.equal(called, false);
});

test('GIF selection sends only canonical identity to the authenticated Go Study route', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{input: string; init?: RequestInit}> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({input: String(input), init});
    return new Response(JSON.stringify({ownedItemId: '77', giphyId: 'giphy123'}), {
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
  try {
    await selectBoardGif('77', 'giphy123');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].input, '/api/board/gifs/77');
  assert.equal(calls[0].init?.method, 'PUT');
  assert.equal(calls[0].init?.body, JSON.stringify({giphyId: 'giphy123'}));
  assert.doesNotMatch(String(calls[0].init?.body), /url|title|width|height|api_key/i);
});

test('GIF selection API errors preserve safe Go Study error codes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({code: 'INVALID_GIF_SELECTION'}), {
    status: 400,
    headers: {'Content-Type': 'application/json'},
  })) as typeof fetch;
  try {
    await assert.rejects(
      selectBoardGif('77', 'bad id'),
      (error: unknown) => error instanceof Error
        && 'status' in error
        && error.status === 400
        && 'code' in error
        && error.code === 'INVALID_GIF_SELECTION',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
