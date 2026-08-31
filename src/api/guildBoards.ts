import type {
  GuildBoard,
  GuildBoardAssetKind,
  GuildBoardAssets,
  GuildBoardTheme,
  PublicGuildBoard,
} from '../types';

export class GuildBoardsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Guild Boards API request failed with ${status}`);
  }
}

export function parseRetryAfterSeconds(
  value: string | null,
  now: number = Date.now(),
): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  const resetAt = Date.parse(normalized);
  if (!Number.isFinite(resetAt)) return null;
  return Math.max(0, Math.ceil((resetAt - now) / 1000));
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as {error?: unknown};
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {Accept: 'application/json', ...init.headers},
  });
  if (!response.ok) {
    throw new GuildBoardsApiError(
      response.status,
      await readErrorCode(response),
      parseRetryAfterSeconds(response.headers.get('Retry-After')),
    );
  }
  return response.json() as Promise<T>;
}

export async function fetchPublicGuildBoard(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicGuildBoard> {
  const response = await requestJson<{board: PublicGuildBoard}>(
    `/api/servers/${encodeURIComponent(slug)}/board`,
    {credentials: 'omit', signal},
  );
  return response.board;
}

export async function fetchAdminGuildBoard(
  guildId: string,
  signal?: AbortSignal,
): Promise<GuildBoard> {
  const response = await requestJson<{board: GuildBoard}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board`,
    {credentials: 'same-origin', signal},
  );
  return response.board;
}

export async function fetchAdminGuildBoardAssets(
  guildId: string,
  signal?: AbortSignal,
): Promise<GuildBoardAssets> {
  return requestJson<GuildBoardAssets>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board/assets`,
    {credentials: 'same-origin', signal},
  );
}

export async function saveAdminGuildBoardTheme(
  guildId: string,
  input: {theme: GuildBoardTheme; expectedRevision: string},
): Promise<GuildBoard> {
  const response = await requestJson<{board: GuildBoard}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board/theme`,
    {
      credentials: 'same-origin',
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    },
  );
  return response.board;
}

export async function saveAdminGuildBoardCapacity(
  guildId: string,
  input: {width: number; height: number; expectedRevision: string},
): Promise<GuildBoard> {
  const response = await requestJson<{board: GuildBoard}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board/capacity`,
    {
      credentials: 'same-origin',
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    },
  );
  return response.board;
}

export async function addAdminGuildBoardObject(
  guildId: string,
  input: {
    assetKind: GuildBoardAssetKind;
    assetId: string;
    x: number;
    y: number;
    size: number;
    rotation: number;
    expectedRevision: string;
  },
): Promise<GuildBoard> {
  const response = await requestJson<{board: GuildBoard}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board/objects`,
    {
      credentials: 'same-origin',
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    },
  );
  return response.board;
}

export async function updateAdminGuildBoardObject(
  guildId: string,
  objectId: string,
  input: {
    x: number;
    y: number;
    size: number;
    rotation: number;
    expectedRevision: string;
  },
): Promise<GuildBoard> {
  const response = await requestJson<{board: GuildBoard}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board/objects/${encodeURIComponent(objectId)}/transform`,
    {
      credentials: 'same-origin',
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    },
  );
  return response.board;
}

export async function reorderAdminGuildBoardObject(
  guildId: string,
  objectId: string,
  input: {action: 'front' | 'back'; expectedRevision: string},
): Promise<GuildBoard> {
  const response = await requestJson<{board: GuildBoard}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board/objects/${encodeURIComponent(objectId)}/layer`,
    {
      credentials: 'same-origin',
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    },
  );
  return response.board;
}

export async function deleteAdminGuildBoardObject(
  guildId: string,
  objectId: string,
  expectedRevision: string,
): Promise<GuildBoard> {
  const response = await requestJson<{board: GuildBoard}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}/board/objects/${encodeURIComponent(objectId)}`,
    {
      credentials: 'same-origin',
      method: 'DELETE',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({expectedRevision}),
    },
  );
  return response.board;
}
