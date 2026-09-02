import { createContext, useContext, useCallback, useMemo } from 'react';
import type { Panel, PanelLayout, PinnablePanel, DockSide } from '../types';

interface PanelContextValue {
  layout: PanelLayout;
  activePanel: Panel | null;
  togglePanel: (panel: Panel) => void;
  /** Close whichever slide-out is open (Escape). */
  closePanel: () => void;
  pinPanel: (panel: PinnablePanel, side: DockSide) => void;
  isPinned: (panel: PinnablePanel) => boolean;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export function PanelProvider({
  layout,
  activePanel,
  togglePanel,
  closePanel,
  pinPanel,
  children,
}: {
  layout: PanelLayout;
  activePanel: Panel | null;
  togglePanel: (panel: Panel) => void;
  closePanel: () => void;
  pinPanel: (panel: PinnablePanel, side: DockSide) => void;
  children: React.ReactNode;
}) {
  const isPinned = useCallback(
    (panel: PinnablePanel) => layout.left.includes(panel) || layout.right.includes(panel),
    [layout]
  );

  const value = useMemo(
    () => ({ layout, activePanel, togglePanel, closePanel, pinPanel, isPinned }),
    [layout, activePanel, togglePanel, closePanel, pinPanel, isPinned]
  );

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanelContext(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('usePanelContext must be used within PanelProvider');
  return ctx;
}
