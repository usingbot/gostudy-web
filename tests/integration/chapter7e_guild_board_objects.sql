\set ON_ERROR_STOP on

-- Run only in a disposable StudyLion schema v22 database after web migrations
-- 0001-0012. chapter7e_acl_snapshot.sql and migration 0012 must run in the
-- same psql session. Every fixture and ownership change below rolls back.
BEGIN;

ALTER TABLE public.web_user_roles OWNER TO gostudy_web_owner;
ALTER TABLE public.web_guild_boards OWNER TO gostudy_web_owner;
ALTER TABLE public.web_guild_board_objects OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_guild_board_objects_objectid_seq
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_upsert_guild_board_theme(
  bigint, text, bigint, bigint
) OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_expand_guild_board(
  bigint, integer, integer, bigint, bigint
) OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_add_guild_board_asset(
  bigint, text, bigint, integer, integer, integer, numeric, bigint, bigint
) OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_update_guild_board_object(
  bigint, bigint, integer, integer, integer, numeric, bigint, bigint
) OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_delete_guild_board_object(
  bigint, bigint, bigint, bigint
) OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reorder_guild_board_object(
  bigint, bigint, text, bigint, bigint
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
  AND NOT pg_catalog.pg_has_role('gostudy_web', 'gostudy_web_owner', 'MEMBER'),
  'runtime must be a non-owner non-superuser'
);
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
    WHERE oid = 'public.web_guild_board_objects'::regclass)) = 'gostudy_web_owner'
  AND (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_add_guild_board_asset(bigint,text,bigint,integer,integer,integer,numeric,bigint,bigint)'::regprocedure)
  AND (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_update_guild_board_object(bigint,bigint,integer,integer,integer,numeric,bigint,bigint)'::regprocedure)
  AND (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_delete_guild_board_object(bigint,bigint,bigint,bigint)'::regprocedure)
  AND (SELECT pg_catalog.pg_get_userbyid(proowner) = 'gostudy_web_owner'
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.web_reorder_guild_board_object(bigint,bigint,text,bigint,bigint)'::regprocedure),
  'new table and all four definer functions must transfer to the NOLOGIN web owner'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM chapter7e_registry_mutation_acl_before AS before
      JOIN pg_catalog.pg_class AS current USING (oid)
     WHERE before.lion_insert IS DISTINCT FROM pg_catalog.has_table_privilege('lion', current.oid, 'INSERT')
        OR before.lion_update IS DISTINCT FROM pg_catalog.has_table_privilege('lion', current.oid, 'UPDATE')
        OR before.lion_delete IS DISTINCT FROM pg_catalog.has_table_privilege('lion', current.oid, 'DELETE')
        OR before.lion_truncate IS DISTINCT FROM pg_catalog.has_table_privilege('lion', current.oid, 'TRUNCATE')
        OR before.web_insert IS DISTINCT FROM pg_catalog.has_table_privilege('gostudy_web', current.oid, 'INSERT')
        OR before.web_update IS DISTINCT FROM pg_catalog.has_table_privilege('gostudy_web', current.oid, 'UPDATE')
        OR before.web_delete IS DISTINCT FROM pg_catalog.has_table_privilege('gostudy_web', current.oid, 'DELETE')
        OR before.web_truncate IS DISTINCT FROM pg_catalog.has_table_privilege('gostudy_web', current.oid, 'TRUNCATE')
  )
  AND (SELECT count(*) = 2 FROM chapter7e_registry_mutation_acl_before),
  'migration 0012 must not change bot or web mutation ACLs on asset registries'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guild_emojis', 'SELECT')
  AND pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guild_stickers', 'SELECT')
  AND pg_catalog.has_table_privilege('gostudy_web_owner', 'public.gostudy_guild_emojis', 'SELECT')
  AND pg_catalog.has_table_privilege('gostudy_web_owner', 'public.gostudy_guild_stickers', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guild_emojis', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.gostudy_guild_stickers', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'runtime and owner receive required registry reads without mutation'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_board_objects', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_board_objects', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_board_objects', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_board_objects', 'DELETE')
  AND NOT pg_catalog.has_table_privilege('gostudy_web', 'public.web_guild_board_objects', 'TRUNCATE'),
  'runtime object storage access must be SELECT-only'
);
SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege('gostudy_web', 'public.web_add_guild_board_asset(bigint,text,bigint,integer,integer,integer,numeric,bigint,bigint)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('gostudy_web', 'public.web_update_guild_board_object(bigint,bigint,integer,integer,integer,numeric,bigint,bigint)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('gostudy_web', 'public.web_delete_guild_board_object(bigint,bigint,bigint,bigint)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('gostudy_web', 'public.web_reorder_guild_board_object(bigint,bigint,text,bigint,bigint)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('public', 'public.web_add_guild_board_asset(bigint,text,bigint,integer,integer,integer,numeric,bigint,bigint)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('public', 'public.web_update_guild_board_object(bigint,bigint,integer,integer,integer,numeric,bigint,bigint)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('public', 'public.web_delete_guild_board_object(bigint,bigint,bigint,bigint)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('public', 'public.web_reorder_guild_board_object(bigint,bigint,text,bigint,bigint)', 'EXECUTE'),
  'runtime, but not PUBLIC, must execute exactly the narrow object functions'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.web_guild_board_objects'::regclass
       AND confrelid IN (
         'public.gostudy_guild_emojis'::regclass,
         'public.gostudy_guild_stickers'::regclass
       )
  )
  AND EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.web_guild_board_objects'::regclass
       AND confrelid = 'public.web_guild_boards'::regclass
  ),
  'placements may reference the web board but never bot-owned asset rows'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.web_guild_board_objects'::regclass
       AND pg_catalog.lower(conname) ~ '(count|max.*object|quota)'
  ),
  'Chapter 7E must have no object-count constraint'
);

INSERT INTO public.web_user_roles (userid, role, granted_by) VALUES
  (972000000009999, 'owner', NULL);

INSERT INTO public.gostudy_guilds (
  guildid, name, icon_hash, banner_hash, description, member_count, active,
  first_seen_at, last_synced_at, updated_at
) VALUES
  (972000000000001, 'Decorated Study', 'abcdef', NULL, 'Board guild', 100, TRUE, now(), now(), now()),
  (972000000000002, 'Other Study', NULL, NULL, NULL, 25, TRUE, now(), now(), now()),
  (972000000000003, 'Inactive Study', NULL, NULL, NULL, 10, FALSE, now(), now(), now());

INSERT INTO public.gostudy_guild_emojis (
  emojiid, guildid, name, animated, available,
  first_seen_at, last_seen_at, updated_at
) VALUES
  (972000000001001, 972000000000001, 'same_static', FALSE, TRUE, now(), now(), now()),
  (972000000001002, 972000000000001, 'unavailable', FALSE, FALSE, now(), now(), now()),
  (972000000001003, 972000000000002, 'other_guild', TRUE, TRUE, now(), now(), now());

INSERT INTO public.gostudy_guild_stickers (
  stickerid, guildid, name, description, format_type, sticker_type, available,
  first_seen_at, last_seen_at, updated_at
) VALUES
  (972000000002001, 972000000000001, 'same_png', NULL, 1, 2, TRUE, now(), now(), now()),
  (972000000002002, 972000000000001, 'unavailable', NULL, 2, 2, FALSE, now(), now(), now()),
  (972000000002003, 972000000000001, 'lottie', NULL, 3, 2, TRUE, now(), now(), now()),
  (972000000002004, 972000000000002, 'other_guild', NULL, 4, 2, TRUE, now(), now(), now());

SET LOCAL ROLE gostudy_web;

SELECT public.web_add_guild_board_asset(
  972000000000001, 'emoji', 972000000001001,
  100, 200, 180, -8.00, 0, 972000000009997
);
SELECT pg_temp.assert_true(
  (SELECT theme_key = 'midnight'
          AND width_units = 3000
          AND height_units = 1800
          AND revision = 1
          AND created_by = 972000000009997
          AND updated_by = 972000000009997
     FROM public.web_guild_boards
    WHERE guildid = 972000000000001)
  AND (SELECT count(*) = 1
         FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001
          AND asset_kind = 'emoji'
          AND asset_id = 972000000001001
          AND x_units = 100
          AND y_units = 200
          AND size_units = 180
          AND rotation_degrees = -8.00
          AND z_index = 1),
  'first valid placement must atomically create the default board at revision one'
);

SELECT public.web_add_guild_board_asset(
  972000000000001, 'sticker', 972000000002001,
  500, 600, 240, 0, 1, 972000000009997
);
SELECT pg_temp.assert_true(
  (SELECT revision = 2 FROM public.web_guild_boards WHERE guildid = 972000000000001)
  AND (SELECT count(*) = 2
              AND min(z_index) = 1
              AND max(z_index) = 2
              AND count(DISTINCT z_index) = 2
         FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001),
  'same-guild image sticker must be accepted and increment revision exactly once'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'emoji', 972000000001003, 0, 0, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'cross-guild emoji unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GBA01' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'sticker', 972000000002004, 0, 0, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'cross-guild sticker unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GBA01' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'emoji', 972000000001002, 0, 0, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'unavailable emoji unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GBA01' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'sticker', 972000000002002, 0, 0, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'unavailable sticker unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GBA01' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'sticker', 972000000002003, 0, 0, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'Lottie sticker unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GBA01' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000003, 'emoji', 972000000001001, 0, 0, 180, 0, 0, 972000000009997
    );
    RAISE EXCEPTION 'inactive guild placement unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GSG01' THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'emoji', 972000000001001, -1, 0, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'negative x unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'emoji', 972000000001001, 2821, 0, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'right overflow unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'emoji', 972000000001001, 0, 1621, 180, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'bottom overflow unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'emoji', 972000000001001, 0, 0, 47, 0, 2, 972000000009997
    );
    RAISE EXCEPTION 'undersized placement unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.web_add_guild_board_asset(
      972000000000001, 'emoji', 972000000001001, 0, 0, 180, 180.01, 2, 972000000009997
    );
    RAISE EXCEPTION 'invalid rotation unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT revision = 2 FROM public.web_guild_boards WHERE guildid = 972000000000001)
  AND (SELECT count(*) = 2 FROM public.web_guild_board_objects WHERE guildid = 972000000000001),
  'failed asset and geometry writes must be atomic'
);

