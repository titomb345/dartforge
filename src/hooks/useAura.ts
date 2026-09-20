import { useState, useCallback, useRef } from 'react';
import type { AuraMatch, AuraLevel } from '../lib/auraPatterns';
import type { AnsiColorSegment, MudColor } from '../lib/ansiColorExtract';

export function useAura() {
  const [aura, setAura] = useState<AuraLevel | null>(null);
  const [auraMudColor, setAuraMudColor] = useState<MudColor | null>(null);
  const [auraMudColors, setAuraMudColors] = useState<AnsiColorSegment[] | null>(null);
  /**
   * Same value as `aura`, readable the instant the line is parsed. State
   * updates don't land until React re-renders, so anything that reads the
   * aura while still processing the line (the autopowercast loop) reads this.
   */
  const auraRef = useRef<AuraLevel | null>(null);

  const updateAura = useCallback((match: AuraMatch) => {
    auraRef.current = match.level;
    setAura(match.level);
    setAuraMudColor(match.mudColor);
    setAuraMudColors(match.mudColors);
  }, []);

  const clearAura = useCallback(() => {
    auraRef.current = null;
    setAura(null);
    setAuraMudColor(null);
    setAuraMudColors(null);
  }, []);

  return { aura, auraRef, auraMudColor, auraMudColors, updateAura, clearAura };
}
