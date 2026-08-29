\set ON_ERROR_STOP on

-- Run after StudyLion v20, chapter3b_v20_setup.sql, and migrations 0001-0007
-- in a disposable database. Every fixture and assertion rolls back.
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

ALTER TABLE public.web_board_gifs OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_validate_board_gif_owner() OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_upsert_board_gif(bigint, bigint, text)
  OWNER TO gostudy_web_owner;

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
  (SELECT item_type = 'gif' AND price_chalk = 3
     FROM public.web_board_shop_catalog
    WHERE item_key = 'gif-slot'),
  'GIF Slot catalog identity and price must remain unchanged'
);
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
    WHERE oid = 'public.web_board_gifs'::regclass)) = 'gostudy_web_owner',
  'board GIF table must transfer to the NOLOGIN web owner'
);
SELECT pg_temp.assert_true(
  (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
     FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_upsert_board_gif(bigint,bigint,text)'::regprocedure),
  'board GIF definer function must transfer to the NOLOGIN web owner'
);

INSERT INTO public.web_board_purchases
  (purchaseid, userid, item_key, price_chalk, chalk_transactionid, chalk_balance)
VALUES
  ('11111111-1111-4111-8111-555555555551', 950000000000001, 'gif-slot', 3, 950000000010001, 12),
  ('22222222-2222-4222-8222-555555555552', 950000000000002, 'gif-slot', 3, 950000000010002, 9),
  ('33333333-3333-4333-8333-555555555553', 950000000000001, 'sticky-note', 2, 950000000010003, 7);

INSERT INTO public.web_owned_board_items (userid, item_key, purchaseid)
SELECT userid, item_key, purchaseid
FROM public.web_board_purchases
WHERE purchaseid IN (
  '11111111-1111-4111-8111-555555555551',
  '22222222-2222-4222-8222-555555555552',
  '33333333-3333-4333-8333-555555555553'
);

INSERT INTO public.web_study_boards (userid)
VALUES (950000000000001), (950000000000002)
ON CONFLICT (userid) DO NOTHING;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM public.web_board_gifs AS board_gif
      JOIN public.web_owned_board_items AS owned USING (owned_itemid)
     WHERE owned.purchaseid = '11111111-1111-4111-8111-555555555551'
  ),
  'a newly owned GIF Slot must be valid without a selected GIF row'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'web_board_gifs'
       AND column_name IN ('title', 'preview_url', 'render_url', 'width', 'height')
  ),
  'canonical GIF state must persist no provider display or media metadata'
);

DO $$
DECLARE
  _gif_slot bigint;
  _foreign_gif_slot bigint;
  _sticky_note bigint;
BEGIN
  SELECT owned_itemid INTO STRICT _gif_slot
  FROM public.web_owned_board_items
  WHERE purchaseid = '11111111-1111-4111-8111-555555555551';

  SELECT owned_itemid INTO STRICT _foreign_gif_slot
  FROM public.web_owned_board_items
  WHERE purchaseid = '22222222-2222-4222-8222-555555555552';

  SELECT owned_itemid INTO STRICT _sticky_note
  FROM public.web_owned_board_items
  WHERE purchaseid = '33333333-3333-4333-8333-555555555553';

  BEGIN
    PERFORM public.web_upsert_board_gif(
      _foreign_gif_slot,
      950000000000001,
      'foreign123'
    );
    RAISE EXCEPTION 'foreign GIF Slot update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSB04' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_board_gif(
      _sticky_note,
      950000000000001,
      'wrongtype123'
    );
    RAISE EXCEPTION 'non-GIF item update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSB05' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_board_gif(
      _gif_slot,
      950000000000001,
      'unsafe/id'
    );
    RAISE EXCEPTION 'noncanonical GIPHY ID unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.web_board_gifs
      (owned_itemid, userid, giphy_id)
    VALUES
      (_gif_slot, 950000000000002, 'forged123');
    RAISE EXCEPTION 'forged GIF owner unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_board_gifs', 'SELECT')
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_board_gifs', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'runtime GIF table access must be read-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.web_upsert_board_gif(bigint,bigint,text)',
    'EXECUTE'
  ),
  'runtime role must execute the narrow GIF upsert function'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_function_privilege(
    'public',
    'public.web_upsert_board_gif(bigint,bigint,text)',
    'EXECUTE'
  ),
  'PUBLIC must not execute the GIF upsert function'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER'),
  'runtime role must not inherit the definer owner role'
);

SET LOCAL ROLE gostudy_web;

DO $$
DECLARE
  _gif_slot bigint;
  _selection record;
BEGIN
  SELECT owned_itemid INTO STRICT _gif_slot
  FROM public.web_owned_board_items
  WHERE purchaseid = '11111111-1111-4111-8111-555555555551';

  SELECT * INTO STRICT _selection
  FROM public.web_upsert_board_gif(
    _gif_slot,
    950000000000001,
    'focus123'
  );

  IF _selection.giphy_id <> 'focus123' THEN
    RAISE EXCEPTION 'GIF upsert did not return stored identity metadata';
  END IF;

  INSERT INTO public.web_study_board_objects
    (userid, source_type, owned_itemid, object_type, x, y)
  VALUES (950000000000001, 'shop', _gif_slot, 'gif', 0.25, 0.75);

  DELETE FROM public.web_study_board_objects
  WHERE userid = 950000000000001 AND owned_itemid = _gif_slot;

  IF NOT EXISTS (
    SELECT 1 FROM public.web_board_gifs
    WHERE owned_itemid = _gif_slot AND giphy_id = 'focus123'
  ) THEN
    RAISE EXCEPTION 'removing placement deleted GIF ownership selection';
  END IF;

  INSERT INTO public.web_study_board_objects
    (userid, source_type, owned_itemid, object_type, x, y)
  VALUES (950000000000001, 'shop', _gif_slot, 'gif', 0.6, 0.4);

  IF NOT EXISTS (
    SELECT 1
      FROM public.web_study_board_objects AS object
      JOIN public.web_board_gifs AS board_gif USING (owned_itemid)
     WHERE object.owned_itemid = _gif_slot
       AND object.object_type = 'gif'
       AND board_gif.giphy_id = 'focus123'
       AND object.x = 0.6
       AND object.y = 0.4
  ) THEN
    RAISE EXCEPTION 're-added GIF Slot did not restore its stored selection';
  END IF;

  BEGIN
    UPDATE public.web_board_gifs
       SET giphy_id = 'bypassed'
     WHERE owned_itemid = _gif_slot;
    RAISE EXCEPTION 'runtime direct GIF update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0
     FROM public.gostudy_chalk_transactions
    WHERE userid IN (950000000000001, 950000000000002)),
  'GIF selection and placement must never mutate Chalk'
);

ROLLBACK;
