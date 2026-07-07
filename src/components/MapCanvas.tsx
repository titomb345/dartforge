/**
 * MapCanvas — HTML5 Canvas hex grid renderer for the auto-mapper.
 *
 * Design: "Explorer's Chart" — dark background, muted earthy terrain colors,
 * hand-drawn map feel, current position glow, fog of war.
 *
 * Renders the player's current island as a terrain mosaic: visited hexes at
 * full strength, seen-but-unvisited hexes dimmed (fog), landmark markers,
 * and learned blocked edges.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMapContext } from '../contexts/MapContext';
import {
  hexToPixel,
  hexCorners,
  pixelToHex,
  getDirectionOffset,
  directionLabel,
  COMPASS_DIRECTIONS,
  type Direction,
} from '../lib/hexUtils';
import type { HexCell } from '../lib/hexMap';
import { TERRAIN_LABELS, type HexTerrainType } from '../lib/hexTerrainPatterns';
import {
  paintMarkerGlyph,
  HEX_MARKER_TYPES,
  MARKER_COLOR,
  type HexMarkerType,
} from '../lib/mapMarkers';
import { MarkerPicker } from './MarkerPicker';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const HEX_SIZE = 32;
const BG_COLOR = '#0f0e0d';
const GRID_COLOR = 'rgba(80, 70, 55, 0.12)';
const CURRENT_ROOM_GLOW = '#e8a849';

/** Terrain fill colors */
const TERRAIN_FILL: Record<HexTerrainType, string> = {
  plains: 'rgba(120, 130, 60, 0.45)',
  mountains: 'rgba(130, 115, 95, 0.50)',
  water: 'rgba(60, 100, 160, 0.45)',
  river: 'rgba(80, 140, 190, 0.45)',
  ocean: 'rgba(30, 60, 130, 0.50)',
  farmland: 'rgba(180, 160, 70, 0.40)',
  woods: 'rgba(40, 100, 45, 0.50)',
  hills: 'rgba(170, 145, 100, 0.45)',
  swamp: 'rgba(70, 100, 60, 0.45)',
  desert: 'rgba(190, 170, 110, 0.40)',
  wasteland: 'rgba(90, 65, 50, 0.45)',
  unknown: 'rgba(70, 70, 70, 0.30)',
};

/** Terrain stroke colors */
const TERRAIN_STROKE: Record<HexTerrainType, string> = {
  plains: 'rgba(140, 160, 80, 0.6)',
  mountains: 'rgba(160, 140, 115, 0.6)',
  water: 'rgba(80, 130, 200, 0.6)',
  river: 'rgba(100, 160, 210, 0.6)',
  ocean: 'rgba(50, 80, 170, 0.6)',
  farmland: 'rgba(200, 180, 90, 0.5)',
  woods: 'rgba(60, 130, 65, 0.6)',
  hills: 'rgba(190, 165, 120, 0.5)',
  swamp: 'rgba(90, 120, 75, 0.5)',
  desert: 'rgba(210, 190, 130, 0.5)',
  wasteland: 'rgba(120, 90, 70, 0.5)',
  unknown: 'rgba(100, 100, 100, 0.4)',
};

const LABEL_COLOR = 'rgba(200, 185, 160, 0.85)';
const LABEL_FONT = '9px "Courier New", monospace';
const LANDMARK_COLOR = MARKER_COLOR;
const RIVER_COLOR = 'rgba(96, 158, 214, 0.85)';
const CLIFF_COLOR = 'rgba(205, 185, 150, 0.9)';
const BRIDGE_COLOR = '#e8a849';
const BLOCKED_COLOR = 'rgba(220, 80, 70, 0.7)';
const TOOLTIP_BG = 'rgba(20, 18, 16, 0.95)';
const TOOLTIP_BORDER = 'rgba(140, 125, 100, 0.5)';
const TOOLTIP_TEXT = '#c8b9a0';

interface MapCanvasProps {
  width: number;
  height: number;
  showLabels: boolean;
  showFog: boolean;
  /** Dim the terrain mosaic (drawn under icons/markers) — used while indoors */
  dimmed?: boolean;
  onWalkTo?: (q: number, r: number) => void;
}

