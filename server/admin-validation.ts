import type {UserRole} from './admin-auth.js';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const MAX_ADJUSTMENT = 1_000_000n;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const DEFAULT_ADMIN_PAGE_LIMIT = 20;
export const MAX_ADMIN_PAGE_LIMIT = 50;

export interface AdminPagination {
  beforeId: string | null;
  limit: number;
}

export interface ChalkAdjustmentInput {
  amount: string;
  reason: string;
  requestId: string;
}

export interface RoleChangeInput {
  expectedRole: UserRole;
  role: UserRole;
  reason: string;
}

export class AdminValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactProperties(
  value: Record<string, unknown>,
  properties: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === properties.length
    && properties.every((property) => Object.prototype.hasOwnProperty.call(value, property));
}

export function parseDiscordUserId(value: unknown, fieldName = 'userid'): string {
  if (typeof value !== 'string'
    || !/^[1-9]\d*$/.test(value)
    || value.length > 19
    || BigInt(value) > MAX_POSTGRES_BIGINT) {
    throw new AdminValidationError(`${fieldName} must be a canonical positive BIGINT string`);
  }
  return value;
}

function parsePositiveAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new AdminValidationError('amount must be a canonical positive decimal string');
  }
  const amount = BigInt(value);
  if (amount > MAX_ADJUSTMENT) {
    throw new AdminValidationError('amount exceeds the per-request maximum');
  }
  return value;
}

function parseReason(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 500
    || value !== value.trim()) {
    throw new AdminValidationError('reason must be canonical and 1-500 characters');
  }
  return value;
}

function parseRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new AdminValidationError('requestId must be a canonical lowercase UUIDv4');
  }
  return value;
}

function parseRole(value: unknown, fieldName: string): UserRole {
  if (value !== 'owner' && value !== 'admin' && value !== 'tester' && value !== 'user') {
    throw new AdminValidationError(`${fieldName} was invalid`);
  }
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_ADMIN_PAGE_LIMIT;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new AdminValidationError('limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_ADMIN_PAGE_LIMIT) {
    throw new AdminValidationError(`limit must not exceed ${MAX_ADMIN_PAGE_LIMIT}`);
  }
  return parsed;
}

export function parseAdminPagination(
  query: Record<string, unknown>,
  beforeProperty: 'beforeTransactionId' | 'beforeAuditId',
): AdminPagination {
  if (Object.keys(query).some((key) => key !== beforeProperty && key !== 'limit')) {
    throw new AdminValidationError('pagination contained an unknown property');
  }
  return {
    beforeId: query[beforeProperty] === undefined
      ? null
      : parseDiscordUserId(query[beforeProperty], beforeProperty),
    limit: parseLimit(query.limit),
  };
}

export function parseUserSearchQuery(query: Record<string, unknown>): string {
  if (!hasExactProperties(query, ['query'])) {
    throw new AdminValidationError('search requires only a query property');
  }
  return parseDiscordUserId(query.query, 'query');
}

export function parseChalkAdjustmentBody(value: unknown): ChalkAdjustmentInput {
  if (!isRecord(value) || !hasExactProperties(value, ['amount', 'reason', 'requestId'])) {
    throw new AdminValidationError('adjustment body shape was invalid');
  }
  return {
    amount: parsePositiveAmount(value.amount),
    reason: parseReason(value.reason),
    requestId: parseRequestId(value.requestId),
  };
}

export function parseRoleChangeBody(value: unknown): RoleChangeInput {
  if (!isRecord(value) || !hasExactProperties(value, ['expectedRole', 'role', 'reason'])) {
    throw new AdminValidationError('role body shape was invalid');
  }
  const role = parseRole(value.role, 'role');
  if (role === 'owner') {
    throw new AdminValidationError('owner changes are not supported');
  }
  return {
    expectedRole: parseRole(value.expectedRole, 'expectedRole'),
    role,
    reason: parseReason(value.reason),
  };
}
