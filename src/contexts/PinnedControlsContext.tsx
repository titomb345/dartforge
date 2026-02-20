import { createContext, useContext } from 'react';
import type { DockSide } from '../types';

export interface PinnedControlsValue {
  side: DockSide;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onSwapSide?: () => void;
  onUnpin: () => void;
}

const PinnedControlsContext = createContext<PinnedControlsValue | null>(null);

export function PinnedControlsProvider({ value, children }: { value: PinnedControlsValue; children: React.ReactNode }) {
  return <PinnedControlsContext.Provider value={value}>{children}</PinnedControlsContext.Provider>;
}

export function usePinnedControls(): PinnedControlsValue | null {
  return useContext(PinnedControlsContext);
}
