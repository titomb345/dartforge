import { useState, useCallback } from 'react';
import type { AlignmentMatch, AlignmentLevel } from '../lib/alignmentPatterns';

export function useAlignment() {
  const [alignment, setAlignment] = useState<AlignmentLevel | null>(null);

  const updateAlignment = useCallback((match: AlignmentMatch) => {
    setAlignment(match.level);
  }, []);

  const clearAlignment = useCallback(() => {
    setAlignment(null);
  }, []);

  return { alignment, updateAlignment, clearAlignment };
}
