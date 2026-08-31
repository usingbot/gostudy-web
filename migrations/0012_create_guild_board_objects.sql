BEGIN;

CREATE TABLE public.web_guild_board_objects (
  objectid BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guildid BIGINT NOT NULL
    REFERENCES public.web_guild_boards (guildid) ON DELETE CASCADE,
  asset_kind TEXT NOT NULL,
  asset_id BIGINT NOT NULL,
  x_units INTEGER NOT NULL,
  y_units INTEGER NOT NULL,
  size_units INTEGER NOT NULL,
  rotation_degrees NUMERIC(6, 2) NOT NULL DEFAULT 0,
  z_index BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT web_guild_board_objects_guildid_positive
    CHECK (guildid > 0),
  CONSTRAINT web_guild_board_objects_asset_kind_allowlist
    CHECK (asset_kind IN ('emoji', 'sticker')),
  CONSTRAINT web_guild_board_objects_asset_id_positive
    CHECK (asset_id > 0),
  CONSTRAINT web_guild_board_objects_position_nonnegative
    CHECK (x_units >= 0 AND y_units >= 0),
  CONSTRAINT web_guild_board_objects_size_bounded
    CHECK (size_units BETWEEN 48 AND 720),
  CONSTRAINT web_guild_board_objects_rotation_bounded
    CHECK (rotation_degrees BETWEEN -180 AND 180),
  CONSTRAINT web_guild_board_objects_z_index_positive
    CHECK (z_index > 0),
  CONSTRAINT web_guild_board_objects_actors_positive
    CHECK (created_by > 0 AND updated_by > 0),
  CONSTRAINT web_guild_board_objects_timestamp_order
    CHECK (updated_at >= created_at)
);

CREATE INDEX web_guild_board_objects_layer_idx
  ON public.web_guild_board_objects (guildid, z_index, objectid);

