\set ON_ERROR_STOP on

-- Run after chapter4_legacy_board_setup.sql and migration 0006 in a disposable
-- StudyLion v20 database. All changes made by this verification suite roll back.
BEGIN;

ALTER TABLE public.web_user_roles OWNER TO gostudy_web_owner;
ALTER TABLE public.web_role_audit OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_role_audit_auditid_seq OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reject_role_audit_mutation() OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_bootstrap_owner(bigint) OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_change_user_role(bigint, bigint, text, text, text)
  OWNER TO gostudy_web_owner;

ALTER TABLE public.web_board_shop_catalog OWNER TO gostudy_web_owner;
ALTER TABLE public.web_board_purchases OWNER TO gostudy_web_owner;
ALTER TABLE public.web_owned_board_items OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_owned_board_items_owned_itemid_seq OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reject_board_purchase_mutation() OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_purchase_board_item(bigint, text, text) OWNER TO gostudy_web_owner;

ALTER TABLE public.web_study_board_objects OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_study_board_objects_board_objectid_seq OWNER TO gostudy_web_owner;
ALTER TABLE public.web_sticky_notes OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_validate_board_shop_object() OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_validate_sticky_note_owner() OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_upsert_sticky_note(bigint, bigint, text) OWNER TO gostudy_web_owner;

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
  to_regclass('public.web_study_board_items') IS NULL,
  'legacy placement table must be retired only after migration proof'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 3
     FROM public.web_study_board_objects
    WHERE source_type = 'reward'),
  'every legacy placement must become one reward object'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
      FROM public.web_study_board_objects
     WHERE userid = 940000000000001
       AND hour_rewardid = 940000000001002
       AND source_type = 'reward'
       AND object_type = 'reward_decoration'
       AND owned_itemid IS NULL
       AND x = 0.123456789012345::double precision
       AND y = 0.987654321098765::double precision
       AND created_at = '2026-08-03 01:02:03+00'::timestamptz
       AND updated_at = '2026-08-04 01:02:03+00'::timestamptz
  ),
  'legacy identity, exact coordinates, and timestamps must survive'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.web_study_board_objects
      (userid, source_type, hour_rewardid, object_type, x, y)
    VALUES
      (940000000000002, 'reward', 940000000001002, 'reward_decoration', 0.5, 0.5);
    RAISE EXCEPTION 'duplicate reward placement unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_study_board_objects
      (userid, source_type, hour_rewardid, owned_itemid, object_type, x, y)
    VALUES
      (940000000000001, 'reward', 940000000009999, 1, 'reward_decoration', 0.5, 0.5);
    RAISE EXCEPTION 'forged reward source shape unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_study_board_objects
      (userid, source_type, object_type, x, y)
    VALUES
      (940000000000001, 'shop', 'sticky_note', 0.5, 0.5);
    RAISE EXCEPTION 'shop source without owned instance unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.web_study_board_objects
       SET x = 1.01
     WHERE hour_rewardid = 940000000001001;
    RAISE EXCEPTION 'non-normalized coordinate unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO public.web_board_purchases
  (purchaseid, userid, item_key, price_chalk, chalk_transactionid, chalk_balance)
VALUES
  ('11111111-1111-4111-8111-111111111111', 940000000000001, 'sticky-note', 2, 940000000010001, 20),
  ('22222222-2222-4222-8222-222222222222', 940000000000001, 'basic-decoration', 1, 940000000010002, 19),
  ('33333333-3333-4333-8333-333333333333', 940000000000001, 'gif-slot', 3, 940000000010003, 16),
  ('44444444-4444-4444-8444-444444444444', 940000000000001, 'photo-frame', 5, 940000000010004, 11),
  ('55555555-5555-4555-8555-555555555555', 940000000000002, 'sticky-note', 2, 940000000010005, 8);

INSERT INTO public.web_owned_board_items (userid, item_key, purchaseid)
SELECT purchases.userid, purchases.item_key, purchases.purchaseid
FROM public.web_board_purchases AS purchases
WHERE purchases.purchaseid IN (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555'
);