SELECT public.web_update_guild_board_object(
  972000000000001,
  (SELECT objectid FROM public.web_guild_board_objects
    WHERE guildid = 972000000000001 AND asset_kind = 'emoji' LIMIT 1),
  120, 220, 200, 12.50, 2, 972000000009997
);
SELECT pg_temp.assert_true(
  (SELECT revision = 3 FROM public.web_guild_boards WHERE guildid = 972000000000001)
  AND (SELECT asset_kind = 'emoji'
              AND asset_id = 972000000001001
              AND x_units = 120
              AND y_units = 220
              AND size_units = 200
              AND rotation_degrees = 12.50
         FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001 AND asset_kind = 'emoji' LIMIT 1),
  'transform must update only geometry and increment revision once'
);

SELECT public.web_reorder_guild_board_object(
  972000000000001,
  (SELECT objectid FROM public.web_guild_board_objects
    WHERE guildid = 972000000000001 AND asset_kind = 'sticker' LIMIT 1),
  'front', 3, 972000000009997
);
SELECT pg_temp.assert_true(
  (SELECT revision = 4 FROM public.web_guild_boards WHERE guildid = 972000000000001)
  AND (SELECT z_index = (SELECT max(z_index) FROM public.web_guild_board_objects WHERE guildid = 972000000000001)
         FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001 AND asset_kind = 'sticker' LIMIT 1)
  AND (SELECT min(z_index) = 1
              AND max(z_index) = count(*)
              AND count(DISTINCT z_index) = count(*)
         FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001),
  'front action must calculate the canonical highest layer and increment once'
);

