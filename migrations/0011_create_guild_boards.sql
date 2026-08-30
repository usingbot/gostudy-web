BEGIN;

CREATE TABLE public.web_guild_boards (
  guildid BIGINT PRIMARY KEY,
  theme_key TEXT NOT NULL,
  width_units INTEGER NOT NULL,
  height_units INTEGER NOT NULL,
  revision BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT web_guild_boards_guildid_positive
    CHECK (guildid > 0),
  CONSTRAINT web_guild_boards_theme_allowlist
    CHECK (theme_key IN ('midnight', 'mint', 'cork', 'paper')),
  CONSTRAINT web_guild_boards_capacity_allowlist
    CHECK ((width_units, height_units) IN (
      (3000, 1800),
      (4500, 2700),
      (6000, 3600),
      (9000, 5400)
    )),
  CONSTRAINT web_guild_boards_revision_positive
    CHECK (revision > 0),
  CONSTRAINT web_guild_boards_actors_positive
    CHECK (created_by > 0 AND updated_by > 0),
  CONSTRAINT web_guild_boards_timestamp_order
    CHECK (updated_at >= created_at)
);

CREATE FUNCTION public.web_upsert_guild_board_theme(
  _guildid BIGINT,
  _theme_key TEXT,
  _expected_revision BIGINT,
  _actor BIGINT
)
RETURNS TABLE (
  guildid BIGINT,
  theme_key TEXT,
  width_units INTEGER,
  height_units INTEGER,
  revision BIGINT,
  created_by BIGINT,
  updated_by BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _existing public.web_guild_boards%ROWTYPE;
BEGIN
  IF _guildid IS NULL OR _guildid <= 0
     OR _actor IS NULL OR _actor <= 0
     OR _theme_key IS NULL
     OR _theme_key NOT IN ('midnight', 'mint', 'cork', 'paper')
     OR _expected_revision IS NULL OR _expected_revision < 0 THEN
    RAISE EXCEPTION 'Guild board input was invalid.'
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
    INTO _existing
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
      _theme_key,
      3000,
      1800,
      1,
      _actor,
      _actor
    );
  ELSE
    IF _existing.revision <> _expected_revision THEN
      RAISE EXCEPTION 'Guild board revision conflict.'
        USING ERRCODE = 'GGB01';
    END IF;

    IF _existing.revision = 9223372036854775807 THEN
      RAISE EXCEPTION 'Guild board revision cannot be incremented.'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.web_guild_boards AS board
       SET theme_key = _theme_key,
           revision = _existing.revision + 1,
           updated_by = _actor,
           updated_at = pg_catalog.now()
     WHERE board.guildid = _guildid;
  END IF;

  RETURN QUERY
  SELECT board.guildid,
         board.theme_key,
         board.width_units,
         board.height_units,
         board.revision,
         board.created_by,
         board.updated_by,
         board.created_at,
         board.updated_at
    FROM public.web_guild_boards AS board
   WHERE board.guildid = _guildid;
END;
$$;

CREATE FUNCTION public.web_expand_guild_board(
  _guildid BIGINT,
  _width_units INTEGER,
  _height_units INTEGER,
  _expected_revision BIGINT,
  _actor BIGINT
)
RETURNS TABLE (
  guildid BIGINT,
  theme_key TEXT,
  width_units INTEGER,
  height_units INTEGER,
  revision BIGINT,
  created_by BIGINT,
  updated_by BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _existing public.web_guild_boards%ROWTYPE;
BEGIN
  IF _guildid IS NULL OR _guildid <= 0
     OR _actor IS NULL OR _actor <= 0
     OR _expected_revision IS NULL OR _expected_revision < 0
     OR _width_units IS NULL OR _height_units IS NULL
     OR (_width_units, _height_units) NOT IN (
       (3000, 1800),
       (4500, 2700),
       (6000, 3600),
       (9000, 5400)
     ) THEN
    RAISE EXCEPTION 'Guild board capacity input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.web_user_roles AS roles
   WHERE roles.userid = _actor
     AND roles.role = 'owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the Go Study owner may expand guild boards.'
      USING ERRCODE = 'GGB02';
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
    INTO _existing
    FROM public.web_guild_boards AS board
   WHERE board.guildid = _guildid
   FOR UPDATE;

  IF NOT FOUND THEN
    IF _expected_revision <> 0 THEN
      RAISE EXCEPTION 'Guild board revision conflict.'
        USING ERRCODE = 'GGB01';
    END IF;
    IF _width_units = 3000 THEN
      RAISE EXCEPTION 'Guild board capacity must increase.'
        USING ERRCODE = '22023';
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
      _width_units,
      _height_units,
      1,
      _actor,
      _actor
    );
  ELSE
    IF _existing.revision <> _expected_revision THEN
      RAISE EXCEPTION 'Guild board revision conflict.'
        USING ERRCODE = 'GGB01';
    END IF;

    IF _width_units <= _existing.width_units
       OR _height_units <= _existing.height_units THEN
      RAISE EXCEPTION 'Guild board capacity must increase without shrinking.'
        USING ERRCODE = '22023';
    END IF;

    IF _existing.revision = 9223372036854775807 THEN
      RAISE EXCEPTION 'Guild board revision cannot be incremented.'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.web_guild_boards AS board
       SET width_units = _width_units,
           height_units = _height_units,
           revision = _existing.revision + 1,
           updated_by = _actor,
           updated_at = pg_catalog.now()
     WHERE board.guildid = _guildid;
  END IF;

  RETURN QUERY
  SELECT board.guildid,
         board.theme_key,
         board.width_units,
         board.height_units,
         board.revision,
         board.created_by,
         board.updated_by,
         board.created_at,
         board.updated_at
    FROM public.web_guild_boards AS board
   WHERE board.guildid = _guildid;
END;
$$;

REVOKE ALL ON TABLE public.web_guild_boards FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_upsert_guild_board_theme(
  bigint, text, bigint, bigint
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_expand_guild_board(
  bigint, integer, integer, bigint, bigint
) FROM PUBLIC;

GRANT SELECT ON TABLE public.web_guild_boards TO gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.web_guild_boards
FROM gostudy_web;

GRANT EXECUTE ON FUNCTION public.web_upsert_guild_board_theme(
  bigint, text, bigint, bigint
) TO gostudy_web;

GRANT EXECUTE ON FUNCTION public.web_expand_guild_board(
  bigint, integer, integer, bigint, bigint
) TO gostudy_web;

COMMIT;
