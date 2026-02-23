import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { DataStoreContext, type DataStore } from './DataStoreContext';
import { useDropbox } from './DropboxContext';
import { WebSetupScreen } from '../components/WebSetupScreen';
import { DropboxFolderPicker } from '../components/DropboxFolderPicker';
import {
  listFiles, downloadFile, uploadFile,
  loadStorageMode, saveStorageMode, clearStorageMode,
  type StorageMode,
} from '../lib/dropbox';

const PREFIX = 'dartforge:';
const LOCAL_DEBOUNCE_MS = 200;
const DROPBOX_DEBOUNCE_MS = 5_000;
const PENDING_UPLOADS_KEY = 'dartforge:_pending_uploads';

type SetupPhase = 'SETUP' | 'CONNECTING' | 'PICK_FOLDER' | 'SYNCING' | 'READY' | 'ERROR';

/**
 * DataStore backed by localStorage (fast cache) with optional Dropbox sync.
 * Implements a state machine that blocks the app until storage is configured.
 *
 * Phases:
 *   SETUP       — first visit, no storage mode chosen
 *   CONNECTING   — Dropbox mode, OAuth/token restore in progress
 *   PICK_FOLDER  — Dropbox mode, connected, no folder selected
 *   SYNCING      — Dropbox mode, connected + folder, initial sync running
 *   READY        — fully operational (localStorage-only or Dropbox synced)
 *   ERROR        — auth failure / token expired
 */
