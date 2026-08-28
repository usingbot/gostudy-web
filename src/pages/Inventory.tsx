import {useEffect, useState} from 'react';
import {Backpack, Check, LoaderCircle, Plus} from 'lucide-react';
import {motion} from 'motion/react';

import {addBoardItem, fetchBoard} from '../api/board';
import {ApiError, fetchInventoryPage} from '../api/productData';
import {useAuth} from '../auth/AuthProvider';
import {renderRewardAsset} from '../components/IconMap';
import type {BoardItem, BoardPosition, InventoryItem} from '../types';

const PAGE_SIZE = 20;

function formatEarnedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(new Date(value));
}

function findFirstFreePosition(boardItems: BoardItem[]): BoardPosition | null {
  if (boardItems.length >= 100) {
    return null;
  }
  const occupiedCells = new Set(boardItems.map((item) => (
    `${Math.round(item.x * 9)}:${Math.round(item.y * 9)}`
  )));
  for (let index = 0; index < 100; index += 1) {
    const column = index % 10;
    const row = Math.floor(index / 10);
    if (!occupiedCells.has(`${column}:${row}`)) {
      return {x: column / 9, y: row / 9};
    }
  }
  return null;
}

export default function Inventory() {
  const {refresh} = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const [placingItemId, setPlacingItemId] = useState<string | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadFailed(false);
    Promise.all([
      fetchInventoryPage(PAGE_SIZE, undefined, controller.signal),
      fetchBoard(controller.signal),
    ])
      .then(([page, board]) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setBoardItems(board.items);
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

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    setLoadFailed(false);
    try {
      const page = await fetchInventoryPage(PAGE_SIZE, nextCursor);
      setItems((currentItems) => [...currentItems, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await refresh();
      } else {
        setLoadFailed(true);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleAddToBoard = async (item: InventoryItem) => {
    if (placingItemId) {
      return;
    }
    const position = findFirstFreePosition(boardItems);
    if (!position) {
      setPlacementError('Your Study Board already has the maximum of 100 items.');
      return;
    }
    setPlacementError(null);
    setPlacingItemId(item.hourRewardId);
    try {
      const placedItem = await addBoardItem(item.hourRewardId, position);
      setBoardItems((currentItems) => [...currentItems, placedItem]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await refresh();
      } else if (error instanceof ApiError && error.code === 'BOARD_CAPACITY_REACHED') {
        setPlacementError('Your Study Board already has the maximum of 100 items.');
      } else if (error instanceof ApiError && error.code === 'BOARD_ITEM_ALREADY_PLACED') {
        try {
          const board = await fetchBoard();
          setBoardItems(board.items);
        } catch {
          setPlacementError('This item is already on your board. Refresh to update its status.');
        }
      } else {
        setPlacementError(`Could not add ${item.displayName} to your board. Please try again.`);
      }
    } finally {
      setPlacingItemId(null);
    }
  };

  const placedItemIds = new Set(boardItems.map((item) => item.hourRewardId));

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center gap-3 border-b border-slate-800 pb-6">
        <div className="w-12 h-12 bg-[#18181b] border border-slate-800 rounded-xl flex items-center justify-center text-indigo-400">
          <Backpack className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50">Your Inventory</h1>
          <p className="text-slate-400 text-sm">Every item instance earned from your verified study sessions.</p>
        </div>
      </div>

      {loadFailed && items.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#18181b] p-10 text-center text-slate-400">
          <p>We could not load your inventory.</p>
          <button
            type="button"
            onClick={() => setRequestVersion((version) => version + 1)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <div className="rounded-2xl border border-slate-800 bg-[#18181b] p-10 text-center text-slate-400">
          Loading your inventory…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-[#18181b] p-12 text-center">
          <Backpack className="mx-auto mb-4 h-10 w-10 text-slate-600" />
          <h2 className="font-semibold text-slate-200">Your inventory is empty</h2>
          <p className="mt-2 text-sm text-slate-500">Complete a verified study hour to earn your first item.</p>
        </div>
      ) : (
        <>
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4"
          >
            {items.map((item, index) => (
              <motion.div
                initial={{opacity: 0, y: 10}}
                animate={{opacity: 1, y: 0}}
                transition={{delay: Math.min(index, PAGE_SIZE) * 0.03}}
                key={item.hourRewardId}
                title={item.description ?? item.displayName}
                className="group relative bg-[#18181b] border border-slate-800 rounded-2xl p-4 flex flex-col items-center text-center hover:border-indigo-500/50 hover:bg-slate-900/50 transition-all"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 mt-2 transition-transform group-hover:scale-110 bg-slate-800 text-slate-300 group-hover:bg-indigo-500/10 group-hover:text-indigo-400">
                  {renderRewardAsset(item.assetKey, 'w-8 h-8')}
                </div>
                <h3 className="font-semibold text-sm text-slate-100 mb-1">{item.displayName}</h3>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 bg-slate-900 px-2 py-1 rounded-md mt-1 border border-slate-800">
                  Hour {item.milestoneHour}
                </span>
                <span className="mt-2 text-[10px] text-slate-600">Earned {formatEarnedAt(item.earnedAt)}</span>
                <button
                  type="button"
                  onClick={() => void handleAddToBoard(item)}
                  disabled={placedItemIds.has(item.hourRewardId) || placingItemId !== null}
                  className={`mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-default ${
                    placedItemIds.has(item.hourRewardId)
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                      : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:border-indigo-400/60 hover:bg-indigo-500/20 disabled:opacity-50'
                  }`}
                >
                  {placedItemIds.has(item.hourRewardId) ? (
                    <><Check className="h-3.5 w-3.5" /> On Board</>
                  ) : placingItemId === item.hourRewardId ? (
                    <><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Adding…</>
                  ) : (
                    <><Plus className="h-3.5 w-3.5" /> Add to Board</>
                  )}
                </button>
              </motion.div>
            ))}
          </motion.div>

          {loadFailed && (
            <p className="text-center text-sm text-red-400">The next page could not be loaded. Please try again.</p>
          )}
          {placementError && (
            <p role="alert" className="text-center text-sm text-red-400">{placementError}</p>
          )}
          {nextCursor && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
                className="rounded-lg border border-slate-700 bg-[#18181b] px-5 py-2.5 text-sm font-semibold text-slate-200 hover:border-indigo-500/50 hover:text-indigo-300 disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
