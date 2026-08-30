\set ON_ERROR_STOP on

-- Run only in a disposable StudyLion schema v21 database after web migrations
-- 0001-0010. Every fixture and assertion rolls back.
BEGIN;

ALTER TABLE public.web_guild_publications OWNER TO gostudy_web_owner;
ALTER TABLE public.web_guild_tags OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_upsert_guild_publication(
  bigint, text, boolean, text, text[], bigint
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
  (SELECT version = 21 FROM public.versionhistory ORDER BY time DESC LIMIT 1),
  'disposable database must use StudyLion schema v21'
);
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
    WHERE oid = 'public.web_guild_publications'::regclass)) = 'gostudy_web_owner',
  'publication table must transfer to the NOLOGIN web owner'
);
SELECT pg_temp.assert_true(
  (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
     FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_upsert_guild_publication(bigint,text,boolean,text,text[],bigint)'::regprocedure),
  'publication function must transfer to the NOLOGIN web owner'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guilds', 'SELECT')
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.gostudy_guilds', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'runtime bot registry access must be read-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_publications', 'SELECT')
  AND pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_tags', 'SELECT')
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_guild_publications', 'INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'gostudy_web', 'public.web_guild_tags', 'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'runtime publication storage access must be read-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.web_upsert_guild_publication(bigint,text,boolean,text,text[],bigint)',
    'EXECUTE'
  ),
  'runtime role must execute the narrow publication function'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.has_function_privilege(
    'public',
    'public.web_upsert_guild_publication(bigint,text,boolean,text,text[],bigint)',
    'EXECUTE'
  ),
  'PUBLIC must not execute the privileged publication function'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER'),
  'runtime role must not inherit the definer owner role'
);

INSERT INTO public.gostudy_guilds (
  guildid, name, icon_hash, banner_hash, description, member_count, active,
  first_seen_at, last_synced_at, updated_at
) VALUES
  (970000000000001, 'Public Study', 'abcdef', NULL, 'Public guild', 100, TRUE, now(), now(), now()),
  (970000000000002, 'Hidden Study', NULL, NULL, NULL, 50, TRUE, now(), now(), now()),
  (970000000000003, 'Inactive Study', NULL, NULL, NULL, 25, FALSE, now(), now(), now()),
  (970000000000004, 'Later Inactive', NULL, NULL, NULL, 10, TRUE, now(), now(), now());

SET LOCAL ROLE gostudy_web;

SELECT public.web_upsert_guild_publication(
  970000000000001,
  'public-study',
  TRUE,
  'Example-Code',
  ARRAY['Study', 'IELTS', 'Vietnamese']::text[],
  970000000009999
);
SELECT public.web_upsert_guild_publication(
  970000000000002,
  'hidden-study',
  FALSE,
  NULL,
  ARRAY[]::text[],
  970000000009999
);
SELECT public.web_upsert_guild_publication(
  970000000000004,
  'later-inactive',
  TRUE,
  NULL,
  ARRAY['Study']::text[],
  970000000009999
);

DO $$
BEGIN
  BEGIN
    PERFORM public.web_upsert_guild_publication(
      970000000000002, 'public-study', TRUE, NULL, ARRAY[]::text[], 970000000009999
    );
    RAISE EXCEPTION 'duplicate slug unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_publication(
      970000000000002, 'Bad--Slug', TRUE, NULL, ARRAY[]::text[], 970000000009999
    );
    RAISE EXCEPTION 'invalid slug unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_publication(
      970000000000002, 'hidden-study', TRUE, 'https://evil.example', ARRAY[]::text[], 970000000009999
    );
    RAISE EXCEPTION 'invalid invite code unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_publication(
      970000000000002,
      'hidden-study',
      TRUE,
      NULL,
      ARRAY['1','2','3','4','5','6']::text[],
      970000000009999
    );
    RAISE EXCEPTION 'six tags unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_publication(
      970000000000002,
      'hidden-study',
      TRUE,
      NULL,
      ARRAY['Study','study']::text[],
      970000000009999
    );
    RAISE EXCEPTION 'case-insensitive duplicate tags unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_publication(
      970000000000002,
      'hidden-study',
      TRUE,
      NULL,
      ARRAY[repeat('x', 25)]::text[],
      970000000009999
    );
    RAISE EXCEPTION 'overlong tag unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_publication(
      970000000000003, 'inactive-study', TRUE, NULL, ARRAY[]::text[], 970000000009999
    );
    RAISE EXCEPTION 'inactive guild unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSG01' THEN NULL;
  END;

  BEGIN
    UPDATE public.gostudy_guilds SET active = FALSE WHERE guildid = 970000000000001;
    RAISE EXCEPTION 'runtime registry mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.web_guild_publications SET is_public = FALSE
    WHERE guildid = 970000000000001;
    RAISE EXCEPTION 'runtime direct publication mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT slug = 'hidden-study' AND is_public = FALSE
     FROM public.web_guild_publications
    WHERE guildid = 970000000000002),
  'failed publication updates must leave prior settings unchanged'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 3
     FROM public.web_guild_tags
    WHERE guildid = 970000000000001),
  'successful publication update must persist the complete ordered tag set'
);
SELECT pg_temp.assert_true(
  (SELECT array_agg(tag ORDER BY sort_order) = ARRAY['Study', 'IELTS', 'Vietnamese']::text[]
     FROM public.web_guild_tags
    WHERE guildid = 970000000000001),
  'tag display values and order must be preserved'
);

RESET ROLE;

UPDATE public.gostudy_guilds
   SET active = FALSE, updated_at = now(), last_synced_at = now()
 WHERE guildid = 970000000000004;

SELECT pg_temp.assert_true(
  (SELECT array_agg(guild.guildid ORDER BY guild.guildid) = ARRAY[970000000000001::bigint]
     FROM public.gostudy_guilds AS guild
     JOIN public.web_guild_publications AS publication USING (guildid)
    WHERE guild.active = TRUE
      AND publication.is_public = TRUE),
  'public read qualification must exclude hidden and inactive guilds'
);

ROLLBACK;
