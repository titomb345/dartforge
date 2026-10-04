import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { DataFileCache } from '../lib/dataFileCache';
import { DataStoreContext, type DataStore } from './DataStoreContext';

const LOCAL_CONFIG_FILE = 'local-config.json';
const DATA_DIRS_KEY = 'dataDirs';
const DEBOUNCE_MS = 200;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** A data file of the active data dir (null: no such file) */
const readDataFile = (filename: string): Promise<Record<string, unknown> | null> =>
  invoke('read_data_file', { filename });

export function DataStoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [activeDataDir, setActiveDataDir] = useState<string | null>(null);

  // In-memory cache: filename -> { key: value }, each file read from disk
  // once (shared first reads, data-dir changes: lib/dataFileCache.ts)
  const cacheRef = useRef(new DataFileCache(readDataFile));
  // Track dirty files with pending debounced writes
  const dirtyRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Initialize: check if setup is needed
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const localStore = await load(LOCAL_CONFIG_FILE);
        const candidates = (await localStore.get<string[]>(DATA_DIRS_KEY)) ?? [];

        if (candidates.length === 0) {
          // No location configured — require setup before doing anything
          if (!cancelled) setNeedsSetup(true);
          return;
        }

        // Location configured — resolve and initialize
        if (!cancelled) await initializeWithCandidates(candidates);
      } catch (e) {
        console.error('DataStore init failed:', e);
        if (!cancelled) setNeedsSetup(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function initializeWithCandidates(candidates: string[]) {
    const resolved: string = await invoke('resolve_data_dir', { candidates });
    setActiveDataDir(resolved);

    // Check if auto-backups are enabled (read directly — settings context isn't mounted yet)
    const settings: Record<string, unknown> | null = await invoke('read_data_file', {
      filename: 'settings.json',
    });
    const backupsEnabled = settings?.autoBackupEnabled !== false; // default true

    if (backupsEnabled) {
      await invoke('create_backup', { tag: 'session-start' });
      await invoke('prune_backups', { keep: 30 });
    }

    setReady(true);
  }

  // Complete first-run setup
  const completeSetup = useCallback(async (dir: string): Promise<void> => {
    // Resolve to the selected directory
    const resolved: string = await invoke('resolve_data_dir', { candidates: [dir] });
    setActiveDataDir(resolved);

    // Save to local config
    const localStore = await load(LOCAL_CONFIG_FILE);
    await localStore.set(DATA_DIRS_KEY, [dir]);
    await localStore.save();

    // Now that a location is active, create first backup and go
    await invoke('create_backup', { tag: 'session-start' });

    setNeedsSetup(false);
    setReady(true);
  }, []);

  // Hourly auto-backup (checks setting from cache each tick)
  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(async () => {
      try {
        const cache = cacheRef.current.peek('settings.json');
        if (cache && cache.autoBackupEnabled === false) return;
        await invoke('create_backup', { tag: 'auto' });
      } catch (e) {
        console.error('Auto-backup failed:', e);
      }
    }, BACKUP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ready]);

  /** Schedule a debounced write for a file. */
  const scheduleDebouncedWrite = useCallback((filename: string) => {
    const existing = dirtyRef.current.get(filename);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      dirtyRef.current.delete(filename);
      const cache = cacheRef.current.peek(filename);
      if (cache) {
        try {
          await invoke('write_data_file', { filename, data: cache });
        } catch (e) {
          console.error(`Failed to write ${filename}:`, e);
        }
      }
    }, DEBOUNCE_MS);
    dirtyRef.current.set(filename, timer);
  }, []);

  const get = useCallback(async <T,>(filename: string, key: string): Promise<T | null> => {
    const cache = await cacheRef.current.load(filename);
    const value = cache[key];
    return value !== undefined ? (value as T) : null;
  }, []);

  const set = useCallback(
    async (filename: string, key: string, value: unknown): Promise<void> => {
      const cache = await cacheRef.current.forChange(filename);
      cache[key] = value;
      cacheRef.current.set(filename, cache);
      scheduleDebouncedWrite(filename);
    },
    [scheduleDebouncedWrite]
  );

  const save = useCallback(async (filename: string): Promise<void> => {
    // Cancel any pending debounced write
    const existing = dirtyRef.current.get(filename);
    if (existing) {
      clearTimeout(existing);
      dirtyRef.current.delete(filename);
    }

    const cache = cacheRef.current.peek(filename);
    if (cache) {
      try {
        await invoke('write_data_file', { filename, data: cache });
      } catch (e) {
        console.error(`Failed to save ${filename}:`, e);
      }
    }
  }, []);

  const del = useCallback(
    async (filename: string, key: string): Promise<void> => {
      const cache = await cacheRef.current.forChange(filename);
      delete cache[key];
      cacheRef.current.set(filename, cache);
      scheduleDebouncedWrite(filename);
    },
    [scheduleDebouncedWrite]
  );

  const keys = useCallback(async (filename: string): Promise<string[]> => {
    const cache = await cacheRef.current.load(filename);
    return Object.keys(cache);
  }, []);

  const readText = useCallback(async (filename: string): Promise<string | null> => {
    const result: string | null = await invoke('read_text_file', { filename });
    return result;
  }, []);

  const writeText = useCallback(async (filename: string, content: string): Promise<void> => {
    try {
      await invoke('write_text_file', { filename, content });
    } catch (e) {
      console.error(`Failed to write text file ${filename}:`, e);
    }
  }, []);

  const deleteText = useCallback(async (filename: string): Promise<void> => {
    try {
      await invoke('delete_text_file', { filename });
    } catch (e) {
      console.error(`Failed to delete text file ${filename}:`, e);
    }
  }, []);

  const flushAll = useCallback(async (): Promise<void> => {
    // Cancel all debounce timers
    for (const timer of dirtyRef.current.values()) {
      clearTimeout(timer);
    }
    const filenames = [...dirtyRef.current.keys()];
    dirtyRef.current.clear();

    // Also flush any loaded files that might have unsaved changes
    const allLoaded = cacheRef.current.loadedFiles();
    const toFlush = new Set([...filenames, ...allLoaded]);

    const promises = [...toFlush].map(async (filename) => {
      const cache = cacheRef.current.peek(filename);
      if (cache) {
        try {
          await invoke('write_data_file', { filename, data: cache });
        } catch (e) {
          console.error(`Failed to flush ${filename}:`, e);
        }
      }
    });
    await Promise.all(promises);
  }, []);

  const reloadFromDir = useCallback(
    async (candidates: string[]): Promise<string> => {
      // Flush current state first
      await flushAll();

      // Clear caches, before the move and again once it lands: anything read
      // until then came from the old dir (see DataFileCache.moveTo)
      const resolved = await cacheRef.current.moveTo(async () => {
        // Save candidates to local config
        const localStore = await load(LOCAL_CONFIG_FILE);
        await localStore.set(DATA_DIRS_KEY, candidates);
        await localStore.save();

        // Re-resolve
        return invoke<string>('resolve_data_dir', { candidates });
      });
      setActiveDataDir(resolved);

      return resolved;
    },
    [flushAll]
  );

  const store: DataStore = useMemo(
    () => ({
      get,
      set,
      save,
      delete: del,
      keys,
      readText,
      writeText,
      deleteText,
      flushAll,
      activeDataDir,
      ready,
      needsSetup,
      completeSetup,
      reloadFromDir,
    }),
    [
      get,
      set,
      save,
      del,
      keys,
      readText,
      writeText,
      deleteText,
      flushAll,
      activeDataDir,
      ready,
      needsSetup,
      completeSetup,
      reloadFromDir,
    ]
  );

  return <DataStoreContext.Provider value={store}>{children}</DataStoreContext.Provider>;
}
