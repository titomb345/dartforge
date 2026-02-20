/**
 * MapCanvas — HTML5 Canvas hex grid renderer for the auto-mapper.
 *
 * Design: "Explorer's Chart" — dark background, muted earthy terrain colors,
 * hand-drawn map feel, current room glow, fog of war.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useMapContext } from '../contexts/MapContext';
import {
  hexToPixel,
  hexCorners,
  pixelToHex,
  type Direction,
  COMPASS_DIRECTIONS,
  getDirectionOffset,
  directionLabel,
} from '../lib/hexUtils';
import type { MapRoom, MapGraph } from '../lib/mapGraph';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const HEX_SIZE = 32; // radius in pixels
const BG_COLOR = '#0f0e0d';
const GRID_COLOR = 'rgba(80, 70, 55, 0.12)';
const CURRENT_ROOM_GLOW = '#e8a849';
const CURRENT_ROOM_FILL = 'rgba(232, 168, 73, 0.25)';
const ROOM_FILL: Record<MapRoom['terrain'], string> = {
  indoor: 'rgba(90, 80, 65, 0.35)',
  wilderness: 'rgba(65, 90, 55, 0.35)',
  city: 'rgba(120, 100, 70, 0.35)',
  unknown: 'rgba(70, 70, 70, 0.25)',
};
const ROOM_STROKE: Record<MapRoom['terrain'], string> = {
  indoor: 'rgba(140, 125, 100, 0.6)',
  wilderness: 'rgba(100, 140, 85, 0.6)',
  city: 'rgba(180, 155, 100, 0.6)',
  unknown: 'rgba(100, 100, 100, 0.4)',
};
const EXIT_LINE_COLOR = 'rgba(120, 105, 80, 0.35)';
const LABEL_COLOR = 'rgba(200, 185, 160, 0.85)';
const LABEL_FONT = '9px "Courier New", monospace';
const TOOLTIP_BG = 'rgba(20, 18, 16, 0.95)';
const TOOLTIP_BORDER = 'rgba(140, 125, 100, 0.5)';
const TOOLTIP_TEXT = '#c8b9a0';

interface MapCanvasProps {
  width: number;
  height: number;
  showLabels: boolean;
  showFog: boolean;
  onWalkTo?: (roomId: string, directions: Direction[]) => void;
}

export function MapCanvas({ width, height, showLabels, showFog, onWalkTo }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { graph, currentRoomId, centerVersion, findPathTo } = useMapContext();

  // Pan/zoom state
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; room: MapRoom } | null>(null);
  const animFrameRef = useRef<number>(0);

  // Force redraw trigger
  const [, setRedraw] = useState(0);
  const requestRedraw = useCallback(() => setRedraw((v) => v + 1), []);

  // Center on current room
  useEffect(() => {
    if (!currentRoomId || !graph.rooms[currentRoomId]) return;
    const room = graph.rooms[currentRoomId];
    const px = hexToPixel(room.coords.q, room.coords.r, HEX_SIZE);
    panRef.current = { x: -px.x, y: -px.y };
    requestRedraw();
  }, [currentRoomId, centerVersion, graph, requestRedraw]);

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

    const rooms = Object.values(graph.rooms);

    // Draw exit lines first (under hexes)
    for (const room of rooms) {
      drawExitLines(ctx, room, graph);
    }

    // Draw hex cells
    for (const room of rooms) {
      const isCurrent = room.id === currentRoomId;
      drawHex(ctx, room, isCurrent, showFog);
    }

    // Draw labels
    if (showLabels) {
      for (const room of rooms) {
        drawLabel(ctx, room);
      }
    }

    // Draw current room glow
    if (currentRoomId && graph.rooms[currentRoomId]) {
      drawCurrentGlow(ctx, graph.rooms[currentRoomId]);
    }

    ctx.restore();

    // Compass rose
    drawCompassRose(ctx, width, height);
  });

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setTooltip(null);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      const dx = (e.clientX - dragRef.current.startX) / zoomRef.current;
      const dy = (e.clientY - dragRef.current.startY) / zoomRef.current;
      panRef.current = {
        x: dragRef.current.panX + dx,
        y: dragRef.current.panY + dy,
      };
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(() => requestRedraw());
    }
  }, [requestRedraw]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomRef.current = Math.max(0.2, Math.min(4, zoomRef.current * delta));
    requestRedraw();
  }, [requestRedraw]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const zoom = zoomRef.current;
    const pan = panRef.current;

    // Convert click position to world coordinates
    const worldX = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
    const worldY = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;

    const hex = pixelToHex(worldX, worldY, HEX_SIZE);

    // Find room at this hex
    const room = Object.values(graph.rooms).find(
      (r) => r.coords.q === hex.q && r.coords.r === hex.r,
    );

    if (room) {
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        room,
      });
    } else {
      setTooltip(null);
    }
  }, [graph]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const zoom = zoomRef.current;
    const pan = panRef.current;

    const worldX = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
    const worldY = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
    const hex = pixelToHex(worldX, worldY, HEX_SIZE);

    const room = Object.values(graph.rooms).find(
      (r) => r.coords.q === hex.q && r.coords.r === hex.r,
    );

    if (room && onWalkTo) {
      const path = findPathTo(room.id);
      if (path && path.directions.length > 0) {
        onWalkTo(room.id, path.directions);
      }
    }
  }, [graph, findPathTo, onWalkTo]);

  return (
    <div className="relative" style={{ width, height, cursor: dragRef.current ? 'grabbing' : 'grab' }}>
      <canvas
        ref={canvasRef}
        style={{ width, height, display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      {tooltip && (
        <RoomTooltip
          room={tooltip.room}
          x={tooltip.x}
          y={tooltip.y}
          containerWidth={width}
          containerHeight={height}
          isCurrent={tooltip.room.id === currentRoomId}
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
  w: number, h: number,
  cx: number, cy: number,
  zoom: number,
) {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  const spacing = 60 * zoom;
  if (spacing < 8) return; // too zoomed out

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

function drawExitLines(ctx: CanvasRenderingContext2D, room: MapRoom, graph: MapGraph) {
  const from = hexToPixel(room.coords.q, room.coords.r, HEX_SIZE);

  for (const dir of COMPASS_DIRECTIONS) {
    const targetId = room.exits[dir];
    if (!targetId) continue;
    const target = graph.rooms[targetId];
    if (!target) continue;

    const to = hexToPixel(target.coords.q, target.coords.r, HEX_SIZE);

    ctx.beginPath();
    ctx.strokeStyle = EXIT_LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  // Draw stubs for exits that don't have a linked target yet
  for (const dir of COMPASS_DIRECTIONS) {
    if (dir in room.exits && !room.exits[dir]) {
      const offset = getDirectionOffset(dir);
      const stubLen = HEX_SIZE * 0.6;
      const dx = offset.dq * 1.5 + offset.dr * (-0.5); // approximate direction
      const dy = offset.dr * Math.sqrt(3) * 0.5 + offset.dq * Math.sqrt(3) * 0.25;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(120, 105, 80, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(from.x + (dx / len) * stubLen, from.y + (dy / len) * stubLen);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  room: MapRoom,
  isCurrent: boolean,
  showFog: boolean,
) {
  const { x, y } = hexToPixel(room.coords.q, room.coords.r, HEX_SIZE);
  const corners = hexCorners(x, y, HEX_SIZE - 1);

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();

  // Fill
  if (isCurrent) {
    ctx.fillStyle = CURRENT_ROOM_FILL;
  } else if (showFog && room.visitCount <= 1) {
    ctx.fillStyle = 'rgba(40, 38, 35, 0.3)';
  } else {
    ctx.fillStyle = ROOM_FILL[room.terrain];
  }
  ctx.fill();

  // Stroke
  ctx.strokeStyle = isCurrent ? CURRENT_ROOM_GLOW : ROOM_STROKE[room.terrain];
  ctx.lineWidth = isCurrent ? 2 : 1;
  ctx.stroke();
}

function drawCurrentGlow(ctx: CanvasRenderingContext2D, room: MapRoom) {
  const { x, y } = hexToPixel(room.coords.q, room.coords.r, HEX_SIZE);

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

function drawLabel(ctx: CanvasRenderingContext2D, room: MapRoom) {
  if (!room.name) return;
  const { x, y } = hexToPixel(room.coords.q, room.coords.r, HEX_SIZE);

  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Truncate name to fit hex
  const maxWidth = HEX_SIZE * 1.6;
  let label = room.name;
  while (ctx.measureText(label).width > maxWidth && label.length > 3) {
    label = label.slice(0, -1);
  }
  if (label !== room.name) label += '…';

  ctx.fillText(label, x, y);
}

function drawCompassRose(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w - 30;
  const cy = h - 30;
  const r = 16;

  ctx.save();
  ctx.globalAlpha = 0.3;

  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200, 185, 160, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // N indicator
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.lineTo(cx - 3, cy - r + 8);
  ctx.lineTo(cx + 3, cy - r + 8);
  ctx.closePath();
  ctx.fillStyle = '#e8a849';
  ctx.globalAlpha = 0.6;
  ctx.fill();

  // N label
  ctx.font = '8px monospace';
  ctx.fillStyle = TOOLTIP_TEXT;
  ctx.globalAlpha = 0.5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - r - 6);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Tooltip component
// ---------------------------------------------------------------------------

function RoomTooltip({
  room,
  x,
  y,
  containerWidth,
  containerHeight,
  isCurrent,
}: {
  room: MapRoom;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  isCurrent: boolean;
}) {
  const tipW = 220;
  const tipH = 100; // approximate
  const tx = x + tipW > containerWidth ? x - tipW - 8 : x + 8;
  const ty = y + tipH > containerHeight ? containerHeight - tipH - 8 : y + 8;

  const exits = Object.entries(room.exits)
    .filter(([, target]) => target)
    .map(([dir]) => directionLabel(dir as Direction));

  return (
    <div
      className="absolute pointer-events-none z-10 rounded px-3 py-2 max-w-[220px]"
      style={{
        left: tx,
        top: ty,
        background: TOOLTIP_BG,
        border: `1px solid ${TOOLTIP_BORDER}`,
        color: TOOLTIP_TEXT,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      <div className="text-[11px] font-semibold mb-1" style={{ color: isCurrent ? CURRENT_ROOM_GLOW : TOOLTIP_TEXT }}>
        {room.name || 'Wilderness'}
      </div>
      {room.brief && (
        <div className="text-[9px] opacity-60 mb-1 line-clamp-2">{room.brief}</div>
      )}
      {exits.length > 0 && (
        <div className="text-[9px] opacity-50">
          Exits: {exits.join(', ')}
        </div>
      )}
      <div className="text-[9px] opacity-40 mt-0.5">
        Visited {room.visitCount}x
        {room.notes ? ' · Has notes' : ''}
      </div>
      {!isCurrent && (
        <div className="text-[9px] opacity-40 mt-0.5 italic">Right-click to walk here</div>
      )}
    </div>
  );
}
