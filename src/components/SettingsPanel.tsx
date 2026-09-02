import { usePanelContext } from '../contexts/PanelLayoutContext';
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import {
  SearchIcon,
  TimerIcon,
  FolderIcon,
  TrashIcon,
  CheckCircleIcon,
  ClockIcon,
  ChevronDownSmallIcon,
  FilterIcon,
  GearIcon,
  NotesIcon,
  RotateCcwIcon,
  Volume2Icon,
  PlayIcon,
  CounterIcon,
  UserIcon,
  PlusIcon,
  SmartphoneIcon,
  HouseIcon,
  MapIcon,
} from './icons';
import type { CustomSoundEntry } from '../hooks/useSoundLibrary';
import { PanelHeader } from './PanelHeader';
import { DEFAULT_NUMPAD_MAPPINGS } from '../hooks/useAppSettings';
import { MudInput, MudTextarea, MudNumberInput, ToggleSwitch } from './shared';
import { cn } from '../lib/cn';
import { useDataStore } from '../contexts/DataStoreContext';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { formatCountdown } from '../lib/panelUtils';
import { getPlatform } from '../lib/platform';
import { loadStorageMode } from '../lib/dropbox';

/* ── Tauri imports (lazy) ─────────────────────────────────── */

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let openDialog: ((opts: Record<string, unknown>) => Promise<unknown>) | null = null;
let loadStore:
  | ((path: string) => Promise<{
      get: <T>(k: string) => Promise<T | null | undefined>;
      set: (k: string, v: unknown) => Promise<void>;
      save: () => Promise<void>;
    }>)
  | null = null;

if (getPlatform() === 'tauri') {
  import('@tauri-apps/api/core').then((m) => {
    invoke = m.invoke;
  });
  import('@tauri-apps/plugin-dialog').then((m) => {
    openDialog = m.open as typeof openDialog;
  });
  import('@tauri-apps/plugin-store').then((m) => {
    loadStore = m.load;
  });
}

const LOCAL_CONFIG_FILE = 'local-config.json';
const DATA_DIRS_KEY = 'dataDirs';
/** Character switch advisory window. A heads-up only, never a block. */
const SWITCH_COOLDOWN_MS = 20 * 60 * 1000;

/* ── Settings Search ──────────────────────────────────────── */

interface SettingsSearchState {
  /** Lower-cased, whitespace-split query words. Empty when not searching. */
  tokens: string[];
  /** Sections report whether they match the current query (null = unmounted). */
  reportHit: (id: string, hit: boolean | null) => void;
}

const SettingsSearchContext = createContext<SettingsSearchState>({
  tokens: [],
  reportHit: () => {},
});

/** Every query word must appear somewhere in the text. */
function matchesTokens(text: string, tokens: string[]): boolean {
  return tokens.every((t) => text.includes(t));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wraps each query word found in `text` with a highlight span. */
function highlightText(text: string, tokens: string[]): ReactNode {
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="text-cyan bg-cyan/15 rounded-[2px]">
        {part}
      </span>
    ) : (
      part
    )
  );
}

/* ── Collapsible Section ──────────────────────────────────── */

