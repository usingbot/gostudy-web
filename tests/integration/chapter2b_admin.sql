\set ON_ERROR_STOP on

-- Run only after chapter2b_v19_setup.sql and migration 0004 in a disposable DB.
ALTER TABLE public.web_user_roles OWNER TO gostudy_web_owner;
ALTER TABLE public.web_role_audit OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_role_audit_auditid_seq OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reject_role_audit_mutation()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_bootstrap_owner(bigint)
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_change_user_role(
  bigint, bigint, text, text, text
) OWNER TO gostudy_web_owner;

CREATE FUNCTION pg_temp.assert_true(_condition boolean, _message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF _condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'assertion failed: %', _message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  NOT (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'gostudy_web_owner'),
  'web owner role must be NOLOGIN'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER'),
  'runtime web role must not inherit web owner'
);

SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_user_roles', 'SELECT')
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_user_roles', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'web role-table privileges must be read-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_role_audit', 'SELECT')
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_role_audit', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'web audit privileges must be read-only'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_sequence_privilege(
    'gostudy_web', 'public.web_role_audit_auditid_seq', 'USAGE'
  ),
  'web must not use the audit identity sequence directly'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_function_privilege(
    'gostudy_web', 'public.web_bootstrap_owner(bigint)', 'EXECUTE'
  ),
  'web must not execute owner bootstrap'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.web_change_user_role(bigint,bigint,text,text,text)',
    'EXECUTE'
  ),
  'web must execute narrow role change'
);

SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.gostudy_admin_grant_chalk(bigint,bigint,bigint,text,text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.gostudy_admin_deduct_chalk(bigint,bigint,bigint,text,text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'gostudy_web', 'public.gostudy_admin_get_chalk_account(bigint)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.gostudy_admin_list_chalk_transactions(bigint,bigint,integer)',
    'EXECUTE'
  ),
  'all four narrow Chalk functions must be executable'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 4
     FROM pg_catalog.pg_proc AS functions
     JOIN pg_catalog.pg_namespace AS schemas
       ON schemas.oid = functions.pronamespace
    WHERE schemas.nspname = 'public'
      AND functions.proname LIKE 'gostudy%chalk%'
      AND pg_catalog.has_function_privilege(
        'gostudy_web', functions.oid, 'EXECUTE'
      )),
  'web must execute exactly four Chalk-named functions'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.gostudy_apply_chalk_transaction(bigint,bigint,text,text,bigint,text,text,bigint,text)',
    'EXECUTE'
  ),
  'generic Chalk mutation must remain inaccessible'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.gostudy_chalk_accounts', 'INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.gostudy_chalk_transactions', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'web must not mutate Chalk tables directly'
);

DO $$
BEGIN
  INSERT INTO public.web_user_roles (userid, role, granted_by)
  VALUES (901, 'admin', NULL);
  RAISE EXCEPTION 'admin with null grant source unexpectedly succeeded';
EXCEPTION WHEN check_violation THEN
  NULL;
END;
$$;

DO $$
BEGIN
  INSERT INTO public.web_user_roles (userid, role, granted_by)
  VALUES (902, 'tester', NULL);
  RAISE EXCEPTION 'tester with null grant source unexpectedly succeeded';
EXCEPTION WHEN check_violation THEN
  NULL;
END;
$$;

DO $$
BEGIN
  INSERT INTO public.web_user_roles (userid, role, granted_by)
  VALUES (903, 'owner', 100);
  RAISE EXCEPTION 'owner with non-null grant source unexpectedly succeeded';
EXCEPTION WHEN check_violation THEN
  NULL;
END;
$$;

INSERT INTO public.web_user_roles (userid, role, granted_by)
VALUES (911, 'owner', NULL);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
     FROM public.web_user_roles
    WHERE role = 'owner'),
  'first owner row must succeed'
);

DO $$
BEGIN
  INSERT INTO public.web_user_roles (userid, role, granted_by)
  VALUES (912, 'owner', NULL);
  RAISE EXCEPTION 'second distinct owner row unexpectedly succeeded';
EXCEPTION WHEN unique_violation THEN
  NULL;
END;
$$;

INSERT INTO public.web_user_roles (userid, role, granted_by)
VALUES
  (904, 'admin', 100),
  (905, 'tester', 100);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
     FROM public.web_user_roles
    WHERE userid IN (904, 905)
      AND granted_by = 100),
  'admin and tester with positive grant sources must succeed'
);
DELETE FROM public.web_user_roles WHERE userid IN (904, 905, 911);

SET ROLE gostudy_web_owner;
SELECT public.web_bootstrap_owner(100);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT role = 'owner' AND granted_by IS NULL
     FROM public.web_user_roles WHERE userid = 100),
  'bootstrap must create one owner'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.web_role_audit
    WHERE target_userid = 100
      AND old_role = 'user'
      AND new_role = 'owner'
      AND actor_userid IS NULL
      AND change_source = 'bootstrap'),
  'bootstrap must write its audit row'
);

