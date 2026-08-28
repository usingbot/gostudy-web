import type {CatalogItem, DashboardData, InventoryPage} from '../types';

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API request failed with status ${status}`);
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {Accept: 'application/json'},
    signal,
  });
  if (!response.ok) {
    throw new ApiError(response.status);
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  return getJson('/api/dashboard', signal);
}

export function fetchInventoryPage(
  limit: number,
  cursor?: string,
  signal?: AbortSignal,
): Promise<InventoryPage> {
  const search = new URLSearchParams({limit: String(limit)});
  if (cursor) {
    search.set('cursor', cursor);
  }
  return getJson(`/api/inventory?${search}`, signal);
}

export function fetchCatalog(signal?: AbortSignal): Promise<CatalogItem[]> {
  return getJson('/api/catalog', signal);
}
