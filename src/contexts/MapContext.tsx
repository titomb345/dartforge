import { createContext, useContext } from 'react';
import type { MapTrackerState, MapTrackerActions } from '../hooks/useMapTracker';

type MapContextValue = MapTrackerState & MapTrackerActions;

const MapContext = createContext<MapContextValue | null>(null);

export function MapProvider({
  value,
  children,
}: {
  value: MapContextValue;
  children: React.ReactNode;
}) {
  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMapContext(): MapContextValue {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error('useMapContext must be used within MapProvider');
  return ctx;
}
