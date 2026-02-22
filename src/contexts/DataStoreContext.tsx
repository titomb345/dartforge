import { createContext, useContext } from 'react';

export interface DataStore {
  get<T>(filename: string, key: string): Promise<T | null>;
  set(filename: string, key: string, value: unknown): Promise<void>;
  save(filename: string): Promise<void>;
  delete(filename: string, key: string): Promise<void>;
  keys(filename: string): Promise<string[]>;
  readText(filename: string): Promise<string | null>;
  writeText(filename: string, content: string): Promise<void>;
  flushAll(): Promise<void>;
  activeDataDir: string | null;
  ready: boolean;
  /** True when no data location has been configured yet. */
  needsSetup: boolean;
  /** Complete first-run setup by selecting a data directory. */
  completeSetup(dir: string): Promise<void>;
  /** Re-resolve data dir and reload all cached files. */
  reloadFromDir(candidates: string[]): Promise<string>;
}

export const DataStoreContext = createContext<DataStore | null>(null);

export function useDataStore(): DataStore {
  const ctx = useContext(DataStoreContext);
  if (!ctx) throw new Error('useDataStore must be used within DataStoreProvider');
  return ctx;
}