INSERT INTO public.web_study_board_objects
  (userid, source_type, owned_itemid, object_type, x, y)
SELECT owned.userid, 'shop', owned.owned_itemid, catalog.item_type, 0.25, 0.75
FROM public.web_owned_board_items AS owned
JOIN public.web_board_shop_catalog AS catalog USING (item_key)
WHERE owned.purchaseid IN (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

DO $$
DECLARE
  _sticky_id bigint;
  _decoration_id bigint;
  _foreign_sticky_id bigint;
BEGIN
  SELECT owned_itemid INTO STRICT _sticky_id
  FROM public.web_owned_board_items
  WHERE purchaseid = '11111111-1111-4111-8111-111111111111';
  SELECT owned_itemid INTO STRICT _decoration_id
  FROM public.web_owned_board_items
  WHERE purchaseid = '22222222-2222-4222-8222-222222222222';
  SELECT owned_itemid INTO STRICT _foreign_sticky_id
  FROM public.web_owned_board_items
  WHERE purchaseid = '55555555-5555-4555-8555-555555555555';

  BEGIN
    INSERT INTO public.web_study_board_objects
      (userid, source_type, owned_itemid, object_type, x, y)
    VALUES (940000000000001, 'shop', _sticky_id, 'sticky_note', 0, 0);
    RAISE EXCEPTION 'duplicate owned placement unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_study_board_objects
      (userid, source_type, owned_itemid, object_type, x, y)
    VALUES (940000000000001, 'shop', _foreign_sticky_id, 'sticky_note', 0, 0);
    RAISE EXCEPTION 'foreign owned placement unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_study_board_objects
      (userid, source_type, owned_itemid, object_type, x, y)
    VALUES (940000000000001, 'shop', _decoration_id, 'sticky_note', 0, 0);
    RAISE EXCEPTION 'forged shop object type unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.web_upsert_sticky_note(_foreign_sticky_id, 940000000000001, 'foreign');
    RAISE EXCEPTION 'foreign Sticky Note edit unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSB04' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_upsert_sticky_note(_decoration_id, 940000000000001, 'wrong type');
    RAISE EXCEPTION 'non-Sticky content unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSB05' THEN NULL;
  END;
END;
$$;

SELECT public.web_upsert_sticky_note(
  (SELECT owned_itemid FROM public.web_owned_board_items
    WHERE purchaseid = '11111111-1111-4111-8111-111111111111'),
  940000000000001,
  '<b>literal text</b> **literal markdown**'
);

SELECT pg_temp.assert_true(
  (SELECT body = '<b>literal text</b> **literal markdown**'
     FROM public.web_sticky_notes
    WHERE owned_itemid = (
      SELECT owned_itemid FROM public.web_owned_board_items
      WHERE purchaseid = '11111111-1111-4111-8111-111111111111'
    )),
  'Sticky Note body must preserve plain text exactly'
);

SELECT public.web_upsert_sticky_note(
  (SELECT owned_itemid FROM public.web_owned_board_items
    WHERE purchaseid = '11111111-1111-4111-8111-111111111111'),
  940000000000001,
  repeat('x', 2000)
);
DO $$
BEGIN
  BEGIN
    PERFORM public.web_upsert_sticky_note(
      (SELECT owned_itemid FROM public.web_owned_board_items
        WHERE purchaseid = '11111111-1111-4111-8111-111111111111'),
      940000000000001,
      repeat('x', 2001)
    );
    RAISE EXCEPTION '2001-character Sticky Note unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$$;

DELETE FROM public.web_study_board_objects
WHERE owned_itemid = (
  SELECT owned_itemid FROM public.web_owned_board_items
  WHERE purchaseid = '11111111-1111-4111-8111-111111111111'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.web_owned_board_items
    WHERE purchaseid = '11111111-1111-4111-8111-111111111111'
  ) AND EXISTS (
    SELECT 1 FROM public.web_sticky_notes
    WHERE owned_itemid = (
      SELECT owned_itemid FROM public.web_owned_board_items
      WHERE purchaseid = '11111111-1111-4111-8111-111111111111'
    )
  ),
  'removing placement must preserve ownership and Sticky Note content'
);

