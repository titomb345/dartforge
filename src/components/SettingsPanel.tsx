import { useState, useEffect, useRef, type ReactNode } from 'react';
import { TimerIcon, FolderIcon, TrashIcon, CheckCircleIcon, ClockIcon, ChevronDownSmallIcon } from './icons';
import { MudInput } from './shared';
import { cn } from '../lib/cn';
import { useDataStore } from '../contexts/DataStoreContext';
import { getPlatform } from '../lib/platform';

/* ── Tauri imports (lazy) ─────────────────────────────────── */

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let openDialog: ((opts: Record<string, unknown>) => Promise<unknown>) | null = null;
let loadStore: ((path: string) => Promise<{ get: <T>(k: string) => Promise<T | null | undefined>; set: (k: string, v: unknown) => Promise<void>; save: () => Promise<void> }>) | null = null;

if (getPlatform() === 'tauri') {
  import('@tauri-apps/api/core').then((m) => { invoke = m.invoke; });
  import('@tauri-apps/plugin-dialog').then((m) => { openDialog = m.open as typeof openDialog; });
  import('@tauri-apps/plugin-store').then((m) => { loadStore = m.load; });
}

const LOCAL_CONFIG_FILE = 'local-config.json';
const DATA_DIRS_KEY = 'dataDirs';

/* ── Collapsible Section ──────────────────────────────────── */

function SettingsSection({
  icon,
  title,
  accent = '#bd93f9',
  defaultOpen = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  accent?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border-dim rounded overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-150',
          'bg-bg-secondary hover:bg-[#252525]',
        )}
        style={{ borderLeft: `2px solid ${open ? accent : 'transparent'}` }}
      >
        <span style={{ color: accent }} className="shrink-0">{icon}</span>
        <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.06em] text-text-label flex-1 text-left">
          {title}
        </span>
        <span
          className="text-text-dim transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <ChevronDownSmallIcon size={12} />
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-3 py-3 space-y-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Toggle Switch ────────────────────────────────────────── */

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  accent = '#bd93f9',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  accent?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative w-[32px] h-[16px] rounded-full border transition-colors duration-200 cursor-pointer shrink-0',
        disabled && 'opacity-30 cursor-default',
      )}
      style={{
        background: checked ? `${accent}25` : '#1a1a1a',
        borderColor: checked ? `${accent}60` : '#444',
      }}
    >
      <span
        className="absolute top-[2px] w-[10px] h-[10px] rounded-full transition-all duration-200"
        style={{
          left: checked ? '18px' : '3px',
          background: checked ? accent : '#666',
          boxShadow: checked ? `0 0 6px ${accent}40` : 'none',
        }}
      />
    </button>
  );
}

/* ── Field Row ────────────────────────────────────────────── */

function FieldRow({ label, children, dimmed }: { label: string; children: ReactNode; dimmed?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', dimmed && 'opacity-40 pointer-events-none')}>
      <span className="text-[10px] font-mono text-text-dim uppercase tracking-wide flex-1">{label}</span>
      {children}
    </div>
  );
}

/* ── Backup Entry ─────────────────────────────────────────── */

interface BackupEntry {
  path: string;
  filename: string;
  timestamp: string;
  tag: string;
  size: number;
  files: string[];
}

/* ── Main Panel ───────────────────────────────────────────── */

interface SettingsPanelProps {
  antiIdleEnabled: boolean;
  antiIdleCommand: string;
  antiIdleMinutes: number;
  onAntiIdleEnabledChange: (v: boolean) => void;
  onAntiIdleCommandChange: (v: string) => void;
  onAntiIdleMinutesChange: (v: number) => void;
}

