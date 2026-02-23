import { useState, useEffect, useRef, type ReactNode } from 'react';
import { TimerIcon, FolderIcon, TrashIcon, CheckCircleIcon, ClockIcon, ChevronDownSmallIcon, FilterIcon, GearIcon, NotesIcon, RotateCcwIcon, Volume2Icon, PlayIcon, CounterIcon } from './icons';
import { DEFAULT_NUMPAD_MAPPINGS } from '../hooks/useAppSettings';
import { MudInput, MudTextarea, MudNumberInput } from './shared';
import { cn } from '../lib/cn';
import { useDataStore } from '../contexts/DataStoreContext';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
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
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  accent?: string;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const handleToggle = onToggle ?? (() => setInternalOpen((v) => !v));
  return (
    <div className="border border-border-dim rounded overflow-hidden">
      <button
        onClick={handleToggle}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-150',
          'bg-bg-secondary hover:bg-[#252525]',
        )}
        style={{ borderLeft: `2px solid ${isOpen ? accent : 'transparent'}` }}
      >
        <span style={{ color: accent }} className="shrink-0">{icon}</span>
        <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.06em] text-text-label flex-1 text-left">
          {title}
        </span>
        <span
          className="text-text-dim transition-transform duration-200"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <ChevronDownSmallIcon size={12} />
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
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

