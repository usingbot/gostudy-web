import {ApiError} from './productData';
import type {
  BoardGif,
  BoardGifMedia,
  BoardGifSelection,
  GiphySearchPage,
} from '../types';

export const GIPHY_SEARCH_LIMIT = 24;
export const GIPHY_MAX_SEARCH_LENGTH = 50;
export const GIPHY_MAX_SEARCH_OFFSET = 4_999;
export const GIPHY_MAX_BATCH_IDS = 100;
const GIPHY_GIFS_ENDPOINT = 'https://api.giphy.com/v1/gifs';

interface ErrorResponse {
  code?: unknown;
}

interface GiphySdkResult {
  data: unknown[];
  pagination: {
    count: number;
    total_count: number;
    offset: number;
  };
}

export interface GiphyWebClient {
  search(term: string, options: {
    limit: number;
    offset: number;
    rating: 'g';
    lang: 'en';
    sort: 'relevant';
    type: 'gifs';
  }, signal?: AbortSignal): Promise<GiphySdkResult>;
  gifs(ids: string[], signal?: AbortSignal): Promise<GiphySdkResult>;
}

let defaultClient: GiphyWebClient | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPaginationNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeSdkResult(value: unknown): GiphySdkResult {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('GIPHY response was malformed');
  }
  const pagination = isRecord(value.pagination) ? value.pagination : {};
  return {
    data: value.data,
    pagination: {
      count: readPaginationNumber(pagination.count, value.data.length),
      total_count: readPaginationNumber(pagination.total_count, value.data.length),
      offset: readPaginationNumber(pagination.offset, 0),
    },
  };
}

export function createGiphyWebClient(
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): GiphyWebClient {
  const canonicalKey = apiKey.trim();
  if (!canonicalKey) {
    throw new Error('A GIPHY Web API key is required');
  }

  const request = async (
    path: string,
    parameters: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<GiphySdkResult> => {
    const url = new URL(`${GIPHY_GIFS_ENDPOINT}${path}`);
    url.searchParams.set('api_key', canonicalKey);
    for (const [name, parameter] of Object.entries(parameters)) {
      url.searchParams.set(name, String(parameter));
    }
    const response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: {Accept: 'application/json'},
      signal,
    });
    if (!response.ok) {
      throw new Error('GIPHY request failed');
    }
    return normalizeSdkResult(await response.json() as unknown);
  };

  return {
    search: (term, options, signal) => request('/search', {
      q: term,
      limit: options.limit,
      offset: options.offset,
      rating: options.rating,
      lang: options.lang,
      sort: options.sort,
    }, signal),
    gifs: (ids, signal) => request('', {ids: ids.join(',')}, signal),
  };
}

export function isCanonicalGiphyId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function readWebApiKey(): string {
  const apiKey = import.meta.env.VITE_GIPHY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('VITE_GIPHY_API_KEY is required for browser GIPHY access');
  }
  return apiKey;
}

function getDefaultClient(): GiphyWebClient {
  defaultClient ??= createGiphyWebClient(readWebApiKey());
  return defaultClient;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The request was aborted', 'AbortError');
  }
}

function readPositiveDimension(value: unknown): number | null {
  const dimension = typeof value === 'string' || typeof value === 'number'
    ? Number(value)
    : Number.NaN;
  return Number.isSafeInteger(dimension) && dimension >= 1 && dimension <= 10_000
    ? dimension
    : null;
}

function readTrustedGiphyUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048) {
    return null;
  }
  try {
    const url = new URL(value);
    const containsKey = [...url.searchParams.keys()]
      .some((name) => name.toLowerCase() === 'api_key' || name.toLowerCase() === 'key');
    if (url.protocol !== 'https:'
      || (url.hostname !== 'giphy.com' && !url.hostname.endsWith('.giphy.com'))
      || url.username
      || url.password
      || url.port
      || containsKey) {
      return null;
    }
    // Preserve the exact URL returned by GIPHY; do not rewrite its query string.
    return value;
  } catch {
    return null;
  }
}

function readRenditionUrl(
  images: Record<string, unknown>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const rendition = images[name];
    if (isRecord(rendition)) {
      const url = readTrustedGiphyUrl(rendition.url);
      if (url) {
        return url;
      }
    }
  }
  return null;
}

