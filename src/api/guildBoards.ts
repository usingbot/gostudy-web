import type {GuildBoard, GuildBoardTheme, PublicGuildBoard} from '../types';

export class GuildBoardsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Guild Boards API request failed with ${status}`);
  }
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
    throw new GuildBoardsApiError(response.status, await readErrorCode(response));
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
