\set ON_ERROR_STOP on

-- Run only after chapter3b_v20_setup.sql and web migrations 0001-0005 in a
-- disposable database. Every data and ownership change in this suite rolls back.
BEGIN;

ALTER TABLE public.web_user_roles OWNER TO gostudy_web_owner;
ALTER TABLE public.web_role_audit OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_role_audit_auditid_seq OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reject_role_audit_mutation()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_bootstrap_owner(bigint)
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_change_user_role(bigint, bigint, text, text, text)
  OWNER TO gostudy_web_owner;

ALTER TABLE public.web_board_shop_catalog OWNER TO gostudy_web_owner;
ALTER TABLE public.web_board_purchases OWNER TO gostudy_web_owner;
ALTER TABLE public.web_owned_board_items OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_owned_board_items_owned_itemid_seq
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reject_board_purchase_mutation()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_purchase_board_item(bigint, text, text)
  OWNER TO gostudy_web_owner;

GRANT EXECUTE
ON FUNCTION public.gostudy_purchase_board_item_chalk(bigint, bigint, text, text)
TO gostudy_web_owner;

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
  (SELECT version = 20 FROM public.versionhistory ORDER BY time DESC LIMIT 1),
  'disposable database must use StudyLion schema v20'
);
SELECT pg_temp.assert_true(
  to_regclass('public.web_board_shop_catalog') IS NOT NULL
  AND to_regclass('public.web_board_purchases') IS NOT NULL
  AND to_regclass('public.web_owned_board_items') IS NOT NULL,
  'all three Shop tables must exist'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 4 FROM public.web_board_shop_catalog),
  'exactly four initial catalog items must be seeded'
);
SELECT pg_temp.assert_true(
  (SELECT array_agg(item_key || ':' || price_chalk::text ORDER BY sort_order)
     FROM public.web_board_shop_catalog)
  = ARRAY[
    'basic-decoration:1',
    'sticky-note:2',
    'gif-slot:3',
    'photo-frame:5'
  ],
  'initial catalog keys and prices must match the Chapter 3B contract'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.web_board_shop_catalog
      (item_key, display_name, item_type, price_chalk, sort_order)
    VALUES ('Invalid_Key', 'Invalid', 'decoration', 1, 50);
    RAISE EXCEPTION 'invalid item key unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_board_shop_catalog
      (item_key, display_name, item_type, price_chalk, sort_order)
    VALUES ('bad-type', 'Invalid', 'loot_box', 1, 50);
    RAISE EXCEPTION 'invalid item type unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_board_shop_catalog
      (item_key, display_name, item_type, price_chalk, sort_order)
    VALUES ('free-item', 'Invalid', 'decoration', 0, 50);
    RAISE EXCEPTION 'zero price unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_board_shop_catalog
      (item_key, display_name, item_type, price_chalk, sort_order)
    VALUES ('overpriced-item', 'Invalid', 'decoration', 1000001, 50);
    RAISE EXCEPTION 'oversized price unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_board_shop_catalog
      (item_key, display_name, item_type, price_chalk, sort_order)
    VALUES ('negative-sort', 'Invalid', 'decoration', 1, -1);
    RAISE EXCEPTION 'negative sort order unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM public.web_purchase_board_item(
      0, 'sticky-note', '11111111-1111-4111-8111-111111111111'
    );
    RAISE EXCEPTION 'invalid userid unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_purchase_board_item(920000000000001, 'sticky-note', 'not-a-uuid');
    RAISE EXCEPTION 'invalid UUID unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_purchase_board_item(
      920000000000001, 'missing-item', '11111111-1111-4111-8111-111111111111'
    );
    RAISE EXCEPTION 'missing item unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSB01' THEN NULL;
  END;
END;
$$;

UPDATE public.web_board_shop_catalog
SET enabled = FALSE
WHERE item_key = 'basic-decoration';
DO $$
BEGIN
  BEGIN
    PERFORM public.web_purchase_board_item(
      920000000000001,
      'basic-decoration',
      '22222222-2222-4222-8222-222222222222'
    );
    RAISE EXCEPTION 'disabled item unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSB02' THEN NULL;
  END;
END;
$$;
UPDATE public.web_board_shop_catalog
SET enabled = TRUE
WHERE item_key = 'basic-decoration';

