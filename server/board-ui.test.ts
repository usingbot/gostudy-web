import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('Inventory offers GIF Slot and Photo Frame placement', async () => {
  const inventory = await readFile('src/pages/Inventory.tsx', 'utf8');
  assert.match(inventory, /item\.itemType !== 'gif'/);
  assert.match(inventory, /item\.itemType === 'gif'/);
  assert.match(inventory, /addShopBoardItem\(item\.ownedItemId, position\)/);
  assert.match(inventory, /placedShopItemIds\.has\(item\.ownedItemId\)/);
  assert.match(inventory, /<Check[\s\S]*On Board/);
  assert.match(inventory, /<Plus[\s\S]*Add to Board/);
  assert.match(inventory, /item\.itemType !== 'photo_frame'/);
  assert.match(inventory, /item\.itemType === 'photo_frame'/);
  assert.doesNotMatch(inventory, /Photo Frame support coming next/);
  assert.match(inventory, /placedRewardIds/);
  assert.match(inventory, /addBoardItem\(item\.hourRewardId, position\)/);
});

test('Photo Frame board UI renders empty/configured states and secure upload controls', async () => {
  const [item, board, uploader] = await Promise.all([
    readFile('src/components/BoardItem.tsx', 'utf8'),
    readFile('src/pages/StudyBoard.tsx', 'utf8'),
    readFile('src/components/PhotoFrameUploader.tsx', 'utf8'),
  ]);
  assert.match(item, /item\.itemType === 'photo_frame'/);
  assert.match(item, /Upload photo/);
  assert.match(item, /Replace/);
  assert.match(item, /alt={`Photo in \$\{item\.displayName\}`}/);
  assert.match(item, /pointer-events-none/);
  assert.match(board, /uploadPhotoFrameImage\(ownedItemId, file, expectedRevision\)/);
  assert.match(uploader, /type="file"/);
  assert.match(uploader, /image\/jpeg,image\/png,image\/webp/);
  assert.match(uploader, /Maximum 5 MB/);
  assert.match(uploader, /Processing securely…/);
  assert.doesNotMatch(`${item}\n${board}\n${uploader}`, /dangerouslySetInnerHTML|type="url"/);
});

test('Study Board renders note text literally with an editor and no HTML injection path', async () => {
  const [boardItem, editor, studyBoard] = await Promise.all([
    readFile('src/components/BoardItem.tsx', 'utf8'),
    readFile('src/components/StickyNoteEditor.tsx', 'utf8'),
    readFile('src/pages/StudyBoard.tsx', 'utf8'),
  ]);
  assert.match(boardItem, /item\.body \|\| 'Click Edit to write a note…'/);
  assert.match(boardItem, /whitespace-pre-wrap/);
  assert.match(boardItem, /onEditStickyNote\(item\.ownedItemId\)/);
  assert.match(editor, /Plain text only\. Empty notes are allowed\./);
  assert.match(editor, /\{wordCount\} \/ \{MAX_STICKY_NOTE_WORDS\} words/);
  assert.match(editor, /clampStickyNoteCharacters/);
  assert.match(studyBoard, /updateStickyNote\(ownedItemId, body\)/);
  assert.doesNotMatch(`${boardItem}\n${editor}\n${studyBoard}`, /dangerouslySetInnerHTML|marked\(|ReactMarkdown/);
});

test('dragging is local during pointer movement and commits exactly once on release', async () => {
  const boardItem = await readFile('src/components/BoardItem.tsx', 'utf8');
  const studyBoard = await readFile('src/pages/StudyBoard.tsx', 'utf8');
  const commitCalls = boardItem.match(/onPositionCommit\(/g) ?? [];
  assert.equal(commitCalls.length, 1);
  assert.match(boardItem, /onPointerMove={handlePointerMove}/);
  assert.match(boardItem, /onPointerUp={finishDrag}/);
  assert.match(boardItem, /handlePointerMove[\s\S]*publishPosition\(position\)/);
  assert.doesNotMatch(boardItem, /moveBoardObject|fetch\(/);
  assert.match(studyBoard, /pendingPositionsRef/);
  assert.match(studyBoard, /savingIdsRef/);
  assert.match(studyBoard, /moveBoardObject\(boardObjectId, position\)/);
  assert.match(studyBoard, /setSaveStates[\s\S]*'error'/);
  assert.match(studyBoard, /handleRollback/);
});

test('reward rendering and controlled purchased decoration rendering coexist', async () => {
  const boardItem = await readFile('src/components/BoardItem.tsx', 'utf8');
  assert.match(boardItem, /item\.source === 'reward'/);
  assert.match(boardItem, /renderRewardAsset\(item\.assetKey/);
  assert.match(boardItem, /renderShopItem\(item\.itemType/);
  assert.doesNotMatch(boardItem, /https?:\/\//);
});
