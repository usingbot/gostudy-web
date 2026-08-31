import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function migrationSql(): Promise<string> {
  return readFile('migrations/0011_create_guild_boards.sql', 'utf8');
}

async function objectMigrationSql(): Promise<string> {
  return readFile('migrations/0012_create_guild_board_objects.sql', 'utf8');
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

test('migration 0012 creates identity-and-geometry-only guild board placements with no quota', async () => {
  const sql = await objectMigrationSql();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /CREATE TABLE public\.web_guild_board_objects/);
  assert.match(sql, /objectid BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
  assert.match(sql, /REFERENCES public\.web_guild_boards \(guildid\) ON DELETE CASCADE/);
  assert.match(sql, /asset_kind IN \('emoji', 'sticker'\)/);
  assert.match(sql, /size_units BETWEEN 48 AND 720/);
  assert.match(sql, /rotation_degrees BETWEEN -180 AND 180/);
  assert.match(sql, /x_units >= 0 AND y_units >= 0/);
  assert.match(sql, /CONSTRAINT web_guild_board_objects_z_index_positive\s+CHECK \(z_index > 0\)/);
  assert.match(sql, /created_by > 0 AND updated_by > 0/);
  assert.match(sql, /updated_at >= created_at/);
  assert.match(sql, /\(guildid, z_index, objectid\)/);
  assert.doesNotMatch(sql, /REFERENCES public\.gostudy_guild_(?:emojis|stickers)/);
  assert.doesNotMatch(sql, /cdn|https?:|image_bytes|max_objects|object_count|quota/i);
  assert.match(sql, /COMMIT;\s*$/);
});

test('add function independently enforces active same-guild available assets and atomic revision-zero creation', async () => {
  const sql = await objectMigrationSql();
  const add = sql.slice(
    sql.indexOf('CREATE FUNCTION public.web_add_guild_board_asset'),
    sql.indexOf('CREATE FUNCTION public.web_update_guild_board_object'),
  );
  assert.match(add, /LANGUAGE plpgsql[\s\S]+SECURITY DEFINER[\s\S]+SET search_path = pg_catalog/);
  assert.match(add, /guild\.active = TRUE/);
  assert.match(add, /pg_catalog\.pg_advisory_xact_lock\(_guildid\)/);
  assert.match(add, /FOR UPDATE/);
  assert.match(add, /emoji\.emojiid = _asset_id[\s\S]+emoji\.guildid = _guildid[\s\S]+emoji\.available = TRUE/);
  assert.match(add, /sticker\.stickerid = _asset_id[\s\S]+sticker\.guildid = _guildid[\s\S]+sticker\.available = TRUE[\s\S]+sticker\.format_type IN \(1, 2, 4\)/);
  assert.match(add, /ERRCODE = 'GBA01'/);
  assert.match(add, /_expected_revision <> 0[\s\S]+ERRCODE = 'GGB01'/);
  assert.match(add, /INSERT INTO public\.web_guild_boards[\s\S]+'midnight',[\s\S]+3000,[\s\S]+1800,[\s\S]+1/);
  assert.match(add, /COALESCE\(pg_catalog\.max\(board_object\.z_index\), 0\)/);
  assert.match(add, /_highest_z \+ 1/);
  assert.match(add, /IF NOT _board_created THEN[\s\S]+revision = _board\.revision \+ 1/);
});

test('transform, layer, and delete functions are narrow, board-scoped, and share optimistic revision locking', async () => {
  const sql = await objectMigrationSql();
  for (const functionName of [
    'web_update_guild_board_object',
    'web_delete_guild_board_object',
    'web_reorder_guild_board_object',
  ]) {
    const source = sql.slice(sql.indexOf(`CREATE FUNCTION public.${functionName}`));
    assert.match(source, /SECURITY DEFINER/);
    assert.match(source, /SET search_path = pg_catalog/);
    assert.match(source, /pg_catalog\.pg_advisory_xact_lock\(_guildid\)/);
    assert.match(source, /_board\.revision <> _expected_revision[\s\S]+ERRCODE = 'GGB01'/);
    assert.match(source, /board_object\.guildid = _guildid[\s\S]+board_object\.objectid = _objectid/);
    assert.match(source, /revision = _board\.revision \+ 1/);
  }
  const transform = sql.slice(
    sql.indexOf('CREATE FUNCTION public.web_update_guild_board_object'),
    sql.indexOf('CREATE FUNCTION public.web_delete_guild_board_object'),
  );
  assert.match(transform, /SET x_units = _x_units,[\s\S]+y_units = _y_units,[\s\S]+size_units = _size_units,[\s\S]+rotation_degrees = _rotation_degrees/);
  assert.doesNotMatch(transform, /SET asset_(?:kind|id)|SET guildid/);
  const layer = sql.slice(sql.indexOf('CREATE FUNCTION public.web_reorder_guild_board_object'));
  assert.match(layer, /_action NOT IN \('front', 'back'\)/);
  assert.match(layer, /row_number\(\) OVER/);
  assert.doesNotMatch(layer, /_z_index/);
});

test('geometry is bounded by logical board dimensions and every object write returns canonical state', async () => {
  const sql = await objectMigrationSql();
  assert.match(sql, /_x_units > _board\.width_units - _size_units/);
  assert.match(sql, /_y_units > _board\.height_units - _size_units/);
  assert.match(sql, /RETURNS TABLE \([\s\S]+board_revision BIGINT,[\s\S]+objectid BIGINT,[\s\S]+rotation_degrees NUMERIC,[\s\S]+z_index BIGINT/);
  assert.equal((sql.match(/RETURN QUERY/g) ?? []).length, 4);
});

test('runtime receives only registry reads, object reads, and four narrow function calls', async () => {
  const sql = await objectMigrationSql();
  assert.match(sql, /GRANT SELECT ON TABLE[\s\S]+gostudy_guild_emojis,[\s\S]+gostudy_guild_stickers[\s\S]+TO gostudy_web, gostudy_web_owner/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE[\s\S]+gostudy_guild_emojis,[\s\S]+gostudy_guild_stickers[\s\S]+FROM gostudy_web/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.web_guild_board_objects TO gostudy_web/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]+web_guild_board_objects[\s\S]+FROM gostudy_web/);
  for (const functionName of [
    'web_add_guild_board_asset',
    'web_update_guild_board_object',
    'web_delete_guild_board_object',
    'web_reorder_guild_board_object',
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}[\\s\\S]+FROM PUBLIC`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}[\\s\\S]+TO gostudy_web`));
  }
});
