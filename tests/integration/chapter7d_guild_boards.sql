\set ON_ERROR_STOP on

-- Run only in a disposable StudyLion schema v22 database after web migrations
-- 0001-0011. chapter7d_acl_snapshot.sql and migration 0011 must run in this
-- same psql session. Every fixture and ownership change below rolls back.
BEGIN;

-- Reproduce the already-deployed web-owner relationship needed by the new
-- owner-verifying definer function, then transfer the Chapter 7D objects.
ALTER TABLE public.web_user_roles OWNER TO gostudy_web_owner;
ALTER TABLE public.web_guild_boards OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_upsert_guild_board_theme(
  bigint, text, bigint, bigint
) OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_expand_guild_board(
  bigint, integer, integer, bigint, bigint
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
  (SELECT version = 22 FROM public.versionhistory ORDER BY time DESC LIMIT 1),
  'disposable database must use StudyLion schema v22'
);
SELECT pg_temp.assert_true(
  NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = 'gostudy_web')
  AND pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
    WHERE oid = 'public.web_guild_boards'::regclass)) = 'gostudy_web_owner',
  'runtime must be non-superuser and must not own board storage'
);
SELECT pg_temp.assert_true(
  (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
     FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_upsert_guild_board_theme(bigint,text,bigint,bigint)'::regprocedure)
  AND (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
     FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_expand_guild_board(bigint,integer,integer,bigint,bigint)'::regprocedure),
  'both board functions must transfer to the NOLOGIN web owner'
);
SELECT pg_temp.assert_true(
  NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER'),
  'runtime role must not inherit the definer owner role'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM chapter7d_registry_acl_before AS before
      JOIN pg_catalog.pg_class AS current USING (oid)
     WHERE current.relacl IS DISTINCT FROM before.relacl
  )
  AND (SELECT count(*) = 3 FROM chapter7d_registry_acl_before),
  'migration 0011 must leave every bot guild-registry ACL unchanged'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guilds', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guilds', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guilds', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guilds', 'DELETE')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guilds', 'TRUNCATE'),
  'runtime bot guild-registry access must remain read-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_boards', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_boards', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_boards', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_boards', 'DELETE')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_boards', 'TRUNCATE'),
  'runtime board storage access must be SELECT-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.web_upsert_guild_board_theme(bigint,text,bigint,bigint)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'gostudy_web',
    'public.web_expand_guild_board(bigint,integer,integer,bigint,bigint)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'public',
    'public.web_upsert_guild_board_theme(bigint,text,bigint,bigint)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'public',
    'public.web_expand_guild_board(bigint,integer,integer,bigint,bigint)',
    'EXECUTE'
  ),
  'runtime, but not PUBLIC, must execute both narrow board mutations'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.web_guild_boards'::regclass
       AND contype = 'f'
  ),
  'web board storage must not use a destructive bot-registry foreign key'
);

INSERT INTO public.web_user_roles (userid, role, granted_by) VALUES
  (971000000009999, 'owner', NULL),
  (971000000009998, 'admin', 971000000009999);

INSERT INTO public.gostudy_guilds (
  guildid, name, icon_hash, banner_hash, description, member_count, active,
  first_seen_at, last_synced_at, updated_at
) VALUES
  (971000000000001, 'Board Study', 'abcdef', NULL, 'Board guild', 100, TRUE, now(), now(), now()),
  (971000000000002, 'Inactive Board Study', NULL, NULL, NULL, 25, FALSE, now(), now(), now()),
  (971000000000003, 'Constraint Fixture', NULL, NULL, NULL, 10, TRUE, now(), now(), now()),
  (971000000000004, 'Owner Expansion Fixture', NULL, NULL, NULL, 10, TRUE, now(), now(), now());

SET LOCAL ROLE gostudy_web;

DO $$
BEGIN
  BEGIN
    PERFORM public.web_upsert_guild_board_theme(
      971000000000001, 'midnight', 1, 971000000009997
    );
    RAISE EXCEPTION 'new board with nonzero revision unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GGB01' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_board_theme(
      971000000000002, 'midnight', 0, 971000000009997
    );
    RAISE EXCEPTION 'inactive guild board unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSG01' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_upsert_guild_board_theme(
      971000000000001, 'custom', 0, 971000000009997
    );
    RAISE EXCEPTION 'invalid function theme unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_expand_guild_board(
      971000000000001, 4500, 2700, 0, 971000000009998
    );
    RAISE EXCEPTION 'ordinary web admin expansion unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GGB02' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_expand_guild_board(
      971000000000001, 4500, 2700, 0, 971000000009997
    );
    RAISE EXCEPTION 'guild manager expansion unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GGB02' THEN NULL;
  END;
END;
$$;

SELECT public.web_upsert_guild_board_theme(
  971000000000001, 'midnight', 0, 971000000009997
);
SELECT pg_temp.assert_true(
  (SELECT theme_key = 'midnight'
          AND width_units = 3000
          AND height_units = 1800
          AND revision = 1
     FROM public.web_guild_boards
    WHERE guildid = 971000000000001),
  'theme creation must produce the starter dimensions at revision one'
);

