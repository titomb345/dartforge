/**
 * Regression test: the town map COMPONENTS — the real TownMapCanvas and
 * MapPanel, rendered by React into a linkedom DOM with a recording canvas
 * context. test-display-compaction.ts covers the display geometry as pure
 * functions; this covers what only the components decide: which cells they
 * draw, hit-test and center on, WHEN the view re-centers, and which map the
 * panel shows.
 *
 * The town comes from the real engine, and its display differs from the
 * store: a collision stretch leaves the West Gate→Well spur two cells long,
 * and the display pulls the Well a cell north, together with the floor its
 * stairs lead to (Loft, Gallery, Tower, Spire).
 *
 *  A. TownMapCanvas
 *   1. Room boxes, labels, the walk route, the current-room glow, search
 *      focus and right-click hit-testing all use the display cells, on both
 *      floors (a pulled room's empty store cell walks nowhere).
 *   2. The view re-centers only on a real change: the player's room, floor
 *      or town (or their display cell), the center button, a floor or town
 *      switch. A sync that changes nothing about the player (a fresh town
 *      summary object, a room added elsewhere, a walk or LOST update, the
 *      player moving on another floor than the one shown) keeps the user's
 *      pan. Before, every room block and survey snapped the view back.
 *   3. A stair double-click shows the floor the stairs lead to, centered on
 *      the room they arrive in (it used to be the floor's centroid), also
 *      when that is the player's floor, and through the real panel too; a
 *      jump the panel declines leaves no target behind for a later switch
 *      to that floor.
 *  B. MapPanel
 *   4. Auto shows the town map only while the town localizer is tracking
 *      (townActive), not merely because the hex side says indoors: right
 *      after a login or a re-enable, `town` is still the last saved position.
 *   5. The center button brings the view back to the player's own town and
 *      floor; with no town position at all it keeps the browsed town (it
 *      used to jump to whichever town the picker lists first).
 *
 * Everything runs twice: plain, and under StrictMode (mount effects twice).
 */
import { parseHTML } from 'linkedom';
import type { ReactElement } from 'react';
import type { AppSettingsState } from '../../src/contexts/AppSettingsContext';
import type {
  MapTrackerActions,
  MapTrackerState,
  TownSummary,
} from '../../src/hooks/useMapTracker';
import { computeTownDisplayLayout, type DisplayCell } from '../../src/lib/townDisplayLayout';
import { TownMapStore, type TownRoom } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';

// ---------------------------------------------------------------------------
// DOM: linkedom, plus the few browser APIs the components use that it lacks
// ---------------------------------------------------------------------------

/** Canvas size (MapPanel's default before its ResizeObserver reports) */
const W = 400;
const H = 300;
/** TownMapCanvas's grid pitch and room box half-size */
const CELL = 46;
const ROOM_HALF = 14;

const { window } = parseHTML('<!doctype html><html><body></body></html>');
const frame = (cb: () => void) => setTimeout(cb, 0) as unknown as number;
const cancelFrame = (id: number) => clearTimeout(id);
Object.assign(window, {
  requestAnimationFrame: frame,
  cancelAnimationFrame: cancelFrame,
  innerWidth: 1200,
  innerHeight: 800,
});
const g = globalThis as unknown as Record<string, unknown>;
Object.assign(g, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  requestAnimationFrame: frame,
  cancelAnimationFrame: cancelFrame,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  IS_REACT_ACT_ENVIRONMENT: true,
});

/** One recorded draw call: [method, ...args] */
type Op = [string, ...unknown[]];
interface Recording {
  ops: Op[];
}

