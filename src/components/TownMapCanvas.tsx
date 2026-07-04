/**
 * TownMapCanvas — HTML5 Canvas room-graph renderer for the town mapper.
 *
 * Matches the hex map's "Explorer's Chart" look: dark background, parchment
 * room boxes, gold current-room glow. Shows ONE floor at a time; stair
 * glyphs (▲▼) mark rooms with up/down exits. Cardinal links draw as solid
 * corridors, diagonal shortcuts as thin lines, doors as amber ticks across
 * the link. Right-click a room to auto-walk there (BFS over learned links,
 * one confirmed step at a time — floors included).
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useMapContext } from '../contexts/MapContext';
import type { TownRoom } from '../lib/townMap';
import type { TownDir } from '../lib/townParser';

// ---------------------------------------------------------------------------
// Design tokens (shared vocabulary with MapCanvas)
// ---------------------------------------------------------------------------

/** Grid pitch — distance between room centers */
const CELL = 46;
/** Room box half-size */
const ROOM_HALF = 14;
const BG_COLOR = '#0f0e0d';
const GRID_COLOR = 'rgba(80, 70, 55, 0.12)';
const CURRENT_ROOM_GLOW = '#e8a849';
const ROOM_FILL = 'rgba(120, 110, 85, 0.32)';
const ROOM_STROKE = 'rgba(170, 155, 125, 0.55)';
const ROOM_FILL_OUTDOOR = 'rgba(100, 115, 70, 0.30)';
const LINK_COLOR = 'rgba(150, 135, 110, 0.45)';
const LINK_DIAG_COLOR = 'rgba(150, 135, 110, 0.30)';
const DOOR_COLOR = '#e8a849';
const STAIR_COLOR = 'rgba(200, 185, 160, 0.9)';
const NAMED_COLOR = 'rgba(160, 120, 200, 0.9)';
const LABEL_COLOR = 'rgba(200, 185, 160, 0.85)';
const TOOLTIP_BG = 'rgba(20, 18, 16, 0.95)';
const TOOLTIP_BORDER = 'rgba(140, 125, 100, 0.5)';
const TOOLTIP_TEXT = '#c8b9a0';

const DIR_LABELS: Record<TownDir, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  u: 'up',
  d: 'down',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};

interface TownMapCanvasProps {
  width: number;
  height: number;
  /** Town being displayed (may differ from the player's town when browsing) */
  townId: number;
  /** Floor (z) being displayed */
  floor: number;
  showLabels: boolean;
  /** Dim the map (drawn under the DOM badge) — used while outdoors */
  dimmed?: boolean;
  onWalkTo?: (roomId: number) => void;
  /** Search focus: pan to and highlight this room (nonce retriggers) */
  focus?: { roomId: number; nonce: number } | null;
  /** Double-clicking a stair room asks the panel to switch floors */
  onStairJump?: (fromZ: number, hasUp: boolean, hasDown: boolean) => void;
}

