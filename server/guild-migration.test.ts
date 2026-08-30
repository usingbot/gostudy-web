import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function migrationSql(): Promise<string> {
  return readFile('migrations/0010_create_guild_publishing.sql', 'utf8');
}

test('migration 0010 creates separate publication and normalized tag models without a bot FK', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE TABLE public\.web_guild_publications/);
  assert.match(sql, /CREATE TABLE public\.web_guild_tags/);
  assert.match(sql, /guildid BIGINT PRIMARY KEY/);
  assert.match(sql, /slug TEXT NOT NULL UNIQUE/);
  assert.match(sql, /PRIMARY KEY \(guildid, sort_order\)/);
  assert.match(sql, /UNIQUE INDEX web_guild_tags_casefold_unique/);
  assert.doesNotMatch(sql, /REFERENCES public\.gostudy_guilds/);
});

test('migration validates slug, invite, actor, tag shape, tag count, and active registry state', async () => {
  const sql = await migrationSql();
  assert.match(sql, /char_length\(slug\) BETWEEN 3 AND 64/);
  assert.match(sql, /invite_code ~ '\^\[A-Za-z0-9-\]\+\$'/);
  assert.match(sql, /sort_order BETWEEN 0 AND 4/);
  assert.match(sql, /cardinality\(_tags\) > 5/);
  assert.match(sql, /GROUP BY pg_catalog\.lower\(tag\)/);
  assert.match(sql, /guild\.active = TRUE/);
  assert.doesNotMatch(sql, /FOR (?:UPDATE|SHARE)/);
});

test('migration atomically replaces publication settings and tags through one narrow function', async () => {
  const sql = await migrationSql();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = pg_catalog/);
  assert.match(sql, /ON CONFLICT \(guildid\) DO UPDATE/);
  assert.match(sql, /DELETE FROM public\.web_guild_tags/);
  assert.match(sql, /WITH ORDINALITY/);
  assert.match(sql, /COMMIT;\s*$/);
});

test('migration grants read-only bot metadata and revokes broad/runtime/public mutation paths', async () => {
  const sql = await migrationSql();
  assert.match(sql, /GRANT SELECT ON TABLE public\.gostudy_guilds\s+TO gostudy_web, gostudy_web_owner/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s+ON TABLE public\.gostudy_guilds\s+FROM gostudy_web/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.web_upsert_guild_publication[\s\S]+FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.web_upsert_guild_publication[\s\S]+TO gostudy_web/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE)[\s\S]+gostudy_guilds/);
});