/** A 2D context recording the calls the checks read; everything else is a no-op */
function recordingContext(): Recording {
  const ops: Op[] = [];
  const target: Record<PropertyKey, unknown> = {
    ops,
    // 8px Courier New advances 0.6em per character
    measureText: (text: string) => ({ width: text.length * 4.8 }),
  };
  for (const name of ['translate', 'roundRect', 'arc', 'fillText']) {
    target[name] = (...args: unknown[]) => ops.push([name, ...args]);
  }
  return new Proxy(target, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => {
      t[p] = v;
      return true;
    },
  }) as unknown as Recording;
}
type RecordedCanvas = HTMLCanvasElement & { recording?: Recording };
const canvasProto = Object.getPrototypeOf(window.document.createElement('canvas')) as {
  getContext: (this: RecordedCanvas) => Recording;
  getBoundingClientRect: () => Partial<DOMRect>;
};
canvasProto.getContext = function () {
  return (this.recording ??= recordingContext());
};
canvasProto.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  right: W,
  bottom: H,
  width: W,
  height: H,
  x: 0,
  y: 0,
});

/** A mouse event as React reads it (linkedom's events carry no coordinates) */
function mouseEvent(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  const fields = { clientX: x, clientY: y, button: 0, buttons: 0, shiftKey: false, ...extra };
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
  return event;
}

// React and the components load only now: react-dom checks for a DOM once,
// when it is first imported.
const React = await import('react');
// tsx compiles the components' JSX with the automatic runtime when it reads
// the repo's tsconfig (run from the repo root, as test-town.ts is); run from
// anywhere else it emits React.createElement, which then finds this.
g.React = React;
const { act, createElement, StrictMode, useState } = React;
const { createRoot } = await import('react-dom/client');
const { MapProvider } = await import('../../src/contexts/MapContext');
const { AppSettingsProvider } = await import('../../src/contexts/AppSettingsContext');
const { PanelProvider } = await import('../../src/contexts/PanelLayoutContext');
const { TownMapCanvas } = await import('../../src/components/TownMapCanvas');
const { MapPanel } = await import('../../src/components/MapPanel');

type MapValue = MapTrackerState & MapTrackerActions;
type Focus = { roomId: number; nonce: number } | null;

let checks = 0;
let failures = 0;

