import type {BoardShopData, BoardShopPurchaseResult} from '../types';
import {ApiError} from './productData';

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as {error?: unknown};
    return typeof body.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchBoardShop(signal?: AbortSignal): Promise<BoardShopData> {
  const response = await fetch('/api/shop', {
    credentials: 'same-origin',
    headers: {Accept: 'application/json'},
    signal,
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorCode(response));
  }
  return response.json() as Promise<BoardShopData>;
}

export async function purchaseBoardShopItem(
  itemKey: string,
  requestId: string,
): Promise<BoardShopPurchaseResult> {
  const response = await fetch('/api/shop/purchase', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({itemKey, requestId}),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorCode(response));
  }
  return response.json() as Promise<BoardShopPurchaseResult>;
}
