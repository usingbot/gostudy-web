import type {PublicGuild} from '../types';

export class PublicServersApiError extends Error {
  constructor(readonly status: number) {
    super(`Public servers API request failed with ${status}`);
  }
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    credentials: 'omit',
    headers: {Accept: 'application/json'},
    signal,
  });
  if (!response.ok) {
    throw new PublicServersApiError(response.status);
  }
  return response.json() as Promise<T>;
}

export async function fetchPublicGuilds(signal?: AbortSignal): Promise<PublicGuild[]> {
  const response = await requestJson<{servers: PublicGuild[]}>(
    '/api/servers',
    signal,
  );
  return response.servers;
}

export async function fetchPublicGuild(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicGuild> {
  const response = await requestJson<{server: PublicGuild}>(
    `/api/servers/${encodeURIComponent(slug)}`,
    signal,
  );
  return response.server;
}
