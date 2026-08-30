import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {Film, ImagePlus, LoaderCircle, Pencil, RefreshCw, RotateCcw, Trash2} from 'lucide-react';

import {renderRewardAsset, renderShopItem} from './IconMap';
import type {BoardObject, BoardPosition} from '../types';

export type BoardItemSaveState = 'idle' | 'saving' | 'error' | 'removing';

interface BoardItemProps {
  key?: string;
  item: BoardObject;
  boardRef: RefObject<HTMLDivElement | null>;
  boardSize: {width: number; height: number};
  itemSize: number;
  saveState: BoardItemSaveState;
  onPositionChange: (boardObjectId: string, position: BoardPosition) => void;
  onPositionCommit: (boardObjectId: string, position: BoardPosition) => void;
  onRemove: (boardObjectId: string) => void;
  onRetry: (boardObjectId: string) => void;
  onRollback: (boardObjectId: string) => void;
  onEditStickyNote: (ownedItemId: string) => void;
  onEditGif: (ownedItemId: string) => void;
  onRetryGif: (ownedItemId: string) => void;
  onEditPhoto: (ownedItemId: string) => void;
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
  onEditStickyNote,
  onEditGif,
  onRetryGif,
  onEditPhoto,
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
      onPositionChange(item.boardObjectId, latestPositionRef.current);
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
    onPositionChange(item.boardObjectId, position);
    onPositionCommit(item.boardObjectId, position);
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
        aria-label={item.source === 'reward'
          ? `Drag ${item.displayName} earned at hour ${item.milestoneHour}`
          : `Drag purchased ${item.displayName}`}
        title={item.source === 'reward'
          ? item.description ?? `Drag ${item.displayName}`
          : item.itemType === 'gif' && item.gif
            ? `Drag ${item.gif.title}`
            : `Drag ${item.displayName}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className={`group h-full w-full cursor-grab touch-none border shadow-xl transition-colors active:cursor-grabbing ${
          item.source === 'shop' && item.itemType === 'sticky_note'
            ? 'rotate-[-1.5deg] rounded-sm border-amber-200/50 bg-[#f3dc82] text-slate-900 shadow-amber-950/25 hover:bg-[#f8e69b]'
            : item.source === 'shop' && item.itemType === 'gif'
              ? 'overflow-hidden rounded-2xl bg-[#09090b] p-1.5 backdrop-blur-sm'
              : item.source === 'shop' && item.itemType === 'photo_frame'
                ? 'overflow-hidden rounded-lg border-amber-100/40 bg-gradient-to-br from-amber-100 via-amber-300 to-amber-700 p-2 shadow-amber-950/40'
              : 'rounded-2xl bg-[#111827]/95 backdrop-blur-sm'
        } ${
          saveState === 'error'
            ? 'border-red-400/70 shadow-red-950/40'
            : 'border-indigo-300/25 hover:border-indigo-300/60 shadow-black/40'
        }`}
      >
        {item.source === 'reward' ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-indigo-200">
            {renderRewardAsset(item.assetKey, 'h-[42%] w-[42%]')}
            <span className="max-w-[90%] truncate text-[9px] font-bold uppercase tracking-wide text-slate-300 sm:text-[10px]">
              {item.displayName}
            </span>
          </span>
        ) : item.itemType === 'sticky_note' ? (
          <span className="flex h-full w-full flex-col overflow-hidden p-2 text-left sm:p-3">
            <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.16em] text-amber-900/55 sm:text-[9px]">
              Sticky Note
            </span>
            <span className="block flex-1 overflow-hidden whitespace-pre-wrap break-words text-[10px] font-medium leading-snug text-slate-900 sm:text-xs">
              {item.body || 'Click Edit to write a note…'}
            </span>
          </span>
        ) : item.itemType === 'gif' ? (
          item.gif ? (
            <span className="relative block h-full w-full overflow-hidden rounded-xl bg-slate-950">
              {item.gif.hydrationState === 'loading' ? (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-slate-400">
                  <LoaderCircle className="h-[30%] w-[30%] animate-spin" />
                  <span className="text-[8px] font-bold uppercase tracking-wide">Loading GIF</span>
                </span>
              ) : item.gif.media ? (
                item.gif.media.previewUrl ? (
                  <picture>
                    <source
                      media="(prefers-reduced-motion: reduce)"
                      srcSet={item.gif.media.previewUrl}
                    />
                    <img
                      src={item.gif.media.renderUrl}
                      alt={item.gif.title}
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  </picture>
                ) : (
                  <>
                    <img
                      src={item.gif.media.renderUrl}
                      alt={item.gif.title}
                      draggable={false}
                      className="h-full w-full object-cover motion-reduce:hidden"
                    />
                    <span className="hidden h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-slate-400 motion-reduce:flex">
                      <Film className="h-[30%] w-[30%]" />
                      <span className="text-[8px] font-bold uppercase tracking-wide">Animation paused</span>
                    </span>
                  </>
                )
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-slate-400">
                  <Film className="h-[30%] w-[30%]" />
                  <span className="text-[8px] font-bold uppercase tracking-wide">GIF unavailable</span>
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-2 py-1 text-left text-[8px] font-semibold text-slate-100 backdrop-blur-sm sm:text-[9px]">
                {item.gif.title}
              </span>
            </span>
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-indigo-400/30 bg-indigo-500/[0.06] text-indigo-200">
              <Film className="h-[34%] w-[34%]" />
              <span className="text-[9px] font-bold uppercase tracking-wide sm:text-[10px]">Choose GIF</span>
            </span>
          )
        ) : item.itemType === 'photo_frame' ? (
          item.photo ? (
            <span className="block h-full w-full overflow-hidden rounded-sm border border-black/35 bg-slate-950 shadow-inner">
              <img
                src={item.photo.url}
                alt={`Photo in ${item.displayName}`}
                draggable={false}
                className="pointer-events-none h-full w-full object-cover"
              />
            </span>
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-amber-950/35 bg-slate-950/90 px-2 text-center text-amber-100">
              <ImagePlus className="h-[32%] w-[32%]" />
              <span className="text-[9px] font-bold uppercase tracking-wide sm:text-[10px]">Upload photo</span>
            </span>
          )
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-fuchsia-200">
            {renderShopItem(item.itemType, 'h-[42%] w-[42%]')}
            <span className="max-w-[90%] truncate text-[9px] font-bold uppercase tracking-wide text-slate-300 sm:text-[10px]">
              {item.displayName}
            </span>
          </span>
        )}
      </button>

      {item.source === 'shop' && item.itemType === 'sticky_note' && (
        <button
          type="button"
          aria-label={`Edit ${item.displayName}`}
          title="Edit note"
          onClick={() => onEditStickyNote(item.ownedItemId)}
          disabled={saveState === 'removing'}
          className="absolute -bottom-2 -left-2 flex h-7 items-center gap-1 rounded-full border border-amber-200/40 bg-amber-950 px-2 text-[9px] font-bold text-amber-100 opacity-100 shadow-lg transition hover:bg-amber-900 focus:opacity-100 disabled:cursor-wait disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Pencil className="h-3 w-3" /> Edit
        </button>
      )}

      {item.source === 'shop' && item.itemType === 'gif' && (
        <button
          type="button"
          aria-label={`${item.gif ? 'Change' : 'Choose'} GIF for ${item.displayName}`}
          title={item.gif ? 'Change GIF' : 'Choose GIF'}
          onClick={() => onEditGif(item.ownedItemId)}
          disabled={saveState === 'removing'}
          className="absolute -bottom-2 -left-2 flex h-7 items-center gap-1 rounded-full border border-indigo-300/30 bg-indigo-950 px-2 text-[9px] font-bold text-indigo-100 opacity-100 shadow-lg transition hover:bg-indigo-900 focus:opacity-100 disabled:cursor-wait disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Film className="h-3 w-3" /> {item.gif ? 'Change' : 'Choose'}
        </button>
      )}

      {item.source === 'shop' && item.itemType === 'photo_frame' && (
        <button
          type="button"
          aria-label={`${item.photo ? 'Replace' : 'Upload'} photo for ${item.displayName}`}
          title={item.photo ? 'Replace photo' : 'Upload photo'}
          onClick={() => onEditPhoto(item.ownedItemId)}
          disabled={saveState === 'removing'}
          className="absolute -bottom-2 -left-2 flex h-7 items-center gap-1 rounded-full border border-amber-200/30 bg-amber-950 px-2 text-[9px] font-bold text-amber-100 opacity-100 shadow-lg transition hover:bg-amber-900 focus:opacity-100 disabled:cursor-wait disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <ImagePlus className="h-3 w-3" /> {item.photo ? 'Replace' : 'Upload'}
        </button>
      )}

      {item.source === 'shop'
        && item.itemType === 'gif'
        && item.gif?.hydrationState === 'unavailable' && (
        <button
          type="button"
          aria-label={`Retry GIF for ${item.displayName}`}
          title="Retry GIF"
          onClick={() => onRetryGif(item.ownedItemId)}
          disabled={saveState === 'removing'}
          className="absolute -bottom-2 left-[4.75rem] flex h-7 items-center gap-1 rounded-full border border-slate-600 bg-slate-950 px-2 text-[9px] font-bold text-slate-200 shadow-lg transition hover:border-indigo-400/60 hover:text-indigo-200 disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}

      <button
        type="button"
        aria-label={`Remove ${item.displayName} from board`}
        title="Remove from board"
        onClick={() => onRemove(item.boardObjectId)}
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
            onClick={() => onRetry(item.boardObjectId)}
            className="rounded-full px-1.5 text-[9px] font-bold text-red-300 hover:bg-red-500/15"
          >
            Retry
          </button>
          <button
            type="button"
            title="Restore last saved position"
            aria-label={`Restore last saved position for ${item.displayName}`}
            onClick={() => onRollback(item.boardObjectId)}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
