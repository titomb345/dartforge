/**
 * MapPanel — pinnable panel wrapper for the auto-mapper.
 *
 * Two views: the hex wilderness map and the town room map. "Auto" follows
 * the player — town view while indoors, hex view outside (the view actually
 * being shown gets a cyan tint on its button). In town view a picker
 * browses ANY mapped town from anywhere; walking is only offered in the
 * town you're physically in. The toolbar stays compact enough for a pinned
 * sidebar: Hex/Town/Center are icons, the gear menu (far right) holds
 * Labels/Fog, town rename, and the delete actions, and the current
 * location is an overlay on the canvas instead of the title.
 */

import { useRef, useState, useEffect } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PanelHeader } from './PanelHeader';
import { FocusIcon, GearIcon, HexGridIcon, HouseIcon, MapIcon } from './icons';
import { MapCanvas } from './MapCanvas';
import { TownMapCanvas } from './TownMapCanvas';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { ToggleSwitch } from './shared';
import { useMapContext } from '../contexts/MapContext';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { TERRAIN_LABELS } from '../lib/hexTerrainPatterns';

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
  const { mapShowFog, updateMapShowFog, mapShowLabels, updateMapShowLabels } =
    useAppSettingsContext();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [menuOpen, setMenuOpen] = useState(false);
  /** Town being browsed; null = follow the player's town */
  const [browseTownId, setBrowseTownId] = useState<number | null>(null);
  /** Floor being browsed; null = follow the player's floor */
  const [floorOverride, setFloorOverride] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const townView = viewMode === 'town' || (viewMode === 'auto' && indoors && town !== null);
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

  // Moving to another floor in-game (or switching displayed towns) snaps
  // the floor back to the default
  useEffect(() => {
    setFloorOverride(null);
  }, [playerFloor, displayedTownId]);

  // Resize observer to fill available space
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
  }, []);

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
  const viewBtnColor = (m: ViewMode) => {
    if (viewMode === m) return 'border-[#e8a849]/30 text-[#e8a849] bg-[#e8a849]/10';
    if (viewMode === 'auto' && m === effectiveView) return 'border-cyan/40 text-cyan bg-cyan/10';
    return 'border-border-dim text-text-dim hover:text-text-label';
  };

  const iconBtnBase =
    'flex items-center justify-center w-[22px] h-[19px] rounded border transition-colors cursor-pointer';
  const plainIconBtn = `${iconBtnBase} border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle`;

  const commitRename = () => {
    if (displayed && nameDraft !== null && nameDraft.trim() && nameDraft !== displayed.name) {
      renameTown(nameDraft, displayed.id);
    }
    setNameDraft(null);
  };

  return (
    <div className={panelRootClass(isPinned)} style={!isPinned ? { width: 480 } : undefined}>
      <PanelHeader icon={<MapIcon size={12} />} title="Map" panel="map" mode={mode} />

      {/* Toolbar row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0 text-[10px]">
        <button
          onClick={() => setViewMode('auto')}
          className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${viewBtnColor('auto')}`}
          title="Follow the player — town view indoors, hex view outside"
        >
          Auto
        </button>
        <button
          onClick={() => setViewMode('hex')}
          className={`${iconBtnBase} ${viewBtnColor('hex')}`}
          title="Hex wilderness map"
        >
          <HexGridIcon size={12} />
        </button>
        <button
          onClick={() => setViewMode('town')}
          className={`${iconBtnBase} ${viewBtnColor('town')}`}
          title="Town room map"
        >
          <HouseIcon size={12} />
        </button>
        <button
          onClick={centerOnPlayer}
          className={plainIconBtn}
          title="Center on current position"
        >
          <FocusIcon size={12} />
        </button>

        {townView && floors.length > 1 && (
          <div
            className="flex items-center gap-0.5 rounded border border-border-dim px-1"
            title="Browse floors (follows you when you take stairs)"
          >
            <button
              onClick={() => floorIdx > 0 && setFloorOverride(floors[floorIdx - 1])}
              disabled={floorIdx <= 0}
              className="text-text-dim hover:text-text-label disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              ▼
            </button>
            <span
              className={`min-w-[22px] text-center ${!browsing && floor === playerFloor ? 'text-[#e8a849]' : 'text-text-label'}`}
            >
              F{floor}
            </span>
            <button
              onClick={() =>
                floorIdx >= 0 &&
                floorIdx < floors.length - 1 &&
                setFloorOverride(floors[floorIdx + 1])
              }
              disabled={floorIdx < 0 || floorIdx >= floors.length - 1}
              className="text-text-dim hover:text-text-label disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              ▲
            </button>
          </div>
        )}

        {!townView && walking && (
          <button
            onClick={cancelWalk}
            className="px-1.5 py-0.5 rounded border border-[#e8a849]/40 text-[#e8a849] bg-[#e8a849]/10 hover:bg-[#e8a849]/20 transition-colors cursor-pointer animate-pulse"
            title="Stop auto-walking"
          >
            Walking ({walking.remaining}) ✕
          </button>
        )}
        {townView && townWalking && (
          <button
            onClick={cancelTownWalk}
            className="px-1.5 py-0.5 rounded border border-[#e8a849]/40 text-[#e8a849] bg-[#e8a849]/10 hover:bg-[#e8a849]/20 transition-colors cursor-pointer animate-pulse"
            title="Stop auto-walking"
          >
            Walking ({townWalking.remaining}) ✕
          </button>
        )}
        {((townView && townLost && !browsing) || (!townView && lost)) && (
          <span
            className="px-1.5 py-0.5 rounded border border-red/40 text-red text-[9px]"
            title={
              townView
                ? 'Room unknown — walk around to re-locate'
                : 'Position unknown — move to distinctive terrain to re-locate'
            }
          >
            LOST
          </span>
        )}

        <div className="flex-1" />

        {townView && towns.length > 0 ? (
          <select
            value={displayedTownId}
            onChange={(e) => {
              const id = Number(e.target.value);
              setBrowseTownId(id === town?.id ? null : id);
            }}
            className="max-w-[110px] text-[10px] px-1 py-0.5 rounded border border-border-dim bg-bg-input text-text-dim hover:text-text-label focus:outline-none focus:border-border-subtle transition-colors cursor-pointer"
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

        {/* Options menu (Labels / Fog / rename / delete) — far right */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={`${plainIconBtn} ${menuOpen ? 'text-text-label border-border-subtle' : ''}`}
            title="Map options"
          >
            <GearIcon size={11} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 flex flex-col gap-1.5 bg-bg-secondary border border-border rounded-md p-2 shadow-lg min-w-[180px] text-[10px]">
                <div className="text-text-dim text-[9px]">
                  {townView
                    ? displayed
                      ? `${displayed.roomCount} room${displayed.roomCount === 1 ? '' : 's'} · ${floors.length} floor${floors.length === 1 ? '' : 's'} · ${townCount} town${townCount === 1 ? '' : 's'} mapped`
                      : 'No town mapped yet'
                    : `${visitedCount}/${cellCount} hexes${islandCount > 1 ? ` · ${islandCount} regions` : ''}${townCount > 0 ? ` · ${townCount} town${townCount === 1 ? '' : 's'}` : ''}`}
                </div>
                <div className="h-px bg-border-subtle" />
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
                    <span
                      className="text-text-label"
                      title="Dim hexes you've seen but never entered"
                    >
                      Fog of war
                    </span>
                    <ToggleSwitch
                      checked={mapShowFog}
                      onChange={updateMapShowFog}
                      accent={ACCENT}
                    />
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
              </div>
            </>
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
                dimmed={!browsing && !indoors}
                onWalkTo={browsing ? undefined : walkToRoom}
              />
            )
          ) : (
            <MapCanvas
              width={size.width}
              height={size.height}
              showLabels={mapShowLabels}
              showFog={mapShowFog}
              dimmed={indoors}
              onWalkTo={walkTo}
            />
          ))}
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
          <div
            className="absolute top-2 right-2 z-20 pointer-events-none flex items-center justify-center px-2.5 py-1 rounded border border-cyan/35 bg-[#121517]/85"
            title="Browsing another town's map — walking is unavailable"
          >
            <span
              className="text-[9px] font-mono font-semibold tracking-[0.14em] leading-none text-cyan"
              style={{ marginRight: '-0.14em' }}
            >
              BROWSING
            </span>
          </div>
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
    </div>
  );
}
