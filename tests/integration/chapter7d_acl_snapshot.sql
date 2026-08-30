\set ON_ERROR_STOP on

-- Run in the same disposable psql session immediately before migration 0011.
CREATE TEMP TABLE chapter7d_registry_acl_before
ON COMMIT PRESERVE ROWS
AS
SELECT oid, relacl
  FROM pg_catalog.pg_class
 WHERE oid IN (
   'public.gostudy_guilds'::regclass,
   'public.gostudy_guild_emojis'::regclass,
   'public.gostudy_guild_stickers'::regclass
 );