SELECT * FROM public.gostudy_apply_chalk_transaction(
  920000000000001,
  50,
  'admin_grant',
  'chapter3b:funding:1',
  920000000009999,
  NULL,
  NULL,
  NULL,
  'Disposable Shop funding'
);

-- Changing the database price proves the purchase function never uses an
-- Express/React constant or caller-supplied price.
UPDATE public.web_board_shop_catalog
SET price_chalk = 4
WHERE item_key = 'sticky-note';

DO $$
DECLARE
  _result record;
BEGIN
  SELECT * INTO STRICT _result
  FROM public.web_purchase_board_item(
    920000000000001,
    'sticky-note',
    '33333333-3333-4333-8333-333333333333'
  );
  IF _result.price_chalk <> 4
     OR _result.chalk_balance <> 46
     OR _result.replayed IS NOT FALSE THEN
    RAISE EXCEPTION 'database-priced purchase result was not canonical';
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT price_chalk = 4
     AND chalk_transactionid > 0
     AND chalk_balance = 46
     FROM public.web_board_purchases
    WHERE purchaseid = '33333333-3333-4333-8333-333333333333'),
  'purchase must record exact price, Chalk transaction, and balance'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
     FROM public.web_owned_board_items
    WHERE purchaseid = '33333333-3333-4333-8333-333333333333'),
  'purchase must create exactly one owned item'
);
SELECT pg_temp.assert_true(
  (SELECT transactions.amount = -4
     FROM public.web_board_purchases AS purchases
     JOIN public.gostudy_chalk_transactions AS transactions
       ON transactions.transactionid = purchases.chalk_transactionid
    WHERE purchases.purchaseid = '33333333-3333-4333-8333-333333333333'),
  'Chalk ledger must debit the exact database price'
);

DO $$
DECLARE
  _result record;
BEGIN
  SELECT * INTO STRICT _result
  FROM public.web_purchase_board_item(
    920000000000001,
    'sticky-note',
    '33333333-3333-4333-8333-333333333333'
  );
  IF _result.replayed IS NOT TRUE OR _result.chalk_balance <> 46 THEN
    RAISE EXCEPTION 'exact replay was not canonical';
  END IF;
END;
$$;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
     FROM public.web_owned_board_items
    WHERE purchaseid = '33333333-3333-4333-8333-333333333333')
  AND
  (SELECT count(*) = 1
     FROM public.gostudy_chalk_transactions
    WHERE idempotency_key =
      'shop:920000000000001:33333333-3333-4333-8333-333333333333'),
  'exact replay must not debit or create ownership twice'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.web_purchase_board_item(
      920000000000001,
      'gif-slot',
      '33333333-3333-4333-8333-333333333333'
    );
    RAISE EXCEPTION 'changed replay item unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSB03' THEN NULL;
  END;
END;
$$;

SELECT public.web_purchase_board_item(
  920000000000001,
  'basic-decoration',
  '44444444-4444-4444-8444-444444444444'
);
SELECT public.web_purchase_board_item(
  920000000000001,
  'basic-decoration',
  '55555555-5555-4555-8555-555555555555'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
     FROM public.web_owned_board_items
    WHERE userid = 920000000000001
      AND item_key = 'basic-decoration'
      AND purchaseid IN (
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555'
      )),
  'different purchase IDs must create duplicate independent item instances'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.web_purchase_board_item(
      920000000000002,
      'basic-decoration',
      '66666666-6666-4666-8666-666666666666'
    );
    RAISE EXCEPTION 'unfunded purchase unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END;
$$;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.web_board_purchases
    WHERE purchaseid = '66666666-6666-4666-8666-666666666666'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.web_owned_board_items
    WHERE purchaseid = '66666666-6666-4666-8666-666666666666'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.gostudy_chalk_transactions
    WHERE idempotency_key =
      'shop:920000000000002:66666666-6666-4666-8666-666666666666'
  ),
  'insufficient Chalk must leave no purchase, ownership, or ledger row'
);

