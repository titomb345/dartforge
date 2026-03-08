import { useEffect, useRef } from 'react';
import { getPlatform } from '../lib/platform';

const invokePromise: Promise<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
> | null = getPlatform() === 'tauri' ? import('@tauri-apps/api/core').then((m) => m.invoke) : null;

const defaultChime1 = new Audio('/chime1.wav');
const defaultChime2 = new Audio('/chime2.wav');

/** A custom sound entry persisted in settings. */
export interface CustomSoundEntry {
  /** User-facing display name (e.g. "deathAlert") */
  name: string;
  /** Filename on disk (e.g. "custom-deathAlert.wav") */
  fileName: string;
}

/** Runtime sound library — ordered list with play-by-index and play-by-name. */
export interface SoundLibrary {
  /** Play a sound by 1-based index or by name. */
  play(id: number | string): void;
  /** Get the ordered list of sound names (built-ins first, then custom). */
  names(): string[];
  /** Get the old-style chimes object for backward compat (chat panel). */
  chimes(): { chime1: HTMLAudioElement; chime2: HTMLAudioElement };
}

/**
 * Manages the full sound library: built-in chime1/chime2 (with optional
 * custom audio replacements) plus user-uploaded custom sounds.
 *
 * Exposes a ref (no state) to avoid re-rendering the parent.
 */
export function useSoundLibrary(
  customChime1: string | null,
  customChime2: string | null,
  customSounds: CustomSoundEntry[]
) {
  // Map of sound name → HTMLAudioElement
  const audioMapRef = useRef<Map<string, HTMLAudioElement>>(
    new Map([
      ['chime1', defaultChime1],
      ['chime2', defaultChime2],
    ])
  );
  // Ordered list of sound names (always built-ins first)
  const orderedNamesRef = useRef<string[]>(['chime1', 'chime2']);

  const libraryRef = useRef<SoundLibrary>({
    play(id: number | string) {
      let audio: HTMLAudioElement | undefined;
      if (typeof id === 'number') {
        const name = orderedNamesRef.current[id - 1]; // 1-based
        if (name) audio = audioMapRef.current.get(name);
      } else {
        audio = audioMapRef.current.get(id);
      }
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    },
    names() {
      return [...orderedNamesRef.current];
    },
    chimes() {
      return {
        chime1: audioMapRef.current.get('chime1') ?? defaultChime1,
        chime2: audioMapRef.current.get('chime2') ?? defaultChime2,
      };
    },
  });

  // Serialize customSounds to a stable string for the effect dependency
  const customSoundsKey = JSON.stringify(customSounds);

  useEffect(() => {
    let cancelled = false;
    const createdAudios: HTMLAudioElement[] = [];

    async function loadSound(
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
      soundId: string,
      fallback?: HTMLAudioElement
    ): Promise<HTMLAudioElement | null> {
      try {
        const dataUrl = (await invoke('get_sound_base64', { soundId })) as string | null;
        if (cancelled) return null;
        if (dataUrl) {
          const audio = new Audio(dataUrl);
          createdAudios.push(audio);
          return audio;
        }
      } catch (e) {
        console.error(`Failed to load sound ${soundId}:`, e);
      }
      return fallback ?? null;
    }

    (async () => {
      if (!invokePromise) return;
      const invoke = await invokePromise;
      if (cancelled) return;

      const newMap = new Map<string, HTMLAudioElement>();
      const newNames: string[] = ['chime1', 'chime2'];

      // Load built-in chimes (with optional custom replacements)
      const c1 = customChime1
        ? await loadSound(invoke, 'chime1', defaultChime1)
        : defaultChime1;
      if (cancelled) return;
      newMap.set('chime1', c1 ?? defaultChime1);

      const c2 = customChime2
        ? await loadSound(invoke, 'chime2', defaultChime2)
        : defaultChime2;
      if (cancelled) return;
      newMap.set('chime2', c2 ?? defaultChime2);

      // Load custom sounds
      const sounds: CustomSoundEntry[] = JSON.parse(customSoundsKey);
      for (const entry of sounds) {
        if (entry.name === 'chime1' || entry.name === 'chime2') continue; // skip collisions
        const audio = await loadSound(invoke, entry.name);
        if (cancelled) return;
        if (audio) {
          newMap.set(entry.name, audio);
          newNames.push(entry.name);
        }
      }

      audioMapRef.current = newMap;
      orderedNamesRef.current = newNames;
    })();

    return () => {
      cancelled = true;
      // Reset to defaults
      audioMapRef.current = new Map([
        ['chime1', defaultChime1],
        ['chime2', defaultChime2],
      ]);
      orderedNamesRef.current = ['chime1', 'chime2'];
      // Release custom Audio objects
      for (const audio of createdAudios) {
        audio.src = '';
      }
    };
  }, [customChime1, customChime2, customSoundsKey]);

  return { libraryRef };
}
