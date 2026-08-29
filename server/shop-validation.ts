const ITEM_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ShopValidationCode = 'INVALID_BODY' | 'INVALID_ITEM';

export interface ShopPurchaseInput {
  itemKey: string;
  requestId: string;
}

export class ShopValidationError extends Error {
  constructor(public readonly code: ShopValidationCode, message: string) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCanonicalShopItemKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 64
    && ITEM_KEY_PATTERN.test(value);
}

export function parseShopPurchaseBody(value: unknown): ShopPurchaseInput {
  if (!isRecord(value)) {
    throw new ShopValidationError('INVALID_BODY', 'Purchase body must be an object');
  }
  const keys = Object.keys(value);
  if (keys.length !== 2
      || !Object.prototype.hasOwnProperty.call(value, 'itemKey')
      || !Object.prototype.hasOwnProperty.call(value, 'requestId')) {
    throw new ShopValidationError('INVALID_BODY', 'Purchase body shape was invalid');
  }
  if (!isCanonicalShopItemKey(value.itemKey)) {
    throw new ShopValidationError('INVALID_ITEM', 'Item key was invalid');
  }
  if (typeof value.requestId !== 'string' || !UUID_V4_PATTERN.test(value.requestId)) {
    throw new ShopValidationError('INVALID_BODY', 'Request ID must be a lowercase UUIDv4');
  }
  return {itemKey: value.itemKey, requestId: value.requestId};
}