SELECT * FROM public.gostudy_apply_chalk_transaction(
  920000000000003,
  10,
  'admin_grant',
  'chapter3b:funding:3',
  920000000009999,
  NULL,
  NULL,
  NULL,
  'Disposable rollback funding'
);
CREATE FUNCTION pg_temp.reject_test_owned_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'forced owned-item failure' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER chapter3b_force_owned_item_failure
BEFORE INSERT ON public.web_owned_board_items
FOR EACH ROW
WHEN (NEW.userid = 920000000000003)
EXECUTE FUNCTION pg_temp.reject_test_owned_item();
DO $$
BEGIN
  BEGIN
    PERFORM public.web_purchase_board_item(
      920000000000003,
      'photo-frame',
      '77777777-7777-4777-8777-777777777777'
    );
    RAISE EXCEPTION 'forced owned-item failure unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END;
$$;
SELECT pg_temp.assert_true(
  (SELECT balance = 10 FROM public.gostudy_chalk_accounts WHERE userid = 920000000000003)
  AND NOT EXISTS (
    SELECT 1 FROM public.gostudy_chalk_transactions
    WHERE idempotency_key =
      'shop:920000000000003:77777777-7777-4777-8777-777777777777'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.web_board_purchases
    WHERE purchaseid = '77777777-7777-4777-8777-777777777777'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.web_owned_board_items
    WHERE purchaseid = '77777777-7777-4777-8777-777777777777'
  ),
  'owned-item failure must roll back the Chalk debit and all web writes'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.web_board_purchases SET price_chalk = 99
    WHERE purchaseid = '33333333-3333-4333-8333-333333333333';
    RAISE EXCEPTION 'purchase audit UPDATE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.web_board_purchases
    WHERE purchaseid = '33333333-3333-4333-8333-333333333333';
    RAISE EXCEPTION 'purchase audit DELETE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    TRUNCATE public.web_owned_board_items, public.web_board_purchases;
    RAISE EXCEPTION 'purchase audit TRUNCATE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.web_purchase_board_item(bigint,text,text)',
    'EXECUTE'
  ),
  'runtime web role must execute only the web Shop purchase boundary'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.gostudy_purchase_board_item_chalk(bigint,bigint,text,text)',
    'EXECUTE'
  ),
  'runtime web role must not choose a price through the v20 Chalk wrapper'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web_owner',
    'public.gostudy_purchase_board_item_chalk(bigint,bigint,text,text)',
    'EXECUTE'
  ),
  'web owner must be able to delegate the server-side database price'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER')
  AND NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_chalk_owner', 'MEMBER'),
  'runtime web role must not inherit either owner role'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_board_shop_catalog', 'SELECT'
  )
  AND pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_board_purchases', 'SELECT'
  )
  AND pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_owned_board_items', 'SELECT'
  ),
  'runtime web role must read all three Shop tables'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_board_shop_catalog', 'INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_board_purchases', 'INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_owned_board_items', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'runtime web role must not mutate Shop tables directly'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_sequence_privilege(
    'gostudy_web', 'public.web_owned_board_items_owned_itemid_seq', 'USAGE'
  ),
  'runtime web role must not allocate owned item IDs directly'
);

SET LOCAL ROLE gostudy_web;
DO $$
BEGIN
  BEGIN
    PERFORM public.gostudy_purchase_board_item_chalk(
      920000000000004,
      1,
      'shop:920000000000004:99999999-9999-4999-8999-999999999999',
      '99999999-9999-4999-8999-999999999999'
    );
    RAISE EXCEPTION 'runtime role unexpectedly executed the direct Chalk wrapper';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- An actual runtime-role purchase proves SECURITY DEFINER ownership and the
-- owner-only Chalk grant work together without role membership.
SELECT * FROM public.gostudy_apply_chalk_transaction(
  920000000000004,
  5,
  'admin_grant',
  'chapter3b:funding:4',
  920000000009999,
  NULL,
  NULL,
  NULL,
  'Disposable runtime-role funding'
);
SET LOCAL ROLE gostudy_web;
SELECT * FROM public.web_purchase_board_item(
  920000000000004,
  'gif-slot',
  '88888888-8888-4888-8888-888888888888'
);
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.web_owned_board_items
    WHERE purchaseid = '88888888-8888-4888-8888-888888888888'),
  'runtime web role purchase must create one owned item through the definer function'
);

ROLLBACK;
