import type {ManageableGuild, ManageableGuildsResponse} from '../types';

export class GuildPublishingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Guild Publishing API request failed with ${status}`);
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new GuildPublishingApiError(response.status, await readErrorCode(response));
  }
  return response.json() as Promise<T>;
}

export function fetchManageableGuilds(signal?: AbortSignal): Promise<ManageableGuildsResponse> {
  return requestJson('/api/admin/servers', {signal});
}

export async function saveGuildPublication(
  guildId: string,
  input: {slug: string; isPublic: boolean; invite: string | null; tags: string[]},
): Promise<ManageableGuild> {
  const response = await requestJson<{guild: ManageableGuild}>(
    `/api/admin/servers/${encodeURIComponent(guildId)}`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    },
  );
  return response.guild;
}
