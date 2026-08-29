import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('picker is an accessible modal with conspicuous GIPHY attribution', async () => {
  const picker = await readFile('src/components/GifPicker.tsx', 'utf8');
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /aria-modal="true"/);
  assert.match(picker, /aria-labelledby="gif-picker-title"/);
  assert.match(picker, /Powered by GIPHY/);
  assert.match(picker, /event\.key === 'Escape'/);
});

test('picker searches GIPHY directly without caching and previews still renditions', async () => {
  const [picker, api] = await Promise.all([
    readFile('src/components/GifPicker.tsx', 'utf8'),
    readFile('src/api/giphy.ts', 'utf8'),
  ]);
  assert.match(picker, /searchGiphy\(searchQuery, offset, controller\.signal\)/);
  assert.match(picker, /gif\.media\.previewUrl/);
  assert.match(picker, /src=\{gif\.media\.renderUrl\}/);
  assert.match(picker, /motion-reduce:hidden/);
  assert.match(api, /https:\/\/api\.giphy\.com\/v1\/gifs/);
  assert.match(api, /cache: 'no-store'/);
  assert.match(api, /VITE_GIPHY_API_KEY/);
  assert.doesNotMatch(`${picker}\n${api}`, /\/api\/giphy\/search|\bGIPHY_API_KEY\b/);
});

test('picker persists only the selected GIPHY ID from the browser', async () => {
  const [picker, api] = await Promise.all([
    readFile('src/components/GifPicker.tsx', 'utf8'),
    readFile('src/api/giphy.ts', 'utf8'),
  ]);
  assert.match(picker, /onSave\(selected\)/);
  assert.match(api, /JSON\.stringify\(\{giphyId\}\)/);
  assert.doesNotMatch(api, /JSON\.stringify\(\{[^}]*previewUrl|JSON\.stringify\(\{[^}]*renderUrl/);
});

test('board GIF card uses animation with a reduced-motion still fallback', async () => {
  const item = await readFile('src/components/BoardItem.tsx', 'utf8');
  assert.match(item, /<picture>/);
  assert.match(item, /prefers-reduced-motion: reduce/);
  assert.match(item, /srcSet=\{item\.gif\.media\.previewUrl\}/);
  assert.match(item, /src=\{item\.gif\.media\.renderUrl\}/);
  assert.match(item, /alt=\{item\.gif\.title\}/);
  assert.match(item, /Animation paused/);
  assert.match(item, /motion-reduce:hidden/);
});

test('configured GIF identity has a graceful unavailable-media state', async () => {
  const item = await readFile('src/components/BoardItem.tsx', 'utf8');
  assert.match(item, /item\.gif\.hydrationState === 'loading'/);
  assert.match(item, /Loading GIF/);
  assert.match(item, /GIF unavailable/);
  assert.match(item, /onRetryGif\(item\.ownedItemId\)/);
  assert.match(item, /> Retry/);
});

test('empty and configured GIF Slots expose Choose and Change controls', async () => {
  const item = await readFile('src/components/BoardItem.tsx', 'utf8');
  assert.match(item, /item\.gif \? 'Change' : 'Choose'/);
  assert.match(item, /Choose GIF/);
  assert.match(item, /onEditGif\(item\.ownedItemId\)/);
});

test('saved GIF selection updates the matching slot without altering its placement', async () => {
  const board = await readFile('src/pages/StudyBoard.tsx', 'utf8');
  assert.match(board, /selectBoardGif\(ownedItemId, gif\.giphyId\)/);
  assert.match(board, /item\.ownedItemId === saved\.ownedItemId/);
  assert.match(board, /\{\.\.\.item, gif\}/);
  assert.doesNotMatch(board, /chalk|purchaseBoardShopItem/i);
});

test('board hydration is browser-direct, batched, loading-aware, and retryable', async () => {
  const [board, api] = await Promise.all([
    readFile('src/pages/StudyBoard.tsx', 'utf8'),
    readFile('src/api/giphy.ts', 'utf8'),
  ]);
  assert.match(board, /hydrateGiphyIds\(giphyIds, controller\.signal\)/);
  assert.match(board, /hydrateGiphyIds\(\[giphyId\]\)/);
  assert.match(board, /hydrationState: 'loading'/);
  assert.match(board, /hydrationState: 'unavailable'/);
  assert.match(api, /readClient\(client\)\.gifs\(canonicalIds, signal\)/);
  assert.doesNotMatch(
    `${board}\n${api}`,
    /fetch\([^)]*['"]\/api\/giphy|['"]\/api\/board\/giphy-metadata/,
  );
});

test('removing a GIF card uses only generic placement removal', async () => {
  const [board, item] = await Promise.all([
    readFile('src/pages/StudyBoard.tsx', 'utf8'),
    readFile('src/components/BoardItem.tsx', 'utf8'),
  ]);
  assert.match(board, /removeBoardObject\(boardObjectId\)/);
  assert.match(item, /onRemove\(item\.boardObjectId\)/);
  assert.doesNotMatch(`${board}\n${item}`, /deleteBoardGif|DELETE[^\n]*gifs/i);
});

test('GIF UI has no arbitrary URL input or HTML injection path', async () => {
  const sources = await Promise.all([
    readFile('src/components/GifPicker.tsx', 'utf8'),
    readFile('src/components/BoardItem.tsx', 'utf8'),
    readFile('src/pages/StudyBoard.tsx', 'utf8'),
  ]);
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /dangerouslySetInnerHTML|contentEditable|type="url"|<iframe|<embed/);
});

test('Inventory makes GIF Slot placeable while Photo Frame remains pending', async () => {
  const inventory = await readFile('src/pages/Inventory.tsx', 'utf8');
  assert.match(inventory, /item\.itemType !== 'gif'/);
  assert.match(inventory, /item\.itemType === 'gif'/);
  assert.match(inventory, /Photo Frame support coming next/);
});

test('server CSP permits direct browser GIPHY API and media loads without proxy routes', async () => {
  const [app, api] = await Promise.all([
    readFile('server/app.ts', 'utf8'),
    readFile('src/api/giphy.ts', 'utf8'),
  ]);
  assert.match(app, /imgSrc:[\s\S]*'https:\/\/\*\.giphy\.com'/);
  assert.match(app, /connectSrc: \["'self'", 'https:\/\/api\.giphy\.com'\]/);
  assert.doesNotMatch(app, /app\.(?:get|post|put|patch)\(['"]\/api\/giphy/);
  assert.doesNotMatch(api, /fetch\(['"]\/api\/giphy/);
});

test('environment documents a dedicated browser-visible Web key and no server GIPHY secret', async () => {
  const [example, config] = await Promise.all([
    readFile('.env.example', 'utf8'),
    readFile('server/config.ts', 'utf8'),
  ]);
  assert.match(example, /browser-visible by design/);
  assert.match(example, /VITE_GIPHY_API_KEY=replace-with-dedicated-web-giphy-api-key/);
  assert.doesNotMatch(example, /^GIPHY_API_KEY=/m);
  assert.doesNotMatch(config, /GIPHY_API_KEY|giphyApiKey/);
});
