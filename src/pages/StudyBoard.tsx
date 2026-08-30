import {useCallback, useEffect, useRef, useState} from 'react';
import {LayoutGrid, RefreshCw} from 'lucide-react';

import {
  fetchBoard,
  isGifSlotObject,
  isPhotoFrameObject,
  isStickyNoteObject,
  moveBoardObject,
  removeBoardObject,
  updateStickyNote,
  uploadPhotoFrameImage,
} from '../api/board';
import {hydrateGiphyIds, selectBoardGif} from '../api/giphy';
import {ApiError} from '../api/productData';
import {useAuth} from '../auth/AuthProvider';
import StudyBoardCanvas from '../components/StudyBoardCanvas';
import type {BoardItemSaveState} from '../components/BoardItem';
import GifPicker from '../components/GifPicker';
import StickyNoteEditor from '../components/StickyNoteEditor';
import PhotoFrameUploader from '../components/PhotoFrameUploader';
import type {BoardGif, BoardObject, BoardPosition, ResolvedBoardGif} from '../types';

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = {...record};
  delete next[key];
  return next;
}

function mergeHydratedGifs(
  items: BoardObject[],
  hydrated: ReadonlyMap<string, BoardGif>,
  targetIds?: ReadonlySet<string>,
): BoardObject[] {
  return items.map((item) => {
    if (!isGifSlotObject(item)
      || !item.gif
      || (targetIds && !targetIds.has(item.gif.giphyId))) {
      return item;
    }
    const current = hydrated.get(item.gif.giphyId);
    return {
      ...item,
      gif: current ?? {
        ...item.gif,
        title: item.gif.title || 'GIF',
        media: null,
        hydrationState: 'unavailable',
      },
    };
  });
}

