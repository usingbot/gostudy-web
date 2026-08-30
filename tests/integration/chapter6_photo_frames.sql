\set ON_ERROR_STOP on

-- Run only in a disposable StudyLion v20 database after web migrations 0001-0009.
-- Every fixture and assertion rolls back.
BEGIN;

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

ALTER TABLE public.web_photo_frames OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_validate_photo_frame_owner() OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_replace_photo_frame_image(
  bigint, bigint, text, integer, integer, bigint, text, bigint
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
  (SELECT version = 20 FROM public.versionhistory ORDER BY time DESC LIMIT 1),
  'disposable database must use StudyLion schema v20'
);
SELECT pg_temp.assert_true(
  (SELECT item_type = 'photo_frame' AND price_chalk = 5
     FROM public.web_board_shop_catalog
    WHERE item_key = 'photo-frame'),
  'Photo Frame catalog identity and price must remain unchanged'
);
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
    WHERE oid = 'public.web_photo_frames'::regclass)) = 'gostudy_web_owner',
  'Photo Frame table must transfer to the NOLOGIN web owner'
);
SELECT pg_temp.assert_true(
  (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
     FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_replace_photo_frame_image(bigint,bigint,text,integer,integer,bigint,text,bigint)'::regprocedure),
  'Photo Frame replacement function must transfer to the NOLOGIN web owner'
);

INSERT INTO public.web_board_purchases
  (purchaseid, userid, item_key, price_chalk, chalk_transactionid, chalk_balance)
VALUES
  ('11111111-1111-4111-8111-666666666661', 960000000000001, 'photo-frame', 5, 960000000010001, 15),
  ('22222222-2222-4222-8222-666666666662', 960000000000002, 'photo-frame', 5, 960000000010002, 10),
  ('33333333-3333-4333-8333-666666666663', 960000000000001, 'sticky-note', 2, 960000000010003, 8),
  ('44444444-4444-4444-8444-666666666664', 960000000000001, 'gif-slot', 3, 960000000010004, 5);

INSERT INTO public.web_owned_board_items (userid, item_key, purchaseid)
SELECT userid, item_key, purchaseid
FROM public.web_board_purchases
WHERE purchaseid IN (
  '11111111-1111-4111-8111-666666666661',
  '22222222-2222-4222-8222-666666666662',
  '33333333-3333-4333-8333-666666666663',
  '44444444-4444-4444-8444-666666666664'
);

INSERT INTO public.web_study_boards (userid)
VALUES (960000000000001), (960000000000002)
ON CONFLICT (userid) DO NOTHING;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM public.web_photo_frames AS frame
      JOIN public.web_owned_board_items AS owned USING (owned_itemid)
     WHERE owned.purchaseid = '11111111-1111-4111-8111-666666666661'
  ),
  'a newly owned Photo Frame must be valid without image state'
);

SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_photo_frames', 'SELECT')
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_photo_frames', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'runtime Photo Frame table access must be read-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.web_replace_photo_frame_image(bigint,bigint,text,integer,integer,bigint,text,bigint)',
    'EXECUTE'
  ),
  'runtime role must execute the narrow replacement function'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_function_privilege(
    'public',
    'public.web_replace_photo_frame_image(bigint,bigint,text,integer,integer,bigint,text,bigint)',
    'EXECUTE'
  ),
  'PUBLIC must not execute the replacement function'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER'),
  'runtime role must not inherit the definer owner role'
);

SET LOCAL ROLE gostudy_web;

DO $$
DECLARE
  _photo_frame bigint;
  _foreign_photo_frame bigint;
  _sticky_note bigint;
  _gif_slot bigint;
  _initial record;
  _replacement record;
