/**
 * MapPanel — pinnable panel wrapper for the auto-mapper.
 *
 * Two views: the hex wilderness map and the town room map. "Auto" follows
 * the player — town view while indoors, hex view outside (the view actually
 * being shown gets a cyan tint on its button). In town view a picker
 * browses ANY mapped town from anywhere; walking is only offered in the
 * town you're physically in. The toolbar stays compact enough for a pinned
 * sidebar: it holds only the Auto/Hex/Town segmented switcher, the town
 * picker, and the gear menu (Labels/Fog, town rename, delete actions).
 * Everything else lives as overlays on the canvas, like a real map UI:
 * center / floor stepper / full screen bottom-right, the walking pill and
 * LOST badge bottom-left, and the current location top-left.
 */

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PanelHeader } from './PanelHeader';
import {
  CollapseIcon,
  ExpandIcon,
  FocusIcon,
  GearIcon,
  HexGridIcon,
  HouseIcon,
  MapIcon,
} from './icons';
import { MapCanvas } from './MapCanvas';
import { TownMapCanvas } from './TownMapCanvas';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { ToggleSwitch } from './shared';
import { useMapContext } from '../contexts/MapContext';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { TERRAIN_LABELS } from '../lib/hexTerrainPatterns';
import { MARKER_COLOR } from '../lib/mapMarkers';
import { PopoverMenu } from './PopoverMenu';

type ViewMode = 'auto' | 'hex' | 'town';

const ACCENT = '#e8a849';

