import assert from 'node:assert/strict';
import test from 'node:test';

import type {Pool} from 'pg';

import {getRoleCapabilities, getUserRole} from './admin-auth.js';

function poolWithRows(rows: unknown[]): Pool {
  return {
    query: async () => ({rows, rowCount: rows.length}),
  } as unknown as Pool;
}

test('missing role resolves to user', async () => {
  assert.equal(await getUserRole(poolWithRows([]), '123'), 'user');
});

test('stored owner, admin, and tester roles resolve exactly', async () => {
  for (const role of ['owner', 'admin', 'tester'] as const) {
    assert.equal(await getUserRole(poolWithRows([{role}]), '123'), role);
  }
  await assert.rejects(getUserRole(poolWithRows([{role: 'user'}]), '123'));
});

test('capabilities match owner, admin, tester, and user policy', () => {
  const owner = getRoleCapabilities('owner');
  assert.equal(owner.accessAdmin, true);
  assert.equal(owner.manageAdmin, true);
  assert.equal(owner.manageOwner, false);

  const admin = getRoleCapabilities('admin');
  assert.equal(admin.accessAdmin, true);
  assert.equal(admin.adjustChalk, true);
  assert.equal(admin.manageTester, true);
  assert.equal(admin.manageAdmin, false);

  for (const role of ['tester', 'user'] as const) {
    assert.deepEqual(Object.values(getRoleCapabilities(role)), [
      false, false, false, false, false, false, false,
    ]);
  }
});
