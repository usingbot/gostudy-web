import assert from 'node:assert/strict';
import test from 'node:test';

import type {Pool, QueryResultRow} from 'pg';

import {
  applyChalkAdjustment,
  changeUserRole,
  getChalkHistory,
  getKnownDiscordIdentity,
  getManageableRoles,
  getRoleAudit,
} from './admin-data.js';

interface QueryCall {
  text: string;
  values: unknown[];
}

function poolReturning(rows: QueryResultRow[], calls: QueryCall[] = []): Pool {
  return {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({text, values});
      return {rows, rowCount: rows.length};
    },
  } as unknown as Pool;
}

const timestamp = new Date('2026-08-29T12:00:00.000Z');

function mutationRow() {
  return {
    transactionid: '9223372036854775806',
    userid: '9223372036854775805',
    amount: '25',
    balance_after: '125',
    transaction_type: 'admin_grant',
    actor_userid: '9223372036854775804',
    reason: 'Support correction',
    created_at: timestamp,
    idempotency_key: 'unused',
    reference_type: null,
    reference_id: null,
    reversal_of_transactionid: null,
    account_balance: '125',
    account_lifetime_credited: '225',
    account_lifetime_debited: '100',
    account_created_at: timestamp,
    account_updated_at: timestamp,
    replayed: false,
  };
}

test('known identity reads only the latest non-sensitive Discord projection', async () => {
  const calls: QueryCall[] = [];
  const identity = await getKnownDiscordIdentity(poolReturning([{
    username: 'learner',
    global_name: 'Study Learner',
    avatar_hash: 'avatar',
  }], calls), '9223372036854775805');

  assert.deepEqual(identity, {
    username: 'learner',
    globalName: 'Study Learner',
    avatarHash: 'avatar',
  });
  assert.deepEqual(calls[0].values, ['9223372036854775805']);
  assert.match(calls[0].text, /expire > now\(\)/);
  assert.doesNotMatch(calls[0].text, /oauthState|oauthReturnTo|cookie/i);
  assert.equal(await getKnownDiscordIdentity(poolReturning([]), '1'), null);
});

test('Chalk adjustment calls only the selected narrow function with a server namespace', async () => {
  const calls: QueryCall[] = [];
  const result = await applyChalkAdjustment(
    poolReturning([mutationRow()], calls),
    'grant',
    '9223372036854775805',
    '9223372036854775804',
    {
      amount: '25',
      reason: 'Support correction',
      requestId: '123e4567-e89b-42d3-a456-426614174000',
    },
  );

  assert.match(calls[0].text, /public\.gostudy_admin_grant_chalk/);
  assert.doesNotMatch(calls[0].text, /gostudy_apply_chalk_transaction/);
  assert.deepEqual(calls[0].values, [
    '9223372036854775805',
    '9223372036854775804',
    '25',
    'admin:9223372036854775804:123e4567-e89b-42d3-a456-426614174000',
    'Support correction',
  ]);
  assert.equal(result.transaction.transactionId, '9223372036854775806');
  assert.equal(result.account.userid, '9223372036854775805');
  assert.equal(result.replayed, false);
});

test('history and role audit preserve BIGINT values as strings and paginate by keyset', async () => {
  const historyCalls: QueryCall[] = [];
  const history = await getChalkHistory(poolReturning([mutationRow()], historyCalls), '9', {
    beforeId: '100',
    limit: 1,
  });
  assert.equal(history.nextCursor, '9223372036854775806');
  assert.deepEqual(historyCalls[0].values, ['9', '100', 1]);

  const auditCalls: QueryCall[] = [];
  const audit = await getRoleAudit(poolReturning([{
    auditid: '9223372036854775807',
    target_userid: '9223372036854775806',
    old_role: 'user',
    new_role: 'tester',
    actor_userid: '9223372036854775805',
    change_source: 'admin',
    reason: 'Test access',
    created_at: timestamp,
  }], auditCalls), {beforeId: null, limit: 1});
  assert.equal(audit.items[0].auditId, '9223372036854775807');
  assert.equal(audit.nextCursor, '9223372036854775807');
  assert.deepEqual(auditCalls[0].values, [null, 1]);
});

test('role changes use the definer function and return its concurrency result', async () => {
  const calls: QueryCall[] = [];
  const result = await changeUserRole(poolReturning([{
    userid: '77',
    old_role: 'user',
    new_role: 'tester',
    changed: true,
    changed_at: timestamp,
  }], calls), '77', '11', {
    expectedRole: 'user',
    role: 'tester',
    reason: 'QA access',
  });
  assert.match(calls[0].text, /public\.web_change_user_role/);
  assert.deepEqual(calls[0].values, ['77', '11', 'user', 'tester', 'QA access']);
  assert.deepEqual(result, {
    userid: '77',
    oldRole: 'user',
    newRole: 'tester',
    changed: true,
    changedAt: timestamp.toISOString(),
  });
});

test('manageable role options enforce the owner and admin matrix', () => {
  assert.deepEqual(getManageableRoles('owner', 'user'), ['tester', 'admin']);
  assert.deepEqual(getManageableRoles('owner', 'admin'), ['user', 'tester']);
  assert.deepEqual(getManageableRoles('admin', 'user'), ['tester']);
  assert.deepEqual(getManageableRoles('admin', 'tester'), ['user']);
  assert.deepEqual(getManageableRoles('admin', 'admin'), []);
  assert.deepEqual(getManageableRoles('owner', 'owner'), []);
});