export function MapPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const {
    currentPos,
    cellCount,
    visitedCount,
    islandCount,
    lost,
    indoors,
    walking,
    town,
    townCount,
    townLost,
    townWalking,
    getCellAt,
    getTowns,
    getTownRooms,
    getTownFloors,
    centerOnPlayer,
    clearMap,
    walkTo,
    cancelWalk,
    walkToRoom,
    cancelTownWalk,
    renameTown,
    deleteTown,
  } = useMapContext();
  const { mapShowFog, updateMapShowFog, mapShowLabels, updateMapShowLabels, townMapperEnabled } =
    useAppSettingsContext();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [menuOpen, setMenuOpen] = useState(false);
  const gearBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  /** Town being browsed; null = follow the player's town */
  const [browseTownId, setBrowseTownId] = useState<number | null>(null);
  /** Floor being browsed; null = follow the player's floor */
  const [floorOverride, setFloorOverride] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [roomSearch, setRoomSearch] = useState('');
  const [focusRoom, setFocusRoom] = useState<{ roomId: number; nonce: number } | null>(null);
  /** Full-screen popout (same pattern as the script editor's expand) */
  const [fullscreen, setFullscreen] = useState(false);

  // Esc leaves full screen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fullscreen]);

  // Kill switch off → v1.12 behavior: always the hex map, with the
  // IN TOWN badge overlay while indoors (below).
  const townView =
    townMapperEnabled && (viewMode === 'town' || (viewMode === 'auto' && indoors && town !== null));
  const effectiveView: 'hex' | 'town' = townView ? 'town' : 'hex';

  const towns = getTowns();
  const displayedTownId = browseTownId ?? town?.id ?? towns[0]?.id;
  const displayed = towns.find((t) => t.id === displayedTownId);
  /** Browsing a town other than the one the player is (last) in */
  const browsing = townView && displayedTownId !== undefined && displayedTownId !== town?.id;

  const floors = townView && displayedTownId !== undefined ? getTownFloors(displayedTownId) : [];
  const playerFloor = town?.floor ?? 0;
  const defaultFloor = browsing ? (floors.includes(0) ? 0 : (floors[0] ?? 0)) : playerFloor;
  const floor = floorOverride ?? defaultFloor;
  const floorIdx = floors.indexOf(floor);

  // Entering a different town follows the player again
  useEffect(() => {
    setBrowseTownId(null);
  }, [town?.id]);

  // Kill switch flipped off while Town view was selected — back to Auto
  useEffect(() => {
    if (!townMapperEnabled) setViewMode((m) => (m === 'town' ? 'auto' : m));
  }, [townMapperEnabled]);

  // Moving to another floor in-game (or switching displayed towns) snaps
  // the floor back to the default
  useEffect(() => {
    setFloorOverride(null);
  }, [playerFloor, displayedTownId]);

  // Room search is per-town
  useEffect(() => {
    setRoomSearch('');
    setFocusRoom(null);
  }, [displayedTownId]);

  const searchMatches =
    townView && displayedTownId !== undefined && roomSearch.trim().length >= 2
      ? getTownRooms(displayedTownId)
          .filter((r) => r.name.toLowerCase().includes(roomSearch.trim().toLowerCase()))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 6)
      : [];

  const jumpToRoom = (roomId: number, z: number) => {
    setFloorOverride(z);
    setFocusRoom((prev) => ({ roomId, nonce: (prev?.nonce ?? 0) + 1 }));
    setMenuOpen(false);
  };

  const handleStairJump = (fromZ: number, hasUp: boolean, hasDown: boolean) => {
    const up = fromZ + 1;
    const down = fromZ - 1;
    const target =
      hasUp && floors.includes(up) ? up : hasDown && floors.includes(down) ? down : null;
    if (target !== null) setFloorOverride(target);
  };

  // Resize observer to fill available space. Re-armed on fullscreen toggle —
  // the body div remounts into (or out of) the portal, so the old observed
  // element is gone.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fullscreen]);

  const currentCell = currentPos ? getCellAt(currentPos.q, currentPos.r) : undefined;

  /** Current location, shown as a canvas overlay (keeps the title short) */
  const locationLabel = townView
    ? browsing
      ? displayed
        ? `Viewing ${displayed.name}`
        : null
      : town
        ? `${town.roomName} — ${town.name}${floorOverride !== null && floor !== playerFloor ? ` (viewing F${floor})` : ''}`
        : null
    : currentCell
      ? `${TERRAIN_LABELS[currentCell.terrain] ?? 'Hex'} (${currentPos!.q}, ${currentPos!.r})`
      : null;

  /** Selected mode is amber; in Auto, the view actually shown is cyan. */
  const segBtnColor = (m: ViewMode) => {
    if (viewMode === m) return 'bg-[#e8a849]/15 text-[#e8a849]';
    if (viewMode === 'auto' && m === effectiveView) return 'bg-cyan/10 text-cyan';
    return 'text-text-dim hover:text-text-label hover:bg-white/[0.04]';
  };

  const plainIconBtn =
    'flex items-center justify-center w-[22px] h-[20px] rounded border transition-colors cursor-pointer border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle';

  /** Square buttons overlaid on the canvas (center, full screen) */
  const overlayBtn =
    'flex items-center justify-center w-6 h-6 rounded border border-border-subtle bg-[#171512]/90 text-text-dim hover:text-text-label hover:border-border transition-colors cursor-pointer';

  const activeWalk = townView ? townWalking : walking;
  const cancelActiveWalk = townView ? cancelTownWalk : cancelWalk;
  const isLost = townView ? townLost && !browsing : lost;

  const commitRename = () => {
    if (displayed && nameDraft !== null && nameDraft.trim() && nameDraft !== displayed.name) {
      renameTown(nameDraft, displayed.id);
    }
    setNameDraft(null);
  };

  // Toolbar + canvas body — rendered either inside the normal panel shell or
  // inside the full-screen popout (widescreen, like the script editor's).
  const content = (
    <>
      {/* Toolbar row — view switcher, town picker, gear. The map controls
          (center, floors, full screen) are overlays on the canvas below. */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border-subtle shrink-0 text-[10px]">
        <div className="flex items-stretch h-[20px] rounded border border-border-dim overflow-hidden shrink-0">
          <button
            onClick={() => setViewMode('auto')}
            className={`px-1.5 transition-colors cursor-pointer ${segBtnColor('auto')}`}
            title="Follow the player — town view indoors, hex view outside"
          >
            Auto
          </button>
          <button
            onClick={() => setViewMode('hex')}
            className={`flex items-center justify-center w-6 border-l border-border-dim transition-colors cursor-pointer ${segBtnColor('hex')}`}
            title="Hex wilderness map"
          >
            <HexGridIcon size={12} />
          </button>
          {townMapperEnabled && (
            <button
              onClick={() => setViewMode('town')}
              className={`flex items-center justify-center w-6 border-l border-border-dim transition-colors cursor-pointer ${segBtnColor('town')}`}
              title="Town room map"
            >
              <HouseIcon size={12} />
            </button>
          )}
        </div>

        <div className="flex-1" />

        {townView && towns.length > 0 ? (
          <select
            value={displayedTownId}
            onChange={(e) => {
              const id = Number(e.target.value);
              setBrowseTownId(id === town?.id ? null : id);
            }}
            className="min-w-0 max-w-[130px] text-[10px] px-1 py-0.5 rounded border border-border-dim bg-bg-input text-text-dim hover:text-text-label focus:outline-none focus:border-border-subtle transition-colors cursor-pointer"
            title="Browse any mapped town (• marks where you are)"
          >
            {towns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id === town?.id ? '• ' : ''}
                {t.name} ({t.roomCount})
              </option>
            ))}
          </select>
        ) : (
          !townView && (
            <span
              className="text-text-dim text-[9px]"
              title={`Visited/mapped hexes${islandCount > 1 ? ` (${islandCount} regions)` : ''}`}
            >
              {visitedCount}/{cellCount}
            </span>
          )
        )}

        {/* Options menu (Labels / Fog / rename / delete) — far right.
            Rendered through a portal so a small pinned panel can't clip it. */}
        <div className="relative">
          <button
            ref={gearBtnRef}
            onClick={() => {
              const rect = gearBtnRef.current?.getBoundingClientRect();
              if (rect) {
                setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              }
              setMenuOpen((v) => !v);
            }}
            className={`${plainIconBtn} ${menuOpen ? 'text-text-label border-border-subtle' : ''}`}
            title="Map options"
          >
            <GearIcon size={11} />
          </button>
          {menuOpen && (
            <PopoverMenu
              top={menuPos.top}
              right={menuPos.right}
              onClose={() => setMenuOpen(false)}
              className="flex flex-col gap-1.5 bg-bg-secondary border border-border rounded-md p-2 shadow-lg min-w-[180px] max-h-[70vh] overflow-y-auto text-[10px]"
            >
              <div className="text-text-dim text-[9px]">
                {townView
                  ? displayed
                    ? `${displayed.roomCount} room${displayed.roomCount === 1 ? '' : 's'} · ${floors.length} floor${floors.length === 1 ? '' : 's'} · ${townCount} town${townCount === 1 ? '' : 's'} mapped`
                    : 'No town mapped yet'
                  : `${visitedCount}/${cellCount} hexes${islandCount > 1 ? ` · ${islandCount} regions` : ''}${townCount > 0 ? ` · ${townCount} town${townCount === 1 ? '' : 's'}` : ''}`}
              </div>
              <div className="h-px bg-border-subtle" />
              {townView && displayed && (
                <>
                  <input
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchMatches.length > 0) {
                        jumpToRoom(searchMatches[0].id, searchMatches[0].z);
                      }
                    }}
                    placeholder="Find room…"
                    className="w-full bg-bg-primary border border-border-dim focus:border-border-subtle rounded px-1 py-0.5 text-text-label outline-none placeholder:text-text-dim/60"
                    title="Search rooms by name — Enter jumps to the best match"
                  />
                  {searchMatches.length > 0 && (
                    <div className="flex flex-col gap-0.5 max-h-[110px] overflow-y-auto">
                      {searchMatches.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => jumpToRoom(r.id, r.z)}
                          className="text-left px-1 py-0.5 rounded hover:bg-bg-primary text-text-label cursor-pointer truncate"
                        >
                          {r.name}{' '}
                          <span className="opacity-50">
                            F{r.z} · {r.visits}x
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="h-px bg-border-subtle" />
                </>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-label">
                  {townView ? 'Room labels' : 'Terrain labels'}
                </span>
                <ToggleSwitch
                  checked={mapShowLabels}
                  onChange={updateMapShowLabels}
                  accent={ACCENT}
                />
              </div>
              {!townView && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-label" title="Dim hexes you've seen but never entered">
                    Fog of war
                  </span>
                  <ToggleSwitch checked={mapShowFog} onChange={updateMapShowFog} accent={ACCENT} />
                </div>
              )}
              {townView && displayed && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-label shrink-0">Name</span>
                  <input
                    value={nameDraft ?? displayed.name}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        // Revert the draft only — don't let the menu's
                        // Escape-to-close swallow the rename cancel
                        e.stopPropagation();
                        setNameDraft(null);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-24 bg-bg-primary border border-border-dim focus:border-border-subtle rounded px-1 py-0.5 text-text-label outline-none"
                    title="Rename this town"
                  />
                </div>
              )}
              <div className="h-px bg-border-subtle" />
              {townView ? (
                displayed && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-text-dim">Delete town map</span>
                    <ConfirmDeleteButton
                      onDelete={() => {
                        deleteTown(displayed.id);
                        setBrowseTownId(null);
                        setMenuOpen(false);
                      }}
                      variant="fixed"
                      title={`Delete "${displayed.name}" (it re-maps as you walk)`}
                    />
                  </div>
                )
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-dim">Clear hex map</span>
                  <ConfirmDeleteButton
                    onDelete={() => {
                      clearMap();
                      setMenuOpen(false);
                    }}
                    variant="fixed"
                    title="Clear hex map data (towns are kept)"
                  />
                </div>
              )}
              {townView && (
                <>
                  <div className="h-px bg-border-subtle" />
                  <div className="text-[9px] leading-4 text-text-dim">
                    <span style={{ color: 'rgba(150, 135, 110, 0.9)' }}>━</span> corridor{'  '}
                    <span style={{ color: 'rgba(150, 135, 110, 0.6)' }}>╌</span> shortcut / squeezed
                    <br />
                    <span style={{ color: 'rgba(160, 120, 200, 0.9)' }}>╌</span> special exit
                    {'  '}
                    <span style={{ color: '#e8a849' }}>┃</span> door
                    <br />
                    <span className="text-text-label">▲▼</span> stairs (double-click to follow)
                    <br />
                    <span style={{ color: '#e8a849' }}>●</span> walk route{'  '}
                    <span style={{ color: 'rgba(150, 135, 110, 0.5)' }}>╶</span> unexplored exit
                    {'  '}
                    <span style={{ color: 'rgba(160, 120, 200, 0.9)' }}>∩</span> portal
                    <br />
                    <span style={{ color: MARKER_COLOR }}>◆</span> room icon (bank, shop, inn, …) —
                    Shift+click a room to set
                  </div>
                </>
              )}
            </PopoverMenu>
          )}
        </div>
      </div>

      {/* Canvas body */}
      <div ref={bodyRef} data-help-id="map-canvas" className="relative flex-1 overflow-hidden">
        {size.width > 0 &&
          size.height > 0 &&
          (townView ? (
            displayedTownId !== undefined && (
              <TownMapCanvas
                width={size.width}
                height={size.height}
                townId={displayedTownId}
                floor={floor}
                showLabels={mapShowLabels}
                dimmed={!browsing && !indoors && !fullscreen}
                onWalkTo={browsing ? undefined : walkToRoom}
                focus={focusRoom}
                onStairJump={handleStairJump}
              />
            )
          ) : (
            <MapCanvas
              width={size.width}
              height={size.height}
              showLabels={mapShowLabels}
              showFog={mapShowFog}
              dimmed={indoors && !fullscreen}
              onWalkTo={walkTo}
            />
          ))}
        {/* Map controls — bottom-right, stacked like a real map UI */}
        <div className="absolute bottom-2 right-2 z-20 flex flex-col items-end gap-1">
          {townView && floors.length > 1 && (
            <div
              className="flex flex-col items-stretch w-6 rounded border border-border-subtle bg-[#171512]/90 overflow-hidden"
              title="Browse floors (follows you when you take stairs)"
            >
              <button
                onClick={() =>
                  floorIdx >= 0 &&
                  floorIdx < floors.length - 1 &&
                  setFloorOverride(floors[floorIdx + 1])
                }
                disabled={floorIdx < 0 || floorIdx >= floors.length - 1}
                className="h-5 flex items-center justify-center text-[8px] text-text-dim hover:text-text-label hover:bg-white/[0.06] disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
              >
                ▲
              </button>
              <span
                className={`text-[9px] font-mono text-center leading-none py-1 border-y border-border-subtle ${!browsing && floor === playerFloor ? 'text-[#e8a849]' : 'text-text-label'}`}
              >
                F{floor}
              </span>
              <button
                onClick={() => floorIdx > 0 && setFloorOverride(floors[floorIdx - 1])}
                disabled={floorIdx <= 0}
                className="h-5 flex items-center justify-center text-[8px] text-text-dim hover:text-text-label hover:bg-white/[0.06] disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
              >
                ▼
              </button>
            </div>
          )}
          <button
            onClick={centerOnPlayer}
            className={overlayBtn}
            title="Center on current position"
          >
            <FocusIcon size={12} />
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              setFullscreen((v) => !v);
            }}
            className={overlayBtn}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen map'}
          >
            {fullscreen ? <CollapseIcon size={11} /> : <ExpandIcon size={11} />}
          </button>
        </div>

        {/* Walk status — bottom-left */}
        {(activeWalk || isLost) && (
          <div className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5">
            {activeWalk && (
              <button
                onClick={cancelActiveWalk}
                className="px-2 py-1 rounded border border-[#e8a849]/40 text-[#e8a849] text-[9px] font-mono leading-none bg-[#171512]/90 hover:bg-[#e8a849]/15 transition-colors cursor-pointer animate-pulse"
                title="Stop auto-walking"
              >
                Walking ({activeWalk.remaining}) ✕
              </button>
            )}
            {isLost && (
              <span
                className="px-2 py-1 rounded border border-red/40 text-red text-[9px] font-mono leading-none bg-[#171512]/90"
                title={
                  townView
                    ? 'Room unknown — walk around to re-locate'
                    : 'Position unknown — move to distinctive terrain to re-locate'
                }
              >
                LOST
              </span>
            )}
          </div>
        )}

        {locationLabel && (
          <div
            className="absolute top-2 left-2 z-20 pointer-events-none max-w-[70%] px-2 py-1 rounded border border-border-subtle bg-[#171512]/85"
            title="Current location"
          >
            <span className="block text-[9px] font-mono leading-none text-text-label truncate">
              {locationLabel}
            </span>
          </div>
        )}
        {!townView && indoors && (
          <div
            className="absolute top-2 right-2 z-20 pointer-events-none flex items-center justify-center px-2.5 py-1 rounded border border-[#e8a849]/35 bg-[#171512]/85"
            title="Hex movement is unavailable indoors"
          >
            <span
              className="text-[9px] font-mono font-semibold tracking-[0.14em] leading-none text-[#e8a849]"
              style={{ marginRight: '-0.14em' }}
            >
              IN TOWN
            </span>
          </div>
        )}
        {townView && browsing && (
          <button
            onClick={() => setBrowseTownId(null)}
            className="absolute top-2 right-2 z-20 flex items-center justify-center gap-1 px-2.5 py-1 rounded border border-cyan/35 bg-[#121517]/85 hover:bg-cyan/15 transition-colors cursor-pointer"
            title="Browsing another town's map (walking is unavailable). Click to return to your current town"
          >
            <span
              className="text-[9px] font-mono font-semibold tracking-[0.14em] leading-none text-cyan"
              style={{ marginRight: '-0.14em' }}
            >
              BROWSING ✕
            </span>
          </button>
        )}
        {townView && !browsing && !indoors && (
          <div
            className="absolute top-2 right-2 z-20 pointer-events-none flex items-center justify-center px-2.5 py-1 rounded border border-[#e8a849]/35 bg-[#171512]/85"
            title="Room movement is unavailable outdoors"
          >
            <span
              className="text-[9px] font-mono font-semibold tracking-[0.14em] leading-none text-[#e8a849]"
              style={{ marginRight: '-0.14em' }}
            >
              OUTDOORS
            </span>
          </div>
        )}
      </div>
    </>
  );

  if (fullscreen) {
    // Widescreen popout — the DartMUD world is much wider than it is tall.
    // Everything works exactly as in the panel: pan/zoom, hover-to-inspect,
    // right-click walks, Ctrl+click clears, the gear menu, the works.
    return createPortal(
      <div
        className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setFullscreen(false);
        }}
      >
        <div
          className="border border-[#e8a849]/30 rounded-lg bg-bg-primary flex flex-col overflow-hidden shadow-2xl"
          style={{ width: '94vw', height: '86vh', minWidth: 640, minHeight: 400 }}
        >
          {content}
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className={panelRootClass(isPinned)} style={!isPinned ? { width: 480 } : undefined}>
      <PanelHeader icon={<MapIcon size={12} />} title="Map" panel="map" mode={mode} />
      {content}
    </div>
  );
}
