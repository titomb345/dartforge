import { useState, useCallback } from 'react';
import type { HealthMatch, HealthLevel } from '../lib/healthPatterns';

export function useHealth() {
  const [health, setHealth] = useState<HealthLevel | null>(null);

  const updateHealth = useCallback((match: HealthMatch) => {
    setHealth(match.level);
  }, []);

  const clearHealth = useCallback(() => {
    setHealth(null);
  }, []);

  return { health, updateHealth, clearHealth };
}
