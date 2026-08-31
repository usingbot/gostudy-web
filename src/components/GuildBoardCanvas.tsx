import {Maximize2, Minus, Move, Pin, Plus, Scan} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {getGuildBoardTheme} from '../guild-board-themes';
import {
  calculateGuildBoardFit,
  GUILD_BOARD_MAX_ZOOM,
  GUILD_BOARD_MIN_ZOOM,
} from '../guild-board-viewport';
import type {GuildBoardTheme} from '../types';

const ZOOM_STEP = 0.15;
const LOGICAL_UNIT_SCALE = 0.1;
const MAX_OVERSCROLL = 150;

interface Point {
  x: number;
  y: number;
}

function clampZoom(value: number): number {
  return Math.min(GUILD_BOARD_MAX_ZOOM, Math.max(GUILD_BOARD_MIN_ZOOM, value));
}

export default function GuildBoardCanvas({
  theme,
  width,
  height,
  objects,
  className = '',
}: {
  theme: GuildBoardTheme;
  width: number;
  height: number;
  objects: readonly Record<string, unknown>[];
  className?: string;
}) {
  const definition = getGuildBoardTheme(theme);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClient: Point;
    startPan: Point;
  } | null>(null);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [pan, setPan] = useState<Point>({x: 0, y: 0});
  const [dragging, setDragging] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const boardWidth = width * LOGICAL_UNIT_SCALE;
  const boardHeight = height * LOGICAL_UNIT_SCALE;

  const constrainPan = useCallback((candidate: Point, nextZoomFactor: number): Point => {
    const viewport = viewportRef.current;
    if (!viewport) return candidate;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    const actualScale = fitScale * nextZoomFactor;
    const scaledWidth = boardWidth * actualScale;
    const scaledHeight = boardHeight * actualScale;
    const overscroll = Math.min(
      MAX_OVERSCROLL,
      Math.max(32, Math.min(viewportWidth, viewportHeight) * 0.08),
    );

    const constrainAxis = (value: number, viewportSize: number, surfaceSize: number) => {
      if (surfaceSize + overscroll * 2 <= viewportSize) {
        return (viewportSize - surfaceSize) / 2;
      }
      const minimum = viewportSize - surfaceSize - overscroll;
      const maximum = overscroll;
      return Math.min(maximum, Math.max(minimum, value));
    };

    return {
      x: constrainAxis(candidate.x, viewportWidth, scaledWidth),
      y: constrainAxis(candidate.y, viewportHeight, scaledHeight),
    };
  }, [boardHeight, boardWidth, fitScale]);

  const fitBoard = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const geometry = calculateGuildBoardFit({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      boardWidth,
      boardHeight,
    });
    setFitScale(geometry.scale);
    setZoomFactor(1);
    setFitMode(true);
    setPan({x: geometry.x, y: geometry.y});
  }, [boardHeight, boardWidth]);

  useEffect(() => {
    fitBoard();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => fitBoard());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitBoard]);

  const zoomTo = useCallback((value: number, anchor?: Point) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextZoomFactor = clampZoom(value);
    const rect = viewport.getBoundingClientRect();
    const focus = anchor ?? {x: rect.width / 2, y: rect.height / 2};
    setPan((current) => constrainPan({
      x: focus.x - ((focus.x - current.x) / zoomFactor) * nextZoomFactor,
      y: focus.y - ((focus.y - current.y) / zoomFactor) * nextZoomFactor,
    }, nextZoomFactor));
    setZoomFactor(nextZoomFactor);
    setFitMode(false);
  }, [constrainPan, zoomFactor]);

  const handleWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      zoomTo(zoomFactor * Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      return;
    }
    setFitMode(false);
    setPan((current) => constrainPan({
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }, zoomFactor));
  }, [constrainPan, zoomFactor, zoomTo]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    viewport.addEventListener('wheel', handleWheel, {passive: false});
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.focus({preventScroll: true});
    event.currentTarget.setPointerCapture(event.pointerId);
    setFitMode(false);
    dragRef.current = {
      pointerId: event.pointerId,
      startClient: {x: event.clientX, y: event.clientY},
      startPan: pan,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan(constrainPan({
      x: drag.startPan.x + event.clientX - drag.startClient.x,
      y: drag.startPan.y + event.clientY - drag.startClient.y,
    }, zoomFactor));
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const actualScale = fitScale * zoomFactor;
  const surfaceStyle: CSSProperties = {
    width: boardWidth,
    height: boardHeight,
    borderRadius: `${12 / actualScale}px`,
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${actualScale})`,
  };
  const emptyStateStyle: CSSProperties = {
    transform: `translate(-50%, -50%) scale(${1 / actualScale})`,
  };

  return (
    <div
      className={`guild-board-shell ${className}`}
      data-theme={definition.key}
      data-object-count={objects.length}
      data-logical-width={width}
      data-logical-height={height}
      data-fit-scale={fitScale}
      data-fit-mode={fitMode}
      data-zoom-factor={zoomFactor}
    >
      <div className="guild-board-toolbar" aria-label="Board viewport controls">
        <span className="guild-board-dimensions">{width.toLocaleString()} × {height.toLocaleString()} units</span>
        <span className="guild-board-zoom" aria-live="polite">{Math.round(zoomFactor * 100)}%{fitMode && <small>Fit</small>}</span>
        <button type="button" onClick={() => zoomTo(zoomFactor - ZOOM_STEP)} aria-label="Zoom out"><Minus /></button>
        <button type="button" onClick={() => zoomTo(zoomFactor + ZOOM_STEP)} aria-label="Zoom in"><Plus /></button>
        <button type="button" onClick={fitBoard} aria-label="Fit board"><Maximize2 /><span>Fit</span></button>
        <button type="button" onClick={() => zoomTo(1)} aria-label="Set board zoom to 100 percent"><Scan /><span>100%</span></button>
      </div>
      <div
        ref={viewportRef}
        role="region"
        aria-label={`Read-only ${definition.label} guild board viewport`}
        tabIndex={0}
        className={`guild-board-viewport ${dragging ? 'is-dragging' : ''} ${spacePressed ? 'is-space-ready' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
        onKeyDown={(event) => {
          if (event.code === 'Space') {
            event.preventDefault();
            setSpacePressed(true);
          }
        }}
        onKeyUp={(event) => {
          if (event.code === 'Space') setSpacePressed(false);
        }}
        onBlur={() => setSpacePressed(false)}
      >
        <div className="guild-board-pan-hint" aria-hidden="true"><Move /> Drag or scroll to pan</div>
        <div
          className={`guild-board-surface ${definition.className}`}
          style={surfaceStyle}
        >
          <div className="guild-board-empty-state" style={emptyStateStyle}>
            <span className="guild-board-empty-icon" aria-hidden="true"><Pin /></span>
            <p className="guild-board-empty-title">Nothing has been pinned here yet.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
