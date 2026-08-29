import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';

const migrationPath = resolve('migrations/0005_create_board_shop.sql');

async function migrationSql(): Promise<string> {
  return readFile(migrationPath, 'utf8');
}

test('Shop migration creates the catalog, purchase audit, and owned-instance tables', async () => {
  const sql = await migrationSql();
  for (const table of [
    'web_board_shop_catalog',
    'web_board_purchases',
    'web_owned_board_items',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
  }
  assert.match(sql, /owned_itemid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
  assert.match(sql, /UNIQUE \(purchaseid\)/);
  assert.match(sql, /UNIQUE \(chalk_transactionid\)/);
  assert.doesNotMatch(sql, /REFERENCES public\.gostudy_chalk/);
});

test('Shop migration seeds exactly the four specified catalog rows and prices', async () => {
  const sql = await migrationSql();
  const seedBlock = sql.match(/INSERT INTO public\.web_board_shop_catalog[\s\S]*?;/)?.[0] ?? '';
  const rows = [...seedBlock.matchAll(/\('([^']+)', '([^']+)', '([^']+)', (\d+), (\d+)\)/g)];
  assert.deepEqual(rows.map((row) => row.slice(1, 5)), [
    ['basic-decoration', 'Basic Decoration', 'decoration', '1'],
    ['sticky-note', 'Sticky Note', 'sticky_note', '2'],
    ['gif-slot', 'GIF Slot', 'gif', '3'],
    ['photo-frame', 'Photo Frame', 'photo_frame', '5'],
  ]);
});

test('catalog constraints and purchase immutability are enforced in SQL', async () => {
  const sql = await migrationSql();
  assert.match(sql, /item_key ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/);
  assert.match(sql, /item_type IN \('decoration', 'sticky_note', 'gif', 'photo_frame'\)/);
  assert.match(sql, /price_chalk BETWEEN 1 AND 1000000/);
  assert.match(sql, /CHECK \(sort_order >= 0\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.web_board_purchases/);
  assert.match(sql, /BEFORE TRUNCATE ON public\.web_board_purchases/);
});

test('purchase function is definer-secured, request-locked, replay-safe, and database-priced', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE FUNCTION public\.web_purchase_board_item[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*hashtextextended\('gostudy:web:shop:' \|\| _request_id/);
  assert.match(sql, /WHERE purchases\.purchaseid = _purchase_id/);
  assert.match(sql, /USING ERRCODE = 'GSB03'/);
  assert.match(sql, /public\.gostudy_purchase_board_item_chalk\([\s\S]*_catalog_item\.price_chalk/);
  assert.match(sql, /INSERT INTO public\.web_board_purchases[\s\S]*INSERT INTO public\.web_owned_board_items/);
});

test('runtime Shop privileges are read-only and hide the price-taking Chalk wrapper', async () => {
  const sql = await migrationSql();
  assert.match(sql, /GRANT SELECT\s+ON TABLE[\s\S]*web_board_shop_catalog[\s\S]*web_board_purchases[\s\S]*web_owned_board_items\s+TO gostudy_web/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*FROM gostudy_web/);
  assert.match(sql, /GRANT EXECUTE\s+ON FUNCTION public\.web_purchase_board_item\(bigint, text, text\)\s+TO gostudy_web/);
  assert.match(sql, /REVOKE EXECUTE\s+ON FUNCTION public\.gostudy_purchase_board_item_chalk\(bigint, bigint, text, text\)\s+FROM gostudy_web/);
});
