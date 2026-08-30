import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('Guild Publishing admin route and dark configuration UI are wired without a public gallery', async () => {
  const [app, page, layout, admin] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/pages/GuildPublishing.tsx', 'utf8'),
    readFile('src/components/Layout.tsx', 'utf8'),
    readFile('src/pages/Admin.tsx', 'utf8'),
  ]);
  assert.match(app, /path="\/admin\/servers" element={<GuildPublishing/);
  assert.match(layout, /name: 'Guilds', path: '\/admin\/servers'/);
  assert.match(admin, /Guild Publishing/);
  assert.match(page, /Discord server publishing/);
  assert.match(page, /bg-\[#18181b\]/);
  assert.doesNotMatch(app, /path="\/servers"/);
});

test('Guild Publishing UI renders metadata, existing settings, toggle, capped tags, errors, and save state', async () => {
  const page = await readFile('src/pages/GuildPublishing.tsx', 'utf8');
  assert.match(page, /guild\.iconUrl/);
  assert.match(page, /guild\.name/);
  assert.match(page, /guild\.memberCount/);
  assert.match(page, /guild\.publication\?\.slug/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /tags\.length < 5/);
  assert.match(page, /maxLength=\{24\}/);
  assert.match(page, /role="alert"/);
  assert.match(page, /Settings saved\./);
  assert.match(page, /saveGuildPublication/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
});

test('authorization UI documents login refresh and does not imply web admins own every guild', async () => {
  const [page, guard] = await Promise.all([
    readFile('src/pages/GuildPublishing.tsx', 'utf8'),
    readFile('src/auth/RequireGuildPublishing.tsx', 'utf8'),
  ]);
  assert.match(page, /Authorization refreshes when you sign in again/);
  assert.match(page, /own the Discord server or have Manage Server \/ Administrator/);
  assert.match(guard, /canManageGuildPublishing/);
});