export function SettingsPanel() {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const toggle = (key: string) => setOpenSection((prev) => (prev === key ? null : key));

  const settings = useAppSettingsContext();
  const {
    antiIdleEnabled, antiIdleCommand, antiIdleMinutes,
    updateAntiIdleEnabled: onAntiIdleEnabledChange,
    updateAntiIdleCommand: onAntiIdleCommandChange,
    updateAntiIdleMinutes: onAntiIdleMinutesChange,
    alignmentTrackingEnabled, alignmentTrackingMinutes,
    updateAlignmentTrackingEnabled, updateAlignmentTrackingMinutes,
    boardDatesEnabled, updateBoardDatesEnabled: onBoardDatesEnabledChange,
    stripPromptsEnabled, updateStripPromptsEnabled: onStripPromptsEnabledChange,
    commandEchoEnabled, updateCommandEchoEnabled,
    showTimerBadges, updateShowTimerBadges,
    terminalScrollback, updateTerminalScrollback,
    commandHistorySize, updateCommandHistorySize,
    chatHistorySize, updateChatHistorySize,
    timestampFormat, updateTimestampFormat,
    sessionLoggingEnabled, updateSessionLoggingEnabled,
    numpadMappings, updateNumpadMappings,
    chatNotifications, toggleChatNotification,
    customChime1, customChime2, updateCustomChime1, updateCustomChime2,
    counterHotThreshold, counterColdThreshold,
    updateCounterHotThreshold, updateCounterColdThreshold,
    postSyncEnabled, postSyncCommands,
    updatePostSyncEnabled, updatePostSyncCommands,
  } = settings;
  const isTauri = getPlatform() === 'tauri';

  return (
    <div className="w-[360px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5"><GearIcon size={12} /> Settings</span>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {/* Timers */}
        <SettingsSection
          icon={<TimerIcon size={13} />}
          title="Timers"
          accent="#f97316"
          open={openSection === 'timers'}
          onToggle={() => toggle('timers')}
        >
          {/* Alignment tracking */}
          <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">Alignment Tracking</div>
          <FieldRow label="Enabled">
            <ToggleSwitch
              checked={alignmentTrackingEnabled}
              onChange={updateAlignmentTrackingEnabled}
              accent="#80e080"
            />
          </FieldRow>
          <FieldRow label="Interval" dimmed={!alignmentTrackingEnabled}>
            <div className="flex items-center gap-1.5">
              <MudNumberInput
                accent="green"
                size="sm"
                min={1}
                max={14}
                value={alignmentTrackingMinutes}
                onChange={updateAlignmentTrackingMinutes}
                className="w-[48px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">min</span>
            </div>
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1 mb-3">
            Polls alignment at the configured interval. Also prevents idle disconnect.
          </div>

          {/* Anti-idle */}
          <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">Anti-Idle</div>
          {alignmentTrackingEnabled && (
            <div className="text-[9px] text-[#80e080] font-mono leading-relaxed mb-1">
              Disabled — alignment tracking is active.
            </div>
          )}
          <FieldRow label="Enabled" dimmed={alignmentTrackingEnabled}>
            <ToggleSwitch
              checked={antiIdleEnabled}
              onChange={onAntiIdleEnabledChange}
              accent="#bd93f9"
              disabled={alignmentTrackingEnabled}
            />
          </FieldRow>
          <FieldRow label="Command" dimmed={!antiIdleEnabled || alignmentTrackingEnabled}>
            <MudInput
              accent="purple"
              size="sm"
              value={antiIdleCommand}
              onChange={(e) => onAntiIdleCommandChange(e.target.value)}
              placeholder="hp"
              className="w-[120px] text-right"
            />
          </FieldRow>
          <FieldRow label="Interval" dimmed={!antiIdleEnabled || alignmentTrackingEnabled}>
            <div className="flex items-center gap-1.5">
              <MudNumberInput
                accent="purple"
                size="sm"
                min={1}
                max={14}
                value={antiIdleMinutes}
                onChange={onAntiIdleMinutesChange}
                className="w-[48px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">min</span>
            </div>
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1 mb-3">
            Sends the command at the configured interval to prevent idle disconnect.
          </div>

          {/* Display */}
          <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">Display</div>
          <FieldRow label="Timer countdowns">
            <ToggleSwitch
              checked={showTimerBadges}
              onChange={updateShowTimerBadges}
              accent="#f97316"
            />
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Show timer countdowns (anti-idle, alignment, and custom timers) next to the command input.
          </div>
        </SettingsSection>

        {/* Login Commands */}
        <SettingsSection
          icon={<PlayIcon size={13} />}
          title="Login Commands"
          accent="#ff79c6"
          open={openSection === 'post-sync'}
          onToggle={() => toggle('post-sync')}
        >
          <FieldRow label="Enabled">
            <ToggleSwitch
              checked={postSyncEnabled}
              onChange={updatePostSyncEnabled}
              accent="#ff79c6"
            />
          </FieldRow>
          <FieldRow label="Commands" dimmed={!postSyncEnabled}>
            <div className="w-full" />
          </FieldRow>
          <div className={cn(!postSyncEnabled && 'opacity-40 pointer-events-none')}>
            <MudTextarea
              accent="pink"
              size="sm"
              value={postSyncCommands}
              onChange={(e) => updatePostSyncCommands(e.target.value)}
              placeholder="inventory;who;/echo Ready!"
              rows={5}
              className="w-full"
            />
          </div>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Sent automatically after logging in. Supports semicolons, aliases, /delay, /echo, /spam, /var.
          </div>
        </SettingsSection>

        {/* Output transformations */}
        <SettingsSection
          icon={<FilterIcon size={13} />}
          title="Output"
          accent="#50fa7b"
          open={openSection === 'output'}
          onToggle={() => toggle('output')}
        >
          <FieldRow label="Convert board dates">
            <ToggleSwitch
              checked={boardDatesEnabled}
              onChange={onBoardDatesEnabledChange}
              accent="#50fa7b"
            />
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Replace in-game bulletin board dates with real-world dates.
          </div>
          <FieldRow label="Strip prompts">
            <ToggleSwitch
              checked={stripPromptsEnabled}
              onChange={onStripPromptsEnabledChange}
              accent="#50fa7b"
            />
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Remove the server prompt (&gt;) from terminal output.
          </div>
          <FieldRow label="Command echo">
            <ToggleSwitch
              checked={commandEchoEnabled}
              onChange={updateCommandEchoEnabled}
              accent="#50fa7b"
            />
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Show your sent commands as dimmed lines in the terminal.
          </div>
        </SettingsSection>

        {/* Counters */}
        <SettingsSection
          icon={<CounterIcon size={13} />}
          title="Counters"
          accent="#f59e0b"
          open={openSection === 'counters'}
          onToggle={() => toggle('counters')}
        >
          <FieldRow label="Hot threshold">
            <div className="flex items-center gap-1.5">
              <MudNumberInput
                accent="purple"
                size="sm"
                min={0}
                max={99}
                step={0.5}
                parse={parseFloat}
                value={counterHotThreshold}
                onChange={updateCounterHotThreshold}
                className="w-[56px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">/pd</span>
            </div>
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Skills at or above this rate glow warm. Set to 0 to disable.
          </div>
          <FieldRow label="Cold threshold">
            <div className="flex items-center gap-1.5">
              <MudNumberInput
                accent="cyan"
                size="sm"
                min={0}
                max={99}
                step={0.5}
                parse={parseFloat}
                value={counterColdThreshold}
                onChange={updateCounterColdThreshold}
                className="w-[56px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">/pd</span>
            </div>
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Skills at or below this rate (but &gt; 0) glow cool. Set to 0 to disable.
          </div>
        </SettingsSection>

        {/* Buffers */}
        <SettingsSection
          icon={<GearIcon size={13} />}
          title="Buffers"
          accent="#8be9fd"
          open={openSection === 'buffers'}
          onToggle={() => toggle('buffers')}
        >
          <FieldRow label="Scrollback">
            <div className="flex items-center gap-1.5">
              <MudNumberInput
                accent="cyan"
                size="sm"
                min={1000}
                max={100000}
                value={terminalScrollback}
                onChange={updateTerminalScrollback}
                className="w-[72px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">lines</span>
            </div>
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Terminal scrollback history. Takes effect on next session.
          </div>
          <FieldRow label="Command history">
            <div className="flex items-center gap-1.5">
              <MudNumberInput
                accent="cyan"
                size="sm"
                min={50}
                max={5000}
                value={commandHistorySize}
                onChange={updateCommandHistorySize}
                className="w-[72px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">cmds</span>
            </div>
          </FieldRow>
          <FieldRow label="Chat history">
            <div className="flex items-center gap-1.5">
              <MudNumberInput
                accent="cyan"
                size="sm"
                min={50}
                max={5000}
                value={chatHistorySize}
                onChange={updateChatHistorySize}
                className="w-[72px] text-center"
              />
              <span className="text-[10px] font-mono text-text-dim">msgs</span>
            </div>
          </FieldRow>
        </SettingsSection>

        {/* Timestamps */}
        <SettingsSection
          icon={<ClockIcon size={13} />}
          title="Timestamps"
          accent="#ff79c6"
          open={openSection === 'timestamps'}
          onToggle={() => toggle('timestamps')}
        >
          <FieldRow label="Timestamp format">
            <div className="flex gap-1">
              {(['12h', '24h'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => updateTimestampFormat(fmt)}
                  className={cn(
                    'text-[10px] font-mono px-2 py-0.5 rounded border cursor-pointer transition-colors',
                    timestampFormat === fmt
                      ? 'text-pink border-pink/40 bg-pink/10'
                      : 'text-text-dim border-border-dim hover:border-pink/30',
                  )}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </FieldRow>
        </SettingsSection>

        {/* Session Logging */}
        <SettingsSection
          icon={<NotesIcon size={13} />}
          title="Session Logging"
          accent="#f1fa8c"
          open={openSection === 'logging'}
          onToggle={() => toggle('logging')}
        >
          <FieldRow label="Enable logging">
            <ToggleSwitch
              checked={sessionLoggingEnabled}
              onChange={updateSessionLoggingEnabled}
              accent="#f1fa8c"
            />
          </FieldRow>
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Logs session output (ANSI stripped) and your commands to the sessions/ folder in your data directory.
          </div>
        </SettingsSection>

        {/* Numpad Mappings */}
        <NumpadSection mappings={numpadMappings} onChange={updateNumpadMappings} open={openSection === 'numpad'} onToggle={() => toggle('numpad')} />

        {/* Custom Sounds — Tauri only */}
        {isTauri && (
          <CustomSoundsSection
            customChime1={customChime1}
            customChime2={customChime2}
            updateCustomChime1={updateCustomChime1}
            updateCustomChime2={updateCustomChime2}
            open={openSection === 'sounds'}
            onToggle={() => toggle('sounds')}
          />
        )}

        {/* Notifications */}
        <SettingsSection
          icon={<Volume2Icon size={13} />}
          title="Notifications"
          accent="#ffb86c"
          open={openSection === 'notifications'}
          onToggle={() => toggle('notifications')}
        >
          {(['say', 'shout', 'ooc', 'tell', 'sz'] as const).map((type) => (
            <FieldRow key={type} label={type.toUpperCase()}>
              <ToggleSwitch
                checked={chatNotifications[type]}
                onChange={() => toggleChatNotification(type)}
                accent="#ffb86c"
              />
            </FieldRow>
          ))}
          <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
            Flashes the taskbar icon when a message arrives while DartForge is unfocused.
          </div>
        </SettingsSection>

        {/* Data Location — Tauri only */}
        {isTauri && <DataLocationSection open={openSection === 'data-location'} onToggle={() => toggle('data-location')} />}

        {/* Backups — Tauri only */}
        {isTauri && <BackupsSection open={openSection === 'backups'} onToggle={() => toggle('backups')} />}
      </div>
    </div>
  );
}

/* ── Numpad Mappings Section ──────────────────────────────── */

const NUMPAD_GRID = [
  [{ key: 'Numpad7', label: '7' }, { key: 'Numpad8', label: '8' }, { key: 'Numpad9', label: '9' }],
  [{ key: 'Numpad4', label: '4' }, { key: 'Numpad5', label: '5' }, { key: 'Numpad6', label: '6' }],
  [{ key: 'Numpad1', label: '1' }, { key: 'Numpad2', label: '2' }, { key: 'Numpad3', label: '3' }],
];
const NUMPAD_BOTTOM = [
  { key: 'Numpad0', label: '0', span: 2 },
  { key: 'NumpadAdd', label: '+', span: 1 },
];

function NumpadSection({ mappings, onChange, open, onToggle }: { mappings: Record<string, string>; onChange: (v: Record<string, string>) => void; open: boolean; onToggle: () => void }) {
  const updateKey = (key: string, value: string) => {
    onChange({ ...mappings, [key]: value });
  };

  return (
    <SettingsSection
      open={open}
      onToggle={onToggle}
      icon={<GearIcon size={13} />}
      title="Numpad Mappings"
      accent="#6272a4"
    >
      <div className="grid grid-cols-3 gap-1">
        {NUMPAD_GRID.flat().map(({ key, label }) => (
          <div key={key} className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] font-mono text-text-dim">{label}</span>
            <MudInput
              accent="purple"
              size="sm"
              value={mappings[key] ?? ''}
              onChange={(e) => updateKey(key, e.target.value)}
              className="w-full text-center text-[10px]"
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 mt-1">
        {NUMPAD_BOTTOM.map(({ key, label, span }) => (
          <div key={key} className="flex flex-col items-center gap-0.5" style={{ gridColumn: `span ${span}` }}>
            <span className="text-[9px] font-mono text-text-dim">{label}</span>
            <MudInput
              accent="purple"
              size="sm"
              value={mappings[key] ?? ''}
              onChange={(e) => updateKey(key, e.target.value)}
              className="w-full text-center text-[10px]"
            />
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange({ ...DEFAULT_NUMPAD_MAPPINGS })}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded mt-1',
          'text-[10px] font-mono text-text-dim border border-border-dim',
          'hover:text-text-label hover:border-border-subtle transition-colors cursor-pointer'
        )}
      >
        <RotateCcwIcon size={9} />
        Reset to defaults
      </button>
    </SettingsSection>
  );
}

/* ── Custom Sounds Section (Tauri-only) ───────────────────── */

const CHIME_BTN = cn(
  'flex items-center gap-1 px-2 py-0.5 rounded',
  'text-[9px] font-mono text-text-dim border border-border-dim',
  'hover:text-text-label hover:border-border-subtle transition-colors cursor-pointer',
);

function ChimePicker({
  label,
  chimeId,
  customFileName,
  onUpdate,
}: {
  label: string;
  chimeId: 'chime1' | 'chime2';
  customFileName: string | null;
  onUpdate: (v: string | null) => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const handleChoose = async () => {
    if (!openDialog || !invoke) return;
    setError(null);
    try {
      const selected = await openDialog({
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'webm'] }],
        multiple: false,
        title: `Select ${label} sound`,
      });
      if (!selected || typeof selected !== 'string') return;

      const destName = await invoke('import_sound_file', {
        sourcePath: selected,
        chimeId,
      }) as string;

      // Store the original filename for display
      const parts = selected.replace(/\\/g, '/').split('/');
      onUpdate(parts[parts.length - 1] || destName);
    } catch (e) {
      setError(String(e));
    }
  };

  const handlePreview = async () => {
    // Stop any in-flight preview first
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current.src = '';
      previewRef.current = null;
    }
    setPreviewing(true);
    try {
      let url: string;
      if (customFileName && invoke) {
        const dataUrl = await invoke('get_sound_base64', { chimeId }) as string | null;
        url = dataUrl || `/${chimeId}.wav`;
      } else {
        url = `/${chimeId}.wav`;
      }
      const audio = new Audio(url);
      previewRef.current = audio;
      const done = () => { previewRef.current = null; setPreviewing(false); };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    } catch {
      previewRef.current = null;
      setPreviewing(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    try {
      if (invoke) await invoke('remove_custom_sound', { chimeId });
      onUpdate(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-text-dim uppercase tracking-wide flex-1">
          {label}
        </span>
        <span className="text-[9px] font-mono text-text-dim truncate max-w-[120px]" title={customFileName || 'Default'}>
          {customFileName || 'Default'}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={handleChoose} className={CHIME_BTN}>
          <FolderIcon size={9} />
          Choose
        </button>
        <button
          onClick={handlePreview}
          disabled={previewing}
          className={cn(CHIME_BTN, previewing && 'opacity-40 pointer-events-none')}
        >
          <PlayIcon size={9} />
          Preview
        </button>
        {customFileName && (
          <button onClick={handleReset} className={CHIME_BTN}>
            <RotateCcwIcon size={9} />
            Reset
          </button>
        )}
      </div>
      {error && (
        <div className="text-[9px] font-mono text-red-400 leading-relaxed">{error}</div>
      )}
    </div>
  );
}

function CustomSoundsSection({
  customChime1,
  customChime2,
  updateCustomChime1,
  updateCustomChime2,
  open,
  onToggle,
}: {
  customChime1: string | null;
  customChime2: string | null;
  updateCustomChime1: (v: string | null) => void;
  updateCustomChime2: (v: string | null) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <SettingsSection
      open={open}
      onToggle={onToggle}
      icon={<Volume2Icon size={13} />}
      title="Custom Sounds"
      accent="#50fa7b"
    >
      <ChimePicker
        label="General Chat"
        chimeId="chime1"
        customFileName={customChime1}
        onUpdate={updateCustomChime1}
      />
      <div className="border-t border-border-dim" />
      <ChimePicker
        label="Tells & SZ"
        chimeId="chime2"
        customFileName={customChime2}
        onUpdate={updateCustomChime2}
      />
      <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
        Choose custom audio files for chat alert sounds. Supports WAV, MP3, OGG, and WebM (max 5 MB).
      </div>
    </SettingsSection>
  );
}

/* ── Data Location Section (Tauri-only) ───────────────────── */

function DataLocationSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
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
      open={open}
      onToggle={onToggle}
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

function BackupsSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { autoBackupEnabled, updateAutoBackupEnabled } = useAppSettingsContext();
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
      open={open}
      onToggle={onToggle}
      icon={<ClockIcon size={13} />}
      title="Backups"
      accent="#f59e0b"
    >
      <FieldRow label="Auto-backup">
        <ToggleSwitch
          checked={autoBackupEnabled}
          onChange={updateAutoBackupEnabled}
          accent="#f59e0b"
        />
      </FieldRow>
      <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
        Automatically creates backups at session start and every hour.
      </div>

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
