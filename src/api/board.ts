import {ApiError} from './productData';
import type {BoardData, BoardItem, BoardPosition} from '../types';

interface ErrorResponse {
  code?: unknown;
}

async function readApiError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  try {
    const body = await response.json() as ErrorResponse;
    if (typeof body.code === 'string') {
      code = body.code;
    }
  } catch {
    // Error responses are allowed to have no JSON body.
  }
  return new ApiError(response.status, code);
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw await readApiError(response);
  }
  return response.json() as Promise<T>;
}

export function fetchBoard(signal?: AbortSignal): Promise<BoardData> {
  return requestJson('/api/board', {signal});
}

export function addBoardItem(
  hourRewardId: string,
  position: BoardPosition,
): Promise<BoardItem> {
  return requestJson('/api/board/items', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({hourRewardId, ...position}),
  });
}

export function moveBoardItem(
  hourRewardId: string,
  position: BoardPosition,
): Promise<BoardItem> {
  return requestJson(`/api/board/items/${encodeURIComponent(hourRewardId)}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(position),
  });
}

export async function removeBoardItem(hourRewardId: string): Promise<void> {
  const response = await fetch(`/api/board/items/${encodeURIComponent(hourRewardId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) {
    throw await readApiError(response);
  }
}