DO $$
BEGIN
  PERFORM public.web_bootstrap_owner(101);
  RAISE EXCEPTION 'second bootstrap unexpectedly succeeded';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
  NULL;
END;
$$;

DO $$
BEGIN
  INSERT INTO public.web_role_audit (
    target_userid, old_role, new_role, actor_userid, change_source, reason
  ) VALUES (
    906, 'user', 'tester', NULL, 'admin', 'Missing actor'
  );
  RAISE EXCEPTION 'admin audit with null actor unexpectedly succeeded';
EXCEPTION WHEN check_violation THEN
  NULL;
END;
$$;

DO $$
BEGIN
  INSERT INTO public.web_role_audit (
    target_userid, old_role, new_role, actor_userid, change_source, reason
  ) VALUES (
    907, 'user', 'tester', 0, 'admin', 'Zero actor'
  );
  RAISE EXCEPTION 'admin audit with zero actor unexpectedly succeeded';
EXCEPTION WHEN check_violation THEN
  NULL;
END;
$$;

DO $$
BEGIN
  INSERT INTO public.web_role_audit (
    target_userid, old_role, new_role, actor_userid, change_source, reason
  ) VALUES (
    908, 'user', 'tester', -1, 'admin', 'Negative actor'
  );
  RAISE EXCEPTION 'admin audit with negative actor unexpectedly succeeded';
EXCEPTION WHEN check_violation THEN
  NULL;
END;
$$;

INSERT INTO public.web_role_audit (
  target_userid, old_role, new_role, actor_userid, change_source, reason
) VALUES (
  909, 'user', 'tester', 100, 'admin', 'Positive actor'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
     FROM public.web_role_audit
    WHERE target_userid = 909
      AND actor_userid = 100
      AND change_source = 'admin'),
  'admin audit with positive actor must succeed'
);

INSERT INTO public.web_role_audit (
  target_userid, old_role, new_role, actor_userid, change_source, reason
) VALUES (
  910, 'user', 'owner', NULL, 'bootstrap', 'Bootstrap shape'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
     FROM public.web_role_audit
    WHERE target_userid = 910
      AND old_role = 'user'
      AND new_role = 'owner'
      AND actor_userid IS NULL
      AND change_source = 'bootstrap'),
  'bootstrap audit with null actor must succeed'
);

SET ROLE gostudy_web;
SELECT pg_temp.assert_true(changed AND old_role = 'user' AND new_role = 'admin',
  'owner should create admin')
FROM public.web_change_user_role(200, 100, 'user', 'admin', 'Initial admin');
SELECT pg_temp.assert_true(changed AND old_role = 'user' AND new_role = 'tester',
  'owner should create tester')
FROM public.web_change_user_role(300, 100, 'user', 'tester', 'Private alpha');
SELECT pg_temp.assert_true(changed AND old_role = 'tester' AND new_role = 'user',
  'admin should revoke tester')
FROM public.web_change_user_role(300, 200, 'tester', 'user', 'Alpha complete');
RESET ROLE;

DO $$
BEGIN
  PERFORM public.web_change_user_role(400, 200, 'user', 'admin', 'Forbidden');
  RAISE EXCEPTION 'admin unexpectedly created admin';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;

DO $$
BEGIN
  PERFORM public.web_change_user_role(200, 200, 'admin', 'tester', 'Forbidden');
  RAISE EXCEPTION 'admin unexpectedly modified an admin';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;

DO $$
BEGIN
  PERFORM public.web_change_user_role(100, 200, 'owner', 'user', 'Forbidden');
  RAISE EXCEPTION 'owner target unexpectedly changed';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;

DO $$
BEGIN
  PERFORM public.web_change_user_role(500, 100, 'user', 'owner', 'Forbidden');
  RAISE EXCEPTION 'normal role function unexpectedly created owner';
EXCEPTION WHEN invalid_parameter_value THEN
  NULL;
END;
$$;

SELECT pg_temp.assert_true(changed AND new_role = 'tester',
  'owner should demote admin')
FROM public.web_change_user_role(200, 100, 'admin', 'tester', 'Reduce access');
SELECT pg_temp.assert_true(changed AND new_role = 'admin',
  'owner should restore admin')
FROM public.web_change_user_role(200, 100, 'tester', 'admin', 'Restore access');

SELECT * FROM public.web_change_user_role(
  400, 100, 'user', 'tester', 'Concurrent test setup'
);
DO $$
BEGIN
  PERFORM public.web_change_user_role(400, 100, 'user', 'admin', 'Stale write');
  RAISE EXCEPTION 'stale role change unexpectedly succeeded';
