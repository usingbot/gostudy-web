import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  GuildBoardGestureCommitGuard,
  GuildBoardMutationQueue,
} from '../src/guild-board-interactions.js';
import {
  calculateGuildBoardFit,
  GUILD_BOARD_DESKTOP_FIT_MARGIN,
  GUILD_BOARD_MAX_ZOOM,
  GUILD_BOARD_MIN_ZOOM,
  GUILD_BOARD_MOBILE_FIT_MARGIN,
  snapGuildBoardCssRect,
} from '../src/guild-board-viewport.js';

test('board Fit uses the inner viewport, preserves aspect ratio, and centers with a bounded margin', () => {
  const fit = calculateGuildBoardFit({
    viewportWidth: 1120,
    viewportHeight: 680,
    boardWidth: 300,
    boardHeight: 180,
  });
  assert.equal(fit.margin, GUILD_BOARD_DESKTOP_FIT_MARGIN);
  assert.ok(fit.margin >= 20 && fit.margin <= 40);
  assert.equal(fit.renderedWidth / fit.renderedHeight, 300 / 180);
  assert.equal(fit.x, (1120 - fit.renderedWidth) / 2);
  assert.equal(fit.y, (680 - fit.renderedHeight) / 2);
  assert.ok(fit.renderedWidth <= 1120 - fit.margin * 2);
  assert.ok(fit.renderedHeight <= 680 - fit.margin * 2);
});

test('board Fit uses a smaller mobile margin and manual zoom remains bounded from 30 to 200 percent', () => {
  const fit = calculateGuildBoardFit({
    viewportWidth: 390,
    viewportHeight: 288,
    boardWidth: 300,
    boardHeight: 180,
  });
  assert.equal(fit.margin, GUILD_BOARD_MOBILE_FIT_MARGIN);
  assert.equal(GUILD_BOARD_MIN_ZOOM, 0.3);
  assert.equal(GUILD_BOARD_MAX_ZOOM, 2);
});

test('board render rectangles snap every edge to integer CSS pixels', () => {
  const rect = snapGuildBoardCssRect({
    x: 31.49,
    y: 52.51,
    width: 98.26,
    height: 44.74,
  });
  assert.deepEqual(rect, {
    left: 31,
    top: 53,
    width: 99,
    height: 44,
  });
  for (const value of Object.values(rect)) {
    assert.ok(Number.isInteger(value));
  }
});

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

test('editor exposes only four fixed themes, previews real objects, and reloads optimistic conflicts', async () => {
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
  assert.match(editor, /reloadCanonicalBoard/);
  assert.match(editor, /The latest revision has been reloaded/);
  assert.match(editor, /<GuildBoardCanvas[\s\S]+theme={theme}[\s\S]+width={board\.width}[\s\S]+height={board\.height}[\s\S]+objects={board\.objects}[\s\S]+editable/);
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
  assert.doesNotMatch(`${detail}\n${canvas}`, /Be the first to pin|pin something/i);
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
  assert.match(canvasSurfaceSource(css), /background-color: var\(--board-background\)/);
});

test('Discord sticker media CSP permits exact image hosts without a Discord wildcard or connect permission', async () => {
  const app = await readFile('server/app.ts', 'utf8');
  assert.match(app, /imgSrc:[\s\S]+?'https:\/\/cdn\.discordapp\.com',[\s\S]+?'https:\/\/media\.discordapp\.net'/);
  assert.doesNotMatch(app, /https:\/\/\*\.(?:discordapp\.com|discordapp\.net|discord\.com|discord\.net)/);
  assert.match(app, /connectSrc: \["'self'", 'https:\/\/api\.giphy\.com'\]/);
  assert.doesNotMatch(app, /connectSrc:[^\n]*media\.discordapp\.net/);
});