CREATE FUNCTION public.web_add_guild_board_asset(
  _guildid BIGINT,
  _asset_kind TEXT,
  _asset_id BIGINT,
  _x_units INTEGER,
  _y_units INTEGER,
  _size_units INTEGER,
  _rotation_degrees NUMERIC,
  _expected_revision BIGINT,
  _actor BIGINT
)
RETURNS TABLE (
  board_theme_key TEXT,
  board_width_units INTEGER,
  board_height_units INTEGER,
  board_revision BIGINT,
  objectid BIGINT,
  asset_kind TEXT,
  asset_id BIGINT,
  x_units INTEGER,
  y_units INTEGER,
  size_units INTEGER,
  rotation_degrees NUMERIC,
  z_index BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _board public.web_guild_boards%ROWTYPE;
  _object public.web_guild_board_objects%ROWTYPE;
  _board_created BOOLEAN := FALSE;
  _highest_z BIGINT;
BEGIN
  IF _guildid IS NULL OR _guildid <= 0
     OR _asset_kind IS NULL OR _asset_kind NOT IN ('emoji', 'sticker')
     OR _asset_id IS NULL OR _asset_id <= 0
     OR _x_units IS NULL OR _x_units < 0
     OR _y_units IS NULL OR _y_units < 0
     OR _size_units IS NULL OR _size_units NOT BETWEEN 48 AND 720
     OR _rotation_degrees IS NULL
     OR _rotation_degrees NOT BETWEEN -180 AND 180
     OR _rotation_degrees <> pg_catalog.round(_rotation_degrees, 2)
     OR _expected_revision IS NULL OR _expected_revision < 0
     OR _actor IS NULL OR _actor <= 0 THEN
    RAISE EXCEPTION 'Guild board asset placement input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.gostudy_guilds AS guild
   WHERE guild.guildid = _guildid
     AND guild.active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active registered guild was not found.'
      USING ERRCODE = 'GSG01';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(_guildid);

  SELECT board.*
    INTO _board
    FROM public.web_guild_boards AS board
   WHERE board.guildid = _guildid
   FOR UPDATE;

  IF NOT FOUND THEN
    IF _expected_revision <> 0 THEN
      RAISE EXCEPTION 'Guild board revision conflict.'
        USING ERRCODE = 'GGB01';
    END IF;

    INSERT INTO public.web_guild_boards (
      guildid,
      theme_key,
      width_units,
      height_units,
      revision,
      created_by,
      updated_by
    ) VALUES (
      _guildid,
      'midnight',
      3000,
      1800,
      1,
      _actor,
      _actor
    )
    RETURNING * INTO _board;
    _board_created := TRUE;
  ELSIF _board.revision <> _expected_revision THEN
    RAISE EXCEPTION 'Guild board revision conflict.'
      USING ERRCODE = 'GGB01';
  END IF;

  IF _asset_kind = 'emoji' THEN
    PERFORM 1
      FROM public.gostudy_guild_emojis AS emoji
     WHERE emoji.emojiid = _asset_id
       AND emoji.guildid = _guildid
       AND emoji.available = TRUE;
  ELSE
    PERFORM 1
      FROM public.gostudy_guild_stickers AS sticker
     WHERE sticker.stickerid = _asset_id
       AND sticker.guildid = _guildid
       AND sticker.available = TRUE
       AND sticker.format_type IN (1, 2, 4);
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guild board asset was unavailable, unsupported, or owned by another guild.'
      USING ERRCODE = 'GBA01';
  END IF;

  IF _x_units > _board.width_units - _size_units
     OR _y_units > _board.height_units - _size_units THEN
    RAISE EXCEPTION 'Guild board asset placement was outside the board.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pg_catalog.max(board_object.z_index), 0)
    INTO _highest_z
    FROM public.web_guild_board_objects AS board_object
   WHERE board_object.guildid = _guildid;

  IF _highest_z = 9223372036854775807 THEN
    WITH ranked AS (
      SELECT board_object.objectid,
             pg_catalog.row_number() OVER (
               ORDER BY board_object.z_index, board_object.objectid
             )::bigint AS compact_z
        FROM public.web_guild_board_objects AS board_object
       WHERE board_object.guildid = _guildid
    )
    UPDATE public.web_guild_board_objects AS board_object
       SET z_index = ranked.compact_z
      FROM ranked
     WHERE board_object.objectid = ranked.objectid;

    SELECT pg_catalog.count(*)::bigint
      INTO _highest_z
      FROM public.web_guild_board_objects AS board_object
     WHERE board_object.guildid = _guildid;
  END IF;

  INSERT INTO public.web_guild_board_objects (
    guildid,
    asset_kind,
    asset_id,
    x_units,
    y_units,
    size_units,
    rotation_degrees,
    z_index,
    created_by,
    updated_by
  ) VALUES (
    _guildid,
    _asset_kind,
    _asset_id,
    _x_units,
    _y_units,
    _size_units,
    _rotation_degrees,
    _highest_z + 1,
    _actor,
    _actor
  )
  RETURNING * INTO _object;

  IF NOT _board_created THEN
    IF _board.revision = 9223372036854775807 THEN
      RAISE EXCEPTION 'Guild board revision cannot be incremented.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.web_guild_boards AS board
       SET revision = _board.revision + 1,
           updated_by = _actor,
           updated_at = pg_catalog.now()
     WHERE board.guildid = _guildid
    RETURNING * INTO _board;
  END IF;

  RETURN QUERY
  SELECT _board.theme_key,
         _board.width_units,
         _board.height_units,
         _board.revision,
         _object.objectid,
         _object.asset_kind,
         _object.asset_id,
         _object.x_units,
         _object.y_units,
         _object.size_units,
         _object.rotation_degrees,
         _object.z_index;
END;
$$;

CREATE FUNCTION public.web_update_guild_board_object(
  _guildid BIGINT,
  _objectid BIGINT,
  _x_units INTEGER,
  _y_units INTEGER,
  _size_units INTEGER,
  _rotation_degrees NUMERIC,
  _expected_revision BIGINT,
  _actor BIGINT
)
RETURNS TABLE (
  board_theme_key TEXT,
  board_width_units INTEGER,
  board_height_units INTEGER,
  board_revision BIGINT,
  objectid BIGINT,
  asset_kind TEXT,
  asset_id BIGINT,
  x_units INTEGER,
  y_units INTEGER,
  size_units INTEGER,
  rotation_degrees NUMERIC,
  z_index BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _board public.web_guild_boards%ROWTYPE;
  _object public.web_guild_board_objects%ROWTYPE;
BEGIN
  IF _guildid IS NULL OR _guildid <= 0
     OR _objectid IS NULL OR _objectid <= 0
     OR _x_units IS NULL OR _x_units < 0
     OR _y_units IS NULL OR _y_units < 0
     OR _size_units IS NULL OR _size_units NOT BETWEEN 48 AND 720
     OR _rotation_degrees IS NULL
     OR _rotation_degrees NOT BETWEEN -180 AND 180
     OR _rotation_degrees <> pg_catalog.round(_rotation_degrees, 2)
     OR _expected_revision IS NULL OR _expected_revision < 0
     OR _actor IS NULL OR _actor <= 0 THEN
    RAISE EXCEPTION 'Guild board object transform input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.gostudy_guilds AS guild
   WHERE guild.guildid = _guildid
     AND guild.active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active registered guild was not found.'
      USING ERRCODE = 'GSG01';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(_guildid);

  SELECT board.*
    INTO _board
    FROM public.web_guild_boards AS board
   WHERE board.guildid = _guildid
   FOR UPDATE;
  IF NOT FOUND THEN
    IF _expected_revision <> 0 THEN
      RAISE EXCEPTION 'Guild board revision conflict.'
        USING ERRCODE = 'GGB01';
    END IF;
    RAISE EXCEPTION 'Guild board object was not found.'
      USING ERRCODE = 'GBO01';
  END IF;
  IF _board.revision <> _expected_revision THEN
    RAISE EXCEPTION 'Guild board revision conflict.'
      USING ERRCODE = 'GGB01';
  END IF;
  IF _board.revision = 9223372036854775807 THEN
    RAISE EXCEPTION 'Guild board revision cannot be incremented.'
      USING ERRCODE = '22023';
  END IF;
  IF _x_units > _board.width_units - _size_units
     OR _y_units > _board.height_units - _size_units THEN
    RAISE EXCEPTION 'Guild board object transform was outside the board.'
      USING ERRCODE = '22023';
  END IF;

  SELECT board_object.*
    INTO _object
    FROM public.web_guild_board_objects AS board_object
   WHERE board_object.guildid = _guildid
     AND board_object.objectid = _objectid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guild board object was not found.'
      USING ERRCODE = 'GBO01';
  END IF;

  UPDATE public.web_guild_board_objects AS board_object
     SET x_units = _x_units,
         y_units = _y_units,
         size_units = _size_units,
         rotation_degrees = _rotation_degrees,
         updated_by = _actor,
         updated_at = pg_catalog.now()
   WHERE board_object.guildid = _guildid
     AND board_object.objectid = _objectid
  RETURNING * INTO _object;

  UPDATE public.web_guild_boards AS board
     SET revision = _board.revision + 1,
         updated_by = _actor,
         updated_at = pg_catalog.now()
   WHERE board.guildid = _guildid
  RETURNING * INTO _board;

  RETURN QUERY
  SELECT _board.theme_key,
         _board.width_units,
         _board.height_units,
         _board.revision,
         _object.objectid,
         _object.asset_kind,
         _object.asset_id,
         _object.x_units,
         _object.y_units,
         _object.size_units,
         _object.rotation_degrees,
         _object.z_index;
END;
$$;

CREATE FUNCTION public.web_delete_guild_board_object(
  _guildid BIGINT,
  _objectid BIGINT,
  _expected_revision BIGINT,
  _actor BIGINT
)
RETURNS TABLE (
  board_theme_key TEXT,
  board_width_units INTEGER,
  board_height_units INTEGER,
  board_revision BIGINT,
  objectid BIGINT,
  asset_kind TEXT,
  asset_id BIGINT,
  x_units INTEGER,
  y_units INTEGER,
  size_units INTEGER,
  rotation_degrees NUMERIC,
  z_index BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _board public.web_guild_boards%ROWTYPE;
  _object public.web_guild_board_objects%ROWTYPE;
BEGIN
  IF _guildid IS NULL OR _guildid <= 0
     OR _objectid IS NULL OR _objectid <= 0
     OR _expected_revision IS NULL OR _expected_revision < 0
     OR _actor IS NULL OR _actor <= 0 THEN
    RAISE EXCEPTION 'Guild board object delete input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.gostudy_guilds AS guild
   WHERE guild.guildid = _guildid
     AND guild.active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active registered guild was not found.'
      USING ERRCODE = 'GSG01';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(_guildid);

  SELECT board.*
    INTO _board
    FROM public.web_guild_boards AS board
   WHERE board.guildid = _guildid
   FOR UPDATE;
  IF NOT FOUND THEN
    IF _expected_revision <> 0 THEN
      RAISE EXCEPTION 'Guild board revision conflict.'
        USING ERRCODE = 'GGB01';
    END IF;
    RAISE EXCEPTION 'Guild board object was not found.'
      USING ERRCODE = 'GBO01';
  END IF;
  IF _board.revision <> _expected_revision THEN
    RAISE EXCEPTION 'Guild board revision conflict.'
      USING ERRCODE = 'GGB01';
  END IF;
  IF _board.revision = 9223372036854775807 THEN
    RAISE EXCEPTION 'Guild board revision cannot be incremented.'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.web_guild_board_objects AS board_object
   WHERE board_object.guildid = _guildid
     AND board_object.objectid = _objectid
  RETURNING * INTO _object;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guild board object was not found.'
      USING ERRCODE = 'GBO01';
  END IF;

  UPDATE public.web_guild_boards AS board
     SET revision = _board.revision + 1,
         updated_by = _actor,
         updated_at = pg_catalog.now()
   WHERE board.guildid = _guildid
  RETURNING * INTO _board;

  RETURN QUERY
  SELECT _board.theme_key,
         _board.width_units,
         _board.height_units,
         _board.revision,
         _object.objectid,
         _object.asset_kind,
         _object.asset_id,
         _object.x_units,
         _object.y_units,
         _object.size_units,
         _object.rotation_degrees,
         _object.z_index;
END;
$$;

CREATE FUNCTION public.web_reorder_guild_board_object(
  _guildid BIGINT,
  _objectid BIGINT,
  _action TEXT,
  _expected_revision BIGINT,
  _actor BIGINT
)
RETURNS TABLE (
  board_theme_key TEXT,
  board_width_units INTEGER,
  board_height_units INTEGER,
  board_revision BIGINT,
  objectid BIGINT,
  asset_kind TEXT,
  asset_id BIGINT,
  x_units INTEGER,
  y_units INTEGER,
  size_units INTEGER,
  rotation_degrees NUMERIC,
  z_index BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _board public.web_guild_boards%ROWTYPE;
  _object public.web_guild_board_objects%ROWTYPE;
BEGIN
  IF _guildid IS NULL OR _guildid <= 0
     OR _objectid IS NULL OR _objectid <= 0
     OR _action IS NULL OR _action NOT IN ('front', 'back')
     OR _expected_revision IS NULL OR _expected_revision < 0
     OR _actor IS NULL OR _actor <= 0 THEN
    RAISE EXCEPTION 'Guild board object layer input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.gostudy_guilds AS guild
   WHERE guild.guildid = _guildid
     AND guild.active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active registered guild was not found.'
      USING ERRCODE = 'GSG01';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(_guildid);

  SELECT board.*
    INTO _board
    FROM public.web_guild_boards AS board
   WHERE board.guildid = _guildid
   FOR UPDATE;
  IF NOT FOUND THEN
    IF _expected_revision <> 0 THEN
      RAISE EXCEPTION 'Guild board revision conflict.'
        USING ERRCODE = 'GGB01';
    END IF;
    RAISE EXCEPTION 'Guild board object was not found.'
      USING ERRCODE = 'GBO01';
  END IF;
  IF _board.revision <> _expected_revision THEN
    RAISE EXCEPTION 'Guild board revision conflict.'
      USING ERRCODE = 'GGB01';
  END IF;
  IF _board.revision = 9223372036854775807 THEN
    RAISE EXCEPTION 'Guild board revision cannot be incremented.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.web_guild_board_objects AS board_object
   WHERE board_object.guildid = _guildid
     AND board_object.objectid = _objectid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guild board object was not found.'
      USING ERRCODE = 'GBO01';
  END IF;

  WITH ranked AS (
    SELECT board_object.objectid,
           pg_catalog.row_number() OVER (
             ORDER BY
               CASE
                 WHEN board_object.objectid = _objectid AND _action = 'back' THEN 0
                 WHEN board_object.objectid = _objectid AND _action = 'front' THEN 2
                 ELSE 1
               END,
               board_object.z_index,
               board_object.objectid
           )::bigint AS canonical_z
      FROM public.web_guild_board_objects AS board_object
     WHERE board_object.guildid = _guildid
  ), reordered AS (
    UPDATE public.web_guild_board_objects AS board_object
       SET z_index = ranked.canonical_z,
           updated_by = CASE
             WHEN board_object.objectid = _objectid THEN _actor
             ELSE board_object.updated_by
           END,
           updated_at = CASE
             WHEN board_object.objectid = _objectid THEN pg_catalog.now()
             ELSE board_object.updated_at
           END
      FROM ranked
     WHERE board_object.objectid = ranked.objectid
    RETURNING board_object.*
  )
  SELECT reordered.*
    INTO _object
    FROM reordered
   WHERE reordered.objectid = _objectid;

  UPDATE public.web_guild_boards AS board
     SET revision = _board.revision + 1,
         updated_by = _actor,
         updated_at = pg_catalog.now()
   WHERE board.guildid = _guildid
  RETURNING * INTO _board;

  RETURN QUERY
  SELECT _board.theme_key,
         _board.width_units,
         _board.height_units,
         _board.revision,
         _object.objectid,
         _object.asset_kind,
         _object.asset_id,
         _object.x_units,
         _object.y_units,
         _object.size_units,
         _object.rotation_degrees,
         _object.z_index;
END;
$$;

REVOKE ALL ON TABLE public.web_guild_board_objects FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_add_guild_board_asset(
  bigint, text, bigint, integer, integer, integer, numeric, bigint, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.web_update_guild_board_object(
  bigint, bigint, integer, integer, integer, numeric, bigint, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.web_delete_guild_board_object(
  bigint, bigint, bigint, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.web_reorder_guild_board_object(
  bigint, bigint, text, bigint, bigint
) FROM PUBLIC;

GRANT SELECT ON TABLE
  public.gostudy_guild_emojis,
  public.gostudy_guild_stickers
TO gostudy_web, gostudy_web_owner;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.gostudy_guild_emojis,
  public.gostudy_guild_stickers
FROM gostudy_web;

GRANT SELECT ON TABLE public.web_guild_board_objects TO gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.web_guild_board_objects
FROM gostudy_web;

GRANT EXECUTE ON FUNCTION public.web_add_guild_board_asset(
  bigint, text, bigint, integer, integer, integer, numeric, bigint, bigint
) TO gostudy_web;
GRANT EXECUTE ON FUNCTION public.web_update_guild_board_object(
  bigint, bigint, integer, integer, integer, numeric, bigint, bigint
) TO gostudy_web;
GRANT EXECUTE ON FUNCTION public.web_delete_guild_board_object(
  bigint, bigint, bigint, bigint
) TO gostudy_web;
GRANT EXECUTE ON FUNCTION public.web_reorder_guild_board_object(
  bigint, bigint, text, bigint, bigint
) TO gostudy_web;

COMMIT;