export function SettingsPanel({
  antiIdleEnabled,
  antiIdleCommand,
  antiIdleMinutes,
  onAntiIdleEnabledChange,
  onAntiIdleCommandChange,
  onAntiIdleMinutesChange,
}: SettingsPanelProps) {
  const isTauri = getPlatform() === 'tauri';

  return (
    <div className="w-[360px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[13px] font-semibold text-text-heading">Settings</span>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {/* Connection / Anti-Idle */}
        <SettingsSection
          icon={<TimerIcon size={13} />}
          title="Anti-Idle"
          accent="#bd93f9"
          defaultOpen
        >
          <FieldRow label="Enabled">
            <ToggleSwitch
              checked={antiIdleEnabled}
              onChange={onAntiIdleEnabledChange}
              accent="#bd93f9"
            />
          </FieldRow>
          <FieldRow label="Command" dimmed={!antiIdleEnabled}>
            <MudInput
              accent="purple"
              size="sm"
              value={antiIdleCommand}
              onChange={(e) => onAntiIdleCommandChange(e.target.value)}
              placeholder="hp"
              className="w-[120px] text-right"
            />
          </FieldRow>
          <FieldRow label="Interval" dimmed={!antiIdleEnabled}>
            <div className="flex items-center gap-1.5">
              <MudInput
                accent="purple"
                size="sm"
                type="number"
                min={1}
                max={14}
                value={antiIdleMinutes}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= 14) onAntiIdleMinutesChange(v);
                }}
                className="w-[48px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">min</span>
            </div>
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Sends the command at the configured interval to prevent idle disconnect.
          </div>
        </SettingsSection>

        {/* Data Location — Tauri only */}
        {isTauri && <DataLocationSection />}

        {/* Backups — Tauri only */}
        {isTauri && <BackupsSection />}
      </div>
    </div>
  );
}

/* ── Data Location Section (Tauri-only) ───────────────────── */