BEGIN
  SELECT owned_itemid INTO STRICT _photo_frame
  FROM public.web_owned_board_items
  WHERE purchaseid = '11111111-1111-4111-8111-666666666661';

  SELECT owned_itemid INTO STRICT _foreign_photo_frame
  FROM public.web_owned_board_items
  WHERE purchaseid = '22222222-2222-4222-8222-666666666662';

  SELECT owned_itemid INTO STRICT _sticky_note
  FROM public.web_owned_board_items
  WHERE purchaseid = '33333333-3333-4333-8333-666666666663';

  SELECT owned_itemid INTO STRICT _gif_slot
  FROM public.web_owned_board_items
  WHERE purchaseid = '44444444-4444-4444-8444-666666666664';

  BEGIN
    PERFORM public.web_replace_photo_frame_image(
      _foreign_photo_frame,
      960000000000001,
      pg_catalog.format(
        'photo-frames/%s/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp',
        _foreign_photo_frame
      ),
      100, 100, 1000, repeat('a', 64), 0
    );
    RAISE EXCEPTION 'foreign Photo Frame update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSP01' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_replace_photo_frame_image(
      _sticky_note,
      960000000000001,
      pg_catalog.format(
        'photo-frames/%s/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp',
        _sticky_note
      ),
      100, 100, 1000, repeat('b', 64), 0
    );
    RAISE EXCEPTION 'Sticky Note image update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSP02' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_replace_photo_frame_image(
      _gif_slot,
      960000000000001,
      pg_catalog.format(
        'photo-frames/%s/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp',
        _gif_slot
      ),
      100, 100, 1000, repeat('c', 64), 0
    );
    RAISE EXCEPTION 'GIF Slot image update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSP02' THEN NULL;
  END;

  SELECT * INTO STRICT _initial
  FROM public.web_replace_photo_frame_image(
    _photo_frame,
    960000000000001,
    pg_catalog.format(
      'photo-frames/%s/11111111-1111-4111-8111-111111111111.webp',
      _photo_frame
    ),
    1200, 800, 200000, repeat('1', 64), 0
  );

  IF _initial.revision <> 1 OR _initial.old_object_key IS NOT NULL THEN
    RAISE EXCEPTION 'initial Photo Frame state did not start at revision one';
  END IF;

  SELECT * INTO STRICT _replacement
  FROM public.web_replace_photo_frame_image(
    _photo_frame,
    960000000000001,
    pg_catalog.format(
      'photo-frames/%s/22222222-2222-4222-8222-222222222222.webp',
      _photo_frame
    ),
    800, 1200, 180000, repeat('2', 64), 1
  );

  IF _replacement.revision <> 2
     OR _replacement.old_object_key <> _initial.object_key THEN
    RAISE EXCEPTION 'replacement did not increment revision and return old key';
  END IF;

  BEGIN
    PERFORM public.web_replace_photo_frame_image(
      _photo_frame,
      960000000000001,
      pg_catalog.format(
        'photo-frames/%s/33333333-3333-4333-8333-333333333333.webp',
        _photo_frame
      ),
      640, 480, 100000, repeat('3', 64), 1
    );
    RAISE EXCEPTION 'stale replacement unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSP03' THEN NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.web_photo_frames
    WHERE owned_itemid = _photo_frame
      AND object_key = _replacement.object_key
      AND revision = 2
  ) THEN
    RAISE EXCEPTION 'stale replacement mutated durable state';
  END IF;

  INSERT INTO public.web_study_board_objects
    (userid, source_type, owned_itemid, object_type, x, y)
  VALUES (960000000000001, 'shop', _photo_frame, 'photo_frame', 0.25, 0.75);

  BEGIN
    INSERT INTO public.web_study_board_objects
      (userid, source_type, owned_itemid, object_type, x, y)
    VALUES (960000000000001, 'shop', _photo_frame, 'photo_frame', 0.5, 0.5);
    RAISE EXCEPTION 'duplicate Photo Frame placement unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  DELETE FROM public.web_study_board_objects
  WHERE userid = 960000000000001 AND owned_itemid = _photo_frame;

  IF NOT EXISTS (
    SELECT 1 FROM public.web_photo_frames
    WHERE owned_itemid = _photo_frame AND revision = 2
  ) THEN
    RAISE EXCEPTION 'removing placement deleted Photo Frame image state';
  END IF;

  INSERT INTO public.web_study_board_objects
    (userid, source_type, owned_itemid, object_type, x, y)
  VALUES (960000000000001, 'shop', _photo_frame, 'photo_frame', 0.6, 0.4);

  IF NOT EXISTS (
    SELECT 1
      FROM public.web_study_board_objects AS object
      JOIN public.web_photo_frames AS frame USING (owned_itemid)
     WHERE object.owned_itemid = _photo_frame
       AND object.object_type = 'photo_frame'
       AND frame.revision = 2
       AND object.x = 0.6
       AND object.y = 0.4
  ) THEN
    RAISE EXCEPTION 're-added Photo Frame did not restore stored image state';
  END IF;

  BEGIN
    UPDATE public.web_photo_frames
       SET revision = revision + 1
     WHERE owned_itemid = _photo_frame;
    RAISE EXCEPTION 'runtime direct Photo Frame update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0
     FROM public.gostudy_chalk_transactions
    WHERE userid IN (960000000000001, 960000000000002)),
  'Photo Frame image replacement and placement must never mutate Chalk'
);

ROLLBACK;
