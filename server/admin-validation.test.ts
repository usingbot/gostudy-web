import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminValidationError,
  parseAdminPagination,
  parseChalkAdjustmentBody,
  parseDiscordUserId,
  parseRoleChangeBody,
  parseUserSearchQuery,
} from './admin-validation.js';

test('Discord IDs accept canonical positive PostgreSQL BIGINT strings', () => {
  assert.equal(parseDiscordUserId('1'), '1');
  assert.equal(parseDiscordUserId('9223372036854775807'), '9223372036854775807');

  for (const value of [undefined, 1, '', '0', '-1', '01', '1.0', '1e3', ' 1', '9223372036854775808']) {
    assert.throws(() => parseDiscordUserId(value), AdminValidationError);
  }
});

test('exact user search accepts only one canonical query property', () => {
  assert.equal(parseUserSearchQuery({query: '123'}), '123');
  for (const query of [{}, {query: '123', username: 'x'}, {query: ['123']}, {query: '01'}]) {
    assert.throws(() => parseUserSearchQuery(query), AdminValidationError);
  }
});

test('adjustment body is strict and validates amount, reason, and UUIDv4', () => {
  const valid = {
    amount: '1000000',
    reason: 'Alpha testing',
    requestId: '7cc98552-2ed4-4c49-b68c-23424d56c171',
  };
  assert.deepEqual(parseChalkAdjustmentBody(valid), valid);

  const invalid: unknown[] = [
    null,
    {},
    {...valid, userid: '999'},
    {...valid, amount: 10},
    {...valid, amount: '0'},
    {...valid, amount: '01'},
    {...valid, amount: '1000001'},
    {...valid, reason: ''},
    {...valid, reason: ' padded'},
    {...valid, reason: 'x'.repeat(501)},
    {...valid, requestId: '7CC98552-2ED4-4C49-B68C-23424D56C171'},
    {...valid, requestId: '7cc98552-2ed4-1c49-b68c-23424d56c171'},
  ];
  for (const body of invalid) {
    assert.throws(() => parseChalkAdjustmentBody(body), AdminValidationError);
  }
});

test('role change body cannot request owner and rejects unknown properties', () => {
  assert.deepEqual(parseRoleChangeBody({
    expectedRole: 'user',
    role: 'tester',
    reason: 'Private alpha access',
  }), {
    expectedRole: 'user',
    role: 'tester',
    reason: 'Private alpha access',
  });

  for (const body of [
    {expectedRole: 'user', role: 'owner', reason: 'No'},
    {expectedRole: 'invalid', role: 'tester', reason: 'No'},
    {expectedRole: 'user', role: 'tester', reason: ' No'},
    {expectedRole: 'user', role: 'tester', reason: 'No', actorUserId: '1'},
  ]) {
    assert.throws(() => parseRoleChangeBody(body), AdminValidationError);
  }
});

test('admin pagination is bounded, canonical, and rejects unknown fields', () => {
  assert.deepEqual(parseAdminPagination({}, 'beforeAuditId'), {beforeId: null, limit: 20});
  assert.deepEqual(parseAdminPagination({beforeAuditId: '9223372036854775807', limit: '50'}, 'beforeAuditId'), {
    beforeId: '9223372036854775807',
    limit: 50,
  });
  for (const query of [
    {limit: '0'},
    {limit: '51'},
    {limit: 20},
    {beforeAuditId: '0'},
    {beforeAuditId: '1', other: 'x'},
  ]) {
    assert.throws(() => parseAdminPagination(query, 'beforeAuditId'), AdminValidationError);
  }
});
