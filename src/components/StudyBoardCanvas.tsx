import {useEffect, useRef, useState} from 'react';

import BoardItem, {type BoardItemSaveState} from './BoardItem';
import type {BoardObject, BoardPosition} from '../types';

interface StudyBoardCanvasProps {
  items: BoardObject[];
  saveStates: Readonly<Record<string, BoardItemSaveState>>;
  onPositionChange: (boardObjectId: string, position: BoardPosition) => void;
  onPositionCommit: (boardObjectId: string, position: BoardPosition) => void;
  onRemove: (boardObjectId: string) => void;
  onRetry: (boardObjectId: string) => void;
  onRollback: (boardObjectId: string) => void;
  onEditStickyNote: (ownedItemId: string) => void;
  onEditGif: (ownedItemId: string) => void;
  onRetryGif: (ownedItemId: string) => void;
}

export default function StudyBoardCanvas({
  items,
  saveStates,
  onPositionChange,
  onPositionCommit,
  onRemove,
  onRetry,
  onRollback,
  onEditStickyNote,
  onEditGif,
  onRetryGif,
}: StudyBoardCanvasProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState({width: 0, height: 0});

  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setBoardSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  const rewardItemSize = Math.max(48, Math.min(86, boardSize.width * 0.105));
  const stickyNoteSize = Math.max(72, Math.min(124, boardSize.width * 0.15));
  const gifSlotSize = Math.max(92, Math.min(154, boardSize.width * 0.18));

  return (
    <div className="rounded-3xl border border-slate-700/80 bg-[#111113] p-3 shadow-2xl shadow-black/30 sm:p-5">
      <div
        ref={boardRef}
        className="relative w-full overflow-hidden rounded-2xl border border-indigo-300/15 shadow-inner"
        style={{
          aspectRatio: '16 / 10',
          backgroundColor: '#171720',
          backgroundImage: [
            'radial-gradient(circle at 18% 20%, rgba(99,102,241,0.11), transparent 34%)',
            'radial-gradient(circle at 82% 75%, rgba(168,85,247,0.08), transparent 30%)',
            'linear-gradient(rgba(148,163,184,0.035) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(148,163,184,0.035) 1px, transparent 1px)',
          ].join(','),
          backgroundSize: 'auto, auto, 28px 28px, 28px 28px',
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-indigo-400/[0.04] to-transparent" />
        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <div className="mb-3 h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_24px_8px_rgba(129,140,248,0.25)]" />
            <h2 className="text-sm font-semibold text-slate-300 sm:text-lg">Your study wall is ready</h2>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500 sm:text-sm">
              Add an item from Inventory, then drag it wherever it belongs.
            </p>
          </div>
        )}
        {boardSize.width > 0 && items.map((item) => (
          <BoardItem
            key={item.boardObjectId}
            item={item}
            boardRef={boardRef}
            boardSize={boardSize}
            itemSize={item.source === 'shop' && item.itemType === 'sticky_note'
              ? stickyNoteSize
              : item.source === 'shop' && item.itemType === 'gif'
                ? gifSlotSize
                : rewardItemSize}
            saveState={saveStates[item.boardObjectId] ?? 'idle'}
            onPositionChange={onPositionChange}
            onPositionCommit={onPositionCommit}
            onRemove={onRemove}
            onRetry={onRetry}
            onRollback={onRollback}
            onEditStickyNote={onEditStickyNote}
            onEditGif={onEditGif}
            onRetryGif={onRetryGif}
          />
        ))}
      </div>
    </div>
  );
}