INSERT INTO public.web_study_board_objects
  (userid, source_type, owned_itemid, object_type, x, y)
SELECT owned.userid, 'shop', owned.owned_itemid, catalog.item_type, 0.625, 0.375
FROM public.web_owned_board_items AS owned
JOIN public.web_board_shop_catalog AS catalog USING (item_key)
WHERE owned.purchaseid = '11111111-1111-4111-8111-111111111111';
SELECT pg_temp.assert_true(
  (SELECT note.body = repeat('x', 2000)
          AND object.x = 0.625
          AND object.y = 0.375
     FROM public.web_study_board_objects AS object
     JOIN public.web_sticky_notes AS note USING (owned_itemid)
     JOIN public.web_owned_board_items AS owned USING (owned_itemid)
    WHERE owned.purchaseid = '11111111-1111-4111-8111-111111111111'),
  're-add must restore note content with the new persisted position'
);

SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_study_board_objects', 'SELECT,INSERT,DELETE')
  AND pg_catalog.has_column_privilege('gostudy_web', 'public.web_study_board_objects', 'x', 'UPDATE')
  AND NOT pg_catalog.has_column_privilege('gostudy_web', 'public.web_study_board_objects', 'object_type', 'UPDATE'),
  'runtime role must mutate only placement-safe board columns'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_sticky_notes', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_sticky_notes', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND pg_catalog.has_function_privilege(
    'gostudy_web', 'public.web_upsert_sticky_note(bigint,bigint,text)', 'EXECUTE'
  ),
  'runtime Sticky Note writes must use only the ownership-checking function'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER'),
  'runtime role must not inherit the web owner role'
);

DELETE FROM public.web_study_board_objects
WHERE owned_itemid = (
  SELECT owned_itemid FROM public.web_owned_board_items
  WHERE purchaseid = '22222222-2222-4222-8222-222222222222'
);
SET LOCAL ROLE gostudy_web;
INSERT INTO public.web_study_board_objects
  (userid, source_type, owned_itemid, object_type, x, y)
SELECT owned.userid, 'shop', owned.owned_itemid, catalog.item_type, 0.4, 0.6
FROM public.web_owned_board_items AS owned
JOIN public.web_board_shop_catalog AS catalog USING (item_key)
WHERE owned.purchaseid = '22222222-2222-4222-8222-222222222222';
UPDATE public.web_study_board_objects
   SET x = 0.5, y = 0.5, updated_at = now()
 WHERE owned_itemid = (
   SELECT owned_itemid FROM public.web_owned_board_items
   WHERE purchaseid = '11111111-1111-4111-8111-111111111111'
 );
SELECT public.web_upsert_sticky_note(
  (SELECT owned_itemid FROM public.web_owned_board_items
    WHERE purchaseid = '11111111-1111-4111-8111-111111111111'),
  940000000000001,
  'runtime role save'
);
DO $$
BEGIN
  BEGIN
    UPDATE public.web_study_board_objects
       SET object_type = 'gif'
     WHERE owned_itemid = (
       SELECT owned_itemid FROM public.web_owned_board_items
       WHERE purchaseid = '11111111-1111-4111-8111-111111111111'
     );
    RAISE EXCEPTION 'runtime role unexpectedly changed a trusted object type';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_sticky_notes (owned_itemid, userid, body)
    VALUES (999999999, 940000000000001, 'direct write');
    RAISE EXCEPTION 'runtime role unexpectedly wrote note storage directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT body = 'runtime role save'
     FROM public.web_sticky_notes
    WHERE owned_itemid = (
      SELECT owned_itemid FROM public.web_owned_board_items
      WHERE purchaseid = '11111111-1111-4111-8111-111111111111'
    )),
  'runtime role must save owned Sticky Notes only through the definer boundary'
);

ROLLBACK;
