import { useRef, useState, useCallback, type ReactNode } from 'react';
import { DataStoreContext, type DataStore } from './DataStoreContext';

const PREFIX = 'dartforge:';
const DEBOUNCE_MS = 200;

export function WebDataStoreProvider({ children }: { children: ReactNode }) {
  const [ready] = useState(true);
  const [needsSetup] = useState(false);
  const [activeDataDir] = useState<string | null>('localStorage');

  const cacheRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const dirtyRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function loadFromStorage(filename: string): Record<string, unknown> {
    if (cacheRef.current.has(filename)) return cacheRef.current.get(filename)!;
    try {
      const raw = localStorage.getItem(PREFIX + filename);
      const data = raw ? JSON.parse(raw) : {};
      cacheRef.current.set(filename, data);
      return data;
    } catch {
      const empty = {};
      cacheRef.current.set(filename, empty);
      return empty;
    }
  }

  function writeToStorage(filename: string) {
    const cache = cacheRef.current.get(filename);
    if (cache) {
      localStorage.setItem(PREFIX + filename, JSON.stringify(cache));
    }
  }

  const scheduleDebouncedWrite = useCallback((filename: string) => {
    const existing = dirtyRef.current.get(filename);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      dirtyRef.current.delete(filename);
      writeToStorage(filename);
    }, DEBOUNCE_MS);
    dirtyRef.current.set(filename, timer);
  }, []);

  const get = useCallback(async <T,>(filename: string, key: string): Promise<T | null> => {
    const cache = loadFromStorage(filename);
    const value = cache[key];
    return value !== undefined ? (value as T) : null;
  }, []);

  const set = useCallback(
    async (filename: string, key: string, value: unknown): Promise<void> => {
      const cache = loadFromStorage(filename);
      cache[key] = value;
      cacheRef.current.set(filename, cache);
      scheduleDebouncedWrite(filename);
    },
    [scheduleDebouncedWrite]
  );

  const save = useCallback(async (filename: string): Promise<void> => {
    const existing = dirtyRef.current.get(filename);
    if (existing) {
      clearTimeout(existing);
      dirtyRef.current.delete(filename);
    }
    writeToStorage(filename);
  }, []);

  const del = useCallback(
    async (filename: string, key: string): Promise<void> => {
      const cache = loadFromStorage(filename);
      delete cache[key];
      cacheRef.current.set(filename, cache);
      scheduleDebouncedWrite(filename);
    },
    [scheduleDebouncedWrite]
  );

  const keys = useCallback(async (filename: string): Promise<string[]> => {
    return Object.keys(loadFromStorage(filename));
  }, []);

  const readText = useCallback(async (filename: string): Promise<string | null> => {
    return localStorage.getItem(PREFIX + filename);
  }, []);

  const writeText = useCallback(async (filename: string, content: string): Promise<void> => {
    localStorage.setItem(PREFIX + filename, content);
  }, []);

  const deleteText = useCallback(async (filename: string): Promise<void> => {
    localStorage.removeItem(PREFIX + filename);
  }, []);

  const flushAll = useCallback(async (): Promise<void> => {
    for (const timer of dirtyRef.current.values()) clearTimeout(timer);
    dirtyRef.current.clear();
    for (const filename of cacheRef.current.keys()) writeToStorage(filename);
  }, []);

  const completeSetup = useCallback(async (): Promise<void> => {}, []);
  const reloadFromDir = useCallback(async (): Promise<string> => 'localStorage', []);

  const store: DataStore = {
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
  };

  return <DataStoreContext.Provider value={store}>{children}</DataStoreContext.Provider>;
}
