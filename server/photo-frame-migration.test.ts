import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function migrationSql(): Promise<string> {
  return readFile('migrations/0009_create_photo_frames.sql', 'utf8');
}

test('migration 0009 creates one durable image state per owned Photo Frame', async () => {
  const sql = await migrationSql();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /CREATE TABLE public\.web_photo_frames/);
  assert.match(sql, /owned_itemid bigint PRIMARY KEY/);
  assert.match(sql, /REFERENCES public\.web_owned_board_items \(owned_itemid\)[\s\S]*ON DELETE RESTRICT/);
  assert.match(sql, /object_key text NOT NULL UNIQUE/);
  assert.match(sql, /CHECK \(width BETWEEN 1 AND 1600\)/);
  assert.match(sql, /CHECK \(height BETWEEN 1 AND 1600\)/);
  assert.match(sql, /CHECK \(byte_size BETWEEN 1 AND 5242880\)/);
  assert.match(sql, /content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /CHECK \(revision > 0\)/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /REFERENCES public\.gostudy_/);
});

test('Photo Frame namespace is tied to owned_itemid and generated UUIDv4 WebP keys', async () => {
  const sql = await migrationSql();
  assert.match(sql, /'\^photo-frames\/' \|\| owned_itemid::text/);
  assert.match(sql, /\[0-9a-f\]\{8\}.*-4\[0-9a-f\]\{3\}.*\[89ab\]/s);
  assert(sql.includes("[0-9a-f]{12}\\.webp$"));
  assert.doesNotMatch(sql, /filename|discord/i);
});

test('ownership trigger and replacement function require the exact photo-frame item key', async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE FUNCTION public\.web_validate_photo_frame_owner\(\)/);
  assert.match(sql, /_owned_userid <> NEW\.userid[\s\S]*_item_key <> 'photo-frame'/);
  assert.match(sql, /CREATE FUNCTION public\.web_replace_photo_frame_image/);
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(sql, /IF NOT FOUND OR _owned_userid <> _userid[\s\S]*ERRCODE = 'GSP01'/);
  assert.match(sql, /IF _item_key <> 'photo-frame'[\s\S]*ERRCODE = 'GSP02'/);
});

test('replacement serialization starts at one, increments, and rejects stale revisions', async () => {
  const sql = await migrationSql();
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /IF _expected_revision = 0/);
  assert.match(sql, /_current_revision <> _expected_revision[\s\S]*ERRCODE = 'GSP03'/);
  assert.match(sql, /revision = _current_revision \+ 1/);
  assert.match(sql, /_old_object_key/);
  assert(sql.indexOf('FOR UPDATE') < sql.indexOf('revision = _current_revision + 1'));
});

test('runtime permissions allow reads and narrow replacement only', async () => {
  const sql = await migrationSql();
  assert.match(sql, /GRANT SELECT ON TABLE public\.web_photo_frames TO gostudy_web/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*FROM gostudy_web/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*web_replace_photo_frame_image[\s\S]*TO gostudy_web/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*web_replace_photo_frame_image[\s\S]*FROM PUBLIC/);
});