export function TownMapCanvas({
  width,
  height,
  townId,
  floor,
  showLabels,
  dimmed = false,
  onWalkTo,
  focus = null,
  onStairJump,
}: TownMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { version, town, townWalking, centerVersion, getTownRooms } = useMapContext();
  /** Is the displayed town the one the player is (last) in? */
  const isPlayerTown = town !== null && town.id === townId;

  // Pan/zoom state
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null
  );
  const [tooltip, setTooltip] = useState<{ x: number; y: number; room: TownRoom } | null>(null);
  const animFrameRef = useRef<number>(0);
  const hoverRef = useRef<{
    key: number | null;
    shownKey: number | null;
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

  const [, setRedraw] = useState(0);
  const requestRedraw = useCallback(() => setRedraw((v) => v + 1), []);

  // Center on the current room (same trigger discipline as the hex canvas)
  useEffect(() => {
    if (!town || town.id !== townId) return;
    const rooms = getTownRooms(townId);
    const cur = rooms.find((r) => r.id === town.roomId);
    if (!cur) return;
    panRef.current = { x: -cur.x * CELL, y: -cur.y * CELL };
    requestRedraw();
  }, [town, townId, centerVersion, getTownRooms, requestRedraw]);

  // Search focus: pan straight to the room
  useEffect(() => {
    if (!focus) return;
    const room = getTownRooms(townId).find((r) => r.id === focus.roomId);
    if (!room) return;
    panRef.current = { x: -room.x * CELL, y: -room.y * CELL };
    requestRedraw();
  }, [focus, townId, getTownRooms, requestRedraw]);

  // Browsing a floor (or a whole town) the player isn't in: center on the
  // displayed floor's rooms instead
  useEffect(() => {
    if (town && town.id === townId && floor === town.floor) return; // player view — handled above
    const rooms = getTownRooms(townId).filter((r) => r.z === floor);
    if (rooms.length === 0) return;
    let sx = 0;
    let sy = 0;
    for (const r of rooms) {
      sx += r.x;
      sy += r.y;
    }
    panRef.current = { x: (-sx / rooms.length) * CELL, y: (-sy / rooms.length) * CELL };
    requestRedraw();
  }, [floor, town, townId, getTownRooms, requestRedraw]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const zoom = zoomRef.current;
    const pan = panRef.current;
    const centerX = width / 2 + pan.x * zoom;
    const centerY = height / 2 + pan.y * zoom;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);
    drawBackgroundGrid(ctx, width, height, centerX, centerY, zoom);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(zoom, zoom);

    const rooms = getTownRooms(townId);
    const byId = new Map<number, TownRoom>();
    for (const r of rooms) byId.set(r.id, r);
    const floorRooms = rooms.filter((r) => r.z === floor);

    // Links first (under the room boxes). Draw each once (id order).
    for (const room of floorRooms) {
      for (const [dir, destId] of Object.entries(room.links) as [TownDir, number][]) {
        if (dir === 'u' || dir === 'd') continue; // stairs render as glyphs
        const dest = byId.get(destId);
        if (!dest || dest.z !== floor) continue;
        if (dest.id < room.id && dest.links[reverse(dir)] === room.id) continue; // drawn already
        drawLink(ctx, room, dest, dir);
      }
      for (const destId of Object.values(room.namedLinks)) {
        const dest = byId.get(destId);
        if (!dest || dest.z !== floor) continue;
        drawNamedLink(ctx, room, dest);
      }
    }

    // Room boxes
    for (const room of floorRooms) {
      drawRoom(ctx, room, isPlayerTown && !!town && room.id === town.roomId);
    }

    // Labels
    if (showLabels && zoom >= 0.7) {
      for (const room of floorRooms) drawRoomLabel(ctx, room);
    }

    // Active walk route preview — dashed gold line through the remaining
    // rooms plus a dot on each (segments only where both ends share the
    // displayed floor; stairs break the line, the dots carry on).
    if (townWalking && town && isPlayerTown) {
      const pathRooms = [town.roomId, ...townWalking.path]
        .map((id) => byId.get(id))
        .filter((r): r is TownRoom => !!r);
      ctx.strokeStyle = CURRENT_ROOM_GLOW;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < pathRooms.length - 1; i++) {
        const a = pathRooms[i];
        const b = pathRooms[i + 1];
        if (a.z !== floor || b.z !== floor) continue;
        ctx.beginPath();
        ctx.moveTo(a.x * CELL, a.y * CELL);
        ctx.lineTo(b.x * CELL, b.y * CELL);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = CURRENT_ROOM_GLOW;
      for (const r of pathRooms) {
        if (r.z !== floor || r.id === town.roomId) continue;
        ctx.beginPath();
        ctx.arc(r.x * CELL, r.y * CELL, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Search-focus ring
    if (focus) {
      const fr = byId.get(focus.roomId);
      if (fr && fr.z === floor) {
        ctx.strokeStyle = 'rgb(70, 180, 210)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(
          fr.x * CELL - ROOM_HALF - 4,
          fr.y * CELL - ROOM_HALF - 4,
          (ROOM_HALF + 4) * 2,
          (ROOM_HALF + 4) * 2
        );
        ctx.setLineDash([]);
      }
    }

    // Current room glow (only when displaying the player's town)
    if (town && isPlayerTown) {
      const cur = byId.get(town.roomId);
      if (cur && cur.z === floor) drawCurrentGlow(ctx, cur);
    }

    ctx.restore();

    if (dimmed) {
      ctx.fillStyle = 'rgba(15, 14, 13, 0.42)';
      ctx.fillRect(0, 0, width, height);
    }
    void version;
  });

  // -------------------------------------------------------------------------
  // Interaction (mirrors MapCanvas: drag-pan, wheel-zoom, hover, right-click)
  // -------------------------------------------------------------------------

  const roomAtMouse = useCallback(
    (e: React.MouseEvent): TownRoom | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const zoom = zoomRef.current;
      const pan = panRef.current;
      const worldX = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
      const worldY = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
      const gx = Math.round(worldX / CELL);
      const gy = Math.round(worldY / CELL);
      if (Math.abs(worldX - gx * CELL) > ROOM_HALF + 4) return null;
      if (Math.abs(worldY - gy * CELL) > ROOM_HALF + 4) return null;
      for (const r of getTownRooms(townId)) {
        if (r.z === floor && r.x === gx && r.y === gy) return r;
      }
      return null;
    },
    [getTownRooms, townId, floor]
  );

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
      cancelHover(true);
      requestRedraw();
    },
    [requestRedraw, cancelHover]
  );

  const HOVER_DELAY = 800;

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
      const room = roomAtMouse(e);
      if (!canvas || !room) {
        cancelHover(true);
        return;
      }
      const h = hoverRef.current;
      if (h.shownKey === room.id) return;
      if (h.key === room.id && h.timer) return;

      cancelHover(true);
      h.key = room.id;
      const rect = canvas.getBoundingClientRect();
      const tipX = e.clientX - rect.left;
      const tipY = e.clientY - rect.top;
      h.timer = setTimeout(() => {
        h.timer = null;
        h.shownKey = room.id;
        setTooltip({ x: tipX, y: tipY, room });
      }, HOVER_DELAY);
    },
    [roomAtMouse, cancelHover, requestRedraw]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const room = roomAtMouse(e);
      if (room && onWalkTo) onWalkTo(room.id);
    },
    [roomAtMouse, onWalkTo]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onStairJump) return;
      const room = roomAtMouse(e);
      if (!room) return;
      const hasUp = room.exits.includes('u');
      const hasDown = room.exits.includes('d');
      if (hasUp || hasDown) onStairJump(room.z, hasUp, hasDown);
    },
    [roomAtMouse, onStairJump]
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
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
      />
      {tooltip && (
        <RoomTooltip
          room={tooltip.room}
          x={tooltip.x}
          y={tooltip.y}
          containerWidth={width}
          containerHeight={height}
          isCurrent={isPlayerTown && !!town && tooltip.room.id === town.roomId}
          showWalkHint={!!onWalkTo}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function reverse(dir: TownDir): TownDir {
  const rev: Record<TownDir, TownDir> = {
    n: 's',
    s: 'n',
    e: 'w',
    w: 'e',
    u: 'd',
    d: 'u',
    ne: 'sw',
    sw: 'ne',
    nw: 'se',
    se: 'nw',
  };
  return rev[dir];
}

function isDiagonal(dir: TownDir): boolean {
  return dir.length === 2;
}

function px(room: TownRoom): { x: number; y: number } {
  return { x: room.x * CELL, y: room.y * CELL };
}

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

const CARDINAL_VEC: Partial<Record<TownDir, [number, number]>> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

function drawLink(ctx: CanvasRenderingContext2D, from: TownRoom, to: TownRoom, dir: TownDir) {
  const a = px(from);
  const b = px(to);
  const diag = isDiagonal(dir);
  // A cardinal link whose rooms aren't grid-adjacent was displaced by a
  // collision nudge (non-Euclidean overlap) — draw it thin and dashed so
  // it doesn't read as a straight corridor through unrelated rooms.
  const vec = CARDINAL_VEC[dir];
  const displaced = !!vec && (to.x !== from.x + vec[0] || to.y !== from.y + vec[1]);
  ctx.strokeStyle = diag || displaced ? LINK_DIAG_COLOR : LINK_COLOR;
  ctx.lineWidth = diag || displaced ? 1.2 : 3;
  if (displaced) ctx.setLineDash([3, 3]);
  ctx.beginPath();
  if (displaced && vec) {
    // The exit still leaves through its own side of the room (a south
    // exit departs the bottom-middle edge, and arrives at the far room's
    // opposite edge) — only the middle of the line angles across.
    const stub = ROOM_HALF + 6;
    ctx.moveTo(a.x + vec[0] * ROOM_HALF, a.y + vec[1] * ROOM_HALF);
    ctx.lineTo(a.x + vec[0] * stub, a.y + vec[1] * stub);
    ctx.lineTo(b.x - vec[0] * stub, b.y - vec[1] * stub);
    ctx.lineTo(b.x - vec[0] * ROOM_HALF, b.y - vec[1] * ROOM_HALF);
  } else {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  if (displaced) ctx.setLineDash([]);

  // Door tick across the link near the from-side
  if (from.doorDirs.includes(dir)) {
    const mx = a.x + (b.x - a.x) * 0.5;
    const my = a.y + (b.y - a.y) * 0.5;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const pxn = -dy / len;
    const pyn = dx / len;
    ctx.strokeStyle = DOOR_COLOR;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(mx - pxn * 5, my - pyn * 5);
    ctx.lineTo(mx + pxn * 5, my + pyn * 5);
    ctx.stroke();
  }
}

function drawNamedLink(ctx: CanvasRenderingContext2D, from: TownRoom, to: TownRoom) {
  const a = px(from);
  const b = px(to);
  ctx.strokeStyle = NAMED_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Rooms with an "It is bright"-style outdoor description read as streets —
 *  cheap heuristic: outdoor rooms tend to list 4+ exits or diagonal exits. */
function roomFill(room: TownRoom): string {
  return room.exits.length >= 4 || room.exits.some(isDiagonal) ? ROOM_FILL_OUTDOOR : ROOM_FILL;
}

function drawRoom(ctx: CanvasRenderingContext2D, room: TownRoom, isCurrent: boolean) {
  const { x, y } = px(room);
  const r = 4; // corner radius

  ctx.beginPath();
  ctx.roundRect(x - ROOM_HALF, y - ROOM_HALF, ROOM_HALF * 2, ROOM_HALF * 2, r);
  ctx.fillStyle = roomFill(room);
  ctx.fill();
  ctx.strokeStyle = isCurrent ? CURRENT_ROOM_GLOW : ROOM_STROKE;
  ctx.lineWidth = isCurrent ? 2 : 1;
  ctx.stroke();

  // Stair glyphs
  const hasUp = room.exits.includes('u');
  const hasDown = room.exits.includes('d');
  if (hasUp || hasDown) {
    ctx.fillStyle = STAIR_COLOR;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = hasUp && hasDown ? '▲▼' : hasUp ? '▲' : '▼';
    ctx.fillText(glyph, x, y - ROOM_HALF + 5);
  }

  // Named-exit badge (boats, "back" rooms, portals)
  if (room.namedExits.length > 0) {
    ctx.fillStyle = NAMED_COLOR;
    ctx.beginPath();
    ctx.arc(x + ROOM_HALF - 4, y + ROOM_HALF - 4, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Unexplored exits: faint stubs for directions with no learned link yet
  ctx.strokeStyle = 'rgba(150, 135, 110, 0.25)';
  ctx.lineWidth = 1.5;
  for (const dir of room.exits) {
    if (dir === 'u' || dir === 'd') continue;
    if (room.links[dir] !== undefined) continue;
    const v = stubVector(dir);
    ctx.beginPath();
    ctx.moveTo(x + v.x * ROOM_HALF, y + v.y * ROOM_HALF);
    ctx.lineTo(x + v.x * (ROOM_HALF + 7), y + v.y * (ROOM_HALF + 7));
    ctx.stroke();
  }
}

function stubVector(dir: TownDir): { x: number; y: number } {
  const v: Record<TownDir, [number, number]> = {
    n: [0, -1],
    s: [0, 1],
    e: [1, 0],
    w: [-1, 0],
    ne: [0.7, -0.7],
    nw: [-0.7, -0.7],
    se: [0.7, 0.7],
    sw: [-0.7, 0.7],
    u: [0, 0],
    d: [0, 0],
  };
  const [x, y] = v[dir];
  return { x, y };
}

function drawRoomLabel(ctx: CanvasRenderingContext2D, room: TownRoom) {
  const { x, y } = px(room);
  ctx.font = '8px "Courier New", monospace';
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label = room.name.length > 14 ? room.name.slice(0, 13) + '…' : room.name;
  ctx.fillText(label, x, y + ROOM_HALF + 3);
}

function drawCurrentGlow(ctx: CanvasRenderingContext2D, room: TownRoom) {
  const { x, y } = px(room);
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.shadowColor = CURRENT_ROOM_GLOW;
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(x, y, ROOM_HALF * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = CURRENT_ROOM_GLOW;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function RoomTooltip({
  room,
  x,
  y,
  containerWidth,
  containerHeight,
  isCurrent,
  showWalkHint,
}: {
  room: TownRoom;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  isCurrent: boolean;
  showWalkHint: boolean;
}) {
  const tipW = 230;
  const tipH = 100;
  const tx = x + tipW > containerWidth ? x - tipW - 8 : x + 8;
  const ty = y + tipH > containerHeight ? containerHeight - tipH - 8 : y + 8;

  const exits = room.exits.map((d) => DIR_LABELS[d]).join(', ');

  return (
    <div
      className="absolute pointer-events-none z-10 rounded px-3 py-2 max-w-[230px]"
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
        {room.name}
        <span className="font-normal opacity-50 ml-1.5">F{room.z}</span>
      </div>
      {room.desc && <div className="text-[9px] opacity-60 mb-1 line-clamp-3">{room.desc}</div>}
      {exits && <div className="text-[9px] opacity-70">Exits: {exits}</div>}
      {room.namedExits.length > 0 && (
        <div className="text-[9px] opacity-70" style={{ color: NAMED_COLOR }}>
          Also: {room.namedExits.join(', ')}
        </div>
      )}
      <div className="text-[9px] opacity-40 mt-0.5">Visited {room.visits}x</div>
      {!isCurrent && showWalkHint && (
        <div className="text-[9px] opacity-40 mt-0.5 italic">Right-click to walk here</div>
      )}
    </div>
  );
}
