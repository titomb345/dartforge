import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { load } from '@tauri-apps/plugin-store';
import { useDataStore } from '../contexts/DataStoreContext';
import { FolderIcon, TrashIcon, CheckCircleIcon, ClockIcon } from './icons';
import { cn } from '../lib/cn';

const LOCAL_CONFIG_FILE = 'local-config.json';
const DATA_DIRS_KEY = 'dataDirs';

interface BackupEntry {
  path: string;
  filename: string;
  timestamp: string;
  tag: string;
  size: number;
  files: string[];
}

type Tab = 'directories' | 'backups';

export function DataDirSettings() {
  const dataStore = useDataStore();
  const [candidates, setCandidates] = useState<string[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('directories');
  const [status, setStatus] = useState<string | null>(null);

  // Load candidate dirs from local config
  useEffect(() => {
    (async () => {
      try {
        const localStore = await load(LOCAL_CONFIG_FILE);
        const dirs = (await localStore.get<string[]>(DATA_DIRS_KEY)) ?? [];
        setCandidates(dirs);
      } catch (e) {
        console.error('Failed to load local config:', e);
      }
    })();
  }, []);

  // Load backups when switching to backups tab
  useEffect(() => {
    if (activeTab === 'backups') refreshBackups();
  }, [activeTab]);

  async function refreshBackups() {
    try {
      const list: BackupEntry[] = await invoke('list_backups');
      setBackups(list);
    } catch (e) {
      console.error('Failed to list backups:', e);
    }
  }

  async function addDirectory() {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select Data Directory' });
      if (!selected) return;

      const path = selected as string;

      // Check if already in list
      if (candidates.includes(path)) {
        showStatus('Directory already added');
        return;
      }

      // Validate it exists and is writable
      const valid: boolean = await invoke('check_dir_valid', { path });
      if (!valid) {
        showStatus('Directory is not writable');
        return;
      }

      const updated = [...candidates, path];
      await saveCandidates(updated);

      // Re-resolve — if the new dir has existing files they'll be loaded as-is
      await dataStore.reloadFromDir(updated);
      showStatus('Directory added');
    } catch (e) {
      console.error('Failed to add directory:', e);
      showStatus('Failed to add directory');
    }
  }

  async function removeDirectory(index: number) {
    const updated = candidates.filter((_, i) => i !== index);
    await saveCandidates(updated);
    await dataStore.reloadFromDir(updated);
    showStatus('Directory removed');
  }

  async function saveCandidates(dirs: string[]) {
    setCandidates(dirs);
    const localStore = await load(LOCAL_CONFIG_FILE);
    await localStore.set(DATA_DIRS_KEY, dirs);
    await localStore.save();
  }

  async function restoreBackup(backupPath: string) {
    try {
      await invoke('restore_backup', { backupPath });
      // Reload data from disk
      await dataStore.reloadFromDir(candidates);
      showStatus('Backup restored');
      refreshBackups();
    } catch (e) {
      console.error('Failed to restore backup:', e);
      showStatus('Restore failed');
    }
  }

  function showStatus(msg: string) {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  }

  function formatTimestamp(ts: string): string {
    // timestamp format: 2026-02-16T14-30-00
    return ts.replace(/T/, ' ').replace(/-/g, (m, offset) => (offset > 6 ? ':' : m));
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const tagLabel: Record<string, string> = {
    'session-start': 'Session Start',
    auto: 'Auto',
    'pre-restore': 'Pre-Restore',
  };

  return (
    <div className="w-[400px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[13px] font-semibold text-text-heading">Settings</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-subtle">
        <button
          onClick={() => setActiveTab('directories')}
          className={cn(
            'flex-1 px-3 py-1.5 text-[11px] font-mono transition-colors cursor-pointer',
            activeTab === 'directories'
              ? 'text-cyan border-b-2 border-cyan'
              : 'text-text-dim hover:text-text-label'
          )}
        >
          Data Location
        </button>
        <button
          onClick={() => setActiveTab('backups')}
          className={cn(
            'flex-1 px-3 py-1.5 text-[11px] font-mono transition-colors cursor-pointer',
            activeTab === 'backups'
              ? 'text-cyan border-b-2 border-cyan'
              : 'text-text-dim hover:text-text-label'
          )}
        >
          Backups
        </button>
      </div>

      {/* Status message */}
      {status && (
        <div className="px-3 py-1.5 text-[11px] text-cyan bg-cyan/5 border-b border-border-subtle">
          {status}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {activeTab === 'directories' ? (
          <DirectoriesTab
            candidates={candidates}
            activeDir={dataStore.activeDataDir}
            onAdd={addDirectory}
            onRemove={removeDirectory}
          />
        ) : (
          <BackupsTab
            backups={backups}
            onRestore={restoreBackup}
            formatTimestamp={formatTimestamp}
            formatSize={formatSize}
            tagLabel={tagLabel}
          />
        )}
      </div>
    </div>
  );
}

function DirectoriesTab({
  candidates,
  activeDir,
  onAdd,
  onRemove,
}: {
  candidates: string[];
  activeDir: string | null;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <>
      {/* Active directory */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1.5">
          Active Location
        </div>
        <div className="flex items-center gap-2 px-2 py-1.5 bg-bg-secondary rounded border border-border-dim">
          <CheckCircleIcon size={12} />
          <span className="text-[11px] text-text-label font-mono truncate flex-1" title={activeDir ?? ''}>
            {activeDir ?? 'Default'}
          </span>
        </div>
      </div>

      {/* Candidate list */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1.5">
          Search Locations
        </div>
        <div className="text-[10px] text-text-dim mb-2">
          On startup, DartForge checks each path in order and uses the first valid one.
          If none are valid, the default app data directory is used.
        </div>
        {candidates.length === 0 ? (
          <div className="text-[11px] text-text-dim italic px-2 py-1.5">
            No custom locations configured. Using default directory.
          </div>
        ) : (
          <div className="space-y-1">
            {candidates.map((dir, i) => (
              <div
                key={dir}
                className="flex items-center gap-2 px-2 py-1.5 bg-bg-secondary rounded border border-border-dim group"
              >
                <FolderIcon size={12} />
                <span
                  className="text-[11px] text-text-label font-mono truncate flex-1"
                  title={dir}
                >
                  {dir}
                </span>
                {dir === activeDir && (
                  <span className="text-[9px] text-cyan font-mono uppercase">active</span>
                )}
                <button
                  onClick={() => onRemove(i)}
                  className="text-text-dim hover:text-red opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Remove"
                >
                  <TrashIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add button */}
      <button
        onClick={onAdd}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded',
          'text-[11px] font-mono text-cyan border border-cyan/30 bg-cyan/5',
          'hover:bg-cyan/10 transition-colors cursor-pointer'
        )}
      >
        <FolderIcon size={12} />
        Add Directory
      </button>
    </>
  );
}

function BackupsTab({
  backups,
  onRestore,
  formatTimestamp,
  formatSize,
  tagLabel,
}: {
  backups: BackupEntry[];
  onRestore: (path: string) => void;
  formatTimestamp: (ts: string) => string;
  formatSize: (bytes: number) => string;
  tagLabel: Record<string, string>;
}) {
  if (backups.length === 0) {
    return (
      <div className="text-[11px] text-text-dim italic">
        No backups found. Backups are created automatically at session start and every hour.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-text-dim mb-2">
        Restoring a backup automatically creates a safety backup of your current data first.
      </div>
      {backups.map((entry) => (
        <div key={entry.path} className="border border-border-dim rounded overflow-hidden group">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-secondary">
            <ClockIcon size={10} />
            <span className="text-[10px] font-mono text-text-muted">
              {formatTimestamp(entry.timestamp)}
            </span>
            <span className="text-[9px] font-mono text-cyan/70 uppercase">
              {tagLabel[entry.tag] ?? entry.tag}
            </span>
            <span className="text-[10px] text-text-dim font-mono ml-auto mr-1">
              {formatSize(entry.size)}
            </span>
            <button
              onClick={() => onRestore(entry.path)}
              className={cn(
                'text-[10px] font-mono px-1.5 py-0.5 rounded border cursor-pointer',
                'text-text-dim border-border-dim opacity-0 group-hover:opacity-100',
                'hover:text-cyan hover:border-cyan/30 transition-all'
              )}
            >
              Restore
            </button>
          </div>
          {entry.files.length > 0 && (
            <div className="px-2 py-1 text-[10px] font-mono text-text-dim">
              {entry.files.join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