function SettingsSection({
  icon,
  title,
  accent = '#bd93f9',
  open,
  onToggle,
  keywords,
  children,
}: {
  icon: ReactNode;
  title: string;
  accent?: string;
  open?: boolean;
  onToggle?: () => void;
  /** Extra search terms (synonyms) not present in the rendered text. */
  keywords?: string;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { tokens, reportHit } = useContext(SettingsSearchContext);
  const searching = tokens.length > 0;
  const [hit, setHit] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Match against the section title, its keyword list, and everything rendered inside it
  // (labels, descriptions, sub-headings). Content stays mounted while collapsed, so the
  // text is always available.
  useLayoutEffect(() => {
    if (!searching) {
      setHit(true);
      reportHit(title, null);
      return;
    }
    const text =
      `${title} ${keywords ?? ''} ${contentRef.current?.textContent ?? ''}`.toLowerCase();
    const matched = matchesTokens(text, tokens);
    setHit(matched);
    reportHit(title, matched);
  }, [searching, tokens, title, keywords, reportHit]);

  useEffect(() => () => reportHit(title, null), [title, reportHit]);

  // While searching, every matching section is forced open.
  const isOpen = searching ? hit : (open ?? internalOpen);
  const handleToggle = () => {
    if (onToggle) onToggle();
    else setInternalOpen((v) => !v);
    // The parent clears the search when a header is clicked mid-search; once the other
    // sections reappear, keep this one in view.
    if (searching) {
      requestAnimationFrame(() => {
        rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'border border-border-dim rounded overflow-hidden',
        searching && !hit && 'hidden'
      )}
    >
      <button
        onClick={handleToggle}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-150',
          'bg-bg-secondary hover:bg-[#252525]'
        )}
        style={{ borderLeft: `2px solid ${isOpen ? accent : 'transparent'}` }}
      >
        <span style={{ color: accent }} className="shrink-0">
          {icon}
        </span>
        <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.06em] text-text-label flex-1 text-left">
          {highlightText(title, tokens)}
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
          <div ref={contentRef} className="px-3 py-3 space-y-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Field Row ────────────────────────────────────────────── */

function FieldRow({
  label,
  children,
  dimmed,
}: {
  label: string;
  children: ReactNode;
  dimmed?: boolean;
}) {
  const { tokens } = useContext(SettingsSearchContext);
  return (
    <div className={cn('flex items-center gap-2', dimmed && 'opacity-40 pointer-events-none')}>
      <span className="text-[10px] font-mono text-text-dim uppercase tracking-wide flex-1">
        {highlightText(label, tokens)}
      </span>
      {children}
    </div>
  );
}

/** FieldRow + ToggleSwitch shorthand for boolean settings. */
function ToggleRow({
  label,
  checked,
  onChange,
  accent,
  dimmed,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accent: string;
  dimmed?: boolean;
  disabled?: boolean;
}) {
  return (
    <FieldRow label={label} dimmed={dimmed}>
      <ToggleSwitch checked={checked} onChange={onChange} accent={accent} disabled={disabled} />
    </FieldRow>
  );
}

type InputAccent = 'red' | 'green' | 'cyan' | 'orange' | 'pink' | 'purple';

/** FieldRow + MudNumberInput + unit suffix shorthand. */
function NumberRow({
  label,
  value,
  onChange,
  accent,
  min,
  max,
  step,
  parse,
  unit,
  width = 'w-[48px]',
  dimmed,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  accent: InputAccent;
  min: number;
  max: number;
  step?: number;
  parse?: (v: string) => number;
  unit: string;
  width?: string;
  dimmed?: boolean;
}) {
  return (
    <FieldRow label={label} dimmed={dimmed}>
      <div className="flex items-center gap-1.5">
        <MudNumberInput
          accent={accent}
          size="sm"
          min={min}
          max={max}
          step={step}
          parse={parse}
          value={value}
          onChange={onChange}
          className={`${width} text-center`}
        />
        <span className="text-[10px] font-mono text-text-dim">{unit}</span>
      </div>
    </FieldRow>
  );
}

/** Timed status message hook — shows a message for 3 seconds. */
function useFlashStatus(): [string | null, (msg: string) => void] {
  const [status, setStatus] = useState<string | null>(null);
  const showStatus = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  };
  return [status, showStatus];
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

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [openSection, setOpenSection] = useState<string | null>(null);

  // Search: filters sections by their labels/descriptions and forces matches open.
  const [query, setQuery] = useState('');
  const { activePanel } = usePanelContext();
  const searchRef = useRef<HTMLInputElement>(null);
  // Focus the search box when the panel slides open. Never on mount: the
  // panel is mounted (parked off the right edge) from launch, and autofocus
  // there scrolled the whole layout row over to reveal it.
  useEffect(() => {
    if (activePanel !== 'settings') return;
    const id = setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 300);
    return () => clearTimeout(id);
  }, [activePanel]);
  const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const searching = tokens.length > 0;
  const [hits, setHits] = useState<Record<string, boolean>>({});
  const reportHit = useCallback((id: string, hit: boolean | null) => {
    setHits((prev) => {
      if (hit === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev[id] === hit ? prev : { ...prev, [id]: hit };
    });
  }, []);
  const searchState = useMemo(() => ({ tokens, reportHit }), [tokens, reportHit]);
  const matchCount = Object.values(hits).filter(Boolean).length;

  // Clicking a section header mid-search clears the search and lands on that section.
  const toggle = (key: string) => {
    if (searching) {
      setQuery('');
      setOpenSection(key);
      return;
    }
    setOpenSection((prev) => (prev === key ? null : key));
  };

  const settings = useAppSettingsContext();
  const {
    antiIdleEnabled,
    antiIdleCommand,
    antiIdleMinutes,
    updateAntiIdleEnabled: onAntiIdleEnabledChange,
    updateAntiIdleCommand: onAntiIdleCommandChange,
    updateAntiIdleMinutes: onAntiIdleMinutesChange,
    alignmentTrackingEnabled,
    alignmentTrackingMinutes,
    updateAlignmentTrackingEnabled,
    updateAlignmentTrackingMinutes,
    whoAutoRefreshEnabled,
    whoRefreshMinutes,
    updateWhoAutoRefreshEnabled,
    updateWhoRefreshMinutes,
    equipAutoRefreshEnabled,
    equipRefreshMinutes,
    updateEquipAutoRefreshEnabled,
    updateEquipRefreshMinutes,
    boardDatesEnabled,
    updateBoardDatesEnabled: onBoardDatesEnabledChange,
    stripPromptsEnabled,
    updateStripPromptsEnabled: onStripPromptsEnabledChange,
    antiSpamEnabled,
    updateAntiSpamEnabled,
    antiSpamThreshold,
    updateAntiSpamThreshold,
    showSkillCounts,
    updateShowSkillCounts,
    commandEchoEnabled,
    updateCommandEchoEnabled,
    selectOnSend,
    updateSelectOnSend,
    commandSeparator,
    updateCommandSeparator,
    showTimerBadges,
    updateShowTimerBadges,
    terminalScrollback,
    updateTerminalScrollback,
    commandHistorySize,
    updateCommandHistorySize,
    chatHistorySize,
    updateChatHistorySize,
    sessionLoggingEnabled,
    updateSessionLoggingEnabled,
    actionBlockingEnabled,
    updateActionBlockingEnabled,
    numpadMappings,
    updateNumpadMappings,
    chatNotifications,
    toggleChatNotification,
    customChime1,
    customChime2,
    customSounds,
    updateCustomChime1,
    updateCustomChime2,
    updateCustomSounds,
    counterHotThreshold,
    counterColdThreshold,
    updateCounterHotThreshold,
    updateCounterColdThreshold,
    doorKeys,
    updateDoorKeys,
    townMapperEnabled,
    updateTownMapperEnabled,
    postSyncEnabled,
    postSyncCommands,
    updatePostSyncEnabled,
    updatePostSyncCommands,
    autoLoginEnabled,
    autoLoginActiveSlot,
    autoLoginCharacters,
    lastLoginTimestamp,
    lastLoginSlot,
    updateAutoLoginEnabled,
    updateAutoLoginCharacters,
    onSwitchCharacter,
    connected,
  } = settings;
  const isTauri = getPlatform() === 'tauri';

  // Character switch advisory (20 minutes). This is a heads-up, never a block:
  // switching the active character is always allowed.
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const otherSlot = (autoLoginActiveSlot === 0 ? 1 : 0) as 0 | 1;
  const otherCharacter = autoLoginCharacters[otherSlot];

  // Advisory logic:
  // - lastLoginSlot = the slot that LAST successfully logged in
  // - That same slot can always re-login (no wait)
  // - The other slot is best left for 20 minutes from lastLoginTimestamp
  // - So the note applies when switching TO a slot that is NOT lastLoginSlot
  const otherSlotNeedsCooldown =
    lastLoginTimestamp != null && lastLoginSlot != null && lastLoginSlot !== otherSlot;

  useEffect(() => {
    const tick = () => {
      if (!otherSlotNeedsCooldown || lastLoginTimestamp == null) {
        setCooldownRemaining(0);
        return;
      }
      const elapsed = Date.now() - lastLoginTimestamp;
      setCooldownRemaining(Math.max(0, SWITCH_COOLDOWN_MS - elapsed));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastLoginTimestamp, otherSlotNeedsCooldown]);

  const switchCooldownActive = otherSlotNeedsCooldown && cooldownRemaining > 0;

  const updateCharacterField = (slot: 0 | 1, field: 'name' | 'password', value: string) => {
    const updated = [...autoLoginCharacters] as [
      (typeof autoLoginCharacters)[0],
      (typeof autoLoginCharacters)[1],
    ];
    const current = updated[slot] ?? { name: '', password: '' };
    updated[slot] = { ...current, [field]: value };
    updateAutoLoginCharacters(updated);
  };

  return (
    <div className="w-[360px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      <PanelHeader icon={<GearIcon size={12} />} title="Settings" onClose={onClose} />

      {/* Search */}
      <div className="px-2 pt-2 shrink-0">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none">
            <SearchIcon size={10} />
          </span>
          <MudInput
            ref={searchRef}
            accent="cyan"
            size="md"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder="Search settings..."
            aria-label="Search settings"
            className="w-full pl-6 pr-6"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-[3px] text-text-dim hover:text-text-label cursor-pointer"
            >
              <span className="text-[13px] leading-none">×</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable sections */}
      <SettingsSearchContext.Provider value={searchState}>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
          {searching && matchCount === 0 && (
            <div className="text-[10px] text-text-dim italic font-mono px-1 py-2">
              No settings match &quot;{query.trim()}&quot;.
            </div>
          )}
          {/* Characters */}
          <SettingsSection
            icon={<UserIcon size={13} />}
            title="Characters"
            accent="#56b6c2"
            open={openSection === 'characters'}
            onToggle={() => toggle('characters')}
            keywords="login password account user name switch"
          >
            <ToggleRow
              label="Auto-login"
              checked={autoLoginEnabled}
              onChange={updateAutoLoginEnabled}
              accent="#56b6c2"
            />

            {([0, 1] as const).map((slot) => {
              const char1Set = !!(autoLoginCharacters[0]?.name && autoLoginCharacters[0]?.password);
              const isDisabled = slot === 1 && !char1Set;
              return (
                <div key={slot} className={slot === 0 ? 'mt-2' : 'mt-3'}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold text-text-muted tracking-wide uppercase">
                      Character {slot + 1}
                    </span>
                    {autoLoginActiveSlot === slot ? (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border bg-[#56b6c2]/10 text-[#56b6c2] border-[#56b6c2]/20">
                        active
                      </span>
                    ) : isDisabled ? (
                      <span className="text-[8px] font-mono text-text-dim">
                        Set Character 1 first
                      </span>
                    ) : null}
                  </div>
                  {/* Use <form> with autocomplete hints so password managers can detect and fill */}
                  <form
                    className="space-y-1.5"
                    onSubmit={(e) => e.preventDefault()}
                    autoComplete="on"
                  >
                    <FieldRow label="Name">
                      <MudInput
                        accent="cyan"
                        size="sm"
                        name={`dartmud-char${slot}-username`}
                        autoComplete={`section-char${slot} username`}
                        value={autoLoginCharacters[slot]?.name ?? ''}
                        onChange={(e) => updateCharacterField(slot, 'name', e.target.value)}
                        placeholder="Character name"
                        className="w-[140px] text-right"
                        disabled={isDisabled}
                      />
                    </FieldRow>
                    <FieldRow label="Password">
                      <MudInput
                        type="password"
                        accent="cyan"
                        size="sm"
                        name={`dartmud-char${slot}-password`}
                        autoComplete={`section-char${slot} current-password`}
                        value={autoLoginCharacters[slot]?.password ?? ''}
                        onChange={(e) => updateCharacterField(slot, 'password', e.target.value)}
                        placeholder="Password"
                        className="w-[140px] text-right"
                        disabled={isDisabled}
                      />
                    </FieldRow>
                  </form>
                </div>
              );
            })}

            {/* Switch active character — always available, online or off */}
            {otherCharacter?.name && (
              <div className="mt-2">
                <button
                  onClick={onSwitchCharacter}
                  title={
                    connected
                      ? `Disconnect and reconnect as ${otherCharacter.name}`
                      : `Make ${otherCharacter.name} the active character`
                  }
                  className="w-full text-[10px] font-mono py-1.5 px-3 rounded border transition-all duration-200 text-[#56b6c2] border-[#56b6c2]/30 bg-[#56b6c2]/5 hover:bg-[#56b6c2]/10 hover:border-[#56b6c2]/50 cursor-pointer"
                >
                  {connected
                    ? `Switch to ${otherCharacter.name} and reconnect`
                    : `Switch to ${otherCharacter.name}`}
                </button>
                {switchCooldownActive && (
                  <div className="mt-1 text-[9px] font-mono text-amber/80 leading-relaxed">
                    Heads up: 20 minutes between characters is the usual gap.{' '}
                    {formatCountdown(cooldownRemaining)} left before {otherCharacter.name} is clear.
                    Switching still works.
                  </div>
                )}
                <div className="mt-1 text-[9px] text-text-dim font-mono leading-relaxed">
                  {connected
                    ? 'Switching drops the connection and logs back in as the other character.'
                    : 'Switching offline just repoints counters, timers, skills, notes, and the map at the other character.'}
                </div>
              </div>
            )}

            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-2">
              {isTauri
                ? "Passwords are stored securely in your operating system's credential manager. When enabled, name and password are sent automatically on connect."
                : "Your browser's password manager can save these credentials. Passwords are not stored by DartForge on web — they are held in memory for this session only."}
            </div>
          </SettingsSection>

          {/* Timers */}
          <SettingsSection
            icon={<TimerIcon size={13} />}
            title="Timers"
            accent="#f97316"
            open={openSection === 'timers'}
            onToggle={() => toggle('timers')}
            keywords="anti-idle idle alignment who list equip loadout action blocking queue countdown badges refresh interval"
          >
            {/* Alignment tracking */}
            <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">
              Alignment Tracking
            </div>
            <ToggleRow
              label="Enabled"
              checked={alignmentTrackingEnabled}
              onChange={updateAlignmentTrackingEnabled}
              accent="#80e080"
            />
            <NumberRow
              label="Interval"
              value={alignmentTrackingMinutes}
              onChange={updateAlignmentTrackingMinutes}
              accent="green"
              min={1}
              max={14}
              unit="min"
              dimmed={!alignmentTrackingEnabled}
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1 mb-3">
              Polls alignment at the configured interval. Also prevents idle disconnect.
            </div>

            {/* Who list refresh */}
            <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">
              Who List
            </div>
            <ToggleRow
              label="Auto-refresh"
              checked={whoAutoRefreshEnabled}
              onChange={updateWhoAutoRefreshEnabled}
              accent="#61afef"
            />
            <NumberRow
              label="Interval"
              value={whoRefreshMinutes}
              onChange={updateWhoRefreshMinutes}
              accent="cyan"
              min={1}
              max={30}
              unit="min"
              dimmed={!whoAutoRefreshEnabled}
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1 mb-3">
              Silently refreshes the who list in the background.
            </div>

            {/* Loadout held-equipment refresh */}
            <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">
              Held Equipment
            </div>
            <ToggleRow
              label="Auto-refresh"
              checked={equipAutoRefreshEnabled}
              onChange={updateEquipAutoRefreshEnabled}
              accent="#bd93f9"
            />
            <NumberRow
              label="Interval"
              value={equipRefreshMinutes}
              onChange={updateEquipRefreshMinutes}
              accent="purple"
              min={1}
              max={30}
              unit="min"
              dimmed={!equipAutoRefreshEnabled}
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1 mb-3">
              Silently re-syncs the Loadout panel's hands ("equip held") in the background.
            </div>

            {/* Anti-idle */}
            <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">
              Anti-Idle
            </div>
            {alignmentTrackingEnabled && (
              <div className="text-[9px] text-[#80e080] font-mono leading-relaxed mb-1">
                Disabled — alignment tracking is active.
              </div>
            )}
            <ToggleRow
              label="Enabled"
              checked={antiIdleEnabled}
              onChange={onAntiIdleEnabledChange}
              accent="#bd93f9"
              dimmed={alignmentTrackingEnabled}
              disabled={alignmentTrackingEnabled}
            />
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
            <NumberRow
              label="Interval"
              value={antiIdleMinutes}
              onChange={onAntiIdleMinutesChange}
              accent="purple"
              min={1}
              max={14}
              unit="min"
              dimmed={!antiIdleEnabled || alignmentTrackingEnabled}
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1 mb-3">
              Sends the command at the configured interval to prevent idle disconnect.
            </div>

            {/* Action Blocking */}
            <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">
              Action Blocking
            </div>
            <ToggleRow
              label="Enabled"
              checked={actionBlockingEnabled}
              onChange={updateActionBlockingEnabled}
              accent="#f59e0b"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1 mb-3">
              Queues commands during channeled actions (cast, study, hunt, etc.) to prevent
              interruption. Use /block and /unblock for manual control.
            </div>

            {/* Display */}
            <div className="text-[10px] font-semibold text-text-muted tracking-wide uppercase mb-1">
              Display
            </div>
            <ToggleRow
              label="Timer countdowns"
              checked={showTimerBadges}
              onChange={updateShowTimerBadges}
              accent="#f97316"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Show timer countdowns (anti-idle, alignment, and custom timers) next to the command
              input.
            </div>
          </SettingsSection>

          {/* Login Commands */}
          <SettingsSection
            icon={<PlayIcon size={13} />}
            title="Login Commands"
            accent="#ff79c6"
            open={openSection === 'post-sync'}
            onToggle={() => toggle('post-sync')}
            keywords="post-sync startup connect on login autorun script"
          >
            <ToggleRow
              label="Enabled"
              checked={postSyncEnabled}
              onChange={updatePostSyncEnabled}
              accent="#ff79c6"
            />
            <FieldRow label="Commands" dimmed={!postSyncEnabled}>
              <div className="w-full" />
            </FieldRow>
            <div className={cn(!postSyncEnabled && 'opacity-40 pointer-events-none')}>
              <MudTextarea
                accent="pink"
                size="sm"
                value={postSyncCommands}
                onChange={(e) => updatePostSyncCommands(e.target.value)}
                placeholder="inventory;;who;;/echo Ready!"
                rows={5}
                className="w-full"
              />
            </div>
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Sent automatically after logging in. Supports the command separator, aliases, /delay,
              /echo, /spam, /var.
            </div>
          </SettingsSection>

          {/* Doors */}
          <SettingsSection
            icon={<HouseIcon size={13} />}
            title="Doors"
            accent="#e8a849"
            open={openSection === 'doors'}
            onToggle={() => toggle('doors')}
            keywords="keys keyring lock unlock door"
          >
            <NumberRow
              label="Keyring slots"
              value={doorKeys}
              onChange={updateDoorKeys}
              accent="orange"
              min={1}
              max={10}
              unit="keys"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              /door &lt;dir&gt; unlocks with key, key 2 … key N, opens, steps through, then closes
              and locks behind you. The town map's auto-walk runs the same sequence when a route
              crosses a known door.
            </div>
          </SettingsSection>

          {/* Map */}
          <SettingsSection
            icon={<MapIcon size={13} />}
            title="Map"
            accent="#e8a849"
            open={openSection === 'map'}
            onToggle={() => toggle('map')}
            keywords="town mapper hex automap indoors rooms"
          >
            <ToggleRow
              label="Town mapper"
              checked={townMapperEnabled}
              onChange={updateTownMapperEnabled}
              accent="#e8a849"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Maps towns and buildings room by room. Turn off if it misbehaves — the Map panel shows
              only the hex map with an IN TOWN badge while indoors. Mapped town data is kept, and
              mapping picks back up when re-enabled.
            </div>
          </SettingsSection>

          {/* Output transformations */}
          <SettingsSection
            icon={<FilterIcon size={13} />}
            title="Output"
            accent="#50fa7b"
            open={openSection === 'output'}
            onToggle={() => toggle('output')}
            keywords="terminal echo separator anti-spam spam prompt board dates skill counts select on send duplicate lines"
          >
            <ToggleRow
              label="Convert board dates"
              checked={boardDatesEnabled}
              onChange={onBoardDatesEnabledChange}
              accent="#50fa7b"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Replace in-game bulletin board dates with real-world dates.
            </div>
            <ToggleRow
              label="Strip prompts"
              checked={stripPromptsEnabled}
              onChange={onStripPromptsEnabledChange}
              accent="#50fa7b"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Remove the server prompt (&gt;) from terminal output.
            </div>
            <ToggleRow
              label="Command echo"
              checked={commandEchoEnabled}
              onChange={updateCommandEchoEnabled}
              accent="#50fa7b"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Show your sent commands as dimmed lines in the terminal.
            </div>
            <ToggleRow
              label="Select on send"
              checked={selectOnSend}
              onChange={updateSelectOnSend}
              accent="#50fa7b"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              After sending a command, keep it selected in the input instead of clearing. Type to
              replace, or press Enter to resend.
            </div>
            <FieldRow label="Command separator">
              <MudInput
                accent="green"
                value={commandSeparator}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.length > 0) updateCommandSeparator(v);
                }}
                className="w-[60px] text-center font-mono"
              />
            </FieldRow>
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Character(s) used to chain multiple commands (e.g. &quot;kill rat{commandSeparator}
              loot corpse&quot;). Prefix with \ to use literally. If you change this, update
              existing alias/trigger bodies to match.
            </div>
            <ToggleRow
              label="Anti-spam"
              checked={antiSpamEnabled}
              onChange={updateAntiSpamEnabled}
              accent="#50fa7b"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Collapse consecutive identical lines with a repeat count.
            </div>
            <NumberRow
              label="Collapse after"
              value={antiSpamThreshold}
              onChange={updateAntiSpamThreshold}
              accent="green"
              min={2}
              max={99}
              unit="repeats"
              dimmed={!antiSpamEnabled}
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              How many identical lines before they collapse. Up to this many show in full — a few
              repeats are usually legitimate — then further copies fold into the count.
            </div>
            <ToggleRow
              label="Show skill counts"
              checked={showSkillCounts}
              onChange={updateShowSkillCounts}
              accent="#50fa7b"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Append tracked improve counts to &quot;show skills&quot; and &quot;show quick
              skills&quot; readouts.
            </div>
          </SettingsSection>

          {/* Counters */}
          <SettingsSection
            icon={<CounterIcon size={13} />}
            title="Counters"
            accent="#f59e0b"
            open={openSection === 'counters'}
            onToggle={() => toggle('counters')}
            keywords="hot cold threshold skill rate improves glow per day"
          >
            <NumberRow
              label="Hot threshold"
              value={counterHotThreshold}
              onChange={updateCounterHotThreshold}
              accent="purple"
              min={0}
              max={99}
              step={0.5}
              parse={parseFloat}
              unit="/pd"
              width="w-[56px]"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Skills at or above this rate glow warm. Set to 0 to disable.
            </div>
            <NumberRow
              label="Cold threshold"
              value={counterColdThreshold}
              onChange={updateCounterColdThreshold}
              accent="cyan"
              min={0}
              max={99}
              step={0.5}
              parse={parseFloat}
              unit="/pd"
              width="w-[56px]"
            />
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
            keywords="scrollback history lines terminal command chat size limit memory"
          >
            <NumberRow
              label="Scrollback"
              value={terminalScrollback}
              onChange={updateTerminalScrollback}
              accent="cyan"
              min={1000}
              max={100000}
              unit="lines"
              width="w-[72px]"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Terminal scrollback history. Takes effect on next session.
            </div>
            <NumberRow
              label="Command history"
              value={commandHistorySize}
              onChange={updateCommandHistorySize}
              accent="cyan"
              min={50}
              max={5000}
              unit="cmds"
              width="w-[72px]"
            />
            <NumberRow
              label="Chat history"
              value={chatHistorySize}
              onChange={updateChatHistorySize}
              accent="cyan"
              min={50}
              max={5000}
              unit="msgs"
              width="w-[72px]"
            />
          </SettingsSection>

          {/* Session Logging */}
          <SettingsSection
            icon={<NotesIcon size={13} />}
            title="Session Logging"
            accent="#f1fa8c"
            open={openSection === 'logging'}
            onToggle={() => toggle('logging')}
            keywords="log file record transcript sessions folder"
          >
            <ToggleRow
              label="Enable logging"
              checked={sessionLoggingEnabled}
              onChange={updateSessionLoggingEnabled}
              accent="#f1fa8c"
            />
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Logs session output (ANSI stripped) and your commands to the sessions/ folder in your
              data directory.
            </div>
          </SettingsSection>

          {/* Numpad Mappings */}
          <NumpadSection
            mappings={numpadMappings}
            onChange={updateNumpadMappings}
            open={openSection === 'numpad'}
            onToggle={() => toggle('numpad')}
          />

          {/* Custom Sounds — Tauri only */}
          {isTauri && (
            <CustomSoundsSection
              customChime1={customChime1}
              customChime2={customChime2}
              customSounds={customSounds}
              updateCustomChime1={updateCustomChime1}
              updateCustomChime2={updateCustomChime2}
              updateCustomSounds={updateCustomSounds}
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
            keywords="taskbar flash alert chat tells say shout ooc sz unfocused"
          >
            {(['say', 'shout', 'ooc', 'tell', 'sz'] as const).map((type) => (
              <ToggleRow
                key={type}
                label={type.toUpperCase()}
                checked={chatNotifications[type]}
                onChange={() => toggleChatNotification(type)}
                accent="#ffb86c"
              />
            ))}
            <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
              Flashes the taskbar icon when a message arrives while DartForge is unfocused.
            </div>
          </SettingsSection>

          {/* Mobile Companion — Tauri only */}
          {isTauri && (
            <CompanionSection
              open={openSection === 'companion'}
              onToggle={() => toggle('companion')}
            />
          )}

          {/* Data Location — Tauri only */}
          {isTauri && (
            <DataLocationSection
              open={openSection === 'data-location'}
              onToggle={() => toggle('data-location')}
            />
          )}

          {/* Data Storage — Web only */}
          {!isTauri && (
            <WebStorageSection
              open={openSection === 'web-storage'}
              onToggle={() => toggle('web-storage')}
            />
          )}

          {/* Backups — Tauri only */}
          {isTauri && (
            <BackupsSection open={openSection === 'backups'} onToggle={() => toggle('backups')} />
          )}
        </div>
      </SettingsSearchContext.Provider>
    </div>
  );
}

