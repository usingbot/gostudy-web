BEGIN;

CREATE TABLE public.web_guild_publications (
  guildid BIGINT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  invite_code TEXT,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT web_guild_publications_guildid_positive
    CHECK (guildid > 0),
  CONSTRAINT web_guild_publications_slug_canonical
    CHECK (
      char_length(slug) BETWEEN 3 AND 64
      AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
  CONSTRAINT web_guild_publications_invite_code_canonical
    CHECK (
      invite_code IS NULL
      OR (
        char_length(invite_code) BETWEEN 2 AND 64
        AND invite_code ~ '^[A-Za-z0-9-]+$'
      )
    ),
  CONSTRAINT web_guild_publications_actors_positive
    CHECK (created_by > 0 AND updated_by > 0),
  CONSTRAINT web_guild_publications_timestamp_order
    CHECK (updated_at >= created_at)
);

CREATE TABLE public.web_guild_tags (
  guildid BIGINT NOT NULL
    REFERENCES public.web_guild_publications (guildid) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  sort_order SMALLINT NOT NULL,
  PRIMARY KEY (guildid, sort_order),
  CONSTRAINT web_guild_tags_guildid_positive
    CHECK (guildid > 0),
  CONSTRAINT web_guild_tags_sort_order_bounded
    CHECK (sort_order BETWEEN 0 AND 4),
  CONSTRAINT web_guild_tags_display_valid
    CHECK (
      char_length(tag) BETWEEN 1 AND 24
      AND tag = btrim(tag)
      AND tag !~ '[[:cntrl:]]'
    )
);

CREATE UNIQUE INDEX web_guild_tags_casefold_unique
  ON public.web_guild_tags (guildid, lower(tag));

CREATE INDEX web_guild_tags_search_idx
  ON public.web_guild_tags (lower(tag), guildid);

CREATE FUNCTION public.web_upsert_guild_publication(
  _guildid BIGINT,
  _slug TEXT,
  _is_public BOOLEAN,
  _invite_code TEXT,
  _tags TEXT[],
  _actor BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF _guildid IS NULL OR _guildid <= 0
     OR _actor IS NULL OR _actor <= 0
     OR _slug IS NULL
     OR pg_catalog.char_length(_slug) NOT BETWEEN 3 AND 64
     OR _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR _is_public IS NULL
     OR (
       _invite_code IS NOT NULL
       AND (
         pg_catalog.char_length(_invite_code) NOT BETWEEN 2 AND 64
         OR _invite_code !~ '^[A-Za-z0-9-]+$'
       )
     )
     OR _tags IS NULL
     OR pg_catalog.cardinality(_tags) > 5 THEN
    RAISE EXCEPTION 'Guild publication input was invalid.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(_tags) AS value(tag)
     WHERE tag IS NULL
        OR pg_catalog.char_length(tag) NOT BETWEEN 1 AND 24
        OR tag <> pg_catalog.btrim(tag)
        OR tag ~ '[[:cntrl:]]'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(_tags) AS value(tag)
     GROUP BY pg_catalog.lower(tag)
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Guild publication tags were invalid.'
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

  INSERT INTO public.web_guild_publications AS publication (
    guildid,
    slug,
    is_public,
    invite_code,
    created_by,
    updated_by
  ) VALUES (
    _guildid,
    _slug,
    _is_public,
    _invite_code,
    _actor,
    _actor
  )
  ON CONFLICT (guildid) DO UPDATE
    SET slug = EXCLUDED.slug,
        is_public = EXCLUDED.is_public,
        invite_code = EXCLUDED.invite_code,
        updated_by = EXCLUDED.updated_by,
        updated_at = pg_catalog.now();

  DELETE FROM public.web_guild_tags
   WHERE guildid = _guildid;

  INSERT INTO public.web_guild_tags (guildid, tag, sort_order)
  SELECT _guildid, value.tag, (value.ordinality - 1)::smallint
    FROM pg_catalog.unnest(_tags) WITH ORDINALITY AS value(tag, ordinality);
END;
$$;

REVOKE ALL ON TABLE
  public.web_guild_publications,
  public.web_guild_tags
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_upsert_guild_publication(
  bigint, text, boolean, text, text[], bigint
) FROM PUBLIC;

GRANT SELECT ON TABLE public.gostudy_guilds
TO gostudy_web, gostudy_web_owner;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.gostudy_guilds
FROM gostudy_web;

GRANT SELECT ON TABLE
  public.web_guild_publications,
  public.web_guild_tags
TO gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE
  public.web_guild_publications,
  public.web_guild_tags
FROM gostudy_web;

GRANT EXECUTE ON FUNCTION public.web_upsert_guild_publication(
  bigint, text, boolean, text, text[], bigint
) TO gostudy_web;

COMMIT;
