/**
 * TownMapCanvas — HTML5 Canvas room-graph renderer for the town mapper.
 *
 * Matches the hex map's "Explorer's Chart" look: dark background, parchment
 * room boxes, gold current-room glow. Shows ONE floor at a time; stair
 * glyphs (▲▼) mark rooms with up/down exits. Cardinal links draw as solid
 * corridors, diagonal shortcuts as thin lines, doors as amber ticks across
 * the link. Right-click a room to auto-walk there (BFS over learned links,
 * one confirmed step at a time — floors included).
 *
 * Everything is placed on the DISPLAY layout (townDisplayLayout.ts): the
 * store's grid with collision-stretch gaps compacted, for presentation
 * only. Drawing, hit-testing, centering, search focus and the walk overlay
 * all read that one layout, so what you click is what you see.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMapContext } from '../contexts/MapContext';
import type { TownRoom } from '../lib/townMap';
import { TOWN_REVERSE, type TownDir } from '../lib/townParser';
import {
  createTownDisplayLayoutCache,
  doorTick,
  fitLabel,
  labelBudgets,
  linkHasDoor,
  linkPolyline,
  linkShape,
  stairJumpTarget,
  type DisplayCell,
  type Point,
} from '../lib/townDisplayLayout';
import {
  paintMarkerGlyph,
  ROOM_ICON_TYPES,
  MARKER_COLOR,
  type RoomIconType,
} from '../lib/mapMarkers';
import { MarkerPicker } from './MarkerPicker';

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
const ICON_COLOR = MARKER_COLOR;
const STAIR_COLOR = 'rgba(200, 185, 160, 0.9)';
const NAMED_COLOR = 'rgba(160, 120, 200, 0.9)';
const LABEL_COLOR = 'rgba(200, 185, 160, 0.85)';
const LABEL_FONT = '8px "Courier New", monospace';
/** Clear space kept between east-west neighbours' labels */
const LABEL_GAP = 6;
/** Widest label for a room with no east/west neighbour */
const LABEL_MAX_W = 2 * CELL - 6;
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
  /** Double-clicking a stair room asks the panel to show the floor its
   *  staircase leads to (the canvas then centers on the arrival room).
   *  Returns whether the panel switched to that floor. */
  onStairJump?: (floor: number) => boolean;
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
  const { town, townWalking, centerVersion, getTownRooms, setRoomIcon } = useMapContext();
  /** Is the displayed town the one the player is (last) in? */
  const isPlayerTown = town !== null && town.id === townId;

  // Display layout, memoized per town on its layout signature: recomputed
  // only when a room is added or moved or a link changes — not on every
  // sync (two per room block, plus every survey). Callbacks and effects
  // read this render's snapshot through viewRef.
  const [layoutFor] = useState(() => createTownDisplayLayoutCache());
  const rooms = getTownRooms(townId);
  const layout = layoutFor(townId, rooms);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const viewRef = useRef({ rooms, byId, layout });
  viewRef.current = { rooms, byId, layout };

  // The player as primitives: the `town` summary is a fresh object on every
  // sync, so effects keyed on it fired on every room block and survey.
  const pTown = town?.id ?? null;
  const pRoom = town?.roomId ?? null;
  const pFloor = town?.floor ?? null;
  const pCell = pTown === townId && pRoom !== null ? layout.pos(pRoom) : undefined;
  const pX = pCell?.x ?? null;
  const pY = pCell?.y ?? null;
  const playerRef = useRef({ pTown, pRoom, pFloor });
  playerRef.current = { pTown, pRoom, pFloor };
  /** Where a stair double-click wants the next floor switch centered */
  const pendingCenterRef = useRef<{ townId: number; z: number; cell: DisplayCell } | null>(null);

  // Shift+click room icon picker (portal popover at viewport coords)
  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    roomId: number;
    current: RoomIconType | 'none' | null;
  } | null>(null);

  // Pan/zoom state
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null
  );
  const [tooltip, setTooltip] = useState<{ x: number; y: number; room: TownRoom } | null>(null);
  const animFrameRef = useRef<number>(0);
  /** Measured label widths — one fixed font, so reusable across frames */
  const labelWidthsRef = useRef(new Map<string, number>());
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

  const centerOn = useCallback(
    (cell: DisplayCell) => {
      panRef.current = { x: -cell.x * CELL, y: -cell.y * CELL };
      requestRedraw();
    },
    [requestRedraw]
  );

  // Follow the player on REAL changes only: their room, floor or town, the
  // display cell of their room (a layout change can move it), or the center
  // button (same trigger discipline as the hex canvas). Depending on the
  // `town` object snapped the view back — undoing any pan — on every room
  // block, survey, icon pick and rename. Browsing another floor of the
  // player's town doesn't follow.
  useEffect(() => {
    if (pTown !== townId || floor !== pFloor || pX === null || pY === null) return;
    centerOn({ x: pX, y: pY });
  }, [pTown, pRoom, pFloor, pX, pY, townId, floor, centerVersion, centerOn]);

  // Showing another floor or town re-centers once: on the room a
  // double-clicked staircase leads to, else on the player when it's their
  // floor of their town, else on the displayed floor's centroid.
  useEffect(() => {
    const { rooms: all, layout: lay } = viewRef.current;
    const player = playerRef.current;
    const pending = pendingCenterRef.current;
    pendingCenterRef.current = null;
    if (pending && pending.townId === townId && pending.z === floor) {
      centerOn(pending.cell);
      return;
    }
    const playerCell =
      player.pTown === townId && player.pFloor === floor && player.pRoom !== null
        ? lay.pos(player.pRoom)
        : undefined;
    if (playerCell) {
      centerOn(playerCell);
      return;
    }
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const r of all) {
      const cell = r.z === floor ? lay.pos(r.id) : undefined;
      if (!cell) continue;
      sx += cell.x;
      sy += cell.y;
      n++;
    }
    if (n > 0) centerOn({ x: sx / n, y: sy / n });
  }, [floor, townId, centerOn]);

  // Search focus: pan straight to the room. Declared after the floor
  // effect on purpose: a match on another floor switches floors in the same
  // render, and the room must win over that floor's centroid.
  useEffect(() => {
    if (!focus) return;
    const cell = viewRef.current.layout.pos(focus.roomId);
    if (cell) centerOn(cell);
  }, [focus, centerOn]);

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

    /** Display cell of a room (its store cell only if the layout lacks it) */
    const cellOf = (room: TownRoom): DisplayCell => layout.pos(room.id) ?? room;
    /** Pixel center of a room on the display grid */
    const at = (room: TownRoom): Point => {
      const cell = cellOf(room);
      return { x: cell.x * CELL, y: cell.y * CELL };
    };
    const occupied = (x: number, y: number) => layout.roomAt(x, y, floor) !== undefined;
    const floorRooms = rooms.filter((r) => r.z === floor);

    // Links first (under the room boxes). Draw each once (id order).
    for (const room of floorRooms) {
      for (const [dir, destId] of Object.entries(room.links) as [TownDir, number][]) {
        if (dir === 'u' || dir === 'd') continue; // stairs render as glyphs
        const dest = byId.get(destId);
        if (!dest || dest.z !== floor) continue;
        if (dest.id < room.id && dest.links[TOWN_REVERSE[dir]] === room.id) continue; // drawn already
        const shape = linkShape(cellOf(room), cellOf(dest), dir, occupied);
        drawLink(ctx, at(room), at(dest), dir, shape === 'displaced', linkHasDoor(room, dest, dir));
      }
      for (const destId of Object.values(room.namedLinks)) {
        const dest = byId.get(destId);
        if (!dest || dest.z !== floor) continue;
        drawNamedLink(ctx, at(room), at(dest));
      }
    }

    // Room boxes
    for (const room of floorRooms) {
      drawRoom(ctx, room, at(room), isPlayerTown && room.id === pRoom);
    }

    // Labels, trimmed to a measured width wherever an east/west neighbour
    // would otherwise overlap (the full name stays in the tooltip)
    if (showLabels && zoom >= 0.7) {
      ctx.font = LABEL_FONT;
      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const widths = labelWidthsRef.current;
      const measure = (text: string) => {
        let w = widths.get(text);
        if (w === undefined) {
          w = ctx.measureText(text).width;
          widths.set(text, w);
        }
        return w;
      };
      const budgets = labelBudgets(
        floorRooms,
        layout,
        (id) => measure(byId.get(id)?.name ?? ''),
        CELL,
        LABEL_GAP,
        LABEL_MAX_W
      );
      for (const room of floorRooms) {
        const label = fitLabel(room.name, budgets.get(room.id) ?? LABEL_MAX_W, measure);
        const p = at(room);
        ctx.fillText(label, p.x, p.y + ROOM_HALF + 3);
      }
    }

    // Active walk route preview — dashed gold line through the remaining
    // rooms plus a dot on each (segments only where both ends share the
    // displayed floor; stairs break the line, the dots carry on).
    if (townWalking && isPlayerTown && pRoom !== null) {
      const pathRooms = [pRoom, ...townWalking.path]
        .map((id) => byId.get(id))
        .filter((r): r is TownRoom => !!r);
      ctx.strokeStyle = CURRENT_ROOM_GLOW;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < pathRooms.length - 1; i++) {
        if (pathRooms[i].z !== floor || pathRooms[i + 1].z !== floor) continue;
        const a = at(pathRooms[i]);
        const b = at(pathRooms[i + 1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = CURRENT_ROOM_GLOW;
      for (const r of pathRooms) {
        if (r.z !== floor || r.id === pRoom) continue;
        const p = at(r);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Search-focus ring
    if (focus) {
      const fr = byId.get(focus.roomId);
      if (fr && fr.z === floor) {
        const p = at(fr);
        ctx.strokeStyle = 'rgb(70, 180, 210)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(
          p.x - ROOM_HALF - 4,
          p.y - ROOM_HALF - 4,
          (ROOM_HALF + 4) * 2,
          (ROOM_HALF + 4) * 2
        );
        ctx.setLineDash([]);
      }
    }

    // Current room glow (only when displaying the player's town)
    if (isPlayerTown && pRoom !== null) {
      const cur = byId.get(pRoom);
      if (cur && cur.z === floor) drawCurrentGlow(ctx, at(cur));
    }

    ctx.restore();

    if (dimmed) {
      ctx.fillStyle = 'rgba(15, 14, 13, 0.42)';
      ctx.fillRect(0, 0, width, height);
    }
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
      const { layout: lay, byId: rooms } = viewRef.current;
      const id = lay.roomAt(gx, gy, floor);
      return id === undefined ? null : (rooms.get(id) ?? null);
    },
    [floor]
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
      // Viewport coords — the tooltip renders through a portal (like the
      // gear menu) so a small pinned panel can't clip it.
      const tipX = e.clientX;
      const tipY = e.clientY;
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

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Shift+click opens the room icon picker
      if (!e.shiftKey) return;
      const room = roomAtMouse(e);
      if (!room) return;
      setPicker({ x: e.clientX, y: e.clientY, roomId: room.id, current: room.icon });
      cancelHover(true);
    },
    [roomAtMouse, cancelHover]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onStairJump) return;
      const room = roomAtMouse(e);
      if (!room) return;
      const { rooms: all, byId: rooms, layout: lay } = viewRef.current;
      const floors = new Set(all.map((r) => r.z));
      const target = stairJumpTarget(room, (id) => rooms.get(id), floors);
      if (!target) return;
      // Land on the room the staircase leads to. A staircase never taken
      // has no known arrival room: land on the mapped room of that floor
      // nearest the stairs instead. Floors share one grid, so that is
      // usually right above or below them, while the stairs' own cell on
      // the other floor is often empty space (live save: 1 of 2 untaken
      // stairs, 13 cells from the nearest room).
      let cell = target.roomId !== null ? lay.pos(target.roomId) : undefined;
      const from = lay.pos(room.id);
      if (!cell && from) {
        let best = Infinity;
        for (const r of all) {
          const c = r.z === target.z ? lay.pos(r.id) : undefined;
          if (!c) continue;
          const d = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
          if (d < best) {
            best = d;
            cell = c;
          }
        }
      }
      cell ??= from;
      // Set before asking, so it is in place for the floor switch however
      // the panel renders it; a jump the panel declines must not leave it
      // behind for some later switch to that floor.
      pendingCenterRef.current = cell ? { townId, z: target.z, cell } : null;
      if (!onStairJump(target.z)) pendingCenterRef.current = null;
    },
    [roomAtMouse, onStairJump, townId]
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
        onDoubleClick={handleDoubleClick}
      />
      {tooltip && (
        <RoomTooltip
          room={tooltip.room}
          x={tooltip.x}
          y={tooltip.y}
          isCurrent={isPlayerTown && !!town && tooltip.room.id === town.roomId}
          showWalkHint={!!onWalkTo}
        />
      )}
      {picker && (
        <MarkerPicker
          x={picker.x}
          y={picker.y}
          title="Room icon"
          options={ROOM_ICON_TYPES}
          current={picker.current}
          onPick={(value) => setRoomIcon(townId, picker.roomId, value)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function isDiagonal(dir: TownDir): boolean {
  return dir.length === 2;
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

/**
 * A lateral link between two room centers. A `displaced` link (see
 * linkShape: its endpoints don't sit along the exit's own direction — a
 * collision, non-Euclidean geometry, or a diagonal whose ends drifted) is
 * drawn thin and dashed, leaving and arriving through the exit's own sides
 * (linkPolyline), so it never reads as a straight corridor through
 * unrelated rooms; a long straight run across empty cells stays a solid
 * street.
 */
function drawLink(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  dir: TownDir,
  displaced: boolean,
  door: boolean
) {
  const diag = isDiagonal(dir);
  const path = linkPolyline(a, b, dir, displaced, ROOM_HALF);
  ctx.strokeStyle = diag || displaced ? LINK_DIAG_COLOR : LINK_COLOR;
  ctx.lineWidth = diag || displaced ? 1.2 : 3;
  if (displaced) ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  if (displaced) ctx.setLineDash([]);

  // Door tick across the middle of the link
  if (door) {
    const [t0, t1] = doorTick(path, 5);
    ctx.strokeStyle = DOOR_COLOR;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(t0.x, t0.y);
    ctx.lineTo(t1.x, t1.y);
    ctx.stroke();
  }
}

function drawNamedLink(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
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

function drawRoom(ctx: CanvasRenderingContext2D, room: TownRoom, at: Point, isCurrent: boolean) {
  const { x, y } = at;
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

  // Point-of-interest icon (bank, shop, inn, ...) in landmark gold
  if (room.icon && room.icon !== 'none') {
    paintMarkerGlyph(
      ctx,
      room.icon,
      x + ROOM_HALF - 6,
      y - ROOM_HALF + 6,
      4.5,
      ICON_COLOR,
      BG_COLOR
    );
  }

  // Named-exit badge (boats, "back" rooms)
  if (room.namedExits.length > 0) {
    ctx.fillStyle = NAMED_COLOR;
    ctx.beginPath();
    ctx.arc(x + ROOM_HALF - 4, y + ROOM_HALF - 4, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Portal landmark: a purple arch (the portal itself)
  if (room.portal) {
    ctx.strokeStyle = NAMED_COLOR;
    ctx.lineWidth = 1.6;
    const ax = x - ROOM_HALF + 6;
    const ay = y + ROOM_HALF - 4;
    const r2 = 4;
    ctx.beginPath();
    ctx.moveTo(ax - r2, ay);
    ctx.lineTo(ax - r2, ay - 2);
    ctx.arc(ax, ay - 2, r2, Math.PI, 0);
    ctx.lineTo(ax + r2, ay);
    ctx.stroke();
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

function drawCurrentGlow(ctx: CanvasRenderingContext2D, at: Point) {
  const { x, y } = at;
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
  isCurrent,
  showWalkHint,
}: {
  room: TownRoom;
  /** Viewport (client) coords — rendered via portal with fixed positioning */
  x: number;
  y: number;
  isCurrent: boolean;
  showWalkHint: boolean;
}) {
  const tipW = 230;
  const tipH = 100;
  const tx = x + tipW + 16 > window.innerWidth ? x - tipW - 8 : x + 8;
  const ty = y + tipH + 16 > window.innerHeight ? window.innerHeight - tipH - 8 : y + 8;

  const exits = room.exits.map((d) => DIR_LABELS[d]).join(', ');

  return createPortal(
    <div
      className="fixed pointer-events-none z-[10000] rounded px-3 py-2 max-w-[230px]"
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
        {room.icon && room.icon !== 'none' && (
          <span style={{ color: ICON_COLOR }}>
            {' '}
            · {ROOM_ICON_TYPES.find((i) => i.type === room.icon)?.label ?? room.icon}
          </span>
        )}
        {room.portal && <span style={{ color: NAMED_COLOR }}> · portal</span>}
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
      <div className="text-[9px] opacity-40 mt-0.5 italic">
        {!isCurrent && showWalkHint ? 'Right-click to walk here · ' : ''}Shift+click to set icon
      </div>
    </div>,
    document.body
  );
}