SELECT public.web_delete_guild_board_object(
  972000000000001,
  (SELECT objectid FROM public.web_guild_board_objects
    WHERE guildid = 972000000000001 AND asset_kind = 'sticker' LIMIT 1),
  4, 972000000009997
);
SELECT pg_temp.assert_true(
  (SELECT revision = 5 FROM public.web_guild_boards WHERE guildid = 972000000000001)
  AND NOT EXISTS (
    SELECT 1 FROM public.web_guild_board_objects
     WHERE guildid = 972000000000001 AND asset_kind = 'sticker'
  ),
  'delete must remove only the board object and increment once'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.web_update_guild_board_object(
      972000000000001,
      (SELECT objectid FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001 LIMIT 1),
      130, 230, 200, 0, 4, 972000000009997
    );
    RAISE EXCEPTION 'stale transform unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GGB01' THEN NULL;
  END;
  BEGIN
    UPDATE public.web_guild_board_objects SET x_units = 1
     WHERE guildid = 972000000000001;
    RAISE EXCEPTION 'runtime direct object update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.web_guild_board_objects WHERE guildid = 972000000000001;
    RAISE EXCEPTION 'runtime direct object delete unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.gostudy_guild_emojis SET available = FALSE
     WHERE emojiid = 972000000001001;
    RAISE EXCEPTION 'runtime registry mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT public.web_upsert_guild_board_theme(
  972000000000001, 'paper', 5, 972000000009997
);
SELECT public.web_add_guild_board_asset(
  972000000000001, 'emoji', 972000000001001,
  400, 400, 180, 0, 6, 972000000009997
);
SELECT public.web_add_guild_board_asset(
  972000000000001, 'emoji', 972000000001001,
  700, 700, 180, 0, 7, 972000000009997
);
SELECT public.web_expand_guild_board(
  972000000000001, 4500, 2700, 8, 972000000009999
);
SELECT pg_temp.assert_true(
  (SELECT theme_key = 'paper'
          AND width_units = 4500
          AND height_units = 2700
          AND revision = 9
     FROM public.web_guild_boards
    WHERE guildid = 972000000000001)
  AND (SELECT count(*) = 3
         FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001
          AND asset_kind = 'emoji'
          AND asset_id = 972000000001001)
  AND (SELECT min(x_units) = 120 AND min(y_units) = 220
         FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001),
  'theme, duplicate placement, and expansion share revision while coordinates remain stable'
);

