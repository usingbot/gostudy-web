import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampStickyNoteCharacters,
  countStickyNoteCharacters,
  countStickyNoteWords,
  MAX_STICKY_NOTE_CHARACTERS,
} from './sticky-note.js';

test('Sticky Note UI counts whitespace-delimited words and Unicode characters consistently', () => {
  assert.equal(countStickyNoteWords(''), 0);
  assert.equal(countStickyNoteWords('  one\n two\tthree  '), 3);
  assert.equal(countStickyNoteWords(Array.from({length: 250}, () => 'word').join(' ')), 250);
  assert.equal(countStickyNoteWords(Array.from({length: 251}, () => 'word').join(' ')), 251);
  assert.equal(countStickyNoteCharacters('A😀B'), 3);
});

test('Sticky Note UI clamps pasted text at exactly 2000 Unicode characters', () => {
  assert.equal(clampStickyNoteCharacters('x'.repeat(MAX_STICKY_NOTE_CHARACTERS)).length, 2000);
  assert.equal(clampStickyNoteCharacters('x'.repeat(MAX_STICKY_NOTE_CHARACTERS + 1)).length, 2000);
  assert.equal(countStickyNoteCharacters(clampStickyNoteCharacters('😀'.repeat(2001))), 2000);
});