function canvasSurfaceSource(css: string): string {
  return css.slice(css.indexOf('.guild-board-surface {'), css.indexOf('.guild-board-surface::before'));
}

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
  assert.match(canvas, /GUILD_BOARD_MIN_ZOOM/);
  assert.match(canvas, /GUILD_BOARD_MAX_ZOOM/);
  assert.match(canvas, /const MAX_OVERSCROLL = 150/);
  assert.match(canvas, /viewport\.clientWidth/);
  assert.match(canvas, /viewport\.clientHeight/);
  assert.match(canvas, /fitScale \* zoomFactor/);
  assert.match(canvas, /Fit board/);
  assert.match(canvas, /Set board zoom to 100 percent/);
  assert.match(canvas, /onPointerDown/);
  assert.match(canvas, /event\.button !== 0 && event\.button !== 1/);
  assert.match(canvas, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(canvas, /addEventListener\('wheel', handleWheel, \{passive: false\}\)/);
  assert.match(css, /touch-action: none/);
  assert.doesNotMatch(css, /\.guild-board-viewport[\s\S]{0,300}padding:\s*(?:[5-9]\d|\d{3,})px/);
  assert.doesNotMatch(canvas, /window\.(?:innerWidth|innerHeight)/);
  assert.doesNotMatch(canvas, /fetch\(|localStorage|sessionStorage|canvas|getContext/);
});