function readMedia(images: Record<string, unknown>): BoardGifMedia | null {
  const previewUrl = readRenditionUrl(images, [
    'fixed_width_small_still',
    'fixed_width_still',
    'fixed_height_still',
    'downsized_still',
    'original_still',
  ]);
  for (const name of [
    'fixed_width',
    'fixed_height',
    'downsized_medium',
    'downsized',
    'original',
  ]) {
    const rendition = images[name];
    if (!isRecord(rendition)) {
      continue;
    }
    const renderUrl = readTrustedGiphyUrl(rendition.url);
    const width = readPositiveDimension(rendition.width);
    const height = readPositiveDimension(rendition.height);
    if (renderUrl && width && height) {
      return {previewUrl, renderUrl, width, height};
    }
  }
  return null;
}

function mapGiphyResult(value: unknown): BoardGif {
  const record = isRecord(value) ? value : {};
  const rawId = typeof record.id === 'string' || typeof record.id === 'number'
    ? String(record.id)
    : '';
  const rawTitle = typeof record.title === 'string' ? record.title.trim() : '';
  const title = (rawTitle || 'Untitled GIF').slice(0, 500).trim() || 'Untitled GIF';
  const media = isRecord(record.images) ? readMedia(record.images) : null;
  return {
    giphyId: rawId,
    title,
    media,
    hydrationState: media ? 'ready' : 'unavailable',
  };
}

function readClient(client?: GiphyWebClient): GiphyWebClient {
  return client ?? getDefaultClient();
}

export async function searchGiphy(
  query: string,
  offset = 0,
  signal?: AbortSignal,
  client?: GiphyWebClient,
): Promise<GiphySearchPage> {
  const canonicalQuery = query.trim();
  if (canonicalQuery.length < 1 || canonicalQuery.length > GIPHY_MAX_SEARCH_LENGTH) {
    throw new Error('GIPHY search query was invalid');
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > GIPHY_MAX_SEARCH_OFFSET) {
    throw new Error('GIPHY search offset was invalid');
  }
  throwIfAborted(signal);
  const result = await readClient(client).search(canonicalQuery, {
    limit: GIPHY_SEARCH_LIMIT,
    offset,
    rating: 'g',
    lang: 'en',
    sort: 'relevant',
    type: 'gifs',
  }, signal);
  throwIfAborted(signal);
  if (!Array.isArray(result.data)) {
    throw new Error('GIPHY search response was malformed');
  }
  const items = result.data.map(mapGiphyResult);
  const count = Number(result.pagination?.count);
  const totalCount = Number(result.pagination?.total_count);
  const next = offset + count;
  const nextOffset = Number.isSafeInteger(count)
    && count > 0
    && Number.isSafeInteger(totalCount)
    && next < totalCount
    && next <= GIPHY_MAX_SEARCH_OFFSET
    ? next
    : null;
  return {items, offset, nextOffset};
}

export async function hydrateGiphyIds(
  giphyIds: readonly string[],
  signal?: AbortSignal,
  client?: GiphyWebClient,
): Promise<Map<string, BoardGif>> {
  const canonicalIds = [...new Set(giphyIds)];
  if (canonicalIds.length > GIPHY_MAX_BATCH_IDS
    || canonicalIds.some((giphyId) => !isCanonicalGiphyId(giphyId))) {
    throw new Error('GIPHY hydration IDs were invalid');
  }
  if (canonicalIds.length === 0) {
    return new Map();
  }
  throwIfAborted(signal);
  const result = await readClient(client).gifs(canonicalIds, signal);
  throwIfAborted(signal);
  if (!Array.isArray(result.data)) {
    throw new Error('GIPHY hydration response was malformed');
  }
  const requestedIds = new Set(canonicalIds);
  const hydrated = new Map<string, BoardGif>();
  for (const value of result.data) {
    const gif = mapGiphyResult(value);
    if (requestedIds.has(gif.giphyId)) {
      hydrated.set(gif.giphyId, gif);
    }
  }
  return hydrated;
}

async function readApiError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  try {
    const body = await response.json() as ErrorResponse;
    if (typeof body.code === 'string') {
      code = body.code;
    }
  } catch {
    // Error responses may be empty.
  }
  return new ApiError(response.status, code);
}

export async function selectBoardGif(
  ownedItemId: string,
  giphyId: string,
): Promise<BoardGifSelection> {
  const response = await fetch(`/api/board/gifs/${encodeURIComponent(ownedItemId)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({giphyId}),
  });
  if (!response.ok) {
    throw await readApiError(response);
  }
  return response.json() as Promise<BoardGifSelection>;
}
