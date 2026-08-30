import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('Guild Publishing remains guarded while public server discovery is outside auth', async () => {
  const [app, main, page, layout, admin, publicLayout] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/main.tsx', 'utf8'),
    readFile('src/pages/GuildPublishing.tsx', 'utf8'),
    readFile('src/components/Layout.tsx', 'utf8'),
    readFile('src/pages/Admin.tsx', 'utf8'),
    readFile('src/components/PublicLayout.tsx', 'utf8'),
  ]);
  assert.match(app, /path="\/admin\/servers" element={<GuildPublishing/);
  assert.match(layout, /name: 'Guilds', path: '\/admin\/servers'/);
  assert.match(admin, /Guild Publishing/);
  assert.match(page, /Discord server publishing/);
  assert.match(page, /bg-\[#18181b\]/);
  assert.match(app, /path="\/servers" element={<PublicServers/);
  assert.match(app, /path="\/servers\/:slug" element={<PublicServerDetail/);
  assert.match(main, /<AuthProvider>\s*<App \/>\s*<\/AuthProvider>/);
  assert.equal((main.match(/<AuthProvider>/g) ?? []).length, 1);
  assert.doesNotMatch(app, /AuthProvider/);
  assert.match(app, /<Route element={<RequireAuth \/>}>/);
  assert.ok(app.indexOf('path="/servers"') < app.indexOf('<Route element={<RequireAuth'));
  assert.ok(app.indexOf('path="/dashboard"') > app.indexOf('<Route element={<RequireAuth'));
  assert.match(publicLayout, /status === 'authenticated'/);
  assert.match(publicLayout, /isAuthenticated \? '\/dashboard' : '\/login'/);
  assert.doesNotMatch(publicLayout, /Navigate|logout\(/);
});

test('root auth context persists across public route navigation without automatic logout', async () => {
  const [main, app, provider] = await Promise.all([
    readFile('src/main.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
    readFile('src/auth/AuthProvider.tsx', 'utf8'),
  ]);
  assert.equal((main.match(/<AuthProvider>/g) ?? []).length, 1);
  assert.match(main, /<AuthProvider>\s*<App \/>\s*<\/AuthProvider>/);
  assert.match(app, /path="\/dashboard"/);
  assert.match(app, /path="\/servers"/);
  assert.doesNotMatch(app, /key=\{location|key=\{.*pathname/);
  const effect = provider.slice(
    provider.indexOf('useEffect(() =>'),
    provider.indexOf('const logout = useCallback'),
  );
  assert.match(effect, /void refresh\(\)/);
  assert.doesNotMatch(effect, /logout/);
  assert.match(provider, /response\.status === 401/);
  assert.match(provider, /setStatus\(currentUser \? 'authenticated' : 'unauthenticated'\)/);
});

test('Guild Publishing UI renders metadata, existing settings, toggle, capped tags, errors, and save state', async () => {
  const page = await readFile('src/pages/GuildPublishing.tsx', 'utf8');
  assert.match(page, /DiscordGuildIcon/);
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

test('public gallery renders real fields, graceful fallbacks, tags, and conditional invites', async () => {
  const [page, card, icon] = await Promise.all([
    readFile('src/pages/PublicServers.tsx', 'utf8'),
    readFile('src/components/PublicServerCard.tsx', 'utf8'),
    readFile('src/components/DiscordGuildIcon.tsx', 'utf8'),
  ]);
  assert.match(page, /Explore Study Servers/);
  assert.match(page, /Loading study servers/);
  assert.match(page, /Servers could not be loaded/);
  assert.match(page, /No public servers yet/);
  assert.match(card, /guild\.bannerUrl/);
  assert.match(card, /DiscordGuildIcon/);
  assert.match(icon, /guild\.iconUrl/);
  assert.match(card, /guild\.description/);
  assert.match(card, /count === null \? 'Member count unavailable'/);
  assert.match(card, /tags\.slice\(0, 5\)/);
  assert.match(card, /guild\.inviteUrl &&/);
  assert.match(card, /rel="noopener noreferrer"/);
  assert.doesNotMatch(`${page}\n${card}`, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(`${page}\n${card}`, /online members|study hours|active students|streak/i);
});

test('public detail renders guild metadata and an honest empty Study Board foundation', async () => {
  const [page, canvas] = await Promise.all([
    readFile('src/pages/PublicServerDetail.tsx', 'utf8'),
    readFile('src/components/GuildBoardCanvas.tsx', 'utf8'),
  ]);
  assert.match(page, /guild\.name/);
  assert.match(page, /guild\.description/);
  assert.match(page, /MemberCount count=\{guild\.memberCount\}/);
  assert.match(page, /GuildTags tags=\{guild\.tags\}/);
  assert.match(page, /Study Board/);
  assert.match(page, /GuildBoardCanvas/);
  assert.match(canvas, /Nothing has been pinned here yet/);
  assert.match(page, /Server not found/);
  assert.match(page, /This server could not be loaded/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|online members|study hours|active students|streak/i);
  assert.doesNotMatch(page, /board\/objects|board\/items/);
});

test('real Discord icons are alpha-safe while missing icons retain the gradient fallback', async () => {
  const [icon, card, detail, publishing] = await Promise.all([
    readFile('src/components/DiscordGuildIcon.tsx', 'utf8'),
    readFile('src/components/PublicServerCard.tsx', 'utf8'),
    readFile('src/pages/PublicServerDetail.tsx', 'utf8'),
    readFile('src/pages/GuildPublishing.tsx', 'utf8'),
  ]);
  const realIconBranch = icon.slice(
    icon.indexOf('if (guild.iconUrl)'),
    icon.indexOf('const fallback ='),
  );
  const fallbackBranch = icon.slice(icon.indexOf('const fallback ='));
  assert.match(realIconBranch, /bg-transparent/);
  assert.match(realIconBranch, /object-contain/);
  assert.match(realIconBranch, /className="block/);
  assert.match(realIconBranch, /alt=\{`\$\{guild\.name\} server icon`\}/);
  assert.doesNotMatch(realIconBranch, /bg-gradient|from-indigo|fallback/);
  assert.match(fallbackBranch, /bg-gradient-to-br from-indigo-500 to-violet-700/);
  assert.match(fallbackBranch, /<span aria-hidden="true">\{fallback\}<\/span>/);
  for (const consumer of [card, detail, publishing]) {
    assert.match(consumer, /DiscordGuildIcon/);
    assert.doesNotMatch(consumer, /object-cover[^\n]*server icon|bg-gradient[^\n]*guild\.iconUrl/);
  }
});

test('public server card hover feedback never moves or scales card geometry', async () => {
  const [card, gallery] = await Promise.all([
    readFile('src/components/PublicServerCard.tsx', 'utf8'),
    readFile('src/pages/PublicServers.tsx', 'utf8'),
  ]);
  assert.doesNotMatch(card, /hover:[^"'\s]*(?:translate|scale)|group-hover:[^"'\s]*scale/);
  assert.doesNotMatch(card, /\btransform\b|translate-[xy]|scale-\[/);
  assert.doesNotMatch(gallery, /hover:[^"'\s]*(?:translate|scale)/);
  assert.match(card, /className="block h-full w-full object-cover"/);
  assert.match(card, /transition-\[border-color,background-color,box-shadow\]/);
  assert.match(card, /hover:border-indigo-400\/30/);
  assert.match(card, /hover:shadow-indigo-950\/25/);
  assert.match(card, /focus-within:ring-2/);
  assert.match(card, /motion-reduce:transition-none/);
});
