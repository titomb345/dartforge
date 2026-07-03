/**
 * MapPanel — pinnable panel wrapper for the hex auto-mapper.
 */

import { useRef, useState, useEffect } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PanelHeader } from './PanelHeader';
import { MapIcon } from './icons';
import { MapCanvas } from './MapCanvas';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { useMapContext } from '../contexts/MapContext';
import { TERRAIN_LABELS } from '../lib/hexTerrainPatterns';

export function MapPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const {
    currentPos,
    cellCount,
    visitedCount,
    islandCount,
    lost,
    walking,
    getCellAt,
    centerOnPlayer,
    clearMap,
    walkTo,
    cancelWalk,
  } = useMapContext();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [showLabels, setShowLabels] = useState(false);
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

  const currentCell = currentPos ? getCellAt(currentPos.q, currentPos.r) : undefined;

  const mapTitle = currentCell
    ? `Map — ${TERRAIN_LABELS[currentCell.terrain] ?? 'Hex'} (${currentPos!.q}, ${currentPos!.r})`
    : 'Map';

  return (
    <div className={panelRootClass(isPinned)} style={!isPinned ? { width: 480 } : undefined}>
      <PanelHeader icon={<MapIcon size={12} />} title={mapTitle} panel="map" mode={mode} />

      {/* Toolbar row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0 text-[10px]">
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
          title="Toggle terrain labels"
        >
          Labels
        </button>
        <button
          onClick={() => setShowFog((v) => !v)}
          className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${showFog ? 'border-[#e8a849]/30 text-[#e8a849] bg-[#e8a849]/10' : 'border-border-dim text-text-dim'}`}
          title="Dim hexes you've seen but never entered"
        >
          Fog
        </button>
        {walking && (
          <button
            onClick={cancelWalk}
            className="px-1.5 py-0.5 rounded border border-[#e8a849]/40 text-[#e8a849] bg-[#e8a849]/10 hover:bg-[#e8a849]/20 transition-colors cursor-pointer animate-pulse"
            title="Stop auto-walking"
          >
            Walking ({walking.remaining}) ✕
          </button>
        )}
        {lost && (
          <span
            className="px-1.5 py-0.5 rounded border border-red/40 text-red text-[9px]"
            title="Position unknown — move to distinctive terrain to re-locate"
          >
            LOST
          </span>
        )}
        <div className="flex-1" />
        <span className="text-text-dim" title="Visited / total mapped hexes">
          {visitedCount}/{cellCount} hexes
          {islandCount > 1 ? ` · ${islandCount} regions` : ''}
        </span>
        {cellCount > 0 && (
          <ConfirmDeleteButton onDelete={clearMap} variant="fixed" title="Clear all map data" />
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
            onWalkTo={walkTo}
          />
        )}
      </div>
    </div>
  );
}
