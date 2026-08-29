BEGIN;

-- Keep the legacy placement set stable until it has been copied and proven.
LOCK TABLE public.web_study_board_items IN ACCESS EXCLUSIVE MODE;

CREATE TABLE public.web_study_board_objects (
  board_objectid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userid bigint NOT NULL
    REFERENCES public.web_study_boards (userid)
    ON DELETE CASCADE,
  source_type text NOT NULL,
  hour_rewardid bigint,
  owned_itemid bigint,
  object_type text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_study_board_objects_userid_positive
    CHECK (userid > 0),
  CONSTRAINT web_study_board_objects_hour_rewardid_positive
    CHECK (hour_rewardid IS NULL OR hour_rewardid > 0),
  CONSTRAINT web_study_board_objects_owned_itemid_positive
    CHECK (owned_itemid IS NULL OR owned_itemid > 0),
  CONSTRAINT web_study_board_objects_x_normalized
    CHECK (x >= 0 AND x <= 1),
  CONSTRAINT web_study_board_objects_y_normalized
    CHECK (y >= 0 AND y <= 1),
  CONSTRAINT web_study_board_objects_source_shape
    CHECK (
      (
        source_type = 'reward'
        AND hour_rewardid IS NOT NULL
        AND owned_itemid IS NULL
        AND object_type = 'reward_decoration'
      )
      OR
      (
        source_type = 'shop'
        AND hour_rewardid IS NULL
        AND owned_itemid IS NOT NULL
        AND object_type IN ('decoration', 'sticky_note', 'gif', 'photo_frame')
      )
    ),
  CONSTRAINT web_study_board_objects_owned_item_fkey
    FOREIGN KEY (owned_itemid)
    REFERENCES public.web_owned_board_items (owned_itemid)
    ON DELETE RESTRICT
);

CREATE INDEX web_study_board_objects_user_history
  ON public.web_study_board_objects (userid, created_at ASC, board_objectid ASC);

CREATE UNIQUE INDEX web_study_board_objects_reward_unique
  ON public.web_study_board_objects (hour_rewardid)
  WHERE source_type = 'reward';

CREATE UNIQUE INDEX web_study_board_objects_owned_item_unique
  ON public.web_study_board_objects (owned_itemid)
  WHERE source_type = 'shop';

CREATE FUNCTION public.web_validate_board_shop_object()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  _owned_userid bigint;
  _owned_item_type text;
BEGIN
  IF NEW.source_type = 'shop' THEN
    SELECT owned.userid, catalog.item_type
      INTO _owned_userid, _owned_item_type
      FROM public.web_owned_board_items AS owned
      JOIN public.web_board_shop_catalog AS catalog
        ON catalog.item_key = owned.item_key
     WHERE owned.owned_itemid = NEW.owned_itemid;

    IF NOT FOUND
       OR _owned_userid <> NEW.userid
       OR _owned_item_type <> NEW.object_type THEN
      RAISE EXCEPTION 'Shop board object does not match its owned item.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER web_validate_board_shop_object_insert_update
BEFORE INSERT OR UPDATE OF userid, source_type, owned_itemid, object_type
ON public.web_study_board_objects
FOR EACH ROW EXECUTE FUNCTION public.web_validate_board_shop_object();

CREATE TABLE public.web_sticky_notes (
  owned_itemid bigint PRIMARY KEY,
  userid bigint NOT NULL,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_sticky_notes_userid_positive
    CHECK (userid > 0),
  CONSTRAINT web_sticky_notes_body_character_limit
    CHECK (char_length(body) <= 2000),
  CONSTRAINT web_sticky_notes_owned_item_fkey
    FOREIGN KEY (owned_itemid)
    REFERENCES public.web_owned_board_items (owned_itemid)
    ON DELETE RESTRICT
);

CREATE INDEX web_sticky_notes_userid_idx
  ON public.web_sticky_notes (userid, owned_itemid);

CREATE FUNCTION public.web_validate_sticky_note_owner()
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
     OR _item_key <> 'sticky-note' THEN
    RAISE EXCEPTION 'Sticky Note content does not match its owned item.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER web_validate_sticky_note_owner_insert_update
BEFORE INSERT OR UPDATE OF owned_itemid, userid
ON public.web_sticky_notes
FOR EACH ROW EXECUTE FUNCTION public.web_validate_sticky_note_owner();

