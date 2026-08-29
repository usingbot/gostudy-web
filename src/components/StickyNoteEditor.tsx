import {useEffect, useState, type FormEvent} from 'react';
import {LoaderCircle, Save, X} from 'lucide-react';

import {
  clampStickyNoteCharacters,
  countStickyNoteCharacters,
  countStickyNoteWords,
  MAX_STICKY_NOTE_CHARACTERS,
  MAX_STICKY_NOTE_WORDS,
} from '../sticky-note';
import type {ShopBoardObject} from '../types';

interface StickyNoteEditorProps {
  note: ShopBoardObject;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
}

export default function StickyNoteEditor({note, onClose, onSave}: StickyNoteEditorProps) {
  const [body, setBody] = useState(note.body ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const wordCount = countStickyNoteWords(body);
  const characterCount = countStickyNoteCharacters(body);
  const overWordLimit = wordCount > MAX_STICKY_NOTE_WORDS;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, onClose]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving || overWordLimit) {
      return;
    }
    setIsSaving(true);
    setSaveError(false);
    try {
      await onSave(body);
      setIsSaving(false);
      onClose();
      return;
    } catch {
      setSaveError(true);
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sticky-note-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-lg rounded-2xl border border-amber-300/25 bg-[#18181b] p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="sticky-note-editor-title" className="text-lg font-bold text-slate-50">Edit Sticky Note</h2>
            <p className="mt-1 text-xs text-slate-500">Plain text only. Empty notes are allowed.</p>
          </div>
          <button
            type="button"
            aria-label="Close Sticky Note editor"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:cursor-wait"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          autoFocus
          value={body}
          onChange={(event) => setBody(clampStickyNoteCharacters(event.target.value))}
          rows={10}
          aria-describedby="sticky-note-limits"
          className="mt-5 w-full resize-y rounded-xl border border-amber-300/30 bg-[#f3dc82] p-4 text-sm leading-relaxed text-slate-950 outline-none placeholder:text-amber-950/45 focus:border-amber-200 focus:ring-2 focus:ring-amber-300/20"
          placeholder="Write your study note…"
        />

        <div id="sticky-note-limits" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={overWordLimit ? 'font-semibold text-red-300' : 'text-slate-400'}>
            {wordCount} / {MAX_STICKY_NOTE_WORDS} words
          </span>
          <span className="text-slate-500">
            {characterCount} / {MAX_STICKY_NOTE_CHARACTERS} characters
          </span>
        </div>

        {saveError && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            The note could not be saved. Your draft is still here; please try again.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:cursor-wait"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || overWordLimit}
            className="flex items-center gap-2 rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </form>
    </div>
  );
}
