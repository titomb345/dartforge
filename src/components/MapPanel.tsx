/**
 * MapPanel — pinnable panel wrapper for the auto-mapper.
 *
 * Two views: the hex wilderness map and the town room map. "Auto" follows
 * the player — town view while indoors, hex view outside.
 */

import { useRef, useState, useEffect } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PanelHeader } from './PanelHeader';
import { MapIcon } from './icons';
import { MapCanvas } from './MapCanvas';
import { TownMapCanvas } from './TownMapCanvas';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { useMapContext } from '../contexts/MapContext';
import { TERRAIN_LABELS } from '../lib/hexTerrainPatterns';

type ViewMode = 'auto' | 'hex' | 'town';

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
    townLost,
    townWalking,
    getCellAt,
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [showLabels, setShowLabels] = useState(false);
  const [showFog, setShowFog] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  /** Floor being browsed; null = follow the player's floor */
  const [floorOverride, setFloorOverride] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const townView = viewMode === 'town' || (viewMode === 'auto' && indoors && town !== null);
  const playerFloor = town?.floor ?? 0;
  const floor = floorOverride ?? playerFloor;

  // Moving to another floor in-game snaps the view back to the player
  useEffect(() => {
    setFloorOverride(null);
  }, [playerFloor]);

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

  const mapTitle = townView
    ? town
      ? `Map — ${town.roomName} (${town.name})`
      : 'Map — Town'
    : currentCell
      ? `Map — ${TERRAIN_LABELS[currentCell.terrain] ?? 'Hex'} (${currentPos!.q}, ${currentPos!.r})`
      : 'Map';

  const floors = townView ? getTownFloors() : [];
  const floorIdx = floors.indexOf(floor);

  const viewButton = (m: ViewMode, label: string, title: string) => (
    <button
      onClick={() => setViewMode(m)}
      className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
        viewMode === m
          ? 'border-[#e8a849]/30 text-[#e8a849] bg-[#e8a849]/10'
          : 'border-border-dim text-text-dim hover:text-text-label'
      }`}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className={panelRootClass(isPinned)} style={!isPinned ? { width: 480 } : undefined}>
      <PanelHeader icon={<MapIcon size={12} />} title={mapTitle} panel="map" mode={mode} />

      {/* Toolbar row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0 text-[10px]">
        {viewButton('auto', 'Auto', 'Follow the player — town view indoors, hex view outside')}
        {viewButton('hex', 'Hex', 'Hex wilderness map')}
        {viewButton('town', 'Town', 'Town room map')}
        <div className="w-px h-3.5 bg-border-subtle mx-0.5" />
        <button
          onClick={centerOnPlayer}
          className="px-1.5 py-0.5 rounded border border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle transition-colors cursor-pointer"
          title="Center on current position"
        >
          Center
        </button>
        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${showLabels ? 'border-[#e8a849]/30 text-[#e8a849] bg-[#e8a849]/10' : 'border-border-dim text-text-dim'}`}
          title={townView ? 'Toggle room name labels' : 'Toggle terrain labels'}
        >
          Labels
        </button>
        {!townView && (
          <button
            onClick={() => setShowFog((v) => !v)}
            className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${showFog ? 'border-[#e8a849]/30 text-[#e8a849] bg-[#e8a849]/10' : 'border-border-dim text-text-dim'}`}
            title="Dim hexes you've seen but never entered"
          >
            Fog
          </button>
        )}
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
              className={`min-w-[24px] text-center ${floor === playerFloor ? 'text-[#e8a849]' : 'text-text-label'}`}
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
        {((townView && townLost) || (!townView && lost)) && (
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
        {townView ? (
          <>
            {town && (
              <input
                value={nameDraft ?? town.name}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  if (nameDraft !== null && nameDraft.trim() && nameDraft !== town.name) {
                    renameTown(nameDraft);
                  }
                  setNameDraft(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    setNameDraft(null);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-24 bg-transparent border border-transparent hover:border-border-dim focus:border-border-subtle rounded px-1 py-0.5 text-right text-text-dim focus:text-text-label outline-none"
                title="Town name — click to rename"
              />
            )}
            <span className="text-text-dim" title="Mapped rooms in this town">
              {town ? `${town.roomCount} rooms` : 'no town yet'}
            </span>
            {town && (
              <ConfirmDeleteButton
                onDelete={deleteTown}
                variant="fixed"
                title="Delete this town's map"
              />
            )}
          </>
        ) : (
          <>
            <span className="text-text-dim" title="Visited / total mapped hexes">
              {visitedCount}/{cellCount} hexes
              {islandCount > 1 ? ` · ${islandCount} regions` : ''}
            </span>
            {cellCount > 0 && (
              <ConfirmDeleteButton
                onDelete={clearMap}
                variant="fixed"
                title="Clear hex map data (towns are kept)"
              />
            )}
          </>
        )}
      </div>

      {/* Canvas body */}
      <div ref={bodyRef} data-help-id="map-canvas" className="relative flex-1 overflow-hidden">
        {size.width > 0 &&
          size.height > 0 &&
          (townView ? (
            <TownMapCanvas
              width={size.width}
              height={size.height}
              floor={floor}
              showLabels={showLabels}
              dimmed={!indoors}
              onWalkTo={walkToRoom}
            />
          ) : (
            <MapCanvas
              width={size.width}
              height={size.height}
              showLabels={showLabels}
              showFog={showFog}
              dimmed={indoors}
              onWalkTo={walkTo}
            />
          ))}
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
        {townView && !indoors && (
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
