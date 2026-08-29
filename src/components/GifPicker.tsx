import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Check, LoaderCircle, Search, X} from 'lucide-react';

import {isCanonicalGiphyId, searchGiphy} from '../api/giphy';
import {ApiError} from '../api/productData';
import type {BoardGif, ResolvedBoardGif, ShopBoardObject} from '../types';

interface GifPickerProps {
  slot: ShopBoardObject & {itemType: 'gif'};
  onClose: () => void;
  onSave: (gif: ResolvedBoardGif) => Promise<void>;
}

export default function GifPicker({slot, onClose, onSave}: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [results, setResults] = useState<BoardGif[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<ResolvedBoardGif | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      requestRef.current?.abort();
    };
  }, [isSaving, onClose]);

  const runSearch = async (searchQuery: string, offset: number, append: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsSearching(true);
    setError(null);
    try {
      const page = await searchGiphy(searchQuery, offset, controller.signal);
      setResults((current) => append ? [...current, ...page.items] : page.items);
      setNextOffset(page.nextOffset);
      setSearchedQuery(searchQuery);
      if (!append) {
        setSelected(null);
      }
    } catch (searchError) {
      if (controller.signal.aborted) {
        return;
      }
      setError(searchError instanceof ApiError && searchError.status === 401
        ? 'Your session expired. Refresh and sign in again.'
        : 'GIPHY search is unavailable right now. Please try again.');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsSearching(false);
      }
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError('Enter a word or phrase to search.');
      return;
    }
    void runSearch(trimmedQuery, 0, false);
  };

  const handleSave = async () => {
    if (!selected || isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(selected);
      onClose();
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        setError('Your session expired. Refresh and sign in again.');
      } else {
        setError('The GIF could not be saved. Your current selection was not changed.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="gif-picker-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-indigo-400/25 bg-[#111118] shadow-2xl shadow-black/60"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id="gif-picker-title" className="text-lg font-bold text-slate-50">
              {slot.gif ? 'Change GIF' : 'Choose a GIF'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">Search GIPHY directly, preview, then save its ID to this slot.</p>
          </div>
          <button
            type="button"
            aria-label="Close GIF picker"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex gap-2 border-b border-slate-800 p-4">
          <label className="relative flex-1">
            <span className="sr-only">Search GIPHY</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              maxLength={50}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search for focus, celebration, cats…"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-400"
            />
          </label>
          <button
            type="submit"
            disabled={isSearching || isSaving}
            className="flex min-w-24 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-50"
          >
            {isSearching && results.length === 0
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <Search className="h-4 w-4" />}
            Search
          </button>
        </form>

        <div className="min-h-48 flex-1 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}
          {results.length === 0 && !isSearching ? (
            <div className="flex min-h-52 flex-col items-center justify-center text-center text-slate-500">
              <Search className="mb-3 h-8 w-8 text-slate-700" />
              <p className="text-sm">{searchedQuery ? 'No GIFs matched that search.' : 'Search GIPHY to fill this slot.'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label="GIPHY search results">
              {results.map((gif, index) => {
                const isSelected = selected?.giphyId === gif.giphyId;
                const isSelectable = gif.media !== null
                  && gif.hydrationState === 'ready'
                  && isCanonicalGiphyId(gif.giphyId);
                return (
                  <button
                    key={`${gif.giphyId || 'unavailable'}:${index}`}
                    type="button"
                    aria-pressed={isSelected}
                    aria-disabled={!isSelectable}
                    onClick={() => {
                      if (isSelectable) {
                        setSelected(gif as ResolvedBoardGif);
                      }
                    }}
                    className={`relative overflow-hidden rounded-xl border bg-slate-950 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                      isSelected
                        ? 'border-indigo-400 ring-2 ring-indigo-400/40'
                        : isSelectable
                          ? 'border-slate-800 hover:border-slate-600'
                          : 'cursor-not-allowed border-slate-800 opacity-65'
                    }`}
                  >
                    <span className="block aspect-square bg-slate-900">
                      {gif.media?.previewUrl ? (
                        <picture>
                          <source
                            media="(prefers-reduced-motion: reduce)"
                            srcSet={gif.media.previewUrl}
                          />
                          <img
                            src={gif.media.previewUrl}
                            alt={gif.title}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </picture>
                      ) : gif.media ? (
                        <>
                          <img
                            src={gif.media.renderUrl}
                            alt={gif.title}
                            loading="lazy"
                            className="h-full w-full object-cover motion-reduce:hidden"
                          />
                          <span className="hidden h-full w-full items-center justify-center px-3 text-center text-[10px] font-semibold text-slate-500 motion-reduce:flex">
                            Animated preview paused
                          </span>
                        </>
                      ) : (
                        <span className="flex h-full w-full items-center justify-center px-3 text-center text-[10px] font-semibold text-slate-500">
                          This result is currently unavailable
                        </span>
                      )}
                    </span>
                    <span className="block truncate px-2 py-2 text-[11px] text-slate-400">{gif.title}</span>
                    {isSelected && (
                      <span className="absolute right-2 top-2 rounded-full bg-indigo-500 p-1 text-white shadow">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {nextOffset !== null && results.length > 0 && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => void runSearch(searchedQuery, nextOffset, true)}
                disabled={isSearching || isSaving}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:border-indigo-400/50 disabled:opacity-50"
              >
                {isSearching && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-2 self-start rounded-md bg-black px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white">
            <span className="h-3 w-1 bg-cyan-400" />
            <span className="h-3 w-1 bg-emerald-400" />
            <span className="h-3 w-1 bg-amber-400" />
            <span className="h-3 w-1 bg-fuchsia-500" />
            Powered by GIPHY
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!selected || isSaving}
              className="flex min-w-28 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Save GIF
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
