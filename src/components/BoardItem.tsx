import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {RotateCcw, Trash2} from 'lucide-react';

import {renderRewardAsset} from './IconMap';
import type {BoardItem as BoardItemData, BoardPosition} from '../types';

export type BoardItemSaveState = 'idle' | 'saving' | 'error' | 'removing';

interface BoardItemProps {
  key?: string;
  item: BoardItemData;
  boardRef: RefObject<HTMLDivElement | null>;
  boardSize: {width: number; height: number};
  itemSize: number;
  saveState: BoardItemSaveState;
  onPositionChange: (hourRewardId: string, position: BoardPosition) => void;
  onPositionCommit: (hourRewardId: string, position: BoardPosition) => void;
  onRemove: (hourRewardId: string) => void;
  onRetry: (hourRewardId: string) => void;
  onRollback: (hourRewardId: string) => void;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export default function BoardItem({
  item,
  boardRef,
  boardSize,
  itemSize,
  saveState,
  onPositionChange,
  onPositionCommit,
  onRemove,
  onRetry,
  onRollback,
}: BoardItemProps) {
  const draggingRef = useRef(false);
  const grabOffsetRef = useRef({x: 0, y: 0});
  const latestPositionRef = useRef<BoardPosition>({x: item.x, y: item.y});
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!draggingRef.current) {
      latestPositionRef.current = {x: item.x, y: item.y};
    }
  }, [item.x, item.y]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  const publishPosition = (position: BoardPosition) => {
    latestPositionRef.current = position;
    if (animationFrameRef.current !== null) {
      return;
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      onPositionChange(item.hourRewardId, latestPositionRef.current);
    });
  };

  const readPointerPosition = (clientX: number, clientY: number): BoardPosition | null => {
    const board = boardRef.current;
    if (!board) {
      return null;
    }
    const boardBounds = board.getBoundingClientRect();
    const availableWidth = Math.max(0, boardBounds.width - itemSize);
    const availableHeight = Math.max(0, boardBounds.height - itemSize);
    const pixelX = clientX - boardBounds.left - grabOffsetRef.current.x;
    const pixelY = clientY - boardBounds.top - grabOffsetRef.current.y;
    return {
      x: availableWidth === 0 ? 0 : clamp(pixelX / availableWidth),
      y: availableHeight === 0 ? 0 : clamp(pixelY / availableHeight),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || saveState === 'removing') {
      return;
    }
    event.preventDefault();
    const itemBounds = event.currentTarget.getBoundingClientRect();
    grabOffsetRef.current = {
      x: event.clientX - itemBounds.left,
      y: event.clientY - itemBounds.top,
    };
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) {
      return;
    }
    const position = readPointerPosition(event.clientX, event.clientY);
    if (position) {
      publishPosition(position);
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) {
      return;
    }
    const position = event.type === 'pointercancel'
      ? latestPositionRef.current
      : readPointerPosition(event.clientX, event.clientY) ?? latestPositionRef.current;
    draggingRef.current = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    latestPositionRef.current = position;
    onPositionChange(item.hourRewardId, position);
    onPositionCommit(item.hourRewardId, position);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const availableWidth = Math.max(0, boardSize.width - itemSize);
  const availableHeight = Math.max(0, boardSize.height - itemSize);

  return (
    <div
      className="group absolute left-0 top-0 select-none"
      style={{
        width: itemSize,
        height: itemSize,
        transform: `translate3d(${item.x * availableWidth}px, ${item.y * availableHeight}px, 0)`,
      }}
    >
      <button
        type="button"
        aria-label={`Drag ${item.displayName} earned at hour ${item.milestoneHour}`}
        title={item.description ?? `Drag ${item.displayName}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className={`group h-full w-full cursor-grab touch-none rounded-2xl border bg-[#111827]/95 shadow-xl backdrop-blur-sm transition-colors active:cursor-grabbing ${
          saveState === 'error'
            ? 'border-red-400/70 shadow-red-950/40'
            : 'border-indigo-300/25 hover:border-indigo-300/60 shadow-black/40'
        }`}
      >
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-indigo-200">
          {renderRewardAsset(item.assetKey, 'h-[42%] w-[42%]')}
          <span className="max-w-[90%] truncate text-[9px] font-bold uppercase tracking-wide text-slate-300 sm:text-[10px]">
            {item.displayName}
          </span>
        </span>
      </button>

      <button
        type="button"
        aria-label={`Remove ${item.displayName} from board`}
        title="Remove from board"
        onClick={() => onRemove(item.hourRewardId)}
        disabled={saveState === 'saving' || saveState === 'removing'}
        className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-400 opacity-0 shadow-lg transition hover:border-red-400/60 hover:text-red-300 focus:opacity-100 disabled:cursor-wait disabled:opacity-50 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {saveState === 'saving' && (
        <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-500/90 px-2 py-0.5 text-[9px] font-bold text-white shadow">
          Saving…
        </span>
      )}
      {saveState === 'removing' && (
        <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-700 px-2 py-0.5 text-[9px] font-bold text-white shadow">
          Removing…
        </span>
      )}
      {saveState === 'error' && (
        <div className="absolute -bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-red-400/30 bg-slate-950 px-1.5 py-1 shadow-xl">
          <button
            type="button"
            onClick={() => onRetry(item.hourRewardId)}
            className="rounded-full px-1.5 text-[9px] font-bold text-red-300 hover:bg-red-500/15"
          >
            Retry
          </button>
          <button
            type="button"
            title="Restore last saved position"
            aria-label={`Restore last saved position for ${item.displayName}`}
            onClick={() => onRollback(item.hourRewardId)}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