/* ── Numpad Mappings Section ──────────────────────────────── */

/*
 * Numpad layout (3 cols × 6 rows):
 *
 *  [ / ][ * ][ - ]
 *  [ 7 ][ 8 ][ 9 ]
 *  [ 4 ][ 5 ][ 6 ]
 *  [ 1 ][ 2 ][ 3 ]
 *  [   0   ][ . ][ + ]
 */
const NUMPAD_GRID = [
  [
    { key: 'NumpadDivide', label: '/' },
    { key: 'NumpadMultiply', label: '*' },
    { key: 'NumpadSubtract', label: '-' },
  ],
  [
    { key: 'Numpad7', label: '7' },
    { key: 'Numpad8', label: '8' },
    { key: 'Numpad9', label: '9' },
  ],
  [
    { key: 'Numpad4', label: '4' },
    { key: 'Numpad5', label: '5' },
    { key: 'Numpad6', label: '6' },
  ],
  [
    { key: 'Numpad1', label: '1' },
    { key: 'Numpad2', label: '2' },
    { key: 'Numpad3', label: '3' },
  ],
];
const NUMPAD_BOTTOM = [
  { key: 'Numpad0', label: '0', span: 1 },
  { key: 'NumpadDecimal', label: '.', span: 1 },
  { key: 'NumpadAdd', label: '+', span: 1 },
];