export function DropboxDataStoreProvider({ children }: { children: ReactNode }) {
  const { status: dropboxStatus, accessToken, folderPath, connect, disconnect } = useDropbox();

  // Storage mode persisted in localStorage
  const [storageMode, setStorageModeState] = useState<StorageMode | null>(loadStorageMode);
  const [syncComplete, setSyncComplete] = useState(false);

  const cacheRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const dirtyRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dropboxTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const folderPathRef = useRef(folderPath);
  folderPathRef.current = folderPath;

  // Persist storage mode to localStorage
  const setStorageMode = useCallback((mode: StorageMode | null) => {
    if (mode === null) {
      clearStorageMode();
    } else {
      saveStorageMode(mode);
    }
    setStorageModeState(mode);
  }, []);

  // ---------------------------------------------------------------------------
  // Phase derivation
  // ---------------------------------------------------------------------------

  const phase: SetupPhase = useMemo(() => {
    if (storageMode === null) return 'SETUP';
    if (storageMode === 'local') return 'READY';

    // storageMode === 'dropbox'
    if (dropboxStatus === 'error') return 'ERROR';
    if (dropboxStatus === 'disconnected') return 'ERROR';
    if (dropboxStatus === 'connecting') return 'CONNECTING';

    // connected
    if (!folderPath) return 'PICK_FOLDER';
    if (!syncComplete) return 'SYNCING';
    return 'READY';
  }, [storageMode, dropboxStatus, folderPath, syncComplete]);

  const ready = phase === 'READY';

  // ---------------------------------------------------------------------------
  // localStorage layer
  // ---------------------------------------------------------------------------

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
    }, LOCAL_DEBOUNCE_MS);
    dirtyRef.current.set(filename, timer);
  }, []);

  // ---------------------------------------------------------------------------
  // Dropbox sync layer
  // ---------------------------------------------------------------------------

  const scheduleDropboxUpload = useCallback((filename: string) => {
    const token = accessTokenRef.current;
    const folder = folderPathRef.current;
    if (!token || !folder) return;

    const existing = dropboxTimersRef.current.get(filename);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      dropboxTimersRef.current.delete(filename);
      const currentToken = accessTokenRef.current;
      const currentFolder = folderPathRef.current;
      if (!currentToken || !currentFolder) return;

      const cache = cacheRef.current.get(filename);
      if (!cache) return;

      try {
        const content = JSON.stringify(cache, null, 2);
        const path = currentFolder === '/' ? `/${filename}` : `${currentFolder}/${filename}`;
        await uploadFile(currentToken, path, content);
      } catch (e) {
        console.error(`Dropbox upload failed for ${filename}:`, e);
      }
    }, DROPBOX_DEBOUNCE_MS);

    dropboxTimersRef.current.set(filename, timer);
  }, []);

  // Merge skill data: take max count per skill (counts only increase)
  function mergeSkillData(
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = { ...local };

    const localSkills = (local.skills ?? {}) as Record<string, { count: number; [k: string]: unknown }>;
    const remoteSkills = (remote.skills ?? {}) as Record<string, { count: number; [k: string]: unknown }>;
    const mergedSkills: Record<string, unknown> = { ...localSkills };
    for (const [name, remoteRecord] of Object.entries(remoteSkills)) {
      const localRecord = localSkills[name];
      if (!localRecord || remoteRecord.count > localRecord.count) {
        mergedSkills[name] = remoteRecord;
      }
    }
    merged.skills = mergedSkills;

    const localPets = (local.pets ?? {}) as Record<string, Record<string, { count: number; [k: string]: unknown }>>;
    const remotePets = (remote.pets ?? {}) as Record<string, Record<string, { count: number; [k: string]: unknown }>>;
    const mergedPets: Record<string, Record<string, unknown>> = { ...localPets };
    for (const [petName, remotePetSkills] of Object.entries(remotePets)) {
      const localPetSkills = localPets[petName] ?? {};
      const mergedPetSkills: Record<string, unknown> = { ...localPetSkills };
      for (const [skill, remoteRecord] of Object.entries(remotePetSkills)) {
        const localRecord = localPetSkills[skill];
        if (!localRecord || remoteRecord.count > localRecord.count) {
          mergedPetSkills[skill] = remoteRecord;
        }
      }
      mergedPets[petName] = mergedPetSkills;
    }
    merged.pets = mergedPets;

    return merged;
  }

  // Initial sync: download files from Dropbox and merge with localStorage
  // Only runs when storageMode=dropbox + connected + folder selected
  // Also resets syncComplete when folderPath changes (merged from separate effect)
  useEffect(() => {
    if (storageMode !== 'dropbox' || dropboxStatus !== 'connected' || !accessToken || !folderPath) {
      return;
    }

    // Capture values before async work to prevent race conditions
    // if the user disconnects or changes folder mid-sync
    const token: string = accessToken;
    const folder: string = folderPath;
    let cancelled = false;

    setSyncComplete(false);

    async function initialSync() {
      try {
        const files = await listFiles(token, folder);
        const remoteFileNames = new Set(files.map((f) => f.name));

        // Check for pending uploads from a previous session
        const pendingRaw = localStorage.getItem(PENDING_UPLOADS_KEY);
        const pendingUploads: string[] = pendingRaw ? JSON.parse(pendingRaw) : [];
        localStorage.removeItem(PENDING_UPLOADS_KEY);

        // Track files that need uploading after merge
        const filesToUpload: string[] = [];

        for (const file of files) {
          if (cancelled) return;
          if (!file.name.endsWith('.json')) continue;

          try {
            const { content } = await downloadFile(token, file.path_lower);
            const remoteData = JSON.parse(content) as Record<string, unknown>;

            const localData = loadFromStorage(file.name);

            // Skill files: merge by max count. Everything else: remote wins.
            if (file.name.startsWith('skills-')) {
              const merged = mergeSkillData(localData, remoteData);
              cacheRef.current.set(file.name, merged);
              localStorage.setItem(PREFIX + file.name, JSON.stringify(merged));

              // Upload back if local had data that changed the merge result
              if (JSON.stringify(merged) !== content) {
                filesToUpload.push(file.name);
              }
            } else {
              const merged = { ...localData, ...remoteData };
              cacheRef.current.set(file.name, merged);
              localStorage.setItem(PREFIX + file.name, JSON.stringify(merged));
            }
          } catch (e) {
            console.error(`Failed to sync ${file.name}:`, e);
          }
        }

        // Upload any localStorage-only files that don't exist in Dropbox yet
        // (e.g. skills from a character played only in the browser)
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(PREFIX)) continue;
          const filename = key.slice(PREFIX.length);
          if (!filename.endsWith('.json')) continue;
          if (filename.startsWith('_')) continue; // skip internal keys
          if (remoteFileNames.has(filename)) continue; // already merged above

          // This file exists only in localStorage — queue for upload
          loadFromStorage(filename); // ensure it's in cacheRef
          filesToUpload.push(filename);
        }

        // Upload merged/local-only files back to Dropbox
        for (const filename of [...new Set([...filesToUpload, ...pendingUploads])]) {
          if (cancelled) return;
          const cache = cacheRef.current.get(filename);
          if (cache && Object.keys(cache).length > 0) {
            try {
              const path = folder === '/' ? `/${filename}` : `${folder}/${filename}`;
              await uploadFile(token, path, JSON.stringify(cache, null, 2));
            } catch (e) {
              console.error(`Upload failed for ${filename}:`, e);
            }
          }
        }
      } catch (e) {
        console.error('Dropbox initial sync failed:', e);
      } finally {
        if (!cancelled) {
          setSyncComplete(true);
        }
      }
    }

    initialSync();
    return () => { cancelled = true; };
  }, [storageMode, dropboxStatus, accessToken, folderPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record pending uploads on page unload
  useEffect(() => {
    const handleUnload = () => {
      // Flush localStorage synchronously
      for (const [filename, timer] of dirtyRef.current.entries()) {
        clearTimeout(timer);
        writeToStorage(filename);
      }
      dirtyRef.current.clear();

      // Record pending Dropbox uploads for retry on next load
      const pending = [...dropboxTimersRef.current.keys()];
      if (pending.length > 0) {
        localStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(pending));
      }
      for (const timer of dropboxTimersRef.current.values()) clearTimeout(timer);
      dropboxTimersRef.current.clear();
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // ---------------------------------------------------------------------------
  // Phase transition handlers
  // ---------------------------------------------------------------------------

  const handleChooseDropbox = useCallback(() => {
    setStorageMode('dropbox');
    connect();
  }, [connect, setStorageMode]);

  const handleChooseLocal = useCallback(() => {
    setStorageMode('local');
  }, [setStorageMode]);

  const handleCancel = useCallback(() => {
    // Back to setup screen
    setStorageMode(null);
    disconnect();
  }, [disconnect, setStorageMode]);

  const handleRetry = useCallback(() => {
    disconnect();
    connect();
  }, [disconnect, connect]);

  const handleUseLocal = useCallback(() => {
    disconnect();
    setStorageMode('local');
  }, [disconnect, setStorageMode]);

  // ---------------------------------------------------------------------------
  // DataStore interface
  // ---------------------------------------------------------------------------

  const get = useCallback(async <T,>(filename: string, key: string): Promise<T | null> => {
    const cache = loadFromStorage(filename);
    const value = cache[key];
    return value !== undefined ? (value as T) : null;
  }, []);

  const set = useCallback(async (filename: string, key: string, value: unknown): Promise<void> => {
    const cache = loadFromStorage(filename);
    cache[key] = value;
    cacheRef.current.set(filename, cache);
    scheduleDebouncedWrite(filename);
    scheduleDropboxUpload(filename);
  }, [scheduleDebouncedWrite, scheduleDropboxUpload]);

  const save = useCallback(async (filename: string): Promise<void> => {
    const existing = dirtyRef.current.get(filename);
    if (existing) { clearTimeout(existing); dirtyRef.current.delete(filename); }
    writeToStorage(filename);
    scheduleDropboxUpload(filename);
  }, [scheduleDropboxUpload]);

  const del = useCallback(async (filename: string, key: string): Promise<void> => {
    const cache = loadFromStorage(filename);
    delete cache[key];
    cacheRef.current.set(filename, cache);
    scheduleDebouncedWrite(filename);
    scheduleDropboxUpload(filename);
  }, [scheduleDebouncedWrite, scheduleDropboxUpload]);

  const keys = useCallback(async (filename: string): Promise<string[]> => {
    return Object.keys(loadFromStorage(filename));
  }, []);

  const readText = useCallback(async (filename: string): Promise<string | null> => {
    const raw = localStorage.getItem(PREFIX + filename);
    return raw;
  }, []);

  const writeText = useCallback(async (filename: string, content: string): Promise<void> => {
    localStorage.setItem(PREFIX + filename, content);
    // Also upload to Dropbox if connected
    const token = accessTokenRef.current;
    const folder = folderPathRef.current;
    if (token && folder) {
      try {
        const path = folder === '/' ? `/${filename}` : `${folder}/${filename}`;
        await uploadFile(token, path, content);
      } catch (e) {
        console.error(`Dropbox upload failed for text file ${filename}:`, e);
      }
    }
  }, []);

  const deleteText = useCallback(async (filename: string): Promise<void> => {
    localStorage.removeItem(PREFIX + filename);
  }, []);

  const flushAll = useCallback(async (): Promise<void> => {
    // Flush localStorage
    for (const timer of dirtyRef.current.values()) clearTimeout(timer);
    dirtyRef.current.clear();
    for (const filename of cacheRef.current.keys()) writeToStorage(filename);

    // Flush pending Dropbox uploads immediately
    const token = accessTokenRef.current;
    const folder = folderPathRef.current;
    if (token && folder) {
      const pending = [...dropboxTimersRef.current.entries()];
      for (const [, timer] of pending) clearTimeout(timer);
      dropboxTimersRef.current.clear();

      for (const [filename] of pending) {
        const cache = cacheRef.current.get(filename);
        if (cache) {
          try {
            const path = folder === '/' ? `/${filename}` : `${folder}/${filename}`;
            await uploadFile(token, path, JSON.stringify(cache, null, 2));
          } catch (e) {
            console.error(`Dropbox flush failed for ${filename}:`, e);
          }
        }
      }
    }
  }, []);

  const completeSetup = useCallback(async (): Promise<void> => {}, []);
  const reloadFromDir = useCallback(async (): Promise<string> => 'localStorage', []);

  const activeDataDir = storageMode === 'dropbox' && accessToken && folderPath ? 'dropbox' : 'localStorage';

  const store: DataStore = useMemo(() => ({
    get, set, save, delete: del, keys, readText, writeText, deleteText, flushAll,
    activeDataDir,
    ready,
    needsSetup: false,
    completeSetup, reloadFromDir,
  }), [get, set, save, del, keys, readText, writeText, flushAll, activeDataDir, ready, completeSetup, reloadFromDir]);

  return (
    <DataStoreContext.Provider value={store}>
      {phase === 'SETUP' && (
        <WebSetupScreen
          onChooseDropbox={handleChooseDropbox}
          onChooseLocal={handleChooseLocal}
        />
      )}

      {phase === 'CONNECTING' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a]">
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(139,233,253,0.08) 0%, transparent 60%)' }}
          />
          <div className="relative text-center">
            <div className="text-[14px] text-[#e0e0e0] font-semibold mb-2">DartForge</div>
            <div className="text-[12px] text-[#666] animate-pulse">Connecting to Dropbox...</div>
            <button
              onClick={handleCancel}
              className="mt-4 px-3 py-1.5 text-[11px] text-[#555] hover:text-[#aaa] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'PICK_FOLDER' && (
        <DropboxFolderPicker blocking onClose={handleCancel} />
      )}

      {phase === 'SYNCING' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a]">
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(139,233,253,0.08) 0%, transparent 60%)' }}
          />
          <div className="relative text-center">
            <div className="text-[14px] text-[#e0e0e0] font-semibold mb-2">DartForge</div>
            <div className="text-[12px] text-[#666] animate-pulse">Syncing with Dropbox...</div>
          </div>
        </div>
      )}

      {phase === 'ERROR' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a]">
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(139,233,253,0.08) 0%, transparent 60%)' }}
          />
          <div className="relative w-[400px] max-w-[90vw]">
            <div
              className="absolute -inset-px rounded-lg opacity-40"
              style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.3), rgba(167,139,250,0.15), transparent 60%)' }}
            />
            <div className="relative bg-[#111111] rounded-lg border border-[#1e1e1e] overflow-hidden p-6">
              <div className="text-[14px] text-[#e0e0e0] font-semibold mb-2">Dropbox Not Connected</div>
              <p className="text-[12px] text-[#777] leading-relaxed mb-5">
                Authorization was not completed. You can try again or continue with local storage.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleRetry}
                  className="flex-1 py-2 rounded text-[11px] font-medium bg-cyan/10 text-cyan border border-cyan/25 hover:bg-cyan/15 hover:border-cyan/40 transition-all cursor-pointer"
                >
                  Try Again
                </button>
                <button
                  onClick={handleUseLocal}
                  className="flex-1 py-2 rounded text-[11px] font-medium text-[#777] border border-[#2a2a2a] hover:text-[#aaa] hover:border-[#3a3a3a] transition-all cursor-pointer"
                >
                  Use Local Storage
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {children}
    </DataStoreContext.Provider>
  );
}
