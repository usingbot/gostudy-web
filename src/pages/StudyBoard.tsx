import {useCallback, useEffect, useRef, useState} from 'react';
import {LayoutGrid, RefreshCw} from 'lucide-react';

import {fetchBoard, moveBoardItem, removeBoardItem} from '../api/board';
import {ApiError} from '../api/productData';
import {useAuth} from '../auth/AuthProvider';
import StudyBoardCanvas from '../components/StudyBoardCanvas';
import type {BoardItemSaveState} from '../components/BoardItem';
import type {BoardItem, BoardPosition} from '../types';

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = {...record};
  delete next[key];
  return next;
}

export default function StudyBoard() {
  const {refresh} = useAuth();
  const [items, setItems] = useState<BoardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, BoardItemSaveState>>({});
  const [requestVersion, setRequestVersion] = useState(0);
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
          board.items.map((item) => [item.hourRewardId, {x: item.x, y: item.y}]),
        );
        pendingPositionsRef.current.clear();
        savingIdsRef.current.clear();
        setSaveStates({});
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

  const updateLocalPosition = useCallback((hourRewardId: string, position: BoardPosition) => {
    setItems((currentItems) => currentItems.map((item) => (
      item.hourRewardId === hourRewardId ? {...item, ...position} : item
    )));
  }, []);

  const flushPosition = useCallback(async (hourRewardId: string) => {
    if (savingIdsRef.current.has(hourRewardId)) {
      return;
    }
    savingIdsRef.current.add(hourRewardId);
    setSaveStates((current) => ({...current, [hourRewardId]: 'saving'}));
    let failed = false;

    try {
      while (pendingPositionsRef.current.has(hourRewardId)) {
        const position = pendingPositionsRef.current.get(hourRewardId);
        if (!position) {
          break;
        }
        pendingPositionsRef.current.delete(hourRewardId);
        try {
          const savedItem = await moveBoardItem(hourRewardId, position);
          confirmedPositionsRef.current.set(hourRewardId, {x: savedItem.x, y: savedItem.y});
          if (!pendingPositionsRef.current.has(hourRewardId) && mountedRef.current) {
            setItems((currentItems) => currentItems.map((item) => (
              item.hourRewardId === hourRewardId ? savedItem : item
            )));
          }
        } catch (error) {
          if (pendingPositionsRef.current.has(hourRewardId)) {
            continue;
          }
          pendingPositionsRef.current.set(hourRewardId, position);
          failed = true;
          if (mountedRef.current) {
            setSaveStates((current) => ({...current, [hourRewardId]: 'error'}));
          }
          if (error instanceof ApiError && error.status === 401) {
            void refresh();
          }
          break;
        }
      }
      if (!failed && mountedRef.current) {
        setSaveStates((current) => withoutKey(current, hourRewardId));
      }
    } finally {
      savingIdsRef.current.delete(hourRewardId);
    }
  }, [refresh]);

  const handlePositionCommit = useCallback((hourRewardId: string, position: BoardPosition) => {
    pendingPositionsRef.current.set(hourRewardId, position);
    void flushPosition(hourRewardId);
  }, [flushPosition]);

  const handleRetry = useCallback((hourRewardId: string) => {
    if (pendingPositionsRef.current.has(hourRewardId)) {
      void flushPosition(hourRewardId);
    }
  }, [flushPosition]);

  const handleRollback = useCallback((hourRewardId: string) => {
    pendingPositionsRef.current.delete(hourRewardId);
    const confirmed = confirmedPositionsRef.current.get(hourRewardId);
    if (confirmed) {
      updateLocalPosition(hourRewardId, confirmed);
    }
    setSaveStates((current) => withoutKey(current, hourRewardId));
  }, [updateLocalPosition]);

  const handleRemove = useCallback(async (hourRewardId: string) => {
    if (savingIdsRef.current.has(hourRewardId)) {
      return;
    }
    setActionError(null);
    setSaveStates((current) => ({...current, [hourRewardId]: 'removing'}));
    try {
      await removeBoardItem(hourRewardId);
      pendingPositionsRef.current.delete(hourRewardId);
      confirmedPositionsRef.current.delete(hourRewardId);
      if (mountedRef.current) {
        setItems((currentItems) => currentItems.filter((item) => item.hourRewardId !== hourRewardId));
        setSaveStates((current) => withoutKey(current, hourRewardId));
      }
    } catch (error) {
      if (mountedRef.current) {
        setSaveStates((current) => withoutKey(current, hourRewardId));
        setActionError('That item could not be removed. Please try again.');
      }
      if (error instanceof ApiError && error.status === 401) {
        void refresh();
      }
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
            <p className="text-sm text-slate-400">Arrange your earned rewards on a personal study wall.</p>
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
          onRemove={(hourRewardId) => void handleRemove(hourRewardId)}
          onRetry={handleRetry}
          onRollback={handleRollback}
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
