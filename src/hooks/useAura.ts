import { useState, useCallback } from 'react';
import type { AuraMatch, AuraLevel } from '../lib/auraPatterns';
import type { ThemeColorKey } from '../lib/defaultTheme';

export function useAura() {
  const [aura, setAura] = useState<AuraLevel | null>(null);
  const [auraMudColor, setAuraMudColor] = useState<ThemeColorKey | null>(null);

  const updateAura = useCallback((match: AuraMatch) => {
    setAura(match.level);
    if (match.mudColor) setAuraMudColor(match.mudColor);
  }, []);

  const clearAura = useCallback(() => {
    setAura(null);
    setAuraMudColor(null);
  }, []);

  return { aura, auraMudColor, updateAura, clearAura };
}