test('board artwork is laid out at final pixel size without whole-surface scaling', async () => {
  const [canvas, css] = await Promise.all([
    readFile('src/components/GuildBoardCanvas.tsx', 'utf8'),
    readFile('src/index.css', 'utf8'),
  ]);
  const surfaceStyle = canvas.slice(
    canvas.indexOf('const surfaceStyle'),
    canvas.indexOf('const emptyStateStyle'),
  );
  const objectStyle = canvas.slice(
    canvas.indexOf('const renderedGeometry'),
    canvas.indexOf('const artworkStyle'),
  );
  assert.match(surfaceStyle, /width: renderedSurface\.width/);
  assert.match(surfaceStyle, /height: renderedSurface\.height/);
  assert.match(surfaceStyle, /translate3d\(\$\{renderedPan\.x\}px, \$\{renderedPan\.y\}px, 0\)/);
  assert.doesNotMatch(surfaceStyle, /scale\(/);
  assert.match(objectStyle, /left: renderedGeometry\.left/);
  assert.match(objectStyle, /top: renderedGeometry\.top/);
  assert.match(objectStyle, /width: renderedGeometry\.width/);
  assert.match(objectStyle, /height: renderedGeometry\.height/);
  assert.doesNotMatch(objectStyle, /transform:/);
  assert.doesNotMatch(css, /image-rendering:\s*(?:pixelated|crisp-edges)/);
});

test('own-guild picker has Emoji and Stickers tabs, search, viewport-centered placement, and no quota or cross-server UI', async () => {
  const editor = await readFile('src/pages/GuildBoardEditor.tsx', 'utf8');
  assert.match(editor, /fetchAdminGuildBoardAssets/);
  assert.match(editor, /role="tab"[\s\S]+Emoji/);
  assert.match(editor, /role="tab"[\s\S]+Stickers/);
  assert.match(editor, /type="search"/);
  assert.match(editor, /asset\.name\.toLocaleLowerCase\(\)\.includes/);
  assert.match(editor, /canvasRef\.current\?\.getVisibleCenter\(\)/);
  assert.match(editor, /const DEFAULT_DECORATION_SIZE = 180/);
  assert.match(editor, /state\.board\.width - DEFAULT_DECORATION_SIZE/);
  assert.match(editor, /state\.board\.height - DEFAULT_DECORATION_SIZE/);
  assert.match(editor, /PNG, APNG, and GIF stickers are supported/);
  assert.match(editor, /Lottie stickers are excluded/);
  assert.doesNotMatch(editor, /server sidebar|other servers|cross-server|max_objects|object quota|\d+\s*\/\s*150|vitality|decay/i);
});

test('editor interactions preview locally and persist once at gesture completion', async () => {
  const [canvas, editor] = await Promise.all([
    readFile('src/components/GuildBoardCanvas.tsx', 'utf8'),
    readFile('src/pages/GuildBoardEditor.tsx', 'utf8'),
  ]);
  const pointerMove = canvas.slice(
    canvas.indexOf('const handleObjectPointerMove'),
    canvas.indexOf('const settleObjectInteraction'),
  );
  const pointerFinish = canvas.slice(
    canvas.indexOf('const settleObjectInteraction'),
    canvas.indexOf('const sortedObjects'),
  );
  assert.match(pointerMove, /setDraft\(next\)/);
  assert.doesNotMatch(pointerMove, /onTransform|fetch|Promise/);
  assert.match(pointerFinish, /gestureCommitGuardRef\.current\.settle/);
  assert.match(pointerFinish, /const changed =/);
  assert.match(pointerFinish, /onTransform\?\.\(finalDraft\.id/);
  assert.equal((pointerFinish.match(/onTransform\?\.\(/g) ?? []).length, 1);
  assert.match(canvas, /onPointerUp={\(event\) => settleObjectInteraction\(event, true\)}/);
  assert.match(canvas, /onPointerCancel={\(event\) => settleObjectInteraction\(event, false\)}/);
  assert.match(canvas, /onLostPointerCapture={\(event\) => settleObjectInteraction\(event, false\)}/);
  assert.match(canvas, /mode: 'move' \| 'resize' \| 'rotate'/);
  assert.match(canvas, /MIN_OBJECT_SIZE/);
  assert.match(canvas, /MAX_OBJECT_SIZE/);
  assert.match(canvas, /normalizeRotation/);
  assert.match(canvas, /Send decoration to back/);
  assert.match(canvas, /Bring decoration to front/);
  assert.match(canvas, /Delete decoration/);
  assert.match(canvas, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/);
  assert.match(canvas, /event\.key === 'Escape'/);
  assert.match(editor, /updateAdminGuildBoardObject/);
  assert.match(editor, /reorderAdminGuildBoardObject/);
  assert.match(editor, /deleteAdminGuildBoardObject/);
  assert.match(editor, /GuildBoardMutationQueue/);
  assert.match(editor, /'transform',\s*objectId/);
});

test('gesture completion guard persists move, resize, and rotate at most once while cancel and unchanged geometry submit nothing', async () => {
  for (const mode of ['move', 'resize', 'rotate']) {
    const guard = new GuildBoardGestureCommitGuard();
    const gestureId = guard.begin();
    let calls = 0;
    const first = guard.settle(gestureId, true, () => { calls += 1; });
    const replay = guard.settle(gestureId, true, () => { calls += 1; });
    assert.ok(first, `${mode} should persist its completed gesture`);
    assert.equal(replay, null, `${mode} must ignore pointer or StrictMode replay`);
    await first;
    assert.equal(calls, 1);
  }

  const guard = new GuildBoardGestureCommitGuard();
  let skippedCalls = 0;
  const canceledGesture = guard.begin();
  assert.equal(guard.settle(canceledGesture, false, () => { skippedCalls += 1; }), null);
  const unchangedGesture = guard.begin();
  assert.equal(guard.settle(unchangedGesture, false, () => { skippedCalls += 1; }), null);
  assert.equal(skippedCalls, 0);
});

test('mutation queue serializes revisions and coalesces pending transforms to latest geometry', async () => {
  type Snapshot = {revision: number; x: number};
  const results: Snapshot[] = [];
  const calls: number[] = [];
  let active = 0;
  let maximumActive = 0;
  let releaseFirst: (() => void) | null = null;
  const queue = new GuildBoardMutationQueue<Snapshot>({
    onBusyChange: () => undefined,
    onResult: (value) => results.push(value),
    onError: async () => null,
  });
  queue.setCurrent({revision: 0, x: 0});

  const transform = (x: number) => ({
    kind: 'transform' as const,
    coalesceKey: '42',
    run: async (current: Snapshot) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(x);
      if (x === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      active -= 1;
      return {revision: current.revision + 1, x};
    },
  });

  const first = queue.enqueue(transform(1));
  const superseded = queue.enqueue(transform(2));
  const latest = queue.enqueue(transform(3));
  assert.deepEqual(calls, [1]);
  assert.ok(releaseFirst);
  (releaseFirst as () => void)();
  await Promise.all([first, superseded, latest]);

  assert.deepEqual(calls, [1, 3]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(results, [
    {revision: 1, x: 1},
    {revision: 2, x: 3},
  ]);
});

test('failed mutation is reconciled once, never auto-retried, and later work uses canonical revision', async () => {
  type Snapshot = {revision: number};
  let failedCalls = 0;
  let laterRevision = -1;
  let reconciliationCalls = 0;
  let successfulSaves = 0;
  const queue = new GuildBoardMutationQueue<Snapshot>({
    onBusyChange: () => undefined,
    onResult: () => undefined,
    onSuccess: () => { successfulSaves += 1; },
    onError: async () => {
      reconciliationCalls += 1;
      return {revision: 9};
    },
  });
  queue.setCurrent({revision: 0});
  const failed = queue.enqueue({
    kind: 'transform',
    coalesceKey: '42',
    run: async () => {
      failedCalls += 1;
      throw new Error('rate limited');
    },
  });
  const discarded = queue.enqueue({
    kind: 'transform',
    coalesceKey: '42',
    run: async () => {
      failedCalls += 1;
      return {revision: 2};
    },
  });
  await Promise.all([failed, discarded]);
  assert.equal(failedCalls, 1);
  assert.equal(reconciliationCalls, 1);
  assert.equal(successfulSaves, 0);

  await queue.enqueue({
    kind: 'mutation',
    run: async (current) => {
      laterRevision = current.revision;
      return {revision: current.revision + 1};
    },
  });
  assert.equal(laterRevision, 9);
  assert.equal(successfulSaves, 1);
});

test('editor handles 429 distinctly, refetches canonical state, respects Retry-After, and shows cooldown feedback', async () => {
  const editor = await readFile('src/pages/GuildBoardEditor.tsx', 'utf8');
  assert.match(editor, /error\.status === 429/);
  assert.match(editor, /error\.code === 'RATE_LIMITED'/);
  assert.match(editor, /beginRateLimitCooldown\(error\.retryAfterSeconds\)/);
  assert.match(editor, /await fetchAdminGuildBoard\(guildid\)/);
  assert.match(editor, /temporarily rate-limited/);
  assert.match(editor, /interactionDisabled={rateLimitCooldown \|\| saving \|\| savingCapacity}/);
});

test('all four object mutation routes use only the interaction limiter while sensitive board settings stay strict', async () => {
  const app = await readFile('server/app.ts', 'utf8');
  for (const route of [
    '/api/admin/servers/:guildid/board/objects',
    '/api/admin/servers/:guildid/board/objects/:objectid/transform',
    '/api/admin/servers/:guildid/board/objects/:objectid/layer',
    '/api/admin/servers/:guildid/board/objects/:objectid',
  ]) {
    const start = app.indexOf(`'${route}'`);
    assert.notEqual(start, -1);
    const middleware = app.slice(start, app.indexOf('asyncHandler', start));
    assert.match(middleware, /guildBoardInteractionRateLimiter/);
    assert.doesNotMatch(middleware, /adminMutationRateLimiter/);
  }
  for (const route of [
    '/api/admin/servers/:guildid/board/theme',
    '/api/admin/servers/:guildid/board/capacity',
  ]) {
    const start = app.indexOf(`'${route}'`);
    const middleware = app.slice(start, app.indexOf('asyncHandler', start));
    assert.match(middleware, /adminMutationRateLimiter/);
    assert.doesNotMatch(middleware, /guildBoardInteractionRateLimiter/);
  }
});

test('public decorations are artwork-only while selection controls are editor-only and transient', async () => {
  const [canvas, css, detail] = await Promise.all([
    readFile('src/components/GuildBoardCanvas.tsx', 'utf8'),
    readFile('src/index.css', 'utf8'),
    readFile('src/pages/PublicServerDetail.tsx', 'utf8'),
  ]);
  assert.match(canvas, /className="guild-board-object-artwork"/);
  assert.match(canvas, /<img[\s\S]+alt=""[\s\S]+draggable={false}/);
  assert.match(css, /image-rendering: auto/);
  assert.doesNotMatch(css, /filter: drop-shadow/);
  assert.match(canvas, /renderableObjectCount === 0/);
  assert.match(canvas, /selected && \(/);
  assert.match(canvas, /editable && selectedObjectId/);
  assert.match(detail, /objects={board\.objects}/);
  assert.doesNotMatch(detail, /editable|onTransform|onLayer|onDelete/);
  const normalObjectCss = css.slice(
    css.indexOf('.guild-board-object {'),
    css.indexOf('.guild-board-shell.is-editable .guild-board-object'),
  );
  assert.match(normalObjectCss, /border: 0/);
  assert.match(normalObjectCss, /background: transparent/);
  assert.doesNotMatch(normalObjectCss, /box-shadow|padding/);
});