function DataLocationSection() {
  const dataStore = useDataStore();
  const [candidates, setCandidates] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!loadStore) return;
      try {
        const localStore = await loadStore(LOCAL_CONFIG_FILE);
        const dirs = (await localStore.get<string[]>(DATA_DIRS_KEY)) ?? [];
        setCandidates(dirs);
      } catch (e) {
        console.error('Failed to load local config:', e);
      }
    })();
  }, []);

  async function addDirectory() {
    if (!openDialog || !invoke || !loadStore) return;
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: 'Select Data Directory' });
      if (!selected) return;
      const path = selected as string;
      if (candidates.includes(path)) { showStatus('Already added'); return; }
      const valid: boolean = await invoke('check_dir_valid', { path }) as boolean;
      if (!valid) { showStatus('Not writable'); return; }
      const updated = [...candidates, path];
      await saveCandidates(updated);
      await dataStore.reloadFromDir(updated);
      showStatus('Directory added');
    } catch (e) {
      console.error('Failed to add directory:', e);
      showStatus('Failed');
    }
  }

  async function removeDirectory(index: number) {
    const updated = candidates.filter((_, i) => i !== index);
    await saveCandidates(updated);
    await dataStore.reloadFromDir(updated);
    showStatus('Removed');
  }

  async function saveCandidates(dirs: string[]) {
    if (!loadStore) return;
    setCandidates(dirs);
    const localStore = await loadStore(LOCAL_CONFIG_FILE);
    await localStore.set(DATA_DIRS_KEY, dirs);
    await localStore.save();
  }

  function showStatus(msg: string) {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  }

  return (
    <SettingsSection
      icon={<FolderIcon size={13} />}
      title="Data Location"
      accent="#8be9fd"
    >
      {status && (
        <div className="text-[10px] text-cyan font-mono mb-1">{status}</div>
      )}

      {/* Active directory */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-bg-secondary rounded border border-border-dim">
        <CheckCircleIcon size={11} />
        <span className="text-[10px] text-text-label font-mono truncate flex-1" title={dataStore.activeDataDir ?? ''}>
          {dataStore.activeDataDir ?? 'Default'}
        </span>
      </div>

      {/* Candidate list */}
      <div className="text-[9px] text-text-dim font-mono">
        Checks each path in order on startup. First valid one is used.
      </div>
      {candidates.length === 0 ? (
        <div className="text-[10px] text-text-dim italic font-mono">No custom locations.</div>
      ) : (
        <div className="space-y-1">
          {candidates.map((dir, i) => (
            <div
              key={dir}
              className="flex items-center gap-2 px-2 py-1 bg-bg-secondary rounded border border-border-dim group"
            >
              <FolderIcon size={10} />
              <span className="text-[10px] text-text-label font-mono truncate flex-1" title={dir}>
                {dir}
              </span>
              {dir === dataStore.activeDataDir && (
                <span className="text-[8px] text-cyan font-mono uppercase">active</span>
              )}
              <button
                onClick={() => removeDirectory(i)}
                className="text-text-dim hover:text-red opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title="Remove"
              >
                <TrashIcon size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={addDirectory}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded',
          'text-[10px] font-mono text-cyan border border-cyan/30 bg-cyan/5',
          'hover:bg-cyan/10 transition-colors cursor-pointer'
        )}
      >
        <FolderIcon size={10} />
        Add Directory
      </button>
    </SettingsSection>
  );
}

/* ── Backups Section (Tauri-only) ─────────────────────────── */

function BackupsSection() {
  const dataStore = useDataStore();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const [candidates, setCandidates] = useState<string[]>([]);

  // Load candidates for restore
  useEffect(() => {
    (async () => {
      if (!loadStore) return;
      try {
        const localStore = await loadStore(LOCAL_CONFIG_FILE);
        const dirs = (await localStore.get<string[]>(DATA_DIRS_KEY)) ?? [];
        setCandidates(dirs);
      } catch {
        // ignore
      }
    })();
  }, []);

  function refreshBackups() {
    if (!invoke) return;
    invoke('list_backups').then((list) => {
      setBackups(list as BackupEntry[]);
    }).catch(console.error);
  }

  // Load backups on first expand (via useEffect since section mounts lazily)
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      refreshBackups();
    }
  }, []);

  async function restoreBackup(backupPath: string) {
    if (!invoke) return;
    try {
      await invoke('restore_backup', { backupPath });
      await dataStore.reloadFromDir(candidates);
      showStatus('Restored');
      refreshBackups();
    } catch (e) {
      console.error('Failed to restore:', e);
      showStatus('Failed');
    }
  }

  function showStatus(msg: string) {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  }

  function formatTimestamp(ts: string): string {
    return ts.replace(/T/, ' ').replace(/-/g, (m, offset: number) => (offset > 6 ? ':' : m));
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const tagLabel: Record<string, string> = {
    'session-start': 'Session',
    auto: 'Auto',
    'pre-restore': 'Pre-Restore',
  };

  return (
    <SettingsSection
      icon={<ClockIcon size={13} />}
      title="Backups"
      accent="#f59e0b"
    >
      {status && (
        <div className="text-[10px] text-cyan font-mono mb-1">{status}</div>
      )}

      <div className="text-[9px] text-text-dim font-mono">
        Restoring creates a safety backup first.
      </div>

      {backups.length === 0 ? (
        <div className="text-[10px] text-text-dim italic font-mono">
          No backups found. Created automatically at session start and hourly.
        </div>
      ) : (
        <div className="space-y-1.5">
          {backups.map((entry) => (
            <div key={entry.path} className="border border-border-dim rounded overflow-hidden group">
              <div className="flex items-center gap-1 px-2 py-1 bg-bg-secondary">
                <ClockIcon size={9} />
                <span className="text-[9px] font-mono text-text-muted">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className="text-[8px] font-mono text-[#f59e0b]/70 uppercase">
                  {tagLabel[entry.tag] ?? entry.tag}
                </span>
                <span className="text-[9px] text-text-dim font-mono ml-auto mr-1">
                  {formatSize(entry.size)}
                </span>
                <button
                  onClick={() => restoreBackup(entry.path)}
                  className={cn(
                    'text-[9px] font-mono px-1 py-0.5 rounded border cursor-pointer',
                    'text-text-dim border-border-dim opacity-0 group-hover:opacity-100',
                    'hover:text-cyan hover:border-cyan/30 transition-all'
                  )}
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
