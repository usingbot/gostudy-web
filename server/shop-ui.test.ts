import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('Shop route, navigation, database catalog rendering, and current Chalk are present', async () => {
  const [app, layout, shop] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/components/Layout.tsx', 'utf8'),
    readFile('src/pages/Shop.tsx', 'utf8'),
  ]);
  assert.match(app, /path="\/shop" element={<Shop \/>}/);
  assert.match(layout, /name: 'Shop', path: '\/shop'/);
  assert.match(shop, /Board Shop/);
  assert.match(shop, /shop\?\.chalkBalance/);
  assert.match(shop, /shop\.items\.map/);
  assert.match(shop, /item\.priceChalk/);
  assert.doesNotMatch(shop, /priceChalk:\s*['"]?[1235]/);
});

test('buy flow confirms, disables duplicate submit, and retains request ID for safe retry', async () => {
  const shop = await readFile('src/pages/Shop.tsx', 'utf8');
  assert.match(shop, /Confirm purchase/);
  assert.match(shop, /crypto\.randomUUID\(\)/);
  assert.match(shop, /if \(isPurchasing\) return/);
  assert.match(shop, /disabled={isPurchasing}/);
  assert.match(shop, /attempt \? \(\) => void runPurchase\(attempt\)/);
  assert.match(shop, /Retry safely/);
  assert.match(shop, /chalkBalance: result\.chalkBalance/);
  assert.doesNotMatch(shop, /chalkBalance\s*[-+]/);
});

test('Inventory preserves reward placement and enables GIF Slots and Photo Frames', async () => {
  const inventory = await readFile('src/pages/Inventory.tsx', 'utf8');
  assert.match(inventory, /items\.map/);
  assert.match(inventory, /shopItems\.map/);
  assert.match(inventory, /Add to Board/);
  assert.match(inventory, /item\.itemType === 'gif'/);
  assert.match(inventory, /item\.itemType === 'photo_frame'/);
  assert.doesNotMatch(inventory, /Photo Frame support coming next/);
});
