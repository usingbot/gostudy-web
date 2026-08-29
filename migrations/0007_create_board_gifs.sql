BEGIN;

-- A missing row represents an owned GIF Slot that has not been configured yet.
-- Persist only the canonical GIPHY ID. All display metadata and media URLs are
-- resolved directly by the browser and are never durable Go Study state.
CREATE TABLE public.web_board_gifs (
  owned_itemid bigint PRIMARY KEY,
  userid bigint NOT NULL,
  giphy_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_board_gifs_userid_positive
    CHECK (userid > 0),
  CONSTRAINT web_board_gifs_giphy_id_canonical
    CHECK (
      char_length(giphy_id) BETWEEN 1 AND 128
      AND giphy_id ~ '^[A-Za-z0-9_-]+$'
    ),
  CONSTRAINT web_board_gifs_owned_item_fkey
    FOREIGN KEY (owned_itemid)
    REFERENCES public.web_owned_board_items (owned_itemid)
    ON DELETE RESTRICT
);

CREATE INDEX web_board_gifs_userid_idx
  ON public.web_board_gifs (userid, owned_itemid);

CREATE FUNCTION public.web_validate_board_gif_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  _owned_userid bigint;
  _item_key text;
BEGIN
  SELECT owned.userid, owned.item_key
    INTO _owned_userid, _item_key
    FROM public.web_owned_board_items AS owned
   WHERE owned.owned_itemid = NEW.owned_itemid;

  IF NOT FOUND
     OR _owned_userid <> NEW.userid
     OR _item_key <> 'gif-slot' THEN
    RAISE EXCEPTION 'Board GIF does not match its owned GIF Slot.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER web_validate_board_gif_owner_insert_update
BEFORE INSERT OR UPDATE OF owned_itemid, userid
ON public.web_board_gifs
FOR EACH ROW EXECUTE FUNCTION public.web_validate_board_gif_owner();

CREATE FUNCTION public.web_upsert_board_gif(
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

REVOKE ALL ON FUNCTION
  public.web_validate_board_gif_owner(),
  public.web_upsert_board_gif(bigint, bigint, text)
FROM PUBLIC;

GRANT SELECT ON TABLE public.web_board_gifs TO gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.web_board_gifs
FROM gostudy_web;

GRANT EXECUTE
ON FUNCTION public.web_upsert_board_gif(bigint, bigint, text)
TO gostudy_web;

COMMIT;