SELECT public.web_upsert_guild_board_theme(
  971000000000001, 'mint', 1, 971000000009997
);
SELECT public.web_upsert_guild_board_theme(
  971000000000001, 'cork', 2, 971000000009997
);
SELECT public.web_upsert_guild_board_theme(
  971000000000001, 'paper', 3, 971000000009997
);

SELECT pg_temp.assert_true(
  (SELECT theme_key = 'paper'
          AND width_units = 3000
          AND height_units = 1800
          AND revision = 4
          AND created_by = 971000000009997
          AND updated_by = 971000000009997
     FROM public.web_guild_boards
    WHERE guildid = 971000000000001),
  'all themes must save while theme updates preserve dimensions and increment revision'
);

SELECT public.web_expand_guild_board(
  971000000000001, 4500, 2700, 4, 971000000009999
);
SELECT public.web_expand_guild_board(
  971000000000001, 6000, 3600, 5, 971000000009999
);
SELECT public.web_expand_guild_board(
  971000000000001, 9000, 5400, 6, 971000000009999
);

SELECT pg_temp.assert_true(
  (SELECT theme_key = 'paper'
          AND width_units = 9000
          AND height_units = 5400
          AND revision = 7
          AND created_by = 971000000009997
          AND updated_by = 971000000009999
     FROM public.web_guild_boards
    WHERE guildid = 971000000000001),
  'every fixed expansion tier must preserve theme and coordinates while incrementing revision'
);

SELECT public.web_expand_guild_board(
  971000000000004, 4500, 2700, 0, 971000000009999
);
SELECT pg_temp.assert_true(
  (SELECT theme_key = 'midnight'
          AND width_units = 4500
          AND height_units = 2700
          AND revision = 1
     FROM public.web_guild_boards
    WHERE guildid = 971000000000004),
  'owner expansion may create an absent board with the default theme'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.web_upsert_guild_board_theme(
      971000000000001, 'mint', 5, 971000000009997
    );
    RAISE EXCEPTION 'stale theme update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GGB01' THEN NULL;
  END;

  BEGIN
    PERFORM public.web_expand_guild_board(
      971000000000001, 6000, 3600, 7, 971000000009999
    );
    RAISE EXCEPTION 'capacity shrink unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_expand_guild_board(
      971000000000001, 9000, 5400, 7, 971000000009999
    );
    RAISE EXCEPTION 'same-tier expansion unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_expand_guild_board(
      971000000000001, 5000, 3000, 7, 971000000009999
    );
    RAISE EXCEPTION 'arbitrary dimensions unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.web_expand_guild_board(
      971000000000001, 9000, 5400, 6, 971000000009999
    );
    RAISE EXCEPTION 'stale capacity update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GGB01' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.web_guild_boards (
      guildid, theme_key, width_units, height_units, revision, created_by, updated_by
    ) VALUES (971000000000003, 'mint', 3000, 1800, 1, 1, 1);
    RAISE EXCEPTION 'runtime direct insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.web_guild_boards SET theme_key = 'cork'
     WHERE guildid = 971000000000001;
    RAISE EXCEPTION 'runtime direct update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.web_guild_boards WHERE guildid = 971000000000001;
    RAISE EXCEPTION 'runtime direct delete unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    TRUNCATE TABLE public.web_guild_boards;
    RAISE EXCEPTION 'runtime truncate unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT theme_key = 'paper'
          AND width_units = 9000
          AND height_units = 5400
          AND revision = 7
     FROM public.web_guild_boards
    WHERE guildid = 971000000000001),
  'failed theme, shrink, arbitrary, same-tier, and stale writes must be atomic'
);

RESET ROLE;
SET LOCAL ROLE gostudy_web_owner;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.web_guild_boards (
      guildid, theme_key, width_units, height_units, revision, created_by, updated_by
    ) VALUES (-1, 'midnight', 3000, 1800, 1, 1, 1);
    RAISE EXCEPTION 'negative guild ID unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.web_guild_boards (
      guildid, theme_key, width_units, height_units, revision, created_by, updated_by
    ) VALUES (971000000000003, 'custom', 3000, 1800, 1, 1, 1);
    RAISE EXCEPTION 'invalid table theme unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.web_guild_boards (
      guildid, theme_key, width_units, height_units, revision, created_by, updated_by
    ) VALUES (971000000000003, 'mint', 3001, 1800, 1, 1, 1);
    RAISE EXCEPTION 'arbitrary table capacity unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.web_guild_boards (
      guildid, theme_key, width_units, height_units, revision, created_by, updated_by
    ) VALUES (971000000000003, 'mint', 3000, 1800, 0, 1, 1);
    RAISE EXCEPTION 'zero revision unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.web_guild_boards (
      guildid, theme_key, width_units, height_units, revision, created_by, updated_by
    ) VALUES (971000000000003, 'mint', 3000, 1800, 1, 0, 1);
    RAISE EXCEPTION 'zero actor unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.web_guild_boards (
      guildid, theme_key, width_units, height_units, revision,
      created_by, updated_by, created_at, updated_at
    ) VALUES (
      971000000000003, 'mint', 3000, 1800, 1,
      1, 1, now(), now() - interval '1 minute'
    );
    RAISE EXCEPTION 'backward timestamp unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

RESET ROLE;

ROLLBACK;
