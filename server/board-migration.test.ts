import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function migrationSql(): Promise<string> {
  return readFile('migrations/0006_create_board_objects_v2.sql', 'utf8');
}

test('migration creates strict generic board objects with partial physical-instance uniqueness', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE TABLE public\.web_study_board_objects/);
  assert.match(sql, /board_objectid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
  assert.match(sql, /source_type = 'reward'[\s\S]*hour_rewardid IS NOT NULL[\s\S]*owned_itemid IS NULL[\s\S]*object_type = 'reward_decoration'/);
  assert.match(sql, /source_type = 'shop'[\s\S]*hour_rewardid IS NULL[\s\S]*owned_itemid IS NOT NULL/);
  assert.match(sql, /CHECK \(x >= 0 AND x <= 1\)/);
  assert.match(sql, /CHECK \(y >= 0 AND y <= 1\)/);
  assert.match(sql, /CREATE UNIQUE INDEX web_study_board_objects_reward_unique[\s\S]*\(hour_rewardid\)[\s\S]*WHERE source_type = 'reward'/);
  assert.match(sql, /CREATE UNIQUE INDEX web_study_board_objects_owned_item_unique[\s\S]*\(owned_itemid\)[\s\S]*WHERE source_type = 'shop'/);
  assert.match(sql, /web_validate_board_shop_object[\s\S]*_owned_userid <> NEW\.userid[\s\S]*_owned_item_type <> NEW\.object_type/);
  assert.doesNotMatch(sql, /REFERENCES public\.gostudy_(?:hour_rewards|user_inventory|reward_catalog)/);
});

test('legacy migration locks, copies exact coordinates, proves both directions, then drops atomically', async () => {
  const sql = await migrationSql();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /LOCK TABLE public\.web_study_board_items IN ACCESS EXCLUSIVE MODE/);
  assert.match(sql, /INSERT INTO public\.web_study_board_objects[\s\S]*legacy\.userid[\s\S]*'reward'[\s\S]*legacy\.hour_rewardid[\s\S]*legacy\.x[\s\S]*legacy\.y/);
  assert.match(sql, /_legacy_count <> _migrated_count/);
  const excepts = sql.match(/\bEXCEPT\b/g) ?? [];
  assert.equal(excepts.length, 2);
  assert.match(sql, /legacy\.userid, legacy\.hour_rewardid, legacy\.x, legacy\.y[\s\S]*object\.userid, object\.hour_rewardid, object\.x, object\.y/);
  assert.match(sql, /DROP TABLE public\.web_study_board_items/);
  assert.match(sql, /COMMIT;\s*$/);
  assert(sql.indexOf('DROP TABLE public.web_study_board_items') > sql.indexOf('IF EXISTS'));
});

test('Sticky Note storage is owned-instance-bound with database character defense', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE TABLE public\.web_sticky_notes/);
  assert.match(sql, /owned_itemid bigint PRIMARY KEY/);
  assert.match(sql, /CHECK \(char_length\(body\) <= 2000\)/);
  assert.match(sql, /REFERENCES public\.web_owned_board_items \(owned_itemid\)[\s\S]*ON DELETE RESTRICT/);
  assert.match(sql, /web_validate_sticky_note_owner[\s\S]*_item_key <> 'sticky-note'/);
  assert.match(sql, /CREATE FUNCTION public\.web_upsert_sticky_note[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(sql, /USING ERRCODE = 'GSB04'/);
  assert.match(sql, /USING ERRCODE = 'GSB05'/);
  assert.doesNotMatch(sql, /regexp_split|word_count/);
});

test('migration uses RESTRICT ownership semantics and least-privilege runtime grants', async () => {
  const sql = await migrationSql();
  assert.match(sql, /web_study_board_objects_owned_item_fkey[\s\S]*ON DELETE RESTRICT/);
  assert.match(sql, /GRANT SELECT, INSERT, DELETE[\s\S]*web_study_board_objects[\s\S]*TO gostudy_web/);
  assert.match(sql, /GRANT UPDATE \(x, y, updated_at\)/);
  assert.match(sql, /GRANT SELECT[\s\S]*web_sticky_notes[\s\S]*TO gostudy_web/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*web_sticky_notes[\s\S]*FROM gostudy_web/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*web_upsert_sticky_note\(bigint, bigint, text\)[\s\S]*TO gostudy_web/);
});
