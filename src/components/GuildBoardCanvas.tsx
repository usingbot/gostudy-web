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
import type {GuildBoardTheme} from '../types';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.15;
const LOGICAL_UNIT_SCALE = 0.1;
const FIT_PADDING = 24;
const MAX_OVERSCROLL = 150;

interface Point {
  x: number;
  y: number;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({x: 0, y: 0});
  const [dragging, setDragging] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const boardWidth = width * LOGICAL_UNIT_SCALE;
  const boardHeight = height * LOGICAL_UNIT_SCALE;

  const constrainPan = useCallback((candidate: Point, nextZoom: number): Point => {
    const viewport = viewportRef.current;
    if (!viewport) return candidate;
    const {width: viewportWidth, height: viewportHeight} = viewport.getBoundingClientRect();
    const scaledWidth = boardWidth * nextZoom;
    const scaledHeight = boardHeight * nextZoom;
    const overscroll = Math.min(
      MAX_OVERSCROLL,
      Math.max(100, Math.min(viewportWidth, viewportHeight) * 0.3),
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
  }, [boardHeight, boardWidth]);

  const fitBoard = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const nextZoom = clampZoom(Math.min(
      (rect.width - FIT_PADDING * 2) / boardWidth,
      (rect.height - FIT_PADDING * 2) / boardHeight,
    ));
    setZoom(nextZoom);
    setPan({
      x: (rect.width - boardWidth * nextZoom) / 2,
      y: (rect.height - boardHeight * nextZoom) / 2,
    });
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
    const nextZoom = clampZoom(value);
    const rect = viewport.getBoundingClientRect();
    const focus = anchor ?? {x: rect.width / 2, y: rect.height / 2};
    setPan((current) => constrainPan({
      x: focus.x - ((focus.x - current.x) / zoom) * nextZoom,
      y: focus.y - ((focus.y - current.y) / zoom) * nextZoom,
    }, nextZoom));
    setZoom(nextZoom);
  }, [constrainPan, zoom]);

  const handleWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      zoomTo(zoom * Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      return;
    }
    setPan((current) => constrainPan({
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }, zoom));
  }, [constrainPan, zoom, zoomTo]);

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
    }, zoom));
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const surfaceStyle: CSSProperties = {
    width: boardWidth,
    height: boardHeight,
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
  };

  return (
    <div
      className={`guild-board-shell ${className}`}
      data-theme={definition.key}
      data-object-count={objects.length}
      data-logical-width={width}
      data-logical-height={height}
    >
      <div className="guild-board-toolbar" aria-label="Board viewport controls">
        <span className="guild-board-dimensions">{width.toLocaleString()} × {height.toLocaleString()} units</span>
        <span className="guild-board-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomTo(zoom - ZOOM_STEP)} aria-label="Zoom out"><Minus /></button>
        <button type="button" onClick={() => zoomTo(zoom + ZOOM_STEP)} aria-label="Zoom in"><Plus /></button>
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
          <div className="guild-board-empty-state">
            <span className="guild-board-empty-icon" aria-hidden="true"><Pin /></span>
            <p className="guild-board-empty-title">Nothing has been pinned here yet.</p>
            <p className="guild-board-empty-copy">This shared board is ready for the community’s first study moment.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
