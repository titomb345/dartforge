import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useDataStore } from '../contexts/DataStoreContext';
import { FolderIcon } from './icons';
import { cn } from '../lib/cn';

export function SetupDialog() {
  const dataStore = useDataStore();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasExistingData, setHasExistingData] = useState(false);

  async function browse() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Data Directory',
      });
      if (!selected) return;

      const path = selected as string;
      const valid: boolean = await invoke('check_dir_valid', { path });
      if (!valid) {
        setError('That directory is not writable. Please choose another.');
        return;
      }

      setSelectedPath(path);
      setError(null);

      // Temporarily resolve to peek at the directory for existing data
      await invoke('resolve_data_dir', { candidates: [path] });
      const data: unknown = await invoke('read_data_file', { filename: 'settings.json' });
      setHasExistingData(data != null);
    } catch (e) {
      console.error('Browse failed:', e);
      setError('Failed to open folder picker.');
    }
  }

  async function useDefault() {
    setLoading(true);
    try {
      // Resolve with empty candidates → falls back to default app data dir
      const defaultDir: string = await invoke('resolve_data_dir', { candidates: [] });
      await dataStore.completeSetup(defaultDir);
    } catch (e) {
      console.error('Default setup failed:', e);
      setError('Failed to initialize default directory.');
      setLoading(false);
    }
  }

  async function confirm() {
    if (!selectedPath) return;
    setLoading(true);
    try {
      await dataStore.completeSetup(selectedPath);
    } catch (e) {
      console.error('Setup failed:', e);
      setError('Failed to initialize the selected directory.');
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a]">
      {/* Atmospheric background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, rgba(139,233,253,0.08) 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background:
            'radial-gradient(ellipse at 80% 80%, rgba(167,139,250,0.06) 0%, transparent 50%)',
        }}
      />

      {/* Content card */}
      <div className="relative w-[480px] max-w-[90vw]">
        {/* Subtle border glow */}
        <div
          className="absolute -inset-px rounded-lg opacity-40"
          style={{
            background:
              'linear-gradient(135deg, rgba(139,233,253,0.3), rgba(167,139,250,0.15), transparent 60%)',
          }}
        />

        <div className="relative bg-[#111111] rounded-lg border border-[#1e1e1e] overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[22px] font-bold tracking-tight" style={{ color: '#e0e0e0' }}>
                DartForge
              </div>
              <div className="text-[10px] font-mono text-cyan/50 uppercase tracking-widest mt-1">
                Setup
              </div>
            </div>
            <p className="text-[12px] text-[#777] leading-relaxed mt-3">
              Choose where DartForge stores your settings and skill data. Use a synced folder (like
              Dropbox) to share data across machines.
            </p>
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-[#2a2a2a] to-transparent" />

          {/* Selection area */}
          <div className="px-6 py-5 space-y-3">
            {/* Browse button */}
            <button
              onClick={browse}
              disabled={loading}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-md transition-all',
                'border cursor-pointer group',
                selectedPath
                  ? 'border-cyan/30 bg-cyan/5'
                  : 'border-[#2a2a2a] bg-[#141414] hover:border-[#3a3a3a] hover:bg-[#181818]',
                loading && 'opacity-50 pointer-events-none'
              )}
            >
              <div
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                  selectedPath
                    ? 'bg-cyan/10 text-cyan'
                    : 'bg-[#1e1e1e] text-[#555] group-hover:text-[#888]'
                )}
              >
                <FolderIcon size={16} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-[12px] text-[#bbb] font-medium">
                  {selectedPath ? 'Selected Directory' : 'Choose a Directory'}
                </div>
                {selectedPath ? (
                  <div
                    className="text-[11px] font-mono text-[#666] truncate mt-0.5"
                    title={selectedPath}
                  >
                    {selectedPath}
                  </div>
                ) : (
                  <div className="text-[10px] text-[#444] mt-0.5">
                    Browse for a Dropbox or custom folder
                  </div>
                )}
              </div>
              {selectedPath && hasExistingData && (
                <div className="text-[9px] font-mono text-green uppercase tracking-wider shrink-0">
                  Data Found
                </div>
              )}
            </button>

            {/* Divider with "or" */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[#1e1e1e]" />
              <span className="text-[10px] text-[#444] font-mono uppercase">or</span>
              <div className="h-px flex-1 bg-[#1e1e1e]" />
            </div>

            {/* Use default */}
            <button
              onClick={useDefault}
              disabled={loading}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-md transition-all',
                'border border-[#2a2a2a] bg-[#141414] hover:border-[#3a3a3a] hover:bg-[#181818]',
                'cursor-pointer group',
                loading && 'opacity-50 pointer-events-none'
              )}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[#1e1e1e] text-[#555] group-hover:text-[#888] transition-colors">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" />
                  <path d="m8 16 4-4 4 4" />
                  <path d="M12 12v9" />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <div className="text-[12px] text-[#bbb] font-medium">Use Default Location</div>
                <div className="text-[10px] text-[#444] mt-0.5">
                  Local app data (not synced between machines)
                </div>
              </div>
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="px-6 pb-3">
              <div className="text-[11px] text-disconnected bg-disconnected/5 border border-disconnected/20 rounded px-3 py-1.5">
                {error}
              </div>
            </div>
          )}

          {/* Confirm button — only shows when a custom path is selected */}
          {selectedPath && (
            <>
              <div className="h-px bg-gradient-to-r from-transparent via-[#2a2a2a] to-transparent" />
              <div className="px-6 py-4">
                <button
                  onClick={confirm}
                  disabled={loading}
                  className={cn(
                    'w-full py-2.5 rounded-md text-[12px] font-medium transition-all cursor-pointer',
                    'bg-cyan/10 text-cyan border border-cyan/25 hover:bg-cyan/15 hover:border-cyan/40',
                    loading && 'opacity-50 pointer-events-none'
                  )}
                >
                  {loading
                    ? 'Initializing...'
                    : hasExistingData
                      ? 'Load Existing Data'
                      : 'Start Fresh Here'}
                </button>
                {hasExistingData && (
                  <div className="text-[10px] text-[#555] text-center mt-2">
                    Existing settings and skills will be loaded from this directory.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
