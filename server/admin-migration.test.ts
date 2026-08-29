import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';

const migrationPath = resolve('migrations/0004_create_admin_roles.sql');

test('admin migration keeps bootstrap private and the role audit immutable', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /web_bootstrap_owner[\s\S]*SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.web_bootstrap_owner\(bigint\)\s+FROM PUBLIC/);
  assert.doesNotMatch(sql, /GRANT EXECUTE\s+ON FUNCTION public\.web_bootstrap_owner[\s\S]*TO gostudy_web/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.web_role_audit/);
  assert.match(sql, /BEFORE TRUNCATE ON public\.web_role_audit/);
});

test('admin migration grants only narrow web calls and revokes generic Chalk mutation', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const functionName of [
    'gostudy_admin_grant_chalk',
    'gostudy_admin_deduct_chalk',
    'gostudy_admin_get_chalk_account',
    'gostudy_admin_list_chalk_transactions',
  ]) {
    assert.match(sql, new RegExp(`public\\.${functionName}`));
  }
  assert.match(sql, /REVOKE EXECUTE\s+ON FUNCTION public\.gostudy_apply_chalk_transaction/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s+ON TABLE[\s\S]*gostudy_chalk_accounts[\s\S]*gostudy_chalk_transactions\s+FROM gostudy_web/);
  assert.match(sql, /GRANT SELECT\s+ON TABLE[\s\S]*web_user_roles[\s\S]*web_role_audit\s+TO gostudy_web/);
});

test('normal role changes cannot create, transfer, or alter the owner role', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /_new_role NOT IN \('admin', 'tester', 'user'\)/);
  assert.match(sql, /IF _current_role = 'owner'/);
  assert.match(sql, /_actor_role = 'admin'[\s\S]*_current_role NOT IN \('user', 'tester'\)/);
  assert.match(sql, /USING ERRCODE = 'GSR01'/);
});

test('role-table grant sources explicitly reject nullable admin and tester grants', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(
    sql,
    /CONSTRAINT web_user_roles_grant_source_valid\s+CHECK \(\s+\(role = 'owner' AND granted_by IS NULL\)\s+OR \(\s+role IN \('admin', 'tester'\)\s+AND granted_by IS NOT NULL\s+AND granted_by > 0\s+\)\s+\)/,
  );
});

test('role table has a partial unique index allowing only one owner', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(
    sql,
    /CREATE UNIQUE INDEX web_user_roles_single_owner\s+ON public\.web_user_roles \(\(role\)\)\s+WHERE role = 'owner'/,
  );
});

test('normal admin audits explicitly require a positive non-null actor', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(
    sql,
    /change_source = 'bootstrap'\s+AND actor_userid IS NULL\s+AND old_role = 'user'\s+AND new_role = 'owner'[\s\S]*change_source = 'admin'\s+AND actor_userid IS NOT NULL\s+AND actor_userid > 0\s+AND old_role <> 'owner'\s+AND new_role <> 'owner'/,
  );
});
