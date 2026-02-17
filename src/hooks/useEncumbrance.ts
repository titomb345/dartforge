import { useState, useCallback } from 'react';
import type { EncumbranceMatch, EncumbranceLevel } from '../lib/encumbrancePatterns';

export function useEncumbrance() {
  const [encumbrance, setEncumbrance] = useState<EncumbranceLevel | null>(null);

  const updateEncumbrance = useCallback((match: EncumbranceMatch) => {
    setEncumbrance(match.level);
  }, []);

  const clearEncumbrance = useCallback(() => {
    setEncumbrance(null);
  }, []);

  return { encumbrance, updateEncumbrance, clearEncumbrance };
}
