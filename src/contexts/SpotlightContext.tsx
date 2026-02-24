import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export interface SpotlightStep {
  helpId: string;
  tooltip: string;
  position?: 'above' | 'below' | 'left' | 'right';
}

interface SpotlightState {
  active: SpotlightStep | null;
  tourQueue: SpotlightStep[];
  highlight: (helpId: string, tooltip: string, position?: SpotlightStep['position']) => void;
  startTour: (steps: SpotlightStep[]) => void;
  advanceTour: () => void;
  clear: () => void;
}

const SpotlightCtx = createContext<SpotlightState | null>(null);

export function SpotlightProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<SpotlightStep | null>(null);
  const [tourQueue, setTourQueue] = useState<SpotlightStep[]>([]);

  const highlight = useCallback(
    (helpId: string, tooltip: string, position?: SpotlightStep['position']) => {
      setTourQueue([]);
      setActive({ helpId, tooltip, position });
    },
    []
  );

  const startTour = useCallback((steps: SpotlightStep[]) => {
    if (steps.length === 0) return;
    setActive(steps[0]);
    setTourQueue(steps.slice(1));
  }, []);

  const advanceTour = useCallback(() => {
    setTourQueue((q) => {
      if (q.length === 0) {
        setActive(null);
        return [];
      }
      setActive(q[0]);
      return q.slice(1);
    });
  }, []);

  const clear = useCallback(() => {
    setActive(null);
    setTourQueue([]);
  }, []);

  const value = useMemo(
    () => ({
      active,
      tourQueue,
      highlight,
      startTour,
      advanceTour,
      clear,
    }),
    [active, tourQueue, highlight, startTour, advanceTour, clear]
  );

  return <SpotlightCtx.Provider value={value}>{children}</SpotlightCtx.Provider>;
}

export function useSpotlight(): SpotlightState {
  const ctx = useContext(SpotlightCtx);
  if (!ctx) throw new Error('useSpotlight must be used within SpotlightProvider');
  return ctx;
}
