import assert from 'node:assert/strict';
import test from 'node:test';

import {shouldShowAdminNavigation} from './admin-capabilities.js';
import type {AdminSelf, UserRole} from '../types';

function adminSelf(role: UserRole, accessAdmin: boolean): AdminSelf {
  return {
    role,
    capabilities: {
      accessAdmin,
      searchUsers: accessAdmin,
      viewChalk: accessAdmin,
      adjustChalk: accessAdmin,
      manageTester: accessAdmin,
      manageAdmin: role === 'owner',
      manageOwner: false,
    },
  };
}

test('Admin navigation is visible only for owner/admin capabilities', () => {
  assert.equal(shouldShowAdminNavigation(adminSelf('owner', true)), true);
  assert.equal(shouldShowAdminNavigation(adminSelf('admin', true)), true);
  assert.equal(shouldShowAdminNavigation(adminSelf('tester', false)), false);
  assert.equal(shouldShowAdminNavigation(adminSelf('user', false)), false);
  assert.equal(shouldShowAdminNavigation(null), false);
});
