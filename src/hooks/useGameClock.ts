import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Reckoning,
  queryHour,
  formatDate,
  getReckoningLabel,
  getTimeOfDay,
  getHoliday,
  getReckoningAccent,
} from '../lib/dartDate';

const TICK_INTERVAL = 10_000; // 10 seconds

interface GameClockState {
  formattedDate: string;
  hour: number;
  timeOfDay: string;
  holiday: string | null;
  reckoning: Reckoning;
  reckoningLabel: string;
  accent: string;
}

function computeState(reckoning: Reckoning): GameClockState {
  const hour = queryHour();
  return {
    formattedDate: formatDate(null, reckoning),
    hour,
    timeOfDay: getTimeOfDay(hour),
    holiday: getHoliday(null, reckoning),
    reckoning,
    reckoningLabel: getReckoningLabel(reckoning),
    accent: getReckoningAccent(reckoning),
  };
}

export function useGameClock() {
  const [reckoning, setReckoning] = useState(Reckoning.Common);
  const [state, setState] = useState(() => computeState(Reckoning.Common));
  const reckoningRef = useRef(reckoning);

  // Keep ref in sync for the interval callback
  reckoningRef.current = reckoning;

  // Recompute whenever reckoning changes
  useEffect(() => {
    setState(computeState(reckoning));
  }, [reckoning]);

  // Tick every 10s
  useEffect(() => {
    const id = setInterval(() => {
      setState(computeState(reckoningRef.current));
    }, TICK_INTERVAL);
    return () => clearInterval(id);
  }, []);

  const cycleReckoning = useCallback(() => {
    setReckoning((prev) => ((prev + 1) % 3) as Reckoning);
  }, []);

  return { ...state, cycleReckoning };
}
