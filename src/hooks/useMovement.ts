import { useState, useCallback } from 'react';
import type { MovementMatch, MovementLevel } from '../lib/movementPatterns';

export function useMovement() {
  const [movement, setMovement] = useState<MovementLevel | null>(null);

  const updateMovement = useCallback((match: MovementMatch) => {
    setMovement(match.level);
  }, []);

  const clearMovement = useCallback(() => {
    setMovement(null);
  }, []);

  return { movement, updateMovement, clearMovement };
}