CREATE FUNCTION public.web_upsert_sticky_note(
  _owned_itemid bigint,
  _userid bigint,
  _body text
)
RETURNS TABLE (
  owned_itemid bigint,
  userid bigint,
  body text,
  created_at timestamptz,
  updated_at timestamptz
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
     OR _body IS NULL
     OR char_length(_body) > 2000 THEN
    RAISE EXCEPTION 'Sticky Note input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT owned.userid, owned.item_key
    INTO _owned_userid, _item_key
    FROM public.web_owned_board_items AS owned
   WHERE owned.owned_itemid = _owned_itemid;

  IF NOT FOUND OR _owned_userid <> _userid THEN
    RAISE EXCEPTION 'Sticky Note owned item was not found.'
      USING ERRCODE = 'GSB04';
  END IF;
  IF _item_key <> 'sticky-note' THEN
    RAISE EXCEPTION 'Owned item is not a Sticky Note.'
      USING ERRCODE = 'GSB05';
  END IF;

  RETURN QUERY
  INSERT INTO public.web_sticky_notes AS note (
    owned_itemid,
    userid,
    body
  ) VALUES (
    _owned_itemid,
    _userid,
    _body
  )
  ON CONFLICT ON CONSTRAINT web_sticky_notes_pkey DO UPDATE
    SET body = EXCLUDED.body,
        updated_at = now()
  RETURNING
    note.owned_itemid,
    note.userid,
    note.body,
    note.created_at,
    note.updated_at;
END;
$$;

INSERT INTO public.web_study_board_objects (
  userid,
  source_type,
  hour_rewardid,
  owned_itemid,
  object_type,
  x,
  y,
  created_at,
  updated_at
)
SELECT
  legacy.userid,
  'reward',
  legacy.hour_rewardid,
  NULL,
  'reward_decoration',
  legacy.x,
  legacy.y,
  legacy.created_at,
  legacy.updated_at
FROM public.web_study_board_items AS legacy;

DO $$
DECLARE
  _legacy_count bigint;
  _migrated_count bigint;
BEGIN
  SELECT count(*) INTO _legacy_count
  FROM public.web_study_board_items;

  SELECT count(*) INTO _migrated_count
  FROM public.web_study_board_objects
  WHERE source_type = 'reward';

  IF _legacy_count <> _migrated_count THEN
    RAISE EXCEPTION
      'Study Board migration row-count mismatch: legacy %, migrated %.',
      _legacy_count,
      _migrated_count;
  END IF;

  IF EXISTS (
    SELECT legacy.userid, legacy.hour_rewardid, legacy.x, legacy.y
    FROM public.web_study_board_items AS legacy
    EXCEPT
    SELECT object.userid, object.hour_rewardid, object.x, object.y
    FROM public.web_study_board_objects AS object
    WHERE object.source_type = 'reward'
  ) OR EXISTS (
    SELECT object.userid, object.hour_rewardid, object.x, object.y
    FROM public.web_study_board_objects AS object
    WHERE object.source_type = 'reward'
    EXCEPT
    SELECT legacy.userid, legacy.hour_rewardid, legacy.x, legacy.y
    FROM public.web_study_board_items AS legacy
  ) THEN
    RAISE EXCEPTION 'Study Board migration failed to preserve placement identity or coordinates.';
  END IF;
END;
$$;

DROP TABLE public.web_study_board_items;

REVOKE ALL ON TABLE
  public.web_study_board_objects,
  public.web_sticky_notes
FROM PUBLIC;

REVOKE ALL ON SEQUENCE public.web_study_board_objects_board_objectid_seq
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.web_validate_board_shop_object(),
  public.web_validate_sticky_note_owner(),
  public.web_upsert_sticky_note(bigint, bigint, text)
FROM PUBLIC;

GRANT SELECT, INSERT, DELETE
ON TABLE public.web_study_board_objects
TO gostudy_web;

GRANT UPDATE (x, y, updated_at)
ON TABLE public.web_study_board_objects
TO gostudy_web;

GRANT USAGE, SELECT
ON SEQUENCE public.web_study_board_objects_board_objectid_seq
TO gostudy_web;

GRANT SELECT
ON TABLE public.web_sticky_notes
TO gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.web_sticky_notes
FROM gostudy_web;

GRANT EXECUTE
ON FUNCTION public.web_upsert_sticky_note(bigint, bigint, text)
TO gostudy_web;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.web_study_boards
TO gostudy_web;

COMMIT;