EXCEPTION WHEN SQLSTATE 'GSR01' THEN
  NULL;
END;
$$;

DO $$
DECLARE
  _audit_count bigint;
  _result record;
BEGIN
  SELECT count(*) INTO _audit_count FROM public.web_role_audit;
  SELECT * INTO STRICT _result
  FROM public.web_change_user_role(400, 100, 'user', 'tester', 'Achieved state');
  IF _result.changed OR _result.changed_at IS NOT NULL THEN
    RAISE EXCEPTION 'achieved-state result was not an idempotent no-op';
  END IF;
  IF (SELECT count(*) FROM public.web_role_audit) <> _audit_count THEN
    RAISE EXCEPTION 'achieved-state no-op unexpectedly wrote audit';
  END IF;
END;
$$;

DO $$
DECLARE
  _audit_count bigint;
BEGIN
  SELECT count(*) INTO _audit_count FROM public.web_role_audit;
  BEGIN
    PERFORM public.web_change_user_role(500, 100, 'user', 'tester', ' bad reason');
    RAISE EXCEPTION 'invalid atomic role change unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.web_user_roles WHERE userid = 500)
     OR (SELECT count(*) FROM public.web_role_audit) <> _audit_count THEN
    RAISE EXCEPTION 'failed role change was not atomic';
  END IF;
END;
$$;

DO $$
BEGIN
  UPDATE public.web_role_audit SET reason = reason WHERE auditid = 1;
  RAISE EXCEPTION 'audit update unexpectedly succeeded';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
  NULL;
END;
$$;
DO $$
BEGIN
  DELETE FROM public.web_role_audit WHERE auditid = 1;
  RAISE EXCEPTION 'audit delete unexpectedly succeeded';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
  NULL;
END;
$$;
DO $$
BEGIN
  TRUNCATE public.web_role_audit;
  RAISE EXCEPTION 'audit truncate unexpectedly succeeded';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
  NULL;
END;
$$;

SET ROLE gostudy_web;
SELECT pg_temp.assert_true(
  transaction_type = 'admin_grant'
  AND actor_userid = 100
  AND reason = 'Test grant'
  AND amount = 10,
  'grant wrapper must record safe actor and reason fields'
)
FROM public.gostudy_admin_grant_chalk(
  600, 100, 10,
  'admin:100:123e4567-e89b-42d3-a456-426614174000',
  'Test grant'
);
SELECT pg_temp.assert_true(replayed AND account_balance = 10,
  'exact Chalk retry must replay without applying twice')
FROM public.gostudy_admin_grant_chalk(
  600, 100, 10,
  'admin:100:123e4567-e89b-42d3-a456-426614174000',
  'Test grant'
);
DO $$
BEGIN
  PERFORM public.gostudy_admin_grant_chalk(
    600, 100, 11,
    'admin:100:123e4567-e89b-42d3-a456-426614174000',
    'Test grant'
  );
  RAISE EXCEPTION 'changed payload reused an idempotency key';
EXCEPTION WHEN data_exception THEN
  IF SQLSTATE <> '22000' THEN
    RAISE;
  END IF;
END;
$$;
SELECT pg_temp.assert_true(
  transaction_type = 'admin_deduct'
  AND actor_userid = 100
  AND reason = 'Test deduct'
  AND amount = -4,
  'deduct wrapper must record safe actor and reason fields'
)
FROM public.gostudy_admin_deduct_chalk(
  600, 100, 4,
  'admin:100:123e4567-e89b-42d3-a456-426614174001',
  'Test deduct'
);
SELECT pg_temp.assert_true(balance = 6 AND lifetime_credited = 10 AND lifetime_debited = 4,
  'narrow wrappers must update canonical Chalk account')
FROM public.gostudy_admin_get_chalk_account(600);
WITH latest AS (
  SELECT transactionid
  FROM public.gostudy_admin_list_chalk_transactions(600, NULL, 1)
), history_page AS (
  SELECT history.transactionid
  FROM latest
  CROSS JOIN LATERAL public.gostudy_admin_list_chalk_transactions(
    600, latest.transactionid, 20
  ) AS history
)
SELECT pg_temp.assert_true(
  count(*) = 1
  AND max(history_page.transactionid) < (SELECT transactionid FROM latest),
  'Chalk history must use descending keyset pagination'
)
FROM history_page;
RESET ROLE;

SELECT pg_temp.assert_true(
  count(*) = 1,
  'role audit keyset page must exclude its cursor'
)
FROM (
  SELECT auditid
  FROM public.web_role_audit
  WHERE auditid < (SELECT max(auditid) FROM public.web_role_audit)
  ORDER BY auditid DESC
  LIMIT 1
) AS audit_page;

SELECT 'chapter2b disposable integration passed' AS result;
