BEGIN;

-- A missing row represents an owned Photo Frame with no uploaded image yet.
-- Stored objects are always application-generated, metadata-free WebP files.
CREATE TABLE public.web_photo_frames (
  owned_itemid bigint PRIMARY KEY,
  userid bigint NOT NULL,
  object_key text NOT NULL UNIQUE,
  width integer NOT NULL,
  height integer NOT NULL,
  byte_size bigint NOT NULL,
  content_sha256 text NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_photo_frames_owned_item_fkey
    FOREIGN KEY (owned_itemid)
    REFERENCES public.web_owned_board_items (owned_itemid)
    ON DELETE RESTRICT,
  CONSTRAINT web_photo_frames_userid_positive
    CHECK (userid > 0),
  CONSTRAINT web_photo_frames_object_key_canonical
    CHECK (
      object_key ~ (
        '^photo-frames/' || owned_itemid::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
      )
    ),
  CONSTRAINT web_photo_frames_width_valid
    CHECK (width BETWEEN 1 AND 1600),
  CONSTRAINT web_photo_frames_height_valid
    CHECK (height BETWEEN 1 AND 1600),
  CONSTRAINT web_photo_frames_byte_size_valid
    CHECK (byte_size BETWEEN 1 AND 5242880),
  CONSTRAINT web_photo_frames_content_sha256_canonical
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT web_photo_frames_revision_positive
    CHECK (revision > 0)
);

CREATE INDEX web_photo_frames_userid_idx
  ON public.web_photo_frames (userid, owned_itemid);

CREATE FUNCTION public.web_validate_photo_frame_owner()
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
     OR _item_key <> 'photo-frame' THEN
    RAISE EXCEPTION 'Photo Frame image does not match its owned Photo Frame.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER web_validate_photo_frame_owner_insert_update
BEFORE INSERT OR UPDATE OF owned_itemid, userid
ON public.web_photo_frames
FOR EACH ROW EXECUTE FUNCTION public.web_validate_photo_frame_owner();

CREATE FUNCTION public.web_replace_photo_frame_image(
  _owned_itemid bigint,
  _userid bigint,
  _object_key text,
  _width integer,
  _height integer,
  _byte_size bigint,
  _content_sha256 text,
  _expected_revision bigint
)
RETURNS TABLE (
  owned_itemid bigint,
  object_key text,
  width integer,
  height integer,
  byte_size bigint,
  content_sha256 text,
  revision bigint,
  old_object_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _owned_userid bigint;
  _item_key text;
  _current_revision bigint;
  _old_object_key text;
BEGIN
  IF _owned_itemid IS NULL OR _owned_itemid <= 0
     OR _userid IS NULL OR _userid <= 0
     OR _object_key IS NULL
     OR _object_key !~ (
       '^photo-frames/' || _owned_itemid::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
     )
     OR _width IS NULL OR _width NOT BETWEEN 1 AND 1600
     OR _height IS NULL OR _height NOT BETWEEN 1 AND 1600
     OR _byte_size IS NULL OR _byte_size NOT BETWEEN 1 AND 5242880
     OR _content_sha256 IS NULL OR _content_sha256 !~ '^[0-9a-f]{64}$'
     OR _expected_revision IS NULL OR _expected_revision < 0 THEN
    RAISE EXCEPTION 'Photo Frame image input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize both first uploads and replacements. Row locking alone cannot
  -- serialize two concurrent inserts when the state row does not exist yet.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'gostudy:web:photo-frame:' || _owned_itemid::text,
      0
    )
  );

  SELECT owned.userid, owned.item_key
    INTO _owned_userid, _item_key
    FROM public.web_owned_board_items AS owned
   WHERE owned.owned_itemid = _owned_itemid
   FOR SHARE;

  IF NOT FOUND OR _owned_userid <> _userid THEN
    RAISE EXCEPTION 'Photo Frame owned item was not found.'
      USING ERRCODE = 'GSP01';
  END IF;
  IF _item_key <> 'photo-frame' THEN
    RAISE EXCEPTION 'Owned item is not a Photo Frame.'
      USING ERRCODE = 'GSP02';
  END IF;

  SELECT frame.object_key, frame.revision
    INTO _old_object_key, _current_revision
    FROM public.web_photo_frames AS frame
   WHERE frame.owned_itemid = _owned_itemid
   FOR UPDATE;

  IF _expected_revision = 0 THEN
    IF FOUND THEN
      RAISE EXCEPTION 'Photo Frame image revision conflict.'
        USING ERRCODE = 'GSP03';
    END IF;

    RETURN QUERY
    INSERT INTO public.web_photo_frames AS frame (
      owned_itemid,
      userid,
      object_key,
      width,
      height,
      byte_size,
      content_sha256,
      revision
    ) VALUES (
      _owned_itemid,
      _userid,
      _object_key,
      _width,
      _height,
      _byte_size,
      _content_sha256,
      1
    )
    RETURNING
      frame.owned_itemid,
      frame.object_key,
      frame.width,
      frame.height,
      frame.byte_size,
      frame.content_sha256,
      frame.revision,
      NULL::text;
    RETURN;
  END IF;

  IF NOT FOUND OR _current_revision <> _expected_revision THEN
    RAISE EXCEPTION 'Photo Frame image revision conflict.'
      USING ERRCODE = 'GSP03';
  END IF;

  RETURN QUERY
  UPDATE public.web_photo_frames AS frame
     SET object_key = _object_key,
         width = _width,
         height = _height,
         byte_size = _byte_size,
         content_sha256 = _content_sha256,
         revision = _current_revision + 1,
         updated_at = now()
   WHERE frame.owned_itemid = _owned_itemid
  RETURNING
    frame.owned_itemid,
    frame.object_key,
    frame.width,
    frame.height,
    frame.byte_size,
    frame.content_sha256,
    frame.revision,
    _old_object_key;
END;
$$;

REVOKE ALL ON TABLE public.web_photo_frames FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.web_validate_photo_frame_owner(),
  public.web_replace_photo_frame_image(
    bigint,
    bigint,
    text,
    integer,
    integer,
    bigint,
    text,
    bigint
  )
FROM PUBLIC;

GRANT SELECT ON TABLE public.web_photo_frames TO gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.web_photo_frames
FROM gostudy_web;

GRANT EXECUTE
ON FUNCTION public.web_replace_photo_frame_image(
  bigint,
  bigint,
  text,
  integer,
  integer,
  bigint,
  text,
  bigint
)
TO gostudy_web;

COMMIT;
