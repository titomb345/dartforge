import { useState, useCallback } from 'react';
import type { AuraMatch, AuraLevel } from '../lib/auraPatterns';
import type { AnsiColorSegment, MudColor } from '../lib/ansiColorExtract';

export function useAura() {
  const [aura, setAura] = useState<AuraLevel | null>(null);
  const [auraMudColor, setAuraMudColor] = useState<MudColor | null>(null);
  const [auraMudColors, setAuraMudColors] = useState<AnsiColorSegment[] | null>(null);

  const updateAura = useCallback((match: AuraMatch) => {
    setAura(match.level);
    setAuraMudColor(match.mudColor);
    setAuraMudColors(match.mudColors);
  }, []);

  const clearAura = useCallback(() => {
    setAura(null);
    setAuraMudColor(null);
    setAuraMudColors(null);
  }, []);

  return { aura, auraMudColor, auraMudColors, updateAura, clearAura };
}
