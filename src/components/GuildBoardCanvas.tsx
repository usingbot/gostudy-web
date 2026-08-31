import {
  BringToFront,
  ImageOff,
  Maximize2,
  Minus,
  Move,
  MoveDiagonal2,
  Pin,
  Plus,
  RotateCw,
  Scan,
  SendToBack,
  Trash2,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {getGuildBoardTheme} from '../guild-board-themes';
import {GuildBoardGestureCommitGuard} from '../guild-board-interactions';
import {
  calculateGuildBoardFit,
  GUILD_BOARD_MAX_ZOOM,
  GUILD_BOARD_MIN_ZOOM,
  snapGuildBoardCssRect,
} from '../guild-board-viewport';
import type {
  AdminGuildBoardObject,
  GuildBoardObjectGeometry,
  GuildBoardTheme,
  PublicGuildBoardObject,
} from '../types';

const ZOOM_STEP = 0.15;
const LOGICAL_UNIT_SCALE = 0.1;
const MAX_OVERSCROLL = 150;
const MIN_OBJECT_SIZE = 48;
const MAX_OBJECT_SIZE = 720;

interface Point {
  x: number;
  y: number;
}

type CanvasObject = PublicGuildBoardObject | AdminGuildBoardObject;
type EditableGeometry = Pick<GuildBoardObjectGeometry, 'x' | 'y' | 'size' | 'rotation'>;

interface ObjectDraft extends EditableGeometry {
  id: string;
  gestureId: number;
}

interface ObjectInteraction {
  gestureId: number;
  mode: 'move' | 'resize' | 'rotate';
  pointerId: number;
  objectId: string;
  startClient: Point;
  startGeometry: EditableGeometry;
  centerClient: Point;
  startPointerAngle: number;
}

export interface GuildBoardCanvasHandle {
  getVisibleCenter(): Point;
}

export interface GuildBoardCanvasProps {
  theme: GuildBoardTheme;
  width: number;
  height: number;
  objects: readonly CanvasObject[];
  className?: string;
  editable?: boolean;
  mutationBusy?: boolean;
  interactionDisabled?: boolean;
  onTransform?: (objectId: string, geometry: EditableGeometry) => void | Promise<void>;
  onDelete?: (objectId: string) => void | Promise<void>;
  onLayer?: (objectId: string, action: 'front' | 'back') => void | Promise<void>;
}

function clampZoom(value: number): number {
  return Math.min(GUILD_BOARD_MAX_ZOOM, Math.max(GUILD_BOARD_MIN_ZOOM, value));
}

function normalizeRotation(value: number): number {
  let normalized = value;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return Math.round(normalized * 100) / 100;
}

function compareLayers(left: CanvasObject, right: CanvasObject): number {
  const leftLayer = BigInt(left.zIndex);
  const rightLayer = BigInt(right.zIndex);
  if (leftLayer < rightLayer) return -1;
  if (leftLayer > rightLayer) return 1;
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

const GuildBoardCanvas = forwardRef<GuildBoardCanvasHandle, GuildBoardCanvasProps>(
  function GuildBoardCanvas({
    theme,
    width,
    height,
    objects,
    className = '',
    editable = false,
    mutationBusy = false,
    interactionDisabled = false,
    onTransform,
    onDelete,
    onLayer,
  }, ref) {
    const definition = getGuildBoardTheme(theme);
    const viewportRef = useRef<HTMLDivElement>(null);
    const cameraDragRef = useRef<{
      pointerId: number;
      startClient: Point;
      startPan: Point;
    } | null>(null);
    const objectInteractionRef = useRef<ObjectInteraction | null>(null);
    const gestureCommitGuardRef = useRef(new GuildBoardGestureCommitGuard());
    const draftRef = useRef<ObjectDraft | null>(null);
    const [zoomFactor, setZoomFactor] = useState(1);
    const [fitScale, setFitScale] = useState(1);
    const [fitMode, setFitMode] = useState(true);
    const [pan, setPan] = useState<Point>({x: 0, y: 0});
    const [dragging, setDragging] = useState(false);
    const [spacePressed, setSpacePressed] = useState(false);
    const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
    const [draft, setDraftState] = useState<ObjectDraft | null>(null);
    const [failedObjectIds, setFailedObjectIds] = useState<ReadonlySet<string>>(new Set());

    const boardWidth = width * LOGICAL_UNIT_SCALE;
    const boardHeight = height * LOGICAL_UNIT_SCALE;
    const actualScale = fitScale * zoomFactor;
    const logicalToCssScale = LOGICAL_UNIT_SCALE * actualScale;

    const setDraft = useCallback((next: ObjectDraft | null) => {
      draftRef.current = next;
      setDraftState(next);
    }, []);

    const constrainPan = useCallback((candidate: Point, nextZoomFactor: number): Point => {
      const viewport = viewportRef.current;
      if (!viewport) return candidate;
      const viewportWidth = viewport.clientWidth;
      const viewportHeight = viewport.clientHeight;
      const nextActualScale = fitScale * nextZoomFactor;
      const scaledWidth = boardWidth * nextActualScale;
      const scaledHeight = boardHeight * nextActualScale;
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

    useEffect(() => {
      if (selectedObjectId
        && !objects.some((object) => object.id === selectedObjectId)) {
        setSelectedObjectId(null);
      }
    }, [objects, selectedObjectId]);

    useImperativeHandle(ref, () => ({
      getVisibleCenter: () => {
        const viewport = viewportRef.current;
        if (!viewport || actualScale <= 0) {
          return {x: width / 2, y: height / 2};
        }
        return {
          x: Math.min(width, Math.max(
            0,
            (viewport.clientWidth / 2 - pan.x) / actualScale / LOGICAL_UNIT_SCALE,
          )),
          y: Math.min(height, Math.max(
            0,
            (viewport.clientHeight / 2 - pan.y) / actualScale / LOGICAL_UNIT_SCALE,
          )),
        };
      },
    }), [actualScale, height, pan.x, pan.y, width]);

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

    const handleViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 1) return;
      if (event.button === 0 && !spacePressed) setSelectedObjectId(null);
      event.preventDefault();
      event.currentTarget.focus({preventScroll: true});
      event.currentTarget.setPointerCapture(event.pointerId);
      setFitMode(false);
      cameraDragRef.current = {
        pointerId: event.pointerId,
        startClient: {x: event.clientX, y: event.clientY},
        startPan: pan,
      };
      setDragging(true);
    };

    const handleViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const cameraDrag = cameraDragRef.current;
      if (!cameraDrag || cameraDrag.pointerId !== event.pointerId) return;
      setPan(constrainPan({
        x: cameraDrag.startPan.x + event.clientX - cameraDrag.startClient.x,
        y: cameraDrag.startPan.y + event.clientY - cameraDrag.startClient.y,
      }, zoomFactor));
    };

    const finishViewportPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (cameraDragRef.current?.pointerId !== event.pointerId) return;
      cameraDragRef.current = null;
      setDragging(false);
    };

    const startObjectInteraction = (
      event: ReactPointerEvent<HTMLElement>,
      object: CanvasObject,
      mode: ObjectInteraction['mode'],
    ) => {
      if (!editable || interactionDisabled || event.button !== 0 || spacePressed) return;
      event.preventDefault();
      event.stopPropagation();
      viewportRef.current?.focus({preventScroll: true});
      event.currentTarget.setPointerCapture(event.pointerId);
      const objectElement = event.currentTarget.closest('.guild-board-object');
      const rect = objectElement?.getBoundingClientRect();
      const startGeometry = draftRef.current?.id === object.id
        ? draftRef.current
        : object;
      const centerClient = rect
        ? {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}
        : {x: event.clientX, y: event.clientY};
      const gestureId = gestureCommitGuardRef.current.begin();
      objectInteractionRef.current = {
        gestureId,
        mode,
        pointerId: event.pointerId,
        objectId: object.id,
        startClient: {x: event.clientX, y: event.clientY},
        startGeometry: {
          x: startGeometry.x,
          y: startGeometry.y,
          size: startGeometry.size,
          rotation: startGeometry.rotation,
        },
        centerClient,
        startPointerAngle: Math.atan2(
          event.clientY - centerClient.y,
          event.clientX - centerClient.x,
        ),
      };
      setSelectedObjectId(object.id);
      setDraft({
        id: object.id,
        gestureId,
        x: startGeometry.x,
        y: startGeometry.y,
        size: startGeometry.size,
        rotation: startGeometry.rotation,
      });
    };

    const handleObjectPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = objectInteractionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId || actualScale <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      const logicalDeltaX = (event.clientX - interaction.startClient.x)
        / actualScale / LOGICAL_UNIT_SCALE;
      const logicalDeltaY = (event.clientY - interaction.startClient.y)
        / actualScale / LOGICAL_UNIT_SCALE;
      let next: ObjectDraft = {
        id: interaction.objectId,
        gestureId: interaction.gestureId,
        ...interaction.startGeometry,
      };

      if (interaction.mode === 'move') {
        next = {
          ...next,
          x: Math.round(Math.min(
            width - interaction.startGeometry.size,
            Math.max(0, interaction.startGeometry.x + logicalDeltaX),
          )),
          y: Math.round(Math.min(
            height - interaction.startGeometry.size,
            Math.max(0, interaction.startGeometry.y + logicalDeltaY),
          )),
        };
      } else if (interaction.mode === 'resize') {
        const maximumSize = Math.min(
          MAX_OBJECT_SIZE,
          width - interaction.startGeometry.x,
          height - interaction.startGeometry.y,
        );
        next = {
          ...next,
          size: Math.round(Math.min(
            maximumSize,
            Math.max(
              MIN_OBJECT_SIZE,
              interaction.startGeometry.size + Math.max(logicalDeltaX, logicalDeltaY),
            ),
          )),
        };
      } else {
        const pointerAngle = Math.atan2(
          event.clientY - interaction.centerClient.y,
          event.clientX - interaction.centerClient.x,
        );
        next = {
          ...next,
          rotation: normalizeRotation(
            interaction.startGeometry.rotation
              + (pointerAngle - interaction.startPointerAngle) * 180 / Math.PI,
          ),
        };
      }
      setDraft(next);
    };

    const settleObjectInteraction = (
      event: ReactPointerEvent<HTMLDivElement>,
      shouldPersist: boolean,
    ) => {
      const interaction = objectInteractionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      objectInteractionRef.current = null;
      const finalDraft = draftRef.current;
      if (!finalDraft
        || finalDraft.id !== interaction.objectId
        || finalDraft.gestureId !== interaction.gestureId) {
        gestureCommitGuardRef.current.settle(interaction.gestureId, false, () => undefined);
        if (draftRef.current?.gestureId === interaction.gestureId) setDraft(null);
        return;
      }
      const changed = finalDraft.x !== interaction.startGeometry.x
        || finalDraft.y !== interaction.startGeometry.y
        || finalDraft.size !== interaction.startGeometry.size
        || finalDraft.rotation !== interaction.startGeometry.rotation;
      const submission = gestureCommitGuardRef.current.settle(
        interaction.gestureId,
        shouldPersist && changed && Boolean(onTransform),
        () => onTransform?.(finalDraft.id, {
          x: finalDraft.x,
          y: finalDraft.y,
          size: finalDraft.size,
          rotation: finalDraft.rotation,
        }),
      );
      if (!submission) {
        if (draftRef.current?.gestureId === interaction.gestureId) setDraft(null);
        return;
      }
      void submission.finally(() => {
        if (draftRef.current?.gestureId === interaction.gestureId) setDraft(null);
      }).catch(() => undefined);
    };

    const sortedObjects = useMemo(() => [...objects].sort(compareLayers), [objects]);
    const renderableObjectCount = sortedObjects.filter(
      (object) => Boolean(object.url) && !failedObjectIds.has(object.id),
    ).length;

    const renderedSurface = snapGuildBoardCssRect({
      x: 0,
      y: 0,
      width: boardWidth * actualScale,
      height: boardHeight * actualScale,
    });
    const renderedPan = {x: Math.round(pan.x), y: Math.round(pan.y)};
    const surfaceStyle: CSSProperties & {'--board-control-scale': string} = {
      width: renderedSurface.width,
      height: renderedSurface.height,
      borderRadius: '12px',
      transform: `translate3d(${renderedPan.x}px, ${renderedPan.y}px, 0)`,
      '--board-control-scale': '1',
    };
    const emptyStateStyle: CSSProperties = {
      transform: 'translate(-50%, -50%)',
    };

    return (
      <div
        className={`guild-board-shell ${editable ? 'is-editable' : ''} ${className}`}
        data-theme={definition.key}
        data-object-count={objects.length}
        data-renderable-object-count={renderableObjectCount}
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
          aria-label={`${editable ? 'Editable' : 'Read-only'} ${definition.label} guild board viewport`}
          tabIndex={0}
          className={`guild-board-viewport ${dragging ? 'is-dragging' : ''} ${spacePressed ? 'is-space-ready' : ''}`}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={finishViewportPointerDrag}
          onPointerCancel={finishViewportPointerDrag}
          onKeyDown={(event) => {
            if (event.code === 'Space') {
              event.preventDefault();
              setSpacePressed(true);
            } else if (editable && event.key === 'Escape') {
              setSelectedObjectId(null);
            } else if (editable
              && selectedObjectId
              && !mutationBusy
              && (event.key === 'Delete' || event.key === 'Backspace')
              && !event.repeat) {
              event.preventDefault();
              void onDelete?.(selectedObjectId);
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
            {renderableObjectCount === 0 && (
              <div className="guild-board-empty-state" style={emptyStateStyle}>
                <span className="guild-board-empty-icon" aria-hidden="true"><Pin /></span>
                <p className="guild-board-empty-title">Nothing has been pinned here yet.</p>
              </div>
            )}
            {sortedObjects.map((object, layerIndex) => {
              const geometry = draft?.id === object.id ? draft : object;
              const failed = failedObjectIds.has(object.id);
              const renderUrl = failed ? null : object.url;
              if (!editable && !renderUrl) return null;
              const selected = editable && selectedObjectId === object.id;
              const renderedGeometry = snapGuildBoardCssRect({
                x: geometry.x * logicalToCssScale,
                y: geometry.y * logicalToCssScale,
                width: geometry.size * logicalToCssScale,
                height: geometry.size * logicalToCssScale,
              });
              const objectStyle: CSSProperties = {
                left: renderedGeometry.left,
                top: renderedGeometry.top,
                width: renderedGeometry.width,
                height: renderedGeometry.height,
                zIndex: layerIndex + 1,
              };
              const artworkStyle: CSSProperties | undefined = geometry.rotation === 0
                ? undefined
                : {transform: `rotate(${geometry.rotation}deg)`};
              return (
                <div
                  key={object.id}
                  className={`guild-board-object ${selected ? 'is-selected' : ''} ${renderUrl ? '' : 'is-unavailable'}`}
                  style={objectStyle}
                  data-object-id={object.id}
                  data-asset-kind={object.kind}
                  role={editable ? 'button' : undefined}
                  aria-label={editable ? `${object.kind} decoration${renderUrl ? '' : ', unavailable'}` : undefined}
                  tabIndex={editable ? 0 : undefined}
                  onPointerDown={(event) => startObjectInteraction(event, object, 'move')}
                  onPointerMove={handleObjectPointerMove}
                  onPointerUp={(event) => settleObjectInteraction(event, true)}
                  onPointerCancel={(event) => settleObjectInteraction(event, false)}
                  onLostPointerCapture={(event) => settleObjectInteraction(event, false)}
                  onFocus={() => editable && setSelectedObjectId(object.id)}
                >
                  <div className="guild-board-object-artwork" style={artworkStyle}>
                    {renderUrl ? (
                      <img
                        src={renderUrl}
                        alt=""
                        draggable={false}
                        onError={() => setFailedObjectIds((current) => {
                          const next = new Set(current);
                          next.add(object.id);
                          return next;
                        })}
                      />
                    ) : (
                      <span className="guild-board-object-unavailable" aria-hidden="true"><ImageOff /></span>
                    )}
                  </div>
                  {selected && (
                    <>
                      <div className="guild-board-object-actions" aria-label="Selected decoration actions">
                        <button type="button" disabled={mutationBusy} aria-label="Send decoration to back" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void onLayer?.(object.id, 'back'); }}><SendToBack /></button>
                        <button type="button" disabled={mutationBusy} aria-label="Bring decoration to front" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void onLayer?.(object.id, 'front'); }}><BringToFront /></button>
                        <button type="button" disabled={mutationBusy} aria-label="Delete decoration" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void onDelete?.(object.id); }}><Trash2 /></button>
                      </div>
                      <button
                        type="button"
                        className="guild-board-rotate-handle"
                        aria-label="Rotate decoration"
                        disabled={interactionDisabled}
                        onPointerDown={(event) => startObjectInteraction(event, object, 'rotate')}
                      ><RotateCw /></button>
                      <button
                        type="button"
                        className="guild-board-resize-handle"
                        aria-label="Resize decoration"
                        disabled={interactionDisabled}
                        onPointerDown={(event) => startObjectInteraction(event, object, 'resize')}
                      ><MoveDiagonal2 /></button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
);

export default GuildBoardCanvas;
