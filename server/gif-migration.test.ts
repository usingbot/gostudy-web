import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function migrationSql(): Promise<string> {
  return readFile('migrations/0007_create_board_gifs.sql', 'utf8');
}

test('GIF migration is one atomic transaction', async () => {
  const sql = await migrationSql();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});

test('GIF table is keyed to one exact owned item with RESTRICT semantics', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE TABLE public\.web_board_gifs/);
  assert.match(sql, /owned_itemid bigint PRIMARY KEY/);
  assert.match(sql, /REFERENCES public\.web_owned_board_items \(owned_itemid\)[\s\S]*ON DELETE RESTRICT/);
});

test('absence of a GIF row naturally represents an unconfigured slot', async () => {
  const sql = await migrationSql();
  assert.match(sql, /giphy_id text NOT NULL/);
  const schemaSection = sql.slice(0, sql.indexOf('CREATE FUNCTION public.web_upsert_board_gif'));
  assert.doesNotMatch(schemaSection, /INSERT INTO public\.web_board_gifs/);
  assert.doesNotMatch(sql, /DEFAULT ['"]{2}/);
});

test('persisted GIPHY identity has defensive canonical bounds', async () => {
  const sql = await migrationSql();
  assert.match(sql, /char_length\(giphy_id\) BETWEEN 1 AND 128/);
  assert.match(sql, /giphy_id ~ '\^\[A-Za-z0-9_-\]\+\$'/);
});

test('canonical table and upsert persist no provider display or media metadata', async () => {
  const sql = await migrationSql();
  assert.doesNotMatch(sql, /\btitle\b|preview_url|render_url|media_url|\bwidth\b|\bheight\b/i);
  assert.match(sql, /Persist only the canonical GIPHY ID/);
});

test('owner trigger proves exact gif-slot ownership', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE FUNCTION public\.web_validate_board_gif_owner\(\)/);
  assert.match(sql, /_owned_userid <> NEW\.userid/);
  assert.match(sql, /_item_key <> 'gif-slot'/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF owned_itemid, userid/);
});

test('upsert is a narrow security-definer boundary with fully qualified objects', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE FUNCTION public\.web_upsert_board_gif\(/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = pg_catalog/);
  assert.match(sql, /FROM public\.web_owned_board_items AS owned/);
  assert.match(sql, /INSERT INTO public\.web_board_gifs AS board_gif/);
  assert.match(sql, /USING ERRCODE = 'GSB04'/);
  assert.match(sql, /USING ERRCODE = 'GSB05'/);
});

test('runtime can read GIFs and execute only the validated mutation function', async () => {
  const sql = await migrationSql();
  assert.match(sql, /REVOKE ALL ON TABLE public\.web_board_gifs FROM PUBLIC/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.web_board_gifs TO gostudy_web/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*FROM gostudy_web/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*web_upsert_board_gif\(bigint, bigint, text\)[\s\S]*TO gostudy_web/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE)[^;]*web_board_gifs TO gostudy_web/);
});

test('trigger and helper execution are revoked from PUBLIC', async () => {
  const sql = await migrationSql();
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*web_validate_board_gif_owner\(\)[\s\S]*web_upsert_board_gif/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*web_validate_board_gif_owner\(\)[\s\S]*TO gostudy_web/);
});