export default function StudyBoard() {
  const {refresh} = useAuth();
  const [items, setItems] = useState<BoardObject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, BoardItemSaveState>>({});
  const [requestVersion, setRequestVersion] = useState(0);
  const [editingOwnedItemId, setEditingOwnedItemId] = useState<string | null>(null);
  const [editingGifOwnedItemId, setEditingGifOwnedItemId] = useState<string | null>(null);
  const [editingPhotoOwnedItemId, setEditingPhotoOwnedItemId] = useState<string | null>(null);
  const confirmedPositionsRef = useRef(new Map<string, BoardPosition>());
  const pendingPositionsRef = useRef(new Map<string, BoardPosition>());
  const savingIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadFailed(false);
    setActionError(null);
    fetchBoard(controller.signal)
      .then((board) => {
        setItems(board.items);
        confirmedPositionsRef.current = new Map(
          board.items.map((item) => [item.boardObjectId, {x: item.x, y: item.y}]),
        );
        pendingPositionsRef.current.clear();
        savingIdsRef.current.clear();
        setSaveStates({});

        const giphyIds = board.items.flatMap((item) => isGifSlotObject(item) && item.gif
          ? [item.gif.giphyId]
          : []);
        if (giphyIds.length > 0) {
          const requestedIds = new Set(giphyIds);
          void hydrateGiphyIds(giphyIds, controller.signal)
            .then((hydrated) => {
              if (!controller.signal.aborted) {
                setItems((currentItems) => mergeHydratedGifs(
                  currentItems,
                  hydrated,
                  requestedIds,
                ));
              }
            })
            .catch(() => {
              if (!controller.signal.aborted) {
                setItems((currentItems) => mergeHydratedGifs(
                  currentItems,
                  new Map(),
                  requestedIds,
                ));
              }
            });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          void refresh();
          return;
        }
        setLoadFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });
    return () => controller.abort();
  }, [refresh, requestVersion]);

  const updateLocalPosition = useCallback((boardObjectId: string, position: BoardPosition) => {
    setItems((currentItems) => currentItems.map((item) => (
      item.boardObjectId === boardObjectId ? {...item, ...position} : item
    )));
  }, []);

  const flushPosition = useCallback(async (boardObjectId: string) => {
    if (savingIdsRef.current.has(boardObjectId)) {
      return;
    }
    savingIdsRef.current.add(boardObjectId);
    setSaveStates((current) => ({...current, [boardObjectId]: 'saving'}));
    let failed = false;

    try {
      while (pendingPositionsRef.current.has(boardObjectId)) {
        const position = pendingPositionsRef.current.get(boardObjectId);
        if (!position) {
          break;
        }
        pendingPositionsRef.current.delete(boardObjectId);
        try {
          const savedPosition = await moveBoardObject(boardObjectId, position);
          confirmedPositionsRef.current.set(boardObjectId, {x: savedPosition.x, y: savedPosition.y});
          if (!pendingPositionsRef.current.has(boardObjectId) && mountedRef.current) {
            setItems((currentItems) => currentItems.map((item) => (
              item.boardObjectId === boardObjectId ? {...item, ...savedPosition} : item
            )));
          }
        } catch (error) {
          if (pendingPositionsRef.current.has(boardObjectId)) {
            continue;
          }
          pendingPositionsRef.current.set(boardObjectId, position);
          failed = true;
          if (mountedRef.current) {
            setSaveStates((current) => ({...current, [boardObjectId]: 'error'}));
          }
          if (error instanceof ApiError && error.status === 401) {
            void refresh();
          }
          break;
        }
      }
      if (!failed && mountedRef.current) {
        setSaveStates((current) => withoutKey(current, boardObjectId));
      }
    } finally {
      savingIdsRef.current.delete(boardObjectId);
    }
  }, [refresh]);

  const handlePositionCommit = useCallback((boardObjectId: string, position: BoardPosition) => {
    pendingPositionsRef.current.set(boardObjectId, position);
    void flushPosition(boardObjectId);
  }, [flushPosition]);

  const handleRetry = useCallback((boardObjectId: string) => {
    if (pendingPositionsRef.current.has(boardObjectId)) {
      void flushPosition(boardObjectId);
    }
  }, [flushPosition]);

  const handleRollback = useCallback((boardObjectId: string) => {
    pendingPositionsRef.current.delete(boardObjectId);
    const confirmed = confirmedPositionsRef.current.get(boardObjectId);
    if (confirmed) {
      updateLocalPosition(boardObjectId, confirmed);
    }
    setSaveStates((current) => withoutKey(current, boardObjectId));
  }, [updateLocalPosition]);

  const handleRemove = useCallback(async (boardObjectId: string) => {
    if (savingIdsRef.current.has(boardObjectId)) {
      return;
    }
    setActionError(null);
    setSaveStates((current) => ({...current, [boardObjectId]: 'removing'}));
    try {
      await removeBoardObject(boardObjectId);
      pendingPositionsRef.current.delete(boardObjectId);
      confirmedPositionsRef.current.delete(boardObjectId);
      if (mountedRef.current) {
        setItems((currentItems) => currentItems.filter((item) => item.boardObjectId !== boardObjectId));
        setSaveStates((current) => withoutKey(current, boardObjectId));
      }
    } catch (error) {
      if (mountedRef.current) {
        setSaveStates((current) => withoutKey(current, boardObjectId));
        setActionError('That item could not be removed. Please try again.');
      }
      if (error instanceof ApiError && error.status === 401) {
        void refresh();
      }
    }
  }, [refresh]);

  const editingNote = items.find((item) => (
    isStickyNoteObject(item) && item.ownedItemId === editingOwnedItemId
  ));
  const editingGifSlot = items.find((item) => (
    isGifSlotObject(item) && item.ownedItemId === editingGifOwnedItemId
  ));
  const editingPhotoFrame = items.find((item) => (
    isPhotoFrameObject(item) && item.ownedItemId === editingPhotoOwnedItemId
  ));

  const handleSaveStickyNote = useCallback(async (ownedItemId: string, body: string) => {
    try {
      const saved = await updateStickyNote(ownedItemId, body);
      if (mountedRef.current) {
        setItems((currentItems) => currentItems.map((item) => (
          isStickyNoteObject(item) && item.ownedItemId === saved.ownedItemId
            ? {...item, body: saved.body}
            : item
        )));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        void refresh();
      }
      throw error;
    }
  }, [refresh]);

  const handleSaveGif = useCallback(async (
    ownedItemId: string,
    gif: ResolvedBoardGif,
  ): Promise<void> => {
    try {
      const saved = await selectBoardGif(ownedItemId, gif.giphyId);
      if (mountedRef.current) {
        setItems((currentItems) => currentItems.map((item) => (
          isGifSlotObject(item) && item.ownedItemId === saved.ownedItemId
            ? {...item, gif}
            : item
        )));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        void refresh();
      }
      throw error;
    }
  }, [refresh]);

  const handleRetryGif = useCallback(async (ownedItemId: string) => {
    const slot = items.find((item) => isGifSlotObject(item)
      && item.ownedItemId === ownedItemId
      && item.gif);
    if (!slot || !isGifSlotObject(slot) || !slot.gif) {
      return;
    }
    const {giphyId} = slot.gif;
    setItems((currentItems) => currentItems.map((item) => isGifSlotObject(item)
      && item.ownedItemId === ownedItemId
      && item.gif
      ? {...item, gif: {...item.gif, hydrationState: 'loading'}}
      : item));
    try {
      const hydrated = await hydrateGiphyIds([giphyId]);
      if (mountedRef.current) {
        setItems((currentItems) => currentItems.map((item) => isGifSlotObject(item)
          && item.ownedItemId === ownedItemId
          && item.gif?.giphyId === giphyId
          ? mergeHydratedGifs([item], hydrated, new Set([giphyId]))[0]
          : item));
      }
    } catch {
      if (mountedRef.current) {
        setItems((currentItems) => currentItems.map((item) => isGifSlotObject(item)
          && item.ownedItemId === ownedItemId
          && item.gif?.giphyId === giphyId
          ? mergeHydratedGifs([item], new Map(), new Set([giphyId]))[0]
          : item));
      }
    }
  }, [items]);

  const handleSavePhoto = useCallback(async (
    ownedItemId: string,
    file: File,
    expectedRevision: string,
  ): Promise<void> => {
    try {
      const saved = await uploadPhotoFrameImage(ownedItemId, file, expectedRevision);
      if (mountedRef.current) {
        setItems((currentItems) => currentItems.map((item) => (
          isPhotoFrameObject(item) && item.ownedItemId === saved.ownedItemId
            ? {...item, photo: saved.photo}
            : item
        )));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        void refresh();
      }
      throw error;
    }
  }, [refresh]);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-[#18181b] text-indigo-400">
            <LayoutGrid className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-50">Study Board</h1>
            <p className="text-sm text-slate-400">Arrange earned rewards and purchased objects on your personal study wall.</p>
          </div>
        </div>
        {!isLoading && !loadFailed && (
          <span className="self-start rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs font-semibold text-slate-400 sm:self-auto">
            {items.length} / 100 placed
          </span>
        )}
      </div>

      {actionError && (
        <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {loadFailed ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-2xl border border-slate-800 bg-[#18181b] text-slate-400">
          <p>We could not load your Study Board.</p>
          <button
            type="button"
            onClick={() => setRequestVersion((version) => version + 1)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-800 bg-[#18181b] text-slate-400">
          Loading your Study Board…
        </div>
      ) : (
        <StudyBoardCanvas
          items={items}
          saveStates={saveStates}
          onPositionChange={updateLocalPosition}
          onPositionCommit={handlePositionCommit}
          onRemove={(boardObjectId) => void handleRemove(boardObjectId)}
          onRetry={handleRetry}
          onRollback={handleRollback}
          onEditStickyNote={setEditingOwnedItemId}
          onEditGif={setEditingGifOwnedItemId}
          onRetryGif={(ownedItemId) => void handleRetryGif(ownedItemId)}
          onEditPhoto={setEditingPhotoOwnedItemId}
        />
      )}

      {editingNote && (
        <StickyNoteEditor
          note={editingNote}
          onClose={() => setEditingOwnedItemId(null)}
          onSave={(body) => handleSaveStickyNote(editingNote.ownedItemId, body)}
        />
      )}

      {editingGifSlot && isGifSlotObject(editingGifSlot) && (
        <GifPicker
          slot={editingGifSlot}
          onClose={() => setEditingGifOwnedItemId(null)}
          onSave={(gif) => handleSaveGif(editingGifSlot.ownedItemId, gif)}
        />
      )}

      {editingPhotoFrame && isPhotoFrameObject(editingPhotoFrame) && (
        <PhotoFrameUploader
          frame={editingPhotoFrame}
          onClose={() => setEditingPhotoOwnedItemId(null)}
          onSave={(file, expectedRevision) => handleSavePhoto(
            editingPhotoFrame.ownedItemId,
            file,
            expectedRevision,
          )}
        />
      )}

      {!isLoading && !loadFailed && (
        <p className="text-center text-xs text-slate-500">
          Drag an item to move it. Its normalized position is saved when you release it.
        </p>
      )}
    </div>
  );
}
