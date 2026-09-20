import { useState, useCallback, useRef } from 'react';
import type { ConcentrationMatch, ConcentrationLevel } from '../lib/concentrationPatterns';

export function useConcentration() {
  const [concentration, setConcentration] = useState<ConcentrationLevel | null>(null);
  /** See the note on useAura's auraRef — readable while the line is parsed. */
  const concentrationRef = useRef<ConcentrationLevel | null>(null);

  const updateConcentration = useCallback((match: ConcentrationMatch) => {
    concentrationRef.current = match.level;
    setConcentration(match.level);
  }, []);

  const clearConcentration = useCallback(() => {
    concentrationRef.current = null;
    setConcentration(null);
  }, []);

  return { concentration, concentrationRef, updateConcentration, clearConcentration };
}
