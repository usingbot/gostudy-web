import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function migrationSql(): Promise<string> {
  return readFile('migrations/0011_create_guild_boards.sql', 'utf8');
}

test('migration 0011 creates one constrained board row per guild without a bot-registry foreign key', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE TABLE public\.web_guild_boards/);
  assert.match(sql, /guildid BIGINT PRIMARY KEY/);
  assert.match(sql, /theme_key IN \('midnight', 'mint', 'cork', 'paper'\)/);
  for (const pair of ['3000, 1800', '4500, 2700', '6000, 3600', '9000, 5400']) {
    assert.match(sql, new RegExp(`\\(${pair}\\)`));
  }
  assert.match(sql, /revision > 0/);
  assert.match(sql, /created_by > 0 AND updated_by > 0/);
  assert.match(sql, /updated_at >= created_at/);
  assert.doesNotMatch(sql, /REFERENCES public\.gostudy_guilds/);
});

test('narrow theme mutation validates active guilds and implements locked optimistic revisions', async () => {
  const sql = await migrationSql();
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = pg_catalog/);
  assert.match(sql, /guild\.active = TRUE/);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(_guildid\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /_expected_revision <> 0/);
  assert.match(sql, /_existing\.revision <> _expected_revision/);
  assert.match(sql, /revision = _existing\.revision \+ 1/);
  assert.match(sql, /ERRCODE = 'GGB01'/);
  assert.match(sql, /ERRCODE = 'GSG01'/);
  assert.match(sql, /INSERT INTO public\.web_guild_boards[\s\S]+3000,[\s\S]+1800/);
  const themeFunction = sql.slice(
    sql.indexOf('CREATE FUNCTION public.web_upsert_guild_board_theme'),
    sql.indexOf('CREATE FUNCTION public.web_expand_guild_board'),
  );
  assert.doesNotMatch(themeFunction, /SET width_units|SET height_units/);
});

test('capacity expansion is platform-owner-only, fixed-tier, theme-preserving, and never shrinks', async () => {
  const sql = await migrationSql();
  const expansion = sql.slice(sql.indexOf('CREATE FUNCTION public.web_expand_guild_board'));
  assert.match(expansion, /FROM public\.web_user_roles AS roles/);
  assert.match(expansion, /roles\.userid = _actor[\s\S]+roles\.role = 'owner'/);
  assert.match(expansion, /ERRCODE = 'GGB02'/);
  assert.match(expansion, /_width_units <= _existing\.width_units/);
  assert.match(expansion, /_height_units <= _existing\.height_units/);
  assert.match(expansion, /SET width_units = _width_units,[\s\S]+height_units = _height_units/);
  assert.doesNotMatch(expansion, /SET theme_key/);
});

test('runtime can read boards and execute only the narrow mutation function', async () => {
  const sql = await migrationSql();
  assert.match(sql, /REVOKE ALL ON TABLE public\.web_guild_boards FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.web_upsert_guild_board_theme[\s\S]+FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.web_expand_guild_board[\s\S]+FROM PUBLIC/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.web_guild_boards TO gostudy_web/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]+FROM gostudy_web/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.web_upsert_guild_board_theme[\s\S]+TO gostudy_web/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.web_expand_guild_board[\s\S]+TO gostudy_web/);
  assert.doesNotMatch(sql, /(?:GRANT|REVOKE)[^;]+gostudy_guilds/);
});

test('migration is atomic', async () => {
  const sql = await migrationSql();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});
