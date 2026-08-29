import type {Pool, QueryResultRow} from 'pg';

import {
  getUserRole,
  type UserRole,
} from './admin-auth.js';
import type {
  AdminPagination,
  ChalkAdjustmentInput,
  RoleChangeInput,
} from './admin-validation.js';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const MIN_POSTGRES_BIGINT = -9_223_372_036_854_775_808n;

interface IdentityRow extends QueryResultRow {
  username: unknown;
  global_name: unknown;
  avatar_hash: unknown;
}

interface ChalkAccountRow extends QueryResultRow {
  userid: unknown;
  balance: unknown;
  lifetime_credited: unknown;
  lifetime_debited: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface ChalkTransactionRow extends QueryResultRow {
  transactionid: unknown;
  userid: unknown;
  amount: unknown;
  balance_after: unknown;
  transaction_type: unknown;
  actor_userid: unknown;
  reason: unknown;
  created_at: unknown;
}

interface ChalkMutationRow extends ChalkTransactionRow {
  idempotency_key: unknown;
  reference_type: unknown;
  reference_id: unknown;
  reversal_of_transactionid: unknown;
  account_balance: unknown;
  account_lifetime_credited: unknown;
  account_lifetime_debited: unknown;
  account_created_at: unknown;
  account_updated_at: unknown;
  replayed: unknown;
}

interface RoleChangeRow extends QueryResultRow {
  userid: unknown;
  old_role: unknown;
  new_role: unknown;
  changed: unknown;
  changed_at: unknown;
}

interface RoleAuditRow extends QueryResultRow {
  auditid: unknown;
  target_userid: unknown;
  old_role: unknown;
  new_role: unknown;
  actor_userid: unknown;
  change_source: unknown;
  reason: unknown;
  created_at: unknown;
}

export interface KnownDiscordIdentity {
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

export interface AdminUserSummary {
  userid: string;
  identity: KnownDiscordIdentity | null;
  role: UserRole;
}

export interface ChalkAccount {
  userid: string;
  balance: string;
  lifetimeCredited: string;
  lifetimeDebited: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ChalkTransaction {
  transactionId: string;
  userid: string;
  amount: string;
  balanceAfter: string;
  transactionType: string;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ChalkHistoryPage {
  items: ChalkTransaction[];
  nextCursor: string | null;
}

export interface ChalkMutationResult {
  transaction: ChalkTransaction;
  account: ChalkAccount;
  replayed: boolean;
}

export interface RoleChangeResult {
  userid: string;
  oldRole: UserRole;
  newRole: UserRole;
  changed: boolean;
  changedAt: string | null;
}

export interface RoleAuditEvent {
  auditId: string;
  targetUserId: string;
  oldRole: UserRole;
  newRole: UserRole;
  actorUserId: string | null;
  changeSource: 'bootstrap' | 'admin';
  reason: string;
  createdAt: string;
}

export interface RoleAuditPage {
  items: RoleAuditEvent[];
  nextCursor: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  manageableRoles: UserRole[];
  chalkAccount: ChalkAccount;
  chalkHistory: ChalkHistoryPage;
}

function parseBigint(value: unknown, fieldName: string): string {
  const parsed = String(value);
  if (!/^-?(?:0|[1-9]\d*)$/.test(parsed)) {
    throw new Error(`${fieldName} was not a canonical BIGINT`);
  }
  const bigint = BigInt(parsed);
  if (bigint < MIN_POSTGRES_BIGINT || bigint > MAX_POSTGRES_BIGINT) {
    throw new Error(`${fieldName} was outside the PostgreSQL BIGINT range`);
  }
  return parsed;
}

function parsePositiveBigint(value: unknown, fieldName: string): string {
  const parsed = parseBigint(value, fieldName);
  if (BigInt(parsed) <= 0n) {
    throw new Error(`${fieldName} was not positive`);
  }
  return parsed;
}

function parseNonnegativeBigint(value: unknown, fieldName: string): string {
  const parsed = parseBigint(value, fieldName);
  if (BigInt(parsed) < 0n) {
    throw new Error(`${fieldName} was negative`);
  }
  return parsed;
}

function parseTimestamp(value: unknown, fieldName: string): string {
  if (!(value instanceof Date) && typeof value !== 'string') {
    throw new Error(`${fieldName} was not a timestamp`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${fieldName} was not a timestamp`);
  }
  return parsed.toISOString();
}

function parseOptionalTimestamp(value: unknown, fieldName: string): string | null {
  return value === null ? null : parseTimestamp(value, fieldName);
}

function parseStoredRole(value: unknown, fieldName: string): UserRole {
  if (value !== 'owner' && value !== 'admin' && value !== 'tester' && value !== 'user') {
    throw new Error(`${fieldName} was invalid`);
  }
  return value;
}

function parseOptionalPositiveBigint(value: unknown, fieldName: string): string | null {
  return value === null ? null : parsePositiveBigint(value, fieldName);
}

function mapAccount(row: ChalkAccountRow): ChalkAccount {
  return {
    userid: parsePositiveBigint(row.userid, 'userid'),
    balance: parseNonnegativeBigint(row.balance, 'balance'),
    lifetimeCredited: parseNonnegativeBigint(row.lifetime_credited, 'lifetime_credited'),
    lifetimeDebited: parseNonnegativeBigint(row.lifetime_debited, 'lifetime_debited'),
    createdAt: parseOptionalTimestamp(row.created_at, 'account created_at'),
    updatedAt: parseOptionalTimestamp(row.updated_at, 'account updated_at'),
  };
}

function mapTransaction(row: ChalkTransactionRow): ChalkTransaction {
  if (typeof row.transaction_type !== 'string' || row.transaction_type.length === 0) {
    throw new Error('transaction_type was invalid');
  }
  if (row.reason !== null && typeof row.reason !== 'string') {
    throw new Error('transaction reason was invalid');
  }
  return {
    transactionId: parsePositiveBigint(row.transactionid, 'transactionid'),
    userid: parsePositiveBigint(row.userid, 'transaction userid'),
    amount: parseBigint(row.amount, 'amount'),
    balanceAfter: parseNonnegativeBigint(row.balance_after, 'balance_after'),
    transactionType: row.transaction_type,
    actorUserId: parseOptionalPositiveBigint(row.actor_userid, 'actor_userid'),
    reason: row.reason,
    createdAt: parseTimestamp(row.created_at, 'transaction created_at'),
  };
}

export function getManageableRoles(actorRole: UserRole, targetRole: UserRole): UserRole[] {
  if (targetRole === 'owner') {
    return [];
  }
  if (actorRole === 'owner') {
    return (['user', 'tester', 'admin'] as const).filter((role) => role !== targetRole);
  }
  if (actorRole === 'admin' && targetRole === 'user') {
    return ['tester'];
  }
  if (actorRole === 'admin' && targetRole === 'tester') {
    return ['user'];
  }
  return [];
}

export async function getKnownDiscordIdentity(
  pool: Pool,
  userId: string,
): Promise<KnownDiscordIdentity | null> {
  const result = await pool.query<IdentityRow>(
    `SELECT session_data.sess->>'username' AS username,
            CASE
              WHEN json_typeof(session_data.sess->'globalName') = 'string'
                THEN session_data.sess->>'globalName'
              ELSE NULL
            END AS global_name,
            CASE
              WHEN json_typeof(session_data.sess->'avatarHash') = 'string'
                THEN session_data.sess->>'avatarHash'
              ELSE NULL
            END AS avatar_hash
       FROM public.web_sessions AS session_data
      WHERE session_data.expire > now()
        AND session_data.sess->>'discordUserId' = $1
        AND json_typeof(session_data.sess->'username') = 'string'
      ORDER BY session_data.expire DESC
      LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row || typeof row.username !== 'string' || row.username.length === 0) {
    return null;
  }
  if (row.global_name !== null && typeof row.global_name !== 'string') {
    throw new Error('Stored Discord global name was invalid');
  }
  if (row.avatar_hash !== null && typeof row.avatar_hash !== 'string') {
    throw new Error('Stored Discord avatar hash was invalid');
  }
  return {
    username: row.username,
    globalName: row.global_name,
    avatarHash: row.avatar_hash,
  };
}

export async function getAdminUserSummary(
  pool: Pool,
  userId: string,
): Promise<AdminUserSummary> {
  const [identity, role] = await Promise.all([
    getKnownDiscordIdentity(pool, userId),
    getUserRole(pool, userId),
  ]);
  return {userid: userId, identity, role};
}

export async function getChalkAccount(pool: Pool, userId: string): Promise<ChalkAccount> {
  const result = await pool.query<ChalkAccountRow>(
    `SELECT userid,
            balance,
            lifetime_credited,
            lifetime_debited,
            created_at,
            updated_at
       FROM public.gostudy_admin_get_chalk_account($1::bigint)`,
    [userId],
  );
  if (result.rows.length !== 1) {
    throw new Error('Chalk account function returned an invalid row count');
  }
  return mapAccount(result.rows[0]);
}

export async function getChalkHistory(
  pool: Pool,
  userId: string,
  pagination: AdminPagination,
): Promise<ChalkHistoryPage> {
  const result = await pool.query<ChalkTransactionRow>(
    `SELECT transactionid,
            userid,
            amount,
            balance_after,
            transaction_type,
            actor_userid,
            reason,
            created_at
       FROM public.gostudy_admin_list_chalk_transactions(
         $1::bigint,
         $2::bigint,
         $3::integer
       )`,
    [userId, pagination.beforeId, pagination.limit],
  );
  const items = result.rows.map(mapTransaction);
  return {
    items,
    nextCursor: items.length === pagination.limit
      ? items.at(-1)?.transactionId ?? null
      : null,
  };
}

export async function getAdminUserDetail(
  pool: Pool,
  actorRole: UserRole,
  userId: string,
  pagination: AdminPagination,
): Promise<AdminUserDetail> {
  const [summary, chalkAccount, chalkHistory] = await Promise.all([
    getAdminUserSummary(pool, userId),
    getChalkAccount(pool, userId),
    getChalkHistory(pool, userId, pagination),
  ]);
  return {
    ...summary,
    manageableRoles: getManageableRoles(actorRole, summary.role),
    chalkAccount,
    chalkHistory,
  };
}

export async function applyChalkAdjustment(
  pool: Pool,
  kind: 'grant' | 'deduct',
  targetUserId: string,
  actorUserId: string,
  input: ChalkAdjustmentInput,
): Promise<ChalkMutationResult> {
  const functionName = kind === 'grant'
    ? 'public.gostudy_admin_grant_chalk'
    : 'public.gostudy_admin_deduct_chalk';
  const idempotencyKey = `admin:${actorUserId}:${input.requestId}`;
  const result = await pool.query<ChalkMutationRow>(
    `SELECT *
       FROM ${functionName}(
         $1::bigint,
         $2::bigint,
         $3::bigint,
         $4::text,
         $5::text
       )`,
    [targetUserId, actorUserId, input.amount, idempotencyKey, input.reason],
  );
  if (result.rows.length !== 1) {
    throw new Error('Chalk mutation function returned an invalid row count');
  }
  const row = result.rows[0];
  if (typeof row.replayed !== 'boolean') {
    throw new Error('Chalk replay state was invalid');
  }
  return {
    transaction: mapTransaction(row),
    account: mapAccount({
      userid: row.userid,
      balance: row.account_balance,
      lifetime_credited: row.account_lifetime_credited,
      lifetime_debited: row.account_lifetime_debited,
      created_at: row.account_created_at,
      updated_at: row.account_updated_at,
    }),
    replayed: row.replayed,
  };
}

export async function changeUserRole(
  pool: Pool,
  targetUserId: string,
  actorUserId: string,
  input: RoleChangeInput,
): Promise<RoleChangeResult> {
  const result = await pool.query<RoleChangeRow>(
    `SELECT userid,
            old_role,
            new_role,
            changed,
            changed_at
       FROM public.web_change_user_role(
         $1::bigint,
         $2::bigint,
         $3::text,
         $4::text,
         $5::text
       )`,
    [targetUserId, actorUserId, input.expectedRole, input.role, input.reason],
  );
  if (result.rows.length !== 1) {
    throw new Error('Role change function returned an invalid row count');
  }
  const row = result.rows[0];
  if (typeof row.changed !== 'boolean') {
    throw new Error('Role changed state was invalid');
  }
  return {
    userid: parsePositiveBigint(row.userid, 'role userid'),
    oldRole: parseStoredRole(row.old_role, 'old role'),
    newRole: parseStoredRole(row.new_role, 'new role'),
    changed: row.changed,
    changedAt: parseOptionalTimestamp(row.changed_at, 'role changed_at'),
  };
}

export async function getRoleAudit(
  pool: Pool,
  pagination: AdminPagination,
): Promise<RoleAuditPage> {
  const result = await pool.query<RoleAuditRow>(
    `SELECT auditid,
            target_userid,
            old_role,
            new_role,
            actor_userid,
            change_source,
            reason,
            created_at
       FROM public.web_role_audit
      WHERE ($1::bigint IS NULL OR auditid < $1::bigint)
      ORDER BY auditid DESC
      LIMIT $2`,
    [pagination.beforeId, pagination.limit],
  );
  const items = result.rows.map((row): RoleAuditEvent => {
    if (row.change_source !== 'bootstrap' && row.change_source !== 'admin') {
      throw new Error('Role audit source was invalid');
    }
    if (typeof row.reason !== 'string') {
      throw new Error('Role audit reason was invalid');
    }
    return {
      auditId: parsePositiveBigint(row.auditid, 'auditid'),
      targetUserId: parsePositiveBigint(row.target_userid, 'audit target_userid'),
      oldRole: parseStoredRole(row.old_role, 'audit old_role'),
      newRole: parseStoredRole(row.new_role, 'audit new_role'),
      actorUserId: parseOptionalPositiveBigint(row.actor_userid, 'audit actor_userid'),
      changeSource: row.change_source,
      reason: row.reason,
      createdAt: parseTimestamp(row.created_at, 'audit created_at'),
    };
  });
  return {
    items,
    nextCursor: items.length === pagination.limit
      ? items.at(-1)?.auditId ?? null
      : null,
  };
}

export function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' ? error.code : null;
}