function NumpadSection({
  mappings,
  onChange,
  open,
  onToggle,
}: {
  mappings: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  open: boolean;
  onToggle: () => void;
}) {
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
      keywords="keypad keys numpad directions movement hotkeys bindings reset defaults"
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
        {NUMPAD_BOTTOM.map(({ key, label }) => (
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
  'hover:text-text-label hover:border-border-subtle transition-colors cursor-pointer'
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

      const destName = (await invoke('import_sound_file', {
        sourcePath: selected,
        soundId: chimeId,
      })) as string;

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
        const dataUrl = (await invoke('get_sound_base64', { soundId: chimeId })) as string | null;
        url = dataUrl || `/${chimeId}.wav`;
      } else {
        url = `/${chimeId}.wav`;
      }
      const audio = new Audio(url);
      previewRef.current = audio;
      const done = () => {
        previewRef.current = null;
        setPreviewing(false);
      };
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
      if (invoke) await invoke('remove_custom_sound', { soundId: chimeId });
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
        <span
          className="text-[9px] font-mono text-text-dim truncate max-w-[120px]"
          title={customFileName || 'Default'}
        >
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
      {error && <div className="text-[9px] font-mono text-red-400 leading-relaxed">{error}</div>}
    </div>
  );
}

function CustomSoundRow({
  entry,
  onRemove,
  onPreview,
}: {
  entry: CustomSoundEntry;
  onRemove: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-text-label flex-1 truncate" title={entry.name}>
        {entry.name}
      </span>
      <span
        className="text-[9px] font-mono text-text-dim truncate max-w-[80px]"
        title={entry.fileName}
      >
        {entry.fileName}
      </span>
      <button onClick={onPreview} className={CHIME_BTN} title="Preview">
        <PlayIcon size={9} />
      </button>
      <button onClick={onRemove} className={CHIME_BTN} title="Remove">
        <TrashIcon size={9} />
      </button>
    </div>
  );
}

function CustomSoundsSection({
  customChime1,
  customChime2,
  customSounds,
  updateCustomChime1,
  updateCustomChime2,
  updateCustomSounds,
  open,
  onToggle,
}: {
  customChime1: string | null;
  customChime2: string | null;
  customSounds: CustomSoundEntry[];
  updateCustomChime1: (v: string | null) => void;
  updateCustomChime2: (v: string | null) => void;
  updateCustomSounds: (v: CustomSoundEntry[]) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [newSoundName, setNewSoundName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const handleAddSound = async () => {
    if (!openDialog || !invoke) return;
    const name = newSoundName.trim();
    if (!name) {
      setError('Enter a name for the sound.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError('Name must use letters, digits, hyphens, underscores only.');
      return;
    }
    if (name === 'chime1' || name === 'chime2') {
      setError('Cannot use built-in sound names. Use the replacers above.');
      return;
    }
    if (customSounds.some((s) => s.name === name)) {
      setError(`Sound "${name}" already exists.`);
      return;
    }
    setError(null);

    try {
      const selected = await openDialog({
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'webm'] }],
        multiple: false,
        title: `Select audio file for "${name}"`,
      });
      if (!selected || typeof selected !== 'string') return;

      const destName = (await invoke('import_sound_file', {
        sourcePath: selected,
        soundId: name,
      })) as string;

      updateCustomSounds([...customSounds, { name, fileName: destName }]);
      setNewSoundName('');
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRemoveSound = async (name: string) => {
    try {
      if (invoke) await invoke('remove_custom_sound', { soundId: name });
      updateCustomSounds(customSounds.filter((s) => s.name !== name));
    } catch (e) {
      setError(String(e));
    }
  };

  const handlePreviewSound = async (soundId: string) => {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current.src = '';
      previewRef.current = null;
    }
    try {
      let url: string;
      if (invoke) {
        const dataUrl = (await invoke('get_sound_base64', { soundId })) as string | null;
        url = dataUrl || `/${soundId}.wav`;
      } else {
        url = `/${soundId}.wav`;
      }
      const audio = new Audio(url);
      previewRef.current = audio;
      const done = () => {
        previewRef.current = null;
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    } catch {
      previewRef.current = null;
    }
  };

  return (
    <SettingsSection
      open={open}
      onToggle={onToggle}
      icon={<Volume2Icon size={13} />}
      title="Sound Library"
      accent="#50fa7b"
      keywords="sounds audio chime chime1 chime2 wav mp3 ogg playSound custom alert"
    >
      {/* Built-in chime replacements */}
      <ChimePicker
        label="General Chat (chime1)"
        chimeId="chime1"
        customFileName={customChime1}
        onUpdate={updateCustomChime1}
      />
      <div className="border-t border-border-dim" />
      <ChimePicker
        label="Tells & SZ (chime2)"
        chimeId="chime2"
        customFileName={customChime2}
        onUpdate={updateCustomChime2}
      />

      {/* Custom sounds */}
      <div className="border-t border-border-dim mt-2 pt-2">
        <div className="text-[10px] font-mono text-text-dim uppercase tracking-wide mb-1.5">
          Custom Sounds
        </div>
        {customSounds.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {customSounds.map((entry) => (
              <CustomSoundRow
                key={entry.name}
                entry={entry}
                onRemove={() => handleRemoveSound(entry.name)}
                onPreview={() => handlePreviewSound(entry.name)}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newSoundName}
            onChange={(e) => setNewSoundName(e.target.value)}
            placeholder="Sound name"
            className="flex-1 text-[10px] font-mono bg-transparent border border-border-dim rounded px-2 py-1 text-text-label placeholder:text-text-dim/50 focus:outline-none focus:border-[#50fa7b]/40"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddSound();
            }}
          />
          <button onClick={handleAddSound} className={CHIME_BTN} title="Add custom sound">
            <PlusIcon size={9} />
            Add
          </button>
        </div>
        {error && (
          <div className="text-[9px] font-mono text-red-400 leading-relaxed mt-1">{error}</div>
        )}
      </div>

      <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-2">
        Built-in sounds (chime1, chime2) are always available. Add custom sounds for triggers and
        scripts. Use <span className="text-[#50fa7b]">playSound(3)</span> or{' '}
        <span className="text-[#50fa7b]">playSound('name')</span> in scripts. Supports WAV, MP3,
        OGG, WebM (max 5 MB).
      </div>
    </SettingsSection>
  );
}

/* ── Data Storage Section (Web-only) ──────────────────────── */

function WebStorageSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const mode = loadStorageMode();

  return (
    <SettingsSection
      open={open}
      onToggle={onToggle}
      icon={<FolderIcon size={13} />}
      title="Data Storage"
      accent="#8be9fd"
      keywords="dropbox local storage mode sync browser"
    >
      <FieldRow label="Current mode">
        <span className="text-[10px] font-mono text-text-label">
          {mode === 'dropbox' ? 'Dropbox Sync' : mode === 'local' ? 'Local Storage' : 'Not set'}
        </span>
      </FieldRow>
      <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
        Change where DartForge stores your settings and skill data. Resetting will reload the page.
      </div>
      <button
        onClick={() => {
          if (confirm('Reset storage mode? The page will reload and you can choose again.')) {
            localStorage.removeItem('dartforge:storage_mode');
            window.location.reload();
          }
        }}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded mt-1',
          'text-[10px] font-mono text-text-dim border border-border-dim',
          'hover:text-cyan hover:border-cyan/30 transition-colors cursor-pointer'
        )}
      >
        <RotateCcwIcon size={9} />
        Change storage mode
      </button>
    </SettingsSection>
  );
}

/* ── Data Location Section (Tauri-only) ───────────────────── */

function DataLocationSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const dataStore = useDataStore();
  const [candidates, setCandidates] = useState<string[]>([]);
  const [status, showStatus] = useFlashStatus();

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
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select Data Directory',
      });
      if (!selected) return;
      const path = selected as string;
      if (candidates.includes(path)) {
        showStatus('Already added');
        return;
      }
      const valid: boolean = (await invoke('check_dir_valid', { path })) as boolean;
      if (!valid) {
        showStatus('Not writable');
        return;
      }
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

  return (
    <SettingsSection
      open={open}
      onToggle={onToggle}
      icon={<FolderIcon size={13} />}
      title="Data Location"
      accent="#8be9fd"
      keywords="directory folder path storage data dir sync dropbox onedrive"
    >
      {status && <div className="text-[10px] text-cyan font-mono mb-1">{status}</div>}

      {/* Active directory */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-bg-secondary rounded border border-border-dim">
        <CheckCircleIcon size={11} />
        <span
          className="text-[10px] text-text-label font-mono truncate flex-1"
          title={dataStore.activeDataDir ?? ''}
        >
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
  const [status, showStatus] = useFlashStatus();
  const loadedRef = useRef(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);

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
    invoke('list_backups')
      .then((list) => {
        setBackups(list as BackupEntry[]);
      })
      .catch(console.error);
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
    setConfirmingPath(null);
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
      keywords="backup restore auto-backup snapshot hourly"
    >
      <ToggleRow
        label="Auto-backup"
        checked={autoBackupEnabled}
        onChange={updateAutoBackupEnabled}
        accent="#f59e0b"
      />
      <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
        Automatically creates backups at session start and every hour.
      </div>

      {status && <div className="text-[10px] text-cyan font-mono mb-1">{status}</div>}

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
            <div
              key={entry.path}
              className="border border-border-dim rounded overflow-hidden group"
            >
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
                {confirmingPath === entry.path ? (
                  <button
                    onClick={() => restoreBackup(entry.path)}
                    onBlur={() => setConfirmingPath(null)}
                    autoFocus
                    className={cn(
                      'text-[9px] font-mono px-1 py-0.5 rounded border cursor-pointer',
                      'text-[#f59e0b] border-[#f59e0b]/40 hover:bg-[#f59e0b]/10 transition-colors'
                    )}
                  >
                    Overwrite?
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmingPath(entry.path)}
                    className={cn(
                      'text-[9px] font-mono px-1 py-0.5 rounded border cursor-pointer',
                      'text-text-dim border-border-dim opacity-0 group-hover:opacity-100',
                      'hover:text-cyan hover:border-cyan/30 transition-all'
                    )}
                  >
                    Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

/* ── Mobile Companion Section ──────────────────────────────── */

function CompanionSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { companionEnabled, companionPort, updateCompanionEnabled, updateCompanionPort } =
    useAppSettingsContext();

  const [companionInfo, setCompanionInfo] = useState<{
    running: boolean;
    url: string;
    name_url: string | null;
    qr_svg: string;
    local_ip: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start/stop companion server when toggle changes
  useEffect(() => {
    if (!invoke) return;
    let cancelled = false;

    async function syncServer() {
      try {
        setError(null);
        if (companionEnabled) {
          const info = (await invoke!('start_companion', { port: companionPort })) as {
            running: boolean;
            url: string;
            name_url: string | null;
            qr_svg: string;
            local_ip: string;
          };
          if (!cancelled) setCompanionInfo(info);
        } else {
          await invoke!('stop_companion');
          if (!cancelled) setCompanionInfo(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setCompanionInfo(null);
        }
      }
    }

    syncServer();
    return () => {
      cancelled = true;
    };
  }, [companionEnabled, companionPort]);

  return (
    <SettingsSection
      icon={<SmartphoneIcon size={13} />}
      title="Mobile Companion"
      accent="#8be9fd"
      open={open}
      onToggle={onToggle}
      keywords="phone tablet qr code web server port wifi network remote"
    >
      <ToggleRow
        label="Enable companion server"
        checked={companionEnabled}
        onChange={updateCompanionEnabled}
        accent="#8be9fd"
      />
      <NumberRow
        label="Port"
        value={companionPort}
        onChange={updateCompanionPort}
        accent="cyan"
        min={1024}
        max={65535}
        unit=""
        width="w-[72px]"
        dimmed={!companionEnabled}
      />
      <div className="text-[9px] text-text-dim font-mono leading-relaxed mt-1">
        Opens a web server on your local network. Visit the URL below on your phone to see MUD
        output and send commands. Only works on the same WiFi network.
      </div>

      {error && <div className="text-[10px] font-mono text-red-400 mt-1">{error}</div>}

      {companionInfo?.running && (
        <div className="mt-2 flex flex-col items-center gap-2">
          <a
            href={companionInfo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-mono text-[#8be9fd] underline"
          >
            {companionInfo.url}
          </a>
          {companionInfo.qr_svg && (
            <div className="mt-1" dangerouslySetInnerHTML={{ __html: companionInfo.qr_svg }} />
          )}
          <div className="text-[9px] text-text-dim font-mono">
            Scan with your phone camera to connect
          </div>
          {companionInfo.name_url && (
            <div className="text-[9px] text-text-dim font-mono text-center leading-relaxed">
              Chrome on Android and Safari on iPhone can also use{' '}
              <a
                href={companionInfo.name_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8be9fd] underline"
              >
                {companionInfo.name_url}
              </a>
              , which keeps working when your address changes. Firefox cannot open it.
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