export function MapCanvas({
  width,
  height,
  showLabels,
  showFog,
  dimmed = false,
  onWalkTo,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    version,
    currentPos,
    walking,
    centerVersion,
    getCells,
    getCellAt,
    clearBlockedAt,
    setMarkerAt,
  } = useMapContext();
  // Shift+click marker picker (portal popover at viewport coords)
  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    q: number;
    r: number;
    current: HexMarkerType | 'none' | null;
  } | null>(null);

  // Pan/zoom state
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null
  );
  const [tooltip, setTooltip] = useState<{ x: number; y: number; cell: HexCell } | null>(null);
  const animFrameRef = useRef<number>(0);
  // Hover-to-inspect: the tooltip only appears after the cursor rests on a
  // hex for a moment (clicking is for drag/walk/marking, not inspecting)
  const hoverRef = useRef<{
    key: string | null;
    shownKey: string | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ key: null, shownKey: null, timer: null });

  const cancelHover = useCallback((hide: boolean) => {
    const h = hoverRef.current;
    if (h.timer) {
      clearTimeout(h.timer);
      h.timer = null;
    }
    h.key = null;
    if (hide) {
      h.shownKey = null;
      setTooltip(null);
    }
  }, []);

  useEffect(() => () => cancelHover(false), [cancelHover]);

  // Force redraw trigger
  const [, setRedraw] = useState(0);
  const requestRedraw = useCallback(() => setRedraw((v) => v + 1), []);

  // Center on current position
  useEffect(() => {
    if (!currentPos) return;
    const px = hexToPixel(currentPos.q, currentPos.r, HEX_SIZE);
    panRef.current = { x: -px.x, y: -px.y };
    requestRedraw();
  }, [currentPos, centerVersion, requestRedraw]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const zoom = zoomRef.current;
    const pan = panRef.current;
    const centerX = width / 2 + pan.x * zoom;
    const centerY = height / 2 + pan.y * zoom;

    // Clear
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    // Subtle background grid pattern
    drawBackgroundGrid(ctx, width, height, centerX, centerY, zoom);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(zoom, zoom);

    const cells = getCells();

    // Terrain mosaic
    for (const cell of cells) {
      const isCurrent = !!currentPos && cell.q === currentPos.q && cell.r === currentPos.r;
      drawHex(ctx, cell, isCurrent, showFog);
    }

    // Rivers, cliffs, blocked edges, and landmarks on top
    for (const cell of cells) {
      if (cell.river) drawRiver(ctx, cell);
      if (cell.riverEdges.length > 0) drawRiverEdges(ctx, cell);
      if (cell.cliffEdges.length > 0) drawCliffEdges(ctx, cell);
      if (cell.bridgeEdges.length > 0) drawBridgeEdges(ctx, cell);
      if (cell.blocked.length > 0) drawBlockedEdges(ctx, cell);
      if (cell.marker && cell.marker !== 'none') drawCellMarker(ctx, cell, cell.marker);
      else if (cell.landmarks.length > 0) drawLandmarkMarker(ctx, cell);
    }

    // Labels
    if (showLabels && zoom >= 0.6) {
      for (const cell of cells) {
        drawLabel(ctx, cell);
      }
    }

    // Active walk route preview — dashed gold line through the remaining
    // hexes with a dot on each (same language as the town map's preview)
    if (walking && walking.path.length > 0 && currentPos) {
      const points = [currentPos, ...walking.path].map((p) => hexToPixel(p.q, p.r, HEX_SIZE));
      ctx.strokeStyle = CURRENT_ROOM_GLOW;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = CURRENT_ROOM_GLOW;
      for (let i = 1; i < points.length; i++) {
        ctx.beginPath();
        ctx.arc(points[i].x, points[i].y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Current position glow
    if (currentPos) {
      drawCurrentGlow(ctx, currentPos.q, currentPos.r);
    }

    ctx.restore();

    // Compass rose
    drawCompassRose(ctx, width, height);

    // Indoors: dim the whole map uniformly (the DOM popup/badge above the
    // canvas stay at full brightness). Interaction is unaffected.
    if (dimmed) {
      ctx.fillStyle = 'rgba(15, 14, 13, 0.42)';
      ctx.fillRect(0, 0, width, height);
    }
    // The `version` dependency (from context) drives redraws on map changes
    void version;
  });

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      cancelHover(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
    },
    [cancelHover]
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
    cancelHover(true);
  }, [cancelHover]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoomRef.current = Math.max(0.2, Math.min(4, zoomRef.current * delta));
      cancelHover(true); // tooltip position would go stale under the new zoom
      requestRedraw();
    },
    [requestRedraw, cancelHover]
  );

  const hexAtMouse = useCallback((e: React.MouseEvent): { q: number; r: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const zoom = zoomRef.current;
    const pan = panRef.current;
    const worldX = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
    const worldY = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
    return pixelToHex(worldX, worldY, HEX_SIZE);
  }, []);

  /** How long the cursor must rest on a hex before its info popup shows */
  const HOVER_DELAY = 800;

  // Drag-pan + hover-to-inspect. The tooltip appears only after the cursor
  // rests on a mapped hex, so click-dragging the map never pops it up.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) {
        const dx = (e.clientX - dragRef.current.startX) / zoomRef.current;
        const dy = (e.clientY - dragRef.current.startY) / zoomRef.current;
        panRef.current = {
          x: dragRef.current.panX + dx,
          y: dragRef.current.panY + dy,
        };
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(() => requestRedraw());
        return;
      }

      const canvas = canvasRef.current;
      const hex = hexAtMouse(e);
      const cell = hex ? getCellAt(hex.q, hex.r) : undefined;
      if (!canvas || !hex || !cell) {
        cancelHover(true);
        return;
      }
      const key = `${hex.q},${hex.r}`;
      const h = hoverRef.current;
      // Moving within the hex the tooltip is already shown for — keep it
      if (h.shownKey === key) return;
      // Already counting down on this hex — let the timer run
      if (h.key === key && h.timer) return;

      cancelHover(true);
      h.key = key;
      // Viewport coords — the tooltip renders through a portal (like the
      // gear menu) so a small pinned panel can't clip it.
      const tipX = e.clientX;
      const tipY = e.clientY;
      h.timer = setTimeout(() => {
        h.timer = null;
        h.shownKey = key;
        // Re-read the cell so the popup shows fresh data at display time
        const fresh = getCellAt(hex.q, hex.r);
        if (fresh) setTooltip({ x: tipX, y: tipY, cell: fresh });
      }, HOVER_DELAY);
    },
    [hexAtMouse, getCellAt, cancelHover, requestRedraw]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const hex = hexAtMouse(e);
      if (!hex) return;
      const cell = getCellAt(hex.q, hex.r);
      if (!cell) return;
      // Shift+click opens the landmark marker picker
      if (e.shiftKey) {
        setPicker({ x: e.clientX, y: e.clientY, q: hex.q, r: hex.r, current: cell.marker });
        cancelHover(true);
        return;
      }
      // Ctrl+click clears incorrect blocked/river/cliff marks on the hex
      if (
        (e.ctrlKey || e.altKey) &&
        (cell.blocked.length > 0 ||
          cell.riverEdges.length > 0 ||
          cell.cliffEdges.length > 0 ||
          cell.bridgeEdges.length > 0 ||
          cell.river)
      ) {
        clearBlockedAt(hex.q, hex.r);
        cancelHover(true);
      }
      // Plain clicks are for dragging — inspection happens on hover
    },
    [hexAtMouse, getCellAt, clearBlockedAt, cancelHover]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const hex = hexAtMouse(e);
      if (!hex || !onWalkTo) return;
      const cell = getCellAt(hex.q, hex.r);
      if (cell) onWalkTo(hex.q, hex.r);
    },
    [hexAtMouse, getCellAt, onWalkTo]
  );

  return (
    <div
      className="relative"
      style={{ width, height, cursor: dragRef.current ? 'grabbing' : 'grab' }}
    >
      <canvas
        ref={canvasRef}
        style={{ width, height, display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      {tooltip && (
        <CellTooltip
          cell={tooltip.cell}
          x={tooltip.x}
          y={tooltip.y}
          isCurrent={
            !!currentPos && tooltip.cell.q === currentPos.q && tooltip.cell.r === currentPos.r
          }
        />
      )}
      {picker && (
        <MarkerPicker
          x={picker.x}
          y={picker.y}
          title="Hex marker"
          options={HEX_MARKER_TYPES}
          current={picker.current}
          onPick={(value) => setMarkerAt(picker.q, picker.r, value)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawing functions
// ---------------------------------------------------------------------------

function drawBackgroundGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cx: number,
  cy: number,
  zoom: number
) {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  const spacing = 60 * zoom;
  if (spacing < 8) return;

  const startX = cx % spacing;
  const startY = cy % spacing;
  ctx.beginPath();
  for (let x = startX; x < w; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = startY; y < h; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  cell: HexCell,
  isCurrent: boolean,
  showFog: boolean
) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  const corners = hexCorners(x, y, HEX_SIZE - 1);

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();

  const dimmed = showFog && !cell.visited;
  ctx.globalAlpha = dimmed ? 0.45 : 1;
  ctx.fillStyle = TERRAIN_FILL[cell.terrain] ?? TERRAIN_FILL.unknown;
  ctx.fill();

  ctx.strokeStyle = isCurrent
    ? CURRENT_ROOM_GLOW
    : (TERRAIN_STROKE[cell.terrain] ?? TERRAIN_STROKE.unknown);
  ctx.lineWidth = isCurrent ? 2 : 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Which hex corners bound each edge (flat-top layout, hexCorners order:
 * 0=E, 1=SE-bottom, 2=SW-bottom, 3=W, 4=NW-top, 5=NE-top).
 */
const EDGE_CORNERS: Record<Direction, [number, number]> = {
  n: [4, 5],
  ne: [5, 0],
  se: [0, 1],
  s: [1, 2],
  sw: [2, 3],
  nw: [3, 4],
};

/** Rivers running along hex sides — drawn as thick blue edge segments */
function drawRiverEdges(ctx: CanvasRenderingContext2D, cell: HexCell) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  const corners = hexCorners(x, y, HEX_SIZE - 1);
  ctx.strokeStyle = RIVER_COLOR;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const dir of cell.riverEdges) {
    const [a, b] = EDGE_CORNERS[dir];
    ctx.beginPath();
    ctx.moveTo(corners[a].x, corners[a].y);
    ctx.lineTo(corners[b].x, corners[b].y);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Blue stream meandering across a hex (rivers run through other terrain) */
function drawRiver(ctx: CanvasRenderingContext2D, cell: HexCell) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  const w = HEX_SIZE * 0.72;
  ctx.strokeStyle = RIVER_COLOR;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - w, y + HEX_SIZE * 0.1);
  ctx.bezierCurveTo(
    x - w * 0.35,
    y - HEX_SIZE * 0.28,
    x + w * 0.35,
    y + HEX_SIZE * 0.38,
    x + w,
    y - HEX_SIZE * 0.05
  );
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/**
 * Bridges: a short amber bar crossing the edge perpendicular to it —
 * a plank over the river, marking the zero-concentration crossing.
 */
function drawBridgeEdges(ctx: CanvasRenderingContext2D, cell: HexCell) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  const corners = hexCorners(x, y, HEX_SIZE - 1);
  ctx.strokeStyle = BRIDGE_COLOR;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (const dir of cell.bridgeEdges) {
    const [a, b] = EDGE_CORNERS[dir];
    const mx = (corners[a].x + corners[b].x) / 2;
    const my = (corners[a].y + corners[b].y) / 2;
    // Perpendicular to the edge
    const dx = corners[b].x - corners[a].x;
    const dy = corners[b].y - corners[a].y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const half = HEX_SIZE * 0.22;
    ctx.beginPath();
    ctx.moveTo(mx - px * half, my - py * half);
    ctx.lineTo(mx + px * half, my + py * half);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Cliffs along hex sides — dashed stone-colored edge segments */
function drawCliffEdges(ctx: CanvasRenderingContext2D, cell: HexCell) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  const corners = hexCorners(x, y, HEX_SIZE - 1);
  ctx.strokeStyle = CLIFF_COLOR;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([4, 3]);
  for (const dir of cell.cliffEdges) {
    const [a, b] = EDGE_CORNERS[dir];
    ctx.beginPath();
    ctx.moveTo(corners[a].x, corners[a].y);
    ctx.lineTo(corners[b].x, corners[b].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Red tick across each blocked edge */
function drawBlockedEdges(ctx: CanvasRenderingContext2D, cell: HexCell) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  ctx.strokeStyle = BLOCKED_COLOR;
  ctx.lineWidth = 2.5;
  for (const dir of COMPASS_DIRECTIONS) {
    if (!cell.blocked.includes(dir)) continue;
    // Midpoint toward the neighbor, drawn as a short perpendicular tick
    const o = getDirectionOffset(dir as Direction);
    const n = hexToPixel(cell.q + o.dq, cell.r + o.dr, HEX_SIZE);
    const mx = (x + n.x) / 2;
    const my = (y + n.y) / 2;
    const dx = n.x - x;
    const dy = n.y - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular
    const px = -dy / len;
    const py = dx / len;
    const tick = HEX_SIZE * 0.28;
    ctx.beginPath();
    ctx.moveTo(mx - px * tick, my - py * tick);
    ctx.lineTo(mx + px * tick, my + py * tick);
    ctx.stroke();
  }
}

/** Landmark marker glyph (house, castle, cave, ...) in landmark gold */
function drawCellMarker(ctx: CanvasRenderingContext2D, cell: HexCell, marker: HexMarkerType) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  paintMarkerGlyph(ctx, marker, x, y, HEX_SIZE * 0.22, LANDMARK_COLOR, BG_COLOR);
}

function drawLandmarkMarker(ctx: CanvasRenderingContext2D, cell: HexCell) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  const size = 4;
  ctx.fillStyle = LANDMARK_COLOR;
  ctx.beginPath();
  ctx.moveTo(x, y - HEX_SIZE * 0.55 - size);
  ctx.lineTo(x + size, y - HEX_SIZE * 0.55);
  ctx.lineTo(x, y - HEX_SIZE * 0.55 + size);
  ctx.lineTo(x - size, y - HEX_SIZE * 0.55);
  ctx.closePath();
  ctx.fill();
}

function drawCurrentGlow(ctx: CanvasRenderingContext2D, q: number, r: number) {
  const { x, y } = hexToPixel(q, r, HEX_SIZE);

  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.shadowColor = CURRENT_ROOM_GLOW;
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(x, y, HEX_SIZE * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = CURRENT_ROOM_GLOW;
  ctx.fill();
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, cell: HexCell) {
  const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
  const label = TERRAIN_LABELS[cell.terrain] ?? '?';

  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

function drawCompassRose(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w - 40;
  const cy = h - 40;
  const r = 22;

  ctx.save();
  ctx.globalAlpha = 0.3;

  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200, 185, 160, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Direction labels for all 6 hex directions
  ctx.font = '7px monospace';
  ctx.fillStyle = TOOLTIP_TEXT;
  ctx.globalAlpha = 0.5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const dirs: { label: string; angle: number }[] = [
    { label: 'N', angle: -Math.PI / 2 },
    { label: 'NE', angle: -Math.PI / 6 },
    { label: 'SE', angle: Math.PI / 6 },
    { label: 'S', angle: Math.PI / 2 },
    { label: 'SW', angle: (5 * Math.PI) / 6 },
    { label: 'NW', angle: -(5 * Math.PI) / 6 },
  ];

  for (const { label, angle } of dirs) {
    const lx = cx + (r + 8) * Math.cos(angle);
    const ly = cy + (r + 8) * Math.sin(angle);
    ctx.fillText(label, lx, ly);
  }

  // N indicator triangle
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.lineTo(cx - 3, cy - r + 8);
  ctx.lineTo(cx + 3, cy - r + 8);
  ctx.closePath();
  ctx.fillStyle = '#e8a849';
  ctx.globalAlpha = 0.6;
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Tooltip component
// ---------------------------------------------------------------------------

function CellTooltip({
  cell,
  x,
  y,
  isCurrent,
}: {
  /** Viewport (client) coords — rendered via portal with fixed positioning */
  x: number;
  y: number;
  cell: HexCell;
  isCurrent: boolean;
}) {
  const tipW = 220;
  const tipH = 110;
  const tx = x + tipW + 16 > window.innerWidth ? x - tipW - 8 : x + 8;
  const ty = y + tipH + 16 > window.innerHeight ? window.innerHeight - tipH - 8 : y + 8;

  const terrainLabel = TERRAIN_LABELS[cell.terrain] ?? 'Unknown';
  const blocked = cell.blocked.map((d) => directionLabel(d)).join(', ');

  return createPortal(
    <div
      className="fixed pointer-events-none z-[10000] rounded px-3 py-2 max-w-[220px]"
      style={{
        left: tx,
        top: ty,
        background: TOOLTIP_BG,
        border: `1px solid ${TOOLTIP_BORDER}`,
        color: TOOLTIP_TEXT,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      <div
        className="text-[11px] font-semibold mb-1"
        style={{ color: isCurrent ? CURRENT_ROOM_GLOW : TOOLTIP_TEXT }}
      >
        {terrainLabel}
        {cell.marker && cell.marker !== 'none' && (
          <span style={{ color: LANDMARK_COLOR }}>
            {' '}
            · {HEX_MARKER_TYPES.find((m) => m.type === cell.marker)?.label ?? cell.marker}
          </span>
        )}
        {(cell.river || cell.riverEdges.length > 0) && (
          <span style={{ color: RIVER_COLOR }}>
            {' '}
            · river
            {cell.riverEdges.length > 0
              ? ` (${cell.riverEdges.map((d) => directionLabel(d)).join(', ')})`
              : ''}
            <span className="opacity-60 italic"> — Ctrl+click to clear</span>
          </span>
        )}
        {cell.cliffEdges.length > 0 && (
          <span style={{ color: CLIFF_COLOR }}>
            {' '}
            · cliff ({cell.cliffEdges.map((d) => directionLabel(d)).join(', ')})
            <span className="opacity-60 italic"> — Ctrl+click to clear</span>
          </span>
        )}
        {cell.bridgeEdges.length > 0 && (
          <span style={{ color: BRIDGE_COLOR }}>
            {' '}
            · bridge ({cell.bridgeEdges.map((d) => directionLabel(d)).join(', ')})
          </span>
        )}
        <span className="font-normal opacity-50 ml-1.5">
          ({cell.q}, {cell.r})
        </span>
      </div>
      {cell.landmarks.length > 0 && (
        <div className="text-[9px] mb-1" style={{ color: LANDMARK_COLOR }}>
          {cell.landmarks.slice(0, 2).join(' · ')}
        </div>
      )}
      {cell.description && (
        <div className="text-[9px] opacity-60 mb-1 line-clamp-2">{cell.description}</div>
      )}
      {blocked && (
        <div className="text-[9px] opacity-50 text-red-400">
          Blocked: {blocked}
          <span className="opacity-70 italic"> — Ctrl+click to clear</span>
        </div>
      )}
      <div className="text-[9px] opacity-40 mt-0.5">
        {cell.visited ? `Visited ${cell.visitCount}x` : 'Seen from afar'}
        {cell.notes ? ' · Has notes' : ''}
      </div>
      {!isCurrent && (
        <div className="text-[9px] opacity-40 mt-0.5 italic">
          Right-click to walk here · Shift+click to set marker
        </div>
      )}
    </div>,
    document.body
  );
}
