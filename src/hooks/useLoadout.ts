import { useState, useCallback, useEffect, useRef } from 'react';
import { LoadoutTracker, type LoadoutState } from '../lib/loadout';
import type { DataStore } from '../contexts/DataStoreContext';

const loadoutFileName = (name: string) => `loadout-${name.toLowerCase()}.json`;
const SAVE_DEBOUNCE_MS = 2000;
/** A capture block is committed after this much line silence — the block's
 *  natural end is "the first foreign line", which in a quiet room may not
 *  arrive for minutes. */
const FLUSH_IDLE_MS = 1500;

/**
 * Loadout tracker hook — owns the LoadoutTracker instance, feeds it output
 * lines + outgoing commands (wired in App.tsx), persists per character, and
 * exposes the state for the Loadout panel.
 */
export function useLoadout(
  dataStore: DataStore,
  activeCharacter: string | null,
  sendCommandRef: React.RefObject<((cmd: string) => Promise<void>) | null>
) {
  const trackerRef = useRef<LoadoutTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new LoadoutTracker();
  const [state, setState] = useState<LoadoutState>(() =>
    structuredClone(trackerRef.current!.state)
  );

  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const characterRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      const char = characterRef.current;
      if (!char) return;
      try {
        const ds = dataStoreRef.current;
        const file = loadoutFileName(char);
        await ds.set(file, 'loadout', trackerRef.current!.serialize());
        await ds.save(file);
      } catch (e) {
        console.error('Failed to save loadout data:', e);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Load per character (and reset while none is known)
  useEffect(() => {
    characterRef.current = activeCharacter;
    if (!dataStore.ready) return;
    let cancelled = false;
    (async () => {
      if (!activeCharacter) {
        trackerRef.current!.reset();
        setState(structuredClone(trackerRef.current!.state));
        return;
      }
      try {
        const data = await dataStore.get<unknown>(loadoutFileName(activeCharacter), 'loadout');
        if (cancelled) return;
        trackerRef.current = LoadoutTracker.deserialize(data ?? null);
        setState(structuredClone(trackerRef.current.state));
      } catch (e) {
        console.error('Failed to load loadout data for', activeCharacter, e);
        trackerRef.current!.reset();
        setState(structuredClone(trackerRef.current!.state));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCharacter, dataStore.ready]);

  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback(() => {
    setState(structuredClone(trackerRef.current!.state));
    scheduleSave();
  }, [scheduleSave]);

  /** While a block capture is open, (re)arm a timer that force-commits it
   *  after a quiet period — its natural end is "the first foreign line",
   *  which in a quiet room may not arrive for minutes. */
  const armFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    if (!trackerRef.current!.hasPendingCapture) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const change = trackerRef.current!.flush(Date.now());
      if (change !== 'none') publish();
    }, FLUSH_IDLE_MS);
  }, [publish]);

  /** Feed one stripped output line (wired into OutputFilter's onLine). */
  const feedLine = useCallback(
    (line: string) => {
      const change = trackerRef.current!.onLine(line, Date.now());
      if (change !== 'none') publish();
      armFlush();
    },
    [publish, armFlush]
  );

  /** Observe an outgoing command (wired next to the mapper's trackCommand). */
  const trackCommand = useCallback(
    (cmd: string) => {
      trackerRef.current!.onCommand(cmd, Date.now());
      armFlush();
    },
    [armFlush]
  );

  /** Re-sync held items — sends `equip held` (tiny, one line per limb). */
  const refreshHands = useCallback(() => {
    sendCommandRef.current?.('equip held').catch(console.error);
  }, [sendCommandRef]);

  /** Full re-sync (hands + worn + limb health) — sends `view me` (the
   *  native DartMUD examine; `x` is only an alias for it). */
  const refreshFull = useCallback(() => {
    sendCommandRef.current?.('view me').catch(console.error);
  }, [sendCommandRef]);

  return { state, feedLine, trackCommand, refreshHands, refreshFull };
}
