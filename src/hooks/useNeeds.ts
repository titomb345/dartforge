import { useState, useCallback } from 'react';
import type { NeedLevel } from '../lib/needsPatterns';

export function useNeeds() {
  const [hunger, setHunger] = useState<NeedLevel | null>(null);
  const [thirst, setThirst] = useState<NeedLevel | null>(null);

  const updateHunger = useCallback((level: NeedLevel) => {
    setHunger(level);
  }, []);

  const updateThirst = useCallback((level: NeedLevel) => {
    setThirst(level);
  }, []);

  return { hunger, thirst, updateHunger, updateThirst };
}
