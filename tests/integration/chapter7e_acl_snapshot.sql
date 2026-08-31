\set ON_ERROR_STOP on

-- Run in the disposable Chapter 7E psql session immediately before migration
-- 0012. Only mutation privileges are snapshotted because 0012 intentionally
-- adds narrow SELECT grants for trusted web read models.
CREATE TEMP TABLE chapter7e_registry_mutation_acl_before AS
SELECT registry.oid,
       registry.relname,
       pg_catalog.has_table_privilege('lion', registry.oid, 'INSERT') AS lion_insert,
       pg_catalog.has_table_privilege('lion', registry.oid, 'UPDATE') AS lion_update,
       pg_catalog.has_table_privilege('lion', registry.oid, 'DELETE') AS lion_delete,
       pg_catalog.has_table_privilege('lion', registry.oid, 'TRUNCATE') AS lion_truncate,
       pg_catalog.has_table_privilege('gostudy_web', registry.oid, 'INSERT') AS web_insert,
       pg_catalog.has_table_privilege('gostudy_web', registry.oid, 'UPDATE') AS web_update,
       pg_catalog.has_table_privilege('gostudy_web', registry.oid, 'DELETE') AS web_delete,
       pg_catalog.has_table_privilege('gostudy_web', registry.oid, 'TRUNCATE') AS web_truncate
  FROM pg_catalog.pg_class AS registry
 WHERE registry.oid IN (
   'public.gostudy_guild_emojis'::regclass,
   'public.gostudy_guild_stickers'::regclass
 );
