import { useEffect, useRef } from 'react';
import { getPlatform } from '../lib/platform';

const invokePromise: Promise<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>> | null =
  getPlatform() === 'tauri'
    ? import('@tauri-apps/api/core').then((m) => m.invoke)
    : null;

const defaultChime1 = new Audio('/chime1.wav');
const defaultChime2 = new Audio('/chime2.wav');

export interface Chimes {
  chime1: HTMLAudioElement;
  chime2: HTMLAudioElement;
}

/**
 * Loads custom chime audio files (if configured) from the Rust backend,
 * falling back to the built-in defaults. Only exposes a ref (no state)
 * to avoid re-rendering the parent when audio objects swap.
 */
export function useCustomChimes(customChime1: string | null, customChime2: string | null) {
  const chimesRef = useRef<Chimes>({ chime1: defaultChime1, chime2: defaultChime2 });

  useEffect(() => {
    let cancelled = false;
    let created1: HTMLAudioElement | null = null;
    let created2: HTMLAudioElement | null = null;

    async function loadChime(
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
      chimeId: 'chime1' | 'chime2',
      hasCustom: boolean,
    ) {
      const fallback = chimeId === 'chime1' ? defaultChime1 : defaultChime2;
      if (!hasCustom) return fallback;
      try {
        const dataUrl = await invoke('get_sound_base64', { chimeId }) as string | null;
        if (cancelled) return null;
        if (dataUrl) return new Audio(dataUrl);
      } catch (e) {
        console.error(`Failed to load custom ${chimeId}:`, e);
      }
      return fallback;
    }

    (async () => {
      if (!invokePromise) return;
      const invoke = await invokePromise;
      if (cancelled) return;

      const [c1, c2] = await Promise.all([
        loadChime(invoke, 'chime1', customChime1 != null),
        loadChime(invoke, 'chime2', customChime2 != null),
      ]);
      if (cancelled) return;
      if (c1) {
        if (c1 !== defaultChime1) created1 = c1;
        chimesRef.current.chime1 = c1;
      }
      if (c2) {
        if (c2 !== defaultChime2) created2 = c2;
        chimesRef.current.chime2 = c2;
      }
    })();

    return () => {
      cancelled = true;
      // Reset ref to defaults so playback works during the async reload gap
      chimesRef.current = { chime1: defaultChime1, chime2: defaultChime2 };
      // Then release the old custom Audio objects
      if (created1) { created1.src = ''; created1 = null; }
      if (created2) { created2.src = ''; created2 = null; }
    };
  }, [customChime1, customChime2]);

  return { chimesRef };
}
