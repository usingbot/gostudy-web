export const MAX_STICKY_NOTE_WORDS = 250;
export const MAX_STICKY_NOTE_CHARACTERS = 2000;

export function countStickyNoteWords(body: string): number {
  const trimmed = body.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

export function countStickyNoteCharacters(body: string): number {
  return Array.from(body).length;
}

export function clampStickyNoteCharacters(body: string): string {
  const characters = Array.from(body);
  return characters.length <= MAX_STICKY_NOTE_CHARACTERS
    ? body
    : characters.slice(0, MAX_STICKY_NOTE_CHARACTERS).join('');
}
