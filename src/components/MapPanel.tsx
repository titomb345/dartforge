/**
 * MapPanel — pinnable panel wrapper for the hex auto-mapper.
 */

import { useRef, useState, useEffect } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PinnedControls } from './PinnedControls';
import { PinMenuButton } from './PinMenuButton';
import { MapIcon } from './icons';
import { MapCanvas } from './MapCanvas';
import { useMapContext } from '../contexts/MapContext';
import { TERRAIN_LABELS } from '../lib/hexTerrainPatterns';
import type { Direction } from '../lib/hexUtils';

type MapPanelProps = PinnablePanelProps & {
  onWalkTo?: (directions: Direction[]) => void;
};

export function MapPanel({ mode = 'slideout', onWalkTo }: MapPanelProps) {
  const isPinned = mode === 'pinned';
  const { currentRoomId, roomCount, getRoom, centerOnPlayer, clearMap } = useMapContext();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [showLabels, setShowLabels] = useState(true);
  const [showFog, setShowFog] = useState(true);

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

  const currentRoom = currentRoomId ? getRoom(currentRoomId) : null;

  const pinControls = isPinned ? <PinnedControls /> : <PinMenuButton panel="map" />;

  const handleWalkTo = (_roomId: string, directions: Direction[]) => {
    if (onWalkTo) onWalkTo(directions);
  };

  return (
    <div className={panelRootClass(isPinned)} style={!isPinned ? { width: 480 } : undefined}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading truncate flex items-center gap-1.5">
          <MapIcon size={12} /> Map
          {currentRoom && (
            <span className="text-text-dim font-normal ml-1.5">
              — {TERRAIN_LABELS[currentRoom.terrain] ?? 'Hex'} ({currentRoom.coords.q},{' '}
              {currentRoom.coords.r})
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">{pinControls}</div>
      </div>

      {/* Toolbar row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0 text-[10px]">
        <button
          onClick={centerOnPlayer}
          className="px-1.5 py-0.5 rounded border border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle transition-colors cursor-pointer"
          title="Center on current room"
        >
          Center
        </button>
        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${showLabels ? 'border-[#e8a849]/30 text-[#e8a849] bg-[#e8a849]/10' : 'border-border-dim text-text-dim'}`}
          title="Toggle room labels"
        >
          Labels
        </button>
        <button
          onClick={() => setShowFog((v) => !v)}
          className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${showFog ? 'border-[#e8a849]/30 text-[#e8a849] bg-[#e8a849]/10' : 'border-border-dim text-text-dim'}`}
          title="Toggle fog of war"
        >
          Fog
        </button>
        <div className="flex-1" />
        <span className="text-text-dim">{roomCount} hexes</span>
        {roomCount > 0 && (
          <button
            onClick={clearMap}
            className="px-1.5 py-0.5 rounded border border-border-dim text-text-dim hover:text-red hover:border-red/30 transition-colors cursor-pointer"
            title="Clear all map data"
          >
            Clear
          </button>
        )}
      </div>

      {/* Canvas body */}
      <div ref={bodyRef} data-help-id="map-canvas" className="flex-1 overflow-hidden">
        {size.width > 0 && size.height > 0 && (
          <MapCanvas
            width={size.width}
            height={size.height}
            showLabels={showLabels}
            showFog={showFog}
            onWalkTo={handleWalkTo}
          />
        )}
      </div>
    </div>
  );
}