SELECT public.web_update_guild_board_object(
  972000000000001,
  (SELECT objectid FROM public.web_guild_board_objects
    WHERE guildid = 972000000000001 ORDER BY objectid LIMIT 1),
  140, 240, 200, 0, 9, 972000000009997
);
DO $$
BEGIN
  BEGIN
    PERFORM public.web_update_guild_board_object(
      972000000000001,
      (SELECT objectid FROM public.web_guild_board_objects
        WHERE guildid = 972000000000001 ORDER BY objectid DESC LIMIT 1),
      800, 800, 180, 0, 9, 972000000009997
    );
    RAISE EXCEPTION 'concurrent stale different-object transform unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'GGB01' THEN NULL;
  END;
END;
$$;
SELECT pg_temp.assert_true(
  (SELECT revision = 10 FROM public.web_guild_boards WHERE guildid = 972000000000001),
  'different object writers cannot silently overwrite the same board revision'
);

RESET ROLE;
UPDATE public.gostudy_guild_emojis
   SET available = FALSE,
       updated_at = now(),
       last_seen_at = now()
 WHERE emojiid = 972000000001001;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 3
     FROM public.web_guild_board_objects
    WHERE guildid = 972000000000001
      AND asset_kind = 'emoji'
      AND asset_id = 972000000001001)
  AND NOT (SELECT available FROM public.gostudy_guild_emojis
            WHERE emojiid = 972000000001001),
  'unavailable registry assets must leave placement rows intact'
);

SET LOCAL ROLE gostudy_web_owner;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.web_guild_board_objects (
      guildid, asset_kind, asset_id, x_units, y_units, size_units,
      rotation_degrees, z_index, created_by, updated_by
    ) VALUES (
      972000000000001, 'url', 1, 0, 0, 180, 0, 1, 1, 1
    );
    RAISE EXCEPTION 'invalid asset kind unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_guild_board_objects (
      guildid, asset_kind, asset_id, x_units, y_units, size_units,
      rotation_degrees, z_index, created_by, updated_by
    ) VALUES (
      972000000000001, 'emoji', 1, 0, 0, 721, 0, 1, 1, 1
    );
    RAISE EXCEPTION 'oversized object unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_guild_board_objects (
      guildid, asset_kind, asset_id, x_units, y_units, size_units,
      rotation_degrees, z_index, created_by, updated_by
    ) VALUES (
      972000000000001, 'emoji', 1, 0, 0, 180, 0, 0, 1, 1
    );
    RAISE EXCEPTION 'zero z-index unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_guild_board_objects (
      guildid, asset_kind, asset_id, x_units, y_units, size_units,
      rotation_degrees, z_index, created_by, updated_by
    ) VALUES (
      972000000000001, 'emoji', 1, 0, 0, 180, 0, -1, 1, 1
    );
    RAISE EXCEPTION 'negative z-index unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.web_guild_board_objects (
      guildid, asset_kind, asset_id, x_units, y_units, size_units,
      rotation_degrees, z_index, created_by, updated_by, created_at, updated_at
    ) VALUES (
      972000000000001, 'emoji', 1, 0, 0, 180, 0, 1, 1, 1,
      now(), now() - interval '1 minute'
    );
    RAISE EXCEPTION 'backward timestamp unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;
