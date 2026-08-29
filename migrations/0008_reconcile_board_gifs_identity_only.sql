BEGIN;

LOCK TABLE public.web_board_gifs IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.web_board_gifs') IS NULL THEN
    RAISE EXCEPTION 'web_board_gifs does not exist; migration 0007 must run first.';
  END IF;
END;
$$;

-- Remove the obsolete draft function that accepted and persisted GIPHY media
-- metadata. Final Go Study state stores canonical GIPHY identity only.
DROP FUNCTION IF EXISTS public.web_upsert_board_gif(
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  integer,
  integer
);

-- Remove metadata columns used by the early Chapter 5 draft.
-- giphy_id and ownership state are preserved exactly.
ALTER TABLE public.web_board_gifs
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS preview_url,
  DROP COLUMN IF EXISTS render_url,
  DROP COLUMN IF EXISTS width,
  DROP COLUMN IF EXISTS height;

CREATE OR REPLACE FUNCTION public.web_upsert_board_gif(
  _owned_itemid bigint,
  _userid bigint,
  _giphy_id text
)
RETURNS TABLE (
  owned_itemid bigint,
  giphy_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _owned_userid bigint;
  _item_key text;
BEGIN
  IF _owned_itemid IS NULL OR _owned_itemid <= 0
     OR _userid IS NULL OR _userid <= 0
     OR _giphy_id IS NULL
     OR char_length(_giphy_id) NOT BETWEEN 1 AND 128
     OR _giphy_id !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Board GIF input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT owned.userid, owned.item_key
    INTO _owned_userid, _item_key
    FROM public.web_owned_board_items AS owned
   WHERE owned.owned_itemid = _owned_itemid;

  IF NOT FOUND OR _owned_userid <> _userid THEN
    RAISE EXCEPTION 'GIF Slot owned item was not found.'
      USING ERRCODE = 'GSB04';
  END IF;

  IF _item_key <> 'gif-slot' THEN
    RAISE EXCEPTION 'Owned item is not a GIF Slot.'
      USING ERRCODE = 'GSB05';
  END IF;

  RETURN QUERY
  INSERT INTO public.web_board_gifs AS board_gif (
    owned_itemid,
    userid,
    giphy_id
  ) VALUES (
    _owned_itemid,
    _userid,
    _giphy_id
  )
  ON CONFLICT ON CONSTRAINT web_board_gifs_pkey DO UPDATE
    SET giphy_id = EXCLUDED.giphy_id,
        updated_at = now()
  RETURNING
    board_gif.owned_itemid,
    board_gif.giphy_id;
END;
$$;

REVOKE ALL ON TABLE public.web_board_gifs FROM PUBLIC;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.web_board_gifs
FROM gostudy_web;

GRANT SELECT
ON TABLE public.web_board_gifs
TO gostudy_web;

REVOKE ALL
ON FUNCTION public.web_upsert_board_gif(bigint, bigint, text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.web_upsert_board_gif(bigint, bigint, text)
TO gostudy_web;

-- Make the final ownership deterministic both for:
-- 1. databases that previously received the draft 0007, and
-- 2. fresh databases running final 0007 -> 0008.
ALTER TABLE public.web_board_gifs
OWNER TO gostudy_web_owner;

ALTER FUNCTION public.web_validate_board_gif_owner()
OWNER TO gostudy_web_owner;

ALTER FUNCTION public.web_upsert_board_gif(bigint, bigint, text)
OWNER TO gostudy_web_owner;

DO $$
DECLARE
  _obsolete_columns bigint;
BEGIN
  SELECT count(*)
    INTO _obsolete_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'web_board_gifs'
     AND column_name IN (
       'title',
       'preview_url',
       'render_url',
       'width',
       'height'
     );

  IF _obsolete_columns <> 0 THEN
    RAISE EXCEPTION 'Obsolete GIPHY media columns remain after reconciliation.';
  END IF;

  IF to_regprocedure(
    'public.web_upsert_board_gif(bigint,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Final three-argument GIF upsert function was not created.';
  END IF;

  IF to_regprocedure(
    'public.web_upsert_board_gif(bigint,bigint,text,text,text,text,integer,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Obsolete eight-argument GIF upsert function still exists.';
  END IF;
END;
$$;

COMMIT;
