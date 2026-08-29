import {ApiError} from './productData';
import type {
  BoardData,
  BoardObject,
  BoardPosition,
  BoardPositionResult,
  RewardBoardObject,
  ShopBoardObject,
  StickyNoteContent,
} from '../types';

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
): Promise<RewardBoardObject> {
  return requestJson('/api/board/items', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({hourRewardId, ...position}),
  });
}

export function addShopBoardItem(
  ownedItemId: string,
  position: BoardPosition,
): Promise<ShopBoardObject> {
  return requestJson('/api/board/owned-items', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ownedItemId, ...position}),
  });
}

export function moveBoardObject(
  boardObjectId: string,
  position: BoardPosition,
): Promise<BoardPositionResult> {
  return requestJson(`/api/board/objects/${encodeURIComponent(boardObjectId)}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(position),
  });
}

export async function removeBoardObject(boardObjectId: string): Promise<void> {
  const response = await fetch(`/api/board/objects/${encodeURIComponent(boardObjectId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) {
    throw await readApiError(response);
  }
}

export function updateStickyNote(
  ownedItemId: string,
  body: string,
): Promise<StickyNoteContent> {
  return requestJson(`/api/board/sticky-notes/${encodeURIComponent(ownedItemId)}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({body}),
  });
}

export function isStickyNoteObject(item: BoardObject): item is ShopBoardObject & {
  itemType: 'sticky_note';
  body: string;
} {
  return item.source === 'shop'
    && item.itemType === 'sticky_note'
    && typeof item.body === 'string';
}
