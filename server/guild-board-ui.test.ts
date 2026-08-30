import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('board editor is protected by guild publishing authorization and linked from each guild', async () => {
  const [app, publishing, editor] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/pages/GuildPublishing.tsx', 'utf8'),
    readFile('src/pages/GuildBoardEditor.tsx', 'utf8'),
  ]);
  assert.match(app, /<Route element={<RequireGuildPublishing \/>}>[\s\S]+path="\/admin\/servers\/:guildid\/board"/);
  assert.match(publishing, /to={`\/admin\/servers\/\$\{guild\.guildid\}\/board`}/);
  assert.match(publishing, /Edit Board/);
  assert.match(editor, /fetchManageableGuilds/);
  assert.match(editor, /fetchAdminGuildBoard/);
  assert.match(editor, /DiscordGuildIcon/);
});

test('editor exposes only four fixed themes, previews them, and saves optimistic revisions', async () => {
  const [editor, themes, canvas] = await Promise.all([
    readFile('src/pages/GuildBoardEditor.tsx', 'utf8'),
    readFile('src/guild-board-themes.ts', 'utf8'),
    readFile('src/components/GuildBoardCanvas.tsx', 'utf8'),
  ]);
  for (const key of ['midnight', 'mint', 'cork', 'paper']) {
    assert.match(themes, new RegExp(`key: '${key}'`));
  }
  assert.equal((themes.match(/key: '/g) ?? []).length, 4);
  assert.match(editor, /saveAdminGuildBoardTheme/);
  assert.match(editor, /expectedRevision: state\.board\.revision/);
  assert.match(editor, /GUILD_BOARD_REVISION_CONFLICT/);
  assert.match(editor, /Reload latest board/);
  assert.match(editor, /Discord emoji and sticker placement arrives in the next chapter\./);
  assert.match(editor, /<GuildBoardCanvas[\s\S]+theme={theme}[\s\S]+width={board\.width}[\s\S]+height={board\.height}[\s\S]+objects={\[\]}/);
  assert.doesNotMatch(`${editor}\n${themes}\n${canvas}`, /type="(?:text|url|file)"|dangerouslySetInnerHTML|backgroundUrl|https?:\/\//);
});

test('public detail fetches the public board and renders the shared honest empty canvas', async () => {
  const [detail, canvas, api] = await Promise.all([
    readFile('src/pages/PublicServerDetail.tsx', 'utf8'),
    readFile('src/components/GuildBoardCanvas.tsx', 'utf8'),
    readFile('src/api/guildBoards.ts', 'utf8'),
  ]);
  assert.match(detail, /fetchPublicGuildBoard/);
  assert.match(detail, /<GuildBoardCanvas[\s\S]+theme={board\.theme}[\s\S]+width={board\.width}[\s\S]+height={board\.height}[\s\S]+objects={board\.objects}/);
  assert.match(canvas, /Nothing has been pinned here yet\./);
  assert.match(canvas, /data-object-count={objects\.length}/);
  assert.match(api, /credentials: 'omit'/);
  assert.doesNotMatch(`${detail}\n${canvas}`, /fake|sample post|online members|study hours|active students|streak/i);
});

test('board renderer uses fixed CSS classes and no network-backed theme assets', async () => {
  const [themes, css] = await Promise.all([
    readFile('src/guild-board-themes.ts', 'utf8'),
    readFile('src/index.css', 'utf8'),
  ]);
  for (const key of ['midnight', 'mint', 'cork', 'paper']) {
    assert.match(themes, new RegExp(`className: 'guild-board-theme-${key}'`));
    assert.match(css, new RegExp(`\\.guild-board-theme-${key}`));
  }
  assert.doesNotMatch(css, /url\s*\(/i);
});

test('owner-only capacity controls expose fixed expansions with deliberate confirmation and no shrinking inputs', async () => {
  const [editor, capacities] = await Promise.all([
    readFile('src/pages/GuildBoardEditor.tsx', 'utf8'),
    readFile('src/guild-board-capacities.ts', 'utf8'),
  ]);
  for (const pair of ['3000, height: 1800', '4500, height: 2700', '6000, height: 3600', '9000, height: 5400']) {
    assert.match(capacities, new RegExp(`width: ${pair}`));
  }
  assert.match(editor, /admin\?\.role === 'owner'/);
  assert.match(editor, /GUILD_BOARD_CAPACITIES\.slice\(currentCapacityIndex \+ 1\)/);
  assert.match(editor, /Review expansion/);
  assert.match(editor, /Confirm permanent expansion/);
  assert.match(editor, /Capacity is read-only/);
  assert.match(editor, /saveAdminGuildBoardCapacity/);
  assert.doesNotMatch(editor, /type="number"|object limit|maximum objects/i);
});

test('shared finite viewport provides bounded browser-only pan and zoom controls', async () => {
  const [canvas, css] = await Promise.all([
    readFile('src/components/GuildBoardCanvas.tsx', 'utf8'),
    readFile('src/index.css', 'utf8'),
  ]);
  assert.match(canvas, /const MIN_ZOOM = 0\.3/);
  assert.match(canvas, /const MAX_ZOOM = 2/);
  assert.match(canvas, /const MAX_OVERSCROLL = 150/);
  assert.match(canvas, /Fit board/);
  assert.match(canvas, /Set board zoom to 100 percent/);
  assert.match(canvas, /onPointerDown/);
  assert.match(canvas, /event\.button !== 0 && event\.button !== 1/);
  assert.match(canvas, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(canvas, /addEventListener\('wheel', handleWheel, \{passive: false\}\)/);
  assert.match(css, /touch-action: none/);
  assert.doesNotMatch(canvas, /fetch\(|localStorage|sessionStorage|canvas|getContext/);
});