async function run(strict: boolean) {
  const mode = strict ? 'StrictMode' : 'plain';
  const check = (cond: boolean, msg: string) => {
    checks++;
    if (!cond) {
      console.error(`FAIL (${mode}): ${msg}`);
      failures++;
    }
  };
  const wrap = (el: ReactElement) => (strict ? createElement(StrictMode, null, el) : el);

  // -------------------------------------------------------------------------
  // The town, built by the real engine
  // -------------------------------------------------------------------------

  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
    name,
    descFirst: desc,
    desc,
    exits: parseTownExits(`There are exits: ${exits}.`),
  });
  const step = (cmd: string | null, b: TownRoomBlock) => {
    if (cmd) loc.trackCommand(cmd, (t += 1000));
    loc.onRoomBlock(b, '0:0,0', (t += 1000));
    return map.pos!.roomId;
  };
  const CENTER = block('Center Square', 'north, east, south, and west', 'The center of town.');
  const ROAD = block('Road', 'east and west', 'A cobblestone road running east to west.');
  // A staircase up that is never taken (stair double-click on an untaken stair)
  const FERRY = block('Ferry Landing', 'west and up', 'A landing at the river ferry.');
  const WEST_GATE = block('West Gate', 'east and south', 'The old west gate of the town.');
  const WELL = block('Well', 'north and up', 'A deep stone well under a little roof.');
  const LOFT = block('Loft', 'down and east', 'A loft above the well.');
  const GALLERY = block('Gallery', 'west and east', 'A gallery over the square.');
  const TOWER = block('Tower', 'west and east', 'A tower room.');
  const SPIRE = block('Spire', 'west', 'The top of the spire.');
  const SOUTH_ROAD = block('South Road', 'north and east', 'The south road bends east.');
  const LANE = block('Lane', 'north, east, and west', 'A narrow lane between houses.');
  const center = step(null, CENTER);
  step('e', ROAD);
  const ferry = step('e', FERRY);
  step('w', ROAD);
  step('w', CENTER);
  const westGate = step('w', WEST_GATE);
  const well = step('s', WELL);
  const loft = step('u', LOFT);
  const gallery = step('e', GALLERY);
  const tower = step('e', TOWER);
  const spire = step('e', SPIRE);
  step('w', TOWER);
  step('w', GALLERY);
  step('w', LOFT);
  step('d', WELL);
  step('n', WEST_GATE);
  step('e', CENTER);
  step('s', SOUTH_ROAD);
  const lane = step('e', LANE);
  // n from the Lane lands where the first Road sits, but that Road has no
  // south exit: a different room, so the store stretches the first Road's
  // structure north, which leaves the West Gate→Well spur two cells long
  const roadB = step('n', ROAD);

  const town = map.get(map.pos!.townId)!;
  const rooms = () => [...town.rooms.values()];
  const room = (id: number) => town.rooms.get(id)!;
  /** Where the canvas should draw a room: the display layout of the town as it is now */
  const cellOf = (id: number) => computeTownDisplayLayout(rooms()).pos(id)!;
  const centroid = (z: number): DisplayCell => {
    const cells = rooms()
      .filter((r) => r.z === z)
      .map((r) => cellOf(r.id));
    return {
      x: cells.reduce((s, c) => s + c.x, 0) / cells.length,
      y: cells.reduce((s, c) => s + c.y, 0) / cells.length,
    };
  };
  /** The display cell of floor z's room nearest `from` (Manhattan) */
  const nearestOnFloor = (z: number, from: DisplayCell): DisplayCell => {
    let best: DisplayCell = from;
    let bestD = Infinity;
    for (const r of rooms()) {
      if (r.z !== z) continue;
      const c = cellOf(r.id);
      const d = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };
  check(map.stretches === 1, `setup: expected one collision stretch, got ${map.stretches}`);
  check(
    cellOf(well).y === room(well).y - 1,
    'setup: the display should pull the Well a cell north of its store cell'
  );
  check(
    room(loft).z === 1 && cellOf(loft).y === room(loft).y - 1,
    'setup: ... and the Loft upstairs with it'
  );

  // -------------------------------------------------------------------------
  // The map context, as useMapTracker's syncState hands it out (a fresh
  // value per sync), with a second town for the panel's picker
  // -------------------------------------------------------------------------

  const OTHER_TOWN = 99;
  const otherSquare: TownRoom = {
    ...room(center),
    id: 0,
    name: 'Other Square',
    x: 5,
    y: 5,
    z: 0,
    links: {},
    namedLinks: {},
  };
  const summary = (roomId: number): TownSummary => ({
    id: town.id,
    name: town.name,
    roomId,
    roomName: room(roomId).name,
    floor: room(roomId).z,
    roomCount: town.rooms.size,
  });
  let version = 0;
  const mapValue = (fields: Partial<MapValue>): MapValue => {
    const value: Partial<MapValue> = {
      version: ++version,
      currentPos: null,
      cellCount: 0,
      visitedCount: 0,
      islandCount: 0,
      lost: false,
      indoors: true,
      walking: null,
      town: summary(roadB),
      townCount: 2,
      townLost: false,
      townActive: true,
      townWalking: null,
      centerVersion: 0,
      getCells: () => [],
      getCellAt: () => undefined,
      findPathTo: () => null,
      getTowns: () => [
        { id: town.id, name: town.name, roomCount: town.rooms.size },
        { id: OTHER_TOWN, name: 'Other Town', roomCount: 1 },
      ],
      getTownRooms: (id) => (id === undefined || id === town.id ? rooms() : [{ ...otherSquare }]),
      getTownFloors: (id) => (id === undefined || id === town.id ? map.floorsOf(town) : [0]),
      ...fields,
    };
    // A fresh summary object every time, like syncState's
    if (value.town) value.town = { ...value.town };
    // Every other action is a no-op
    return new Proxy(value, {
      get: (o, p) => (p in o ? o[p as keyof MapValue] : () => {}),
    }) as MapValue;
  };

  // -------------------------------------------------------------------------
  // A. TownMapCanvas
  // -------------------------------------------------------------------------

  const walks: number[] = [];
  const stairJumps: number[] = [];
  /** Make the host refuse stair jumps (MapPanel does for an unmapped floor) */
  let declineStairs = false;
  let fields: Partial<MapValue> = {};
  type Host = { value: MapValue; floor: number; focus: Focus };
  let host: Host = { value: mapValue(fields), floor: 0, focus: null };
  let setHost: (next: Host) => void = () => {};
  function CanvasHost() {
    const [state, setState] = useState(host);
    setHost = (next) => {
      host = next;
      setState(next);
    };
    return createElement(MapProvider, {
      value: state.value,
      children: createElement(TownMapCanvas, {
        width: W,
        height: H,
        townId: town.id,
        floor: state.floor,
        showLabels: true,
        onWalkTo: (id: number) => walks.push(id),
        focus: state.focus,
        // Like MapPanel: switch to the floor the stairs lead to
        onStairJump: (z: number) => {
          stairJumps.push(z);
          if (declineStairs) return false;
          setHost({ ...host, floor: z });
          return true;
        },
      }),
    });
  }
  /** A sync: a fresh context value carrying these changes (and all earlier ones) */
  const sync = (changes: Partial<MapValue> = {}) =>
    act(async () => {
      fields = { ...fields, ...changes };
      setHost({ ...host, value: mapValue(fields) });
    });
  /** The panel showing another floor, optionally focused on a search hit */
  const showFloor = (floor: number, focus: Focus = null) =>
    act(async () => setHost({ ...host, floor, focus }));

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(wrap(createElement(CanvasHost))));

  /** Where the helpers below find the canvas (the panel's, in part B) */
  let box: HTMLElement = container;
  const canvas = () => box.querySelector('canvas') as RecordedCanvas;
  /** The last draw: its ops, from the translate that starts it, and its pan (world px) */
  const lastDraw = () => {
    const ops = canvas().recording!.ops;
    let i = ops.length - 1;
    while (i > 0 && ops[i][0] !== 'translate') i--;
    const [, cx, cy] = ops[i] as [string, number, number];
    return { ops: ops.slice(i), pan: { x: cx - W / 2, y: cy - H / 2 } };
  };
  const pan = () => lastDraw().pan;
  const samePan = (a: DisplayCell, b: DisplayCell) => a.x === b.x && a.y === b.y;
  const centeredOn = (c: DisplayCell) => {
    const p = pan();
    return Math.abs(p.x + c.x * CELL) < 1e-9 && Math.abs(p.y + c.y * CELL) < 1e-9;
  };
  /** Viewport point of a grid cell under the current pan (zoom 1) */
  const screenOf = (c: DisplayCell) => {
    const p = pan();
    return { x: W / 2 + p.x + c.x * CELL, y: H / 2 + p.y + c.y * CELL };
  };
  /** A grid cell's center in world px, as "x,y" */
  const px = (c: DisplayCell) => `${c.x * CELL},${c.y * CELL}`;
  /** Where the last draw put the current-room glow ("x,y" in world px) */
  const glowAt = () => {
    const op = lastDraw().ops.find(
      (o) => o[0] === 'arc' && Math.abs((o[3] as number) - 0.8 * ROOM_HALF) < 1e-9
    );
    return op ? `${op[1]},${op[2]}` : 'none';
  };
  const fire = (type: string, at: DisplayCell, extra?: Record<string, unknown>) =>
    act(async () => {
      canvas().dispatchEvent(mouseEvent(type, at.x, at.y, extra));
      await new Promise((resolve) => setTimeout(resolve, 5)); // a drag's animation frame
    });
  const drag = async (dx: number, dy: number) => {
    await fire('mousedown', { x: 200, y: 150 });
    await fire('mousemove', { x: 200 + dx, y: 150 + dy }, { buttons: 1 });
    await fire('mouseup', { x: 200 + dx, y: 150 + dy });
  };
  const rightClick = async (at: DisplayCell) => {
    walks.length = 0;
    await fire('contextmenu', screenOf(at), { button: 2 });
    return walks.join();
  };
  const stairClick = async (id: number) => {
    stairJumps.length = 0;
    await fire('dblclick', screenOf(cellOf(id)));
    return stairJumps.join();
  };

  // 1. Drawn on the display cells
  {
    const ops = lastDraw().ops;
    const boxes = ops
      .filter((o) => o[0] === 'roundRect')
      .map((o) => `${(o[1] as number) + ROOM_HALF},${(o[2] as number) + ROOM_HALF}`);
    const want = rooms()
      .filter((r) => r.z === 0)
      .map((r) => px(cellOf(r.id)));
    check(
      boxes.length === want.length && want.every((w) => boxes.includes(w)),
      `floor 0's room boxes should be drawn on their display cells (drawn ${boxes.join(' ')}; want ${want.join(' ')})`
    );
    const label = ops.find((o) => o[0] === 'fillText' && o[1] === 'Well');
    check(
      !!label && `${label[2]},${(label[3] as number) - ROOM_HALF - 3}` === px(cellOf(well)),
      "the Well's label should sit under its drawn box"
    );
  }
  check(centeredOn(cellOf(roadB)), 'the first draw should center on the player (the second Road)');

  // 2. Syncs that change nothing about the player keep the user's pan
  await drag(100, 50);
  const panned = pan();
  check(
    samePan(panned, { x: -cellOf(roadB).x * CELL + 100, y: -cellOf(roadB).y * CELL + 50 }),
    `a drag should pan the view (pan ${panned.x},${panned.y})`
  );
  await sync({ town: summary(roadB) });
  check(samePan(pan(), panned), 'a sync with a fresh town summary (same room) must keep the pan');
  map.addRoom(town, block('Shed', 'west', 'A garden shed.'), 9, 9, 0, (t += 1000));
  await sync({ town: summary(roadB) });
  check(samePan(pan(), panned), 'a room added elsewhere (a new display layout) must keep the pan');

  // 1. Hit-testing on the display cells
  let walked = await rightClick(cellOf(well));
  check(
    walked === `${well}`,
    `right-click on the Well's drawn box should walk there (got [${walked}])`
  );
  walked = await rightClick(room(well));
  check(
    walked === '',
    `right-click on the Well's empty store cell must walk nowhere (got [${walked}])`
  );

  // 2. The player moving re-centers; 1. the walk route and the glow on display cells
  await sync({ town: summary(lane) });
  check(centeredOn(cellOf(lane)), 'the player moving should re-center on the new room');
  await sync({ townWalking: { remaining: 3, path: [westGate, well, loft] } });
  const dots = lastDraw()
    .ops.filter((o) => o[0] === 'arc' && o[3] === 2.5)
    .map((o) => `${o[1]},${o[2]}`);
  check(
    dots.includes(px(cellOf(well))),
    `the walk route's dot for the Well should be on its drawn cell (dots ${dots.join(' ')})`
  );
  check(glowAt() === px(cellOf(lane)), `the current-room glow should be on the Lane (${glowAt()})`);
  await sync({ townWalking: null });

  // 3. Stair double-click: the floor above, centered where the stairs arrive
  let asked = await stairClick(well);
  check(asked === '1', `double-clicking the Well should ask for floor 1 (asked [${asked}])`);
  const mid1 = centroid(1);
  check(
    host.floor === 1 && centeredOn(cellOf(loft)),
    `the stair jump should center on the Loft, where the stairs arrive (not floor 1's centroid ${mid1.x},${mid1.y})`
  );

  // 1. Search focus on the display cells
  await showFloor(1, { roomId: spire, nonce: 1 });
  check(centeredOn(cellOf(spire)), 'search focus should center on the Spire');

  // 2. Browsing another floor: syncs don't snap the view back
  await drag(-60, -30);
  const browsed = pan();
  await sync({ town: summary(lane) });
  check(samePan(pan(), browsed), 'a sync while browsing floor 1 must keep the pan');
  await showFloor(0);
  check(centeredOn(cellOf(lane)), "returning to the player's floor should center on the player");
  await drag(60, 0);
  await sync({ centerVersion: 1 });
  check(centeredOn(cellOf(lane)), 'the center button should re-center on the player');

  // 3. A stair jump onto the player's own floor still lands on the arrival room
  await sync({ town: summary(gallery) }); // the player is up in the Gallery
  asked = await stairClick(well);
  check(asked === '1', `double-clicking the Well should ask for floor 1 (asked [${asked}])`);
  check(
    centeredOn(cellOf(loft)),
    "onto the player's floor, the stair jump should center on the Loft, not on the player (the Gallery)"
  );
  // Switching to the player's floor centers on their drawn cell (the Gallery
  // was pulled north with the Loft), and a search hit there wins over that
  await showFloor(0);
  await showFloor(1);
  check(centeredOn(cellOf(gallery)), "switching to the player's floor should center on the player");
  await showFloor(0);
  await showFloor(1, { roomId: spire, nonce: 2 });
  check(centeredOn(cellOf(spire)), "a search hit on the player's floor should win over the player");

  // 2. The player moving on another floor than the one shown keeps the pan;
  // taking the stairs onto the shown floor re-centers
  await showFloor(1);
  await drag(-80, -50);
  const browsing = pan();
  await sync({ town: summary(lane) });
  check(samePan(pan(), browsing), 'the player moving on floor 0 must not re-center floor 1');
  await sync({ town: summary(loft) });
  check(centeredOn(cellOf(loft)), 'taking the stairs onto the floor shown should re-center');
  check(glowAt() === px(cellOf(loft)), `the glow should be on the Loft's drawn cell (${glowAt()})`);
  await drag(30, 20);
  const kept = pan();
  await sync({ townWalking: { remaining: 2, path: [gallery, tower] }, townLost: true });
  check(samePan(pan(), kept), 'a walk or LOST update must keep the pan');
  await sync({ townWalking: null, townLost: false });

  // 1. Hit-testing upstairs: the Loft was pulled along with the Well
  walked = await rightClick(cellOf(loft));
  check(
    walked === `${loft}`,
    `right-click on the Loft's drawn box should walk there (got [${walked}])`
  );
  walked = await rightClick(room(loft));
  check(
    walked === '',
    `right-click on the Loft's empty store cell must walk nowhere (got [${walked}])`
  );

  // 3. A stair jump the panel declines leaves no target behind
  await sync({ town: summary(lane) });
  await showFloor(0);
  declineStairs = true;
  asked = await stairClick(well);
  declineStairs = false;
  check(asked === '1' && host.floor === 0, 'setup: the declined stair jump stays on floor 0');
  await showFloor(1); // the floor stepper, later
  check(
    centeredOn(centroid(1)),
    "a later switch to floor 1 should center on its centroid, not on a declined jump's arrival room"
  );

  // 3. A staircase never taken has no known arrival room: the jump lands on
  // the mapped room of that floor nearest the stairs (the Spire, right above
  // the Ferry Landing), not on the stairs' own cell up there, which is empty
  await showFloor(0);
  asked = await stairClick(ferry);
  check(
    asked === '1',
    `double-clicking the Ferry Landing should ask for floor 1 (asked [${asked}])`
  );
  check(
    host.floor === 1 && centeredOn(nearestOnFloor(1, cellOf(ferry))) && !centeredOn(cellOf(ferry)),
    'an untaken staircase should center on the nearest mapped room of the floor it leads to'
  );

  await act(async () => root.unmount());
  container.remove();

  // -------------------------------------------------------------------------
  // B. MapPanel
  // -------------------------------------------------------------------------

  const settings = new Proxy(
    { mapShowFog: false, mapShowLabels: true, townMapperEnabled: true },
    { get: (o: Record<PropertyKey, unknown>, p) => (p in o ? o[p] : () => {}) }
  ) as unknown as AppSettingsState;
  let setPanelValue: (value: MapValue) => void = () => {};
  function PanelHost() {
    const [value, setValue] = useState(() => mapValue({ townActive: false }));
    setPanelValue = setValue;
    return createElement(PanelProvider, {
      layout: { left: [], right: [] },
      activePanel: null,
      togglePanel: () => {},
      closePanel: () => {},
      pinPanel: () => {},
      children: createElement(AppSettingsProvider, {
        value: settings,
        children: createElement(MapProvider, {
          value,
          children: createElement(MapPanel, { mode: 'slideout' }),
        }),
      }),
    });
  }
  const panelBox = window.document.createElement('div');
  window.document.body.appendChild(panelBox);
  const panelRoot = createRoot(panelBox);
  await act(async () => panelRoot.render(wrap(createElement(PanelHost))));
  const text = () => panelBox.textContent ?? '';
  const where = () => text().match(/Viewing [A-Za-z ]+|Road — [A-Za-z ]+/)?.[0] ?? 'no location';
  const buttonWhere = (pred: (b: HTMLButtonElement) => boolean) =>
    [...panelBox.querySelectorAll('button')].find(pred);
  const titled = (title: string) => buttonWhere((b) => b.getAttribute('title') === title);
  const click = (b: HTMLButtonElement | undefined) =>
    act(async () => {
      b?.dispatchEvent(mouseEvent('click', 0, 0));
    });
  const setPanel = (changes: Partial<MapValue>) =>
    act(async () => setPanelValue(mapValue(changes)));
  const pickTown = async (id: number) => {
    const picker = panelBox.querySelector('select');
    if (!picker) return false;
    Object.defineProperty(picker, 'value', { value: String(id), configurable: true });
    await act(async () => {
      picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    return true;
  };
  const RECENTER = 'Center on current position';

  // 4. Auto follows townActive, not just "indoors"
  check(
    text().includes('IN TOWN') && !text().includes('Road — '),
    'Auto, indoors while the town localizer tracks no room: the hex map with its IN TOWN badge, not the last saved room'
  );
  await setPanel({ townActive: true });
  check(
    !text().includes('IN TOWN') && text().includes(`Road — ${town.name}`),
    `Auto: the town map once the localizer tracks the room (${where()})`
  );
  await setPanel({ townActive: true, townLost: true });
  check(
    !text().includes('IN TOWN') && text().includes('LOST'),
    'Auto: still the town map (with its LOST badge) while the localizer tracks but is lost'
  );
  await setPanel({ townActive: false, indoors: false });
  check(!text().includes('Road — '), 'Auto outdoors: the hex map');

  // 5. The center button: back to the player's own town and floor...
  await click(titled('Town room map'));
  check(await pickTown(OTHER_TOWN), 'setup: the town picker should show in the town view');
  check(text().includes('Viewing Other Town'), `setup: browsing the other town (${where()})`);
  await click(titled(RECENTER));
  check(
    text().includes(`Road — ${town.name}`),
    `the center button should bring the view back to the player's own town (${where()})`
  );
  const up = buttonWhere((b) => b.textContent === '▲');
  check(!!up, 'setup: the floor stepper should show');
  await click(up);
  check(text().includes('(viewing F1)'), `setup: browsing floor 1 (${where()})`);
  await click(titled(RECENTER));
  check(!text().includes('(viewing F1)'), "the center button should return to the player's floor");
  // 3. Through the panel: the Well's stairs show floor 1, centered on the Loft
  box = panelBox;
  await fire('dblclick', screenOf(cellOf(well)));
  check(
    text().includes('(viewing F1)') && centeredOn(cellOf(loft)),
    `double-clicking the Well should show floor 1 centered on the Loft (${where()})`
  );
  // 5. ... and with no town position at all, the browsed town stays
  await setPanel({ townActive: false, indoors: false, town: null });
  await pickTown(OTHER_TOWN);
  check(text().includes('Viewing Other Town'), `setup: browsing the other town (${where()})`);
  await click(titled(RECENTER));
  check(
    text().includes('Viewing Other Town'),
    `the center button with no town position must keep the browsed town (${where()})`
  );

  await act(async () => panelRoot.unmount());
  panelBox.remove();
}

await run(false);
await run(true);
if (failures > 0) {
  console.error(`${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(
  `PASS — ${checks} checks: the town map draws, hit-tests and centers on the display layout, re-centers only on real changes, and Auto follows townActive`
);
