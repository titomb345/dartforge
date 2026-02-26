import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useTriggerContext } from '../contexts/TriggerContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import { matchTriggers, expandTriggerBody } from '../lib/triggerEngine';
import { formatCommandPreview } from '../lib/commandUtils';
import { useFilteredGroups } from '../lib/useFilteredGroups';
import { charDisplayName } from '../lib/panelUtils';
import type {
  Trigger,
  TriggerId,
  TriggerMatchMode,
  TriggerPrefill,
  TriggerScope,
} from '../types/trigger';
import { PlusIcon, ChevronDownIcon, ChevronUpIcon, TriggerIcon } from './icons';
import { PanelHeader } from './PanelHeader';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { FilterPill } from './FilterPill';
import { MudInput, MudTextarea, MudButton, MudNumberInput, ToggleSwitch } from './shared';
import { SyntaxHelpTable } from './SyntaxHelpTable';
import type { HelpRow } from './SyntaxHelpTable';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { GAG_GROUPS } from '../lib/gagPatterns';
import type { GagGroupId } from '../lib/gagPatterns';

interface TriggerPanelProps {
  onClose: () => void;
}

const MATCH_MODE_LABELS: Record<TriggerMatchMode, string> = {
  substring: 'Substring',
  exact: 'Exact',
  regex: 'Regex',
};

const HIGHLIGHT_PRESETS: { label: string; code: string; hex: string }[] = [
  { label: 'Yellow', code: '33', hex: '#ffff00' },
  { label: 'Red', code: '31', hex: '#ff5555' },
  { label: 'Green', code: '32', hex: '#50fa7b' },
  { label: 'Cyan', code: '36', hex: '#8be9fd' },
  { label: 'Magenta', code: '35', hex: '#ff79c6' },
  { label: 'White', code: '1;37', hex: '#ffffff' },
];

const PRESET_CODES = new Set(HIGHLIGHT_PRESETS.map((p) => p.code));

/** Convert hex fg/bg to an ANSI 24-bit color code string. */
function hexToAnsi(fg: string | null, bg: string | null): string | null {
  const parts: string[] = [];
  if (fg) {
    const r = parseInt(fg.slice(1, 3), 16),
      g = parseInt(fg.slice(3, 5), 16),
      b = parseInt(fg.slice(5, 7), 16);
    parts.push(`38;2;${r};${g};${b}`);
  }
  if (bg) {
    const r = parseInt(bg.slice(1, 3), 16),
      g = parseInt(bg.slice(3, 5), 16),
      b = parseInt(bg.slice(5, 7), 16);
    parts.push(`48;2;${r};${g};${b}`);
  }
  return parts.length > 0 ? parts.join(';') : null;
}

/** Parse an ANSI code string back to hex fg/bg values. Returns null for non-24-bit codes. */
function ansiToHex(code: string): { fg: string | null; bg: string | null } | null {
  const fgMatch = code.match(/38;2;(\d+);(\d+);(\d+)/);
  const bgMatch = code.match(/48;2;(\d+);(\d+);(\d+)/);
  if (!fgMatch && !bgMatch) return null;
  const toHex = (r: string, g: string, b: string) =>
    '#' + [r, g, b].map((v) => parseInt(v).toString(16).padStart(2, '0')).join('');
  return {
    fg: fgMatch ? toHex(fgMatch[1], fgMatch[2], fgMatch[3]) : null,
    bg: bgMatch ? toHex(bgMatch[1], bgMatch[2], bgMatch[3]) : null,
  };
}

// --- Trigger Row ---

function TriggerRow({
  trigger,
  scope,
  onEdit,
}: {
  trigger: Trigger;
  scope: TriggerScope;
  onEdit: (id: TriggerId) => void;
}) {
  const { toggleTrigger, deleteTrigger } = useTriggerContext();

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-bg-secondary rounded transition-[background] duration-150 cursor-pointer"
      onClick={() => onEdit(trigger.id)}
    >
      <ConfirmDeleteButton onDelete={() => deleteTrigger(trigger.id, scope)} />
      <span
        className={`text-[11px] font-mono flex-1 truncate ${
          trigger.matchMode === 'substring'
            ? 'text-[#ff79c6]'
            : trigger.matchMode === 'exact'
              ? 'text-[#f59e0b]'
              : 'text-[#22d3ee]'
        }`}
        title={`${trigger.pattern}\n${trigger.matchMode} match`}
      >
        {trigger.pattern}
      </span>
      {trigger.gag && (
        <span
          title="Gag (line suppressed)"
          className="text-[8px] font-mono px-1 py-px rounded border border-[#f59e0b]/40 text-[#f59e0b] bg-[#f59e0b]/10 shrink-0"
        >
          G
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTrigger(trigger.id, scope);
        }}
        title={trigger.enabled ? 'Disable trigger' : 'Enable trigger'}
        className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 shrink-0 ${
          trigger.enabled
            ? 'text-green border-green/40 bg-green/10'
            : 'text-text-dim border-border-dim bg-transparent'
        }`}
      >
        {trigger.enabled ? 'on' : 'off'}
      </button>
    </div>
  );
}

// --- Syntax Help ---

const TRIGGER_ACCENT = '#ff79c6';

const TRIGGER_HELP_ROWS: HelpRow[] = [
  { token: '$0', desc: 'The matched text (full match for regex, matched portion for substring)' },
  {
    token: '$1 $2 .. $9',
    desc: 'Regex capture groups',
    example: "Pattern: (\\w+) tells you '(.+)'  →  $1 = name, $2 = message",
  },
  { token: '$line', desc: 'The full matched line (ANSI-stripped)' },
  { token: '$me', desc: 'Your active character name (lowercase)' },
  { token: '$Me', desc: 'Your active character name (Capitalized)' },
  {
    token: '$varName',
    desc: 'User-defined variable (set via /var)',
    example: '/var target goblin  \u2192  $target = goblin',
  },
  {
    token: ';',
    desc: 'Command separator — sends multiple commands',
    example: '/echo Alert!;say hello',
  },
  { token: '\\;', desc: 'Literal semicolon (not a separator)' },
  {
    token: '/delay <ms>',
    desc: 'Pause between commands (milliseconds)',
    example: '/delay 1000;cast heal',
  },
  {
    token: '/echo <text>',
    desc: 'Print text locally (not sent to MUD)',
    example: '/echo [TRIGGER] Combat started',
  },
  {
    token: '/spam <N> <cmd>',
    desc: 'Repeat a command N times (max 1000)',
    example: '/spam 3 say hello',
  },
  {
    token: '/var <name> <val>',
    desc: 'Set a variable (track state from triggers)',
    example: '/var foe $1  →  $foe tracks attacker',
  },
  { token: '/convert <amt>', desc: 'Convert currency and display locally', example: '/convert $0' },
];

const TRIGGER_HELP_FOOTER = (
  <>
    <span className="text-text-label">Match modes:</span>{' '}
    <span className="font-mono" style={{ color: TRIGGER_ACCENT }}>
      Substring
    </span>{' '}
    = pattern appears anywhere in line (case-insensitive).{' '}
    <span className="font-mono" style={{ color: TRIGGER_ACCENT }}>
      Exact
    </span>{' '}
    = entire line must match exactly.{' '}
    <span className="font-mono" style={{ color: TRIGGER_ACCENT }}>
      Regex
    </span>{' '}
    = regular expression, capture groups become $1, $2.
  </>
);

function BodySyntaxHelp() {
  return (
    <SyntaxHelpTable
      rows={TRIGGER_HELP_ROWS}
      accentColor={TRIGGER_ACCENT}
      footer={TRIGGER_HELP_FOOTER}
    />
  );
}

// --- Trigger Editor ---

function TriggerEditor({
  trigger,
  prefill,
  scope: initialScope,
  activeCharacter,
  onSave,
  onCancel,
}: {
  trigger: Trigger | null; // null = creating new
  prefill?: TriggerPrefill | null;
  scope: TriggerScope;
  activeCharacter: string | null;
  onSave: (
    data: {
      pattern: string;
      matchMode: TriggerMatchMode;
      body: string;
      group: string;
      cooldownMs: number;
      gag: boolean;
      highlight: string | null;
      soundAlert: boolean;
    },
    scope: TriggerScope,
    existingId?: TriggerId
  ) => void;
  onCancel: () => void;
}) {
  const [pattern, setPattern] = useState(trigger?.pattern ?? prefill?.pattern ?? '');
  const [matchMode, setMatchMode] = useState<TriggerMatchMode>(
    trigger?.matchMode ?? prefill?.matchMode ?? 'substring'
  );
  const [body, setBody] = useState(trigger?.body ?? prefill?.body ?? '');
  const [group, setGroup] = useState(trigger?.group ?? prefill?.group ?? '');
  const [scope, setScope] = useState<TriggerScope>(initialScope);
  const [cooldownMs, setCooldownMs] = useState(trigger?.cooldownMs ?? 0);
  const [gag, setGag] = useState(trigger?.gag ?? prefill?.gag ?? false);
  const [highlight, setHighlight] = useState<string | null>(trigger?.highlight ?? null);
  const [soundAlert, setSoundAlert] = useState(trigger?.soundAlert ?? false);

  // Custom highlight color state
  const initCustom =
    trigger?.highlight && !PRESET_CODES.has(trigger.highlight)
      ? ansiToHex(trigger.highlight)
      : null;
  const [customMode, setCustomMode] = useState(initCustom !== null);
  const [customFg, setCustomFg] = useState<string>(initCustom?.fg ?? '#ffffff');
  const [customBg, setCustomBg] = useState<string>(initCustom?.bg ?? '#000000');
  const [customFgEnabled, setCustomFgEnabled] = useState(
    initCustom?.fg !== null && initCustom !== null
  );
  const [customBgEnabled, setCustomBgEnabled] = useState(
    initCustom?.bg !== null && initCustom !== null
  );
  const [testInput, setTestInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const patternRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    patternRef.current?.focus();
  }, []);

  // Live match + expansion preview
  const preview = useMemo(() => {
    if (!testInput.trim() || !pattern.trim()) return null;
    const tempTrigger: Trigger = {
      id: 'preview',
      pattern,
      matchMode,
      body,
      enabled: true,
      group: '',
      cooldownMs: 0,
      gag: false,
      highlight: null,
      soundAlert: false,
      createdAt: '',
      updatedAt: '',
    };
    try {
      const matches = matchTriggers(testInput, testInput, [tempTrigger]);
      if (matches.length === 0) return { matched: false, text: 'No match' };
      const commands = expandTriggerBody(body, matches[0], activeCharacter);
      const text = formatCommandPreview(commands).join('\n');
      return { matched: true, text: text || '(no commands)' };
    } catch {
      return { matched: false, text: '[error]' };
    }
  }, [testInput, pattern, matchMode, body, activeCharacter]);

  const canSave = pattern.trim().length > 0;

  const handleFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSave) {
      e.preventDefault();
      onSave(
        {
          pattern: pattern.trim(),
          matchMode,
          body,
          group: group.trim() || 'General',
          cooldownMs,
          gag,
          highlight,
          soundAlert,
        },
        scope,
        trigger?.id
      );
    }
  };

  return (
    <div className="border border-[#ff79c6]/30 rounded-lg mx-2 my-2 bg-bg-secondary overflow-hidden">
      {/* Editor header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-[11px] font-semibold text-text-heading">
          {trigger ? 'Edit Trigger' : 'New Trigger'}
        </span>
        <div className="flex gap-1">
          <MudButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </MudButton>
          <MudButton
            accent="pink"
            size="sm"
            onClick={() => {
              if (canSave)
                onSave(
                  {
                    pattern: pattern.trim(),
                    matchMode,
                    body,
                    group: group.trim() || 'General',
                    cooldownMs,
                    gag,
                    highlight,
                    soundAlert,
                  },
                  scope,
                  trigger?.id
                );
            }}
            disabled={!canSave}
          >
            Save
          </MudButton>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        {/* Pattern + Match mode */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-dim mb-0.5 block">Pattern</label>
            <MudInput
              ref={patternRef}
              accent="pink"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={handleFieldKeyDown}
              placeholder="e.g., You are hungry"
              className="w-full"
            />
          </div>
          <div className="w-[100px]">
            <label className="text-[10px] text-text-dim mb-0.5 block">Match</label>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as TriggerMatchMode)}
              className="w-full text-[11px] px-1.5 py-1 rounded border border-border-dim bg-bg-input text-text-primary focus:outline-none focus:border-[#ff79c6]/40 transition-colors duration-150 cursor-pointer"
            >
              {(['substring', 'exact', 'regex'] as const).map((m) => (
                <option key={m} value={m}>
                  {MATCH_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Body */}
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <label className="text-[10px] text-text-dim">Response body</label>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className="flex items-center gap-0.5 text-[9px] text-[#ff79c6]/70 hover:text-[#ff79c6] cursor-pointer transition-colors duration-150"
            >
              {showHelp ? 'hide help' : 'syntax help'}
              {showHelp ? <ChevronUpIcon size={7} /> : <ChevronDownIcon size={7} />}
            </button>
          </div>
          {showHelp && <BodySyntaxHelp />}
          <MudTextarea
            accent="pink"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="/echo [ALERT] $line"
            rows={5}
            className="w-full"
          />
        </div>

        {/* Group + Scope row */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-dim mb-0.5 block">Group</label>
            <MudInput
              accent="pink"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              onKeyDown={handleFieldKeyDown}
              placeholder="General"
              className="w-full"
            />
          </div>
          <div className="w-[110px]">
            <label className="text-[10px] text-text-dim mb-0.5 block">Scope</label>
            <div className="flex gap-0.5">
              <button
                onClick={() => setScope('global')}
                className={`flex-1 text-[10px] py-1 rounded-l border cursor-pointer transition-colors duration-150 ${
                  scope === 'global'
                    ? 'border-[#ff79c6]/40 text-[#ff79c6] bg-[#ff79c6]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Global
              </button>
              <button
                onClick={() => setScope('character')}
                className={`flex-1 text-[10px] py-1 rounded-r border cursor-pointer transition-colors duration-150 ${
                  scope === 'character'
                    ? 'border-[#ff79c6]/40 text-[#ff79c6] bg-[#ff79c6]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Char
              </button>
            </div>
          </div>
        </div>

        {/* Options row: cooldown, gag, highlight, sound */}
        <div className="flex gap-2 flex-wrap">
          <div className="w-[80px]">
            <label className="text-[10px] text-text-dim mb-0.5 block">Cooldown</label>
            <div className="flex items-center gap-1">
              <MudNumberInput
                accent="pink"
                min={0}
                step={100}
                value={cooldownMs}
                onChange={setCooldownMs}
                onKeyDown={handleFieldKeyDown}
                className="w-full"
              />
              <span className="text-[9px] text-text-dim shrink-0">ms</span>
            </div>
          </div>
          <div className="flex items-end gap-2 flex-1">
            <button
              onClick={() => setGag(!gag)}
              title={gag ? 'Gag ON — line will be suppressed' : 'Gag OFF — line shown normally'}
              className={`text-[9px] font-mono px-2 py-1 rounded border cursor-pointer transition-colors duration-150 ${
                gag
                  ? 'text-[#f59e0b] border-[#f59e0b]/40 bg-[#f59e0b]/10'
                  : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
              }`}
            >
              Gag
            </button>
            <button
              onClick={() => setSoundAlert(!soundAlert)}
              title={soundAlert ? 'Sound alert ON' : 'Sound alert OFF'}
              className={`text-[9px] font-mono px-2 py-1 rounded border cursor-pointer transition-colors duration-150 ${
                soundAlert
                  ? 'text-[#8be9fd] border-[#8be9fd]/40 bg-[#8be9fd]/10'
                  : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
              }`}
            >
              Sound
            </button>
          </div>
        </div>

        {/* Highlight color */}
        <div>
          <label className="text-[10px] text-text-dim mb-0.5 block">Highlight</label>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => {
                setHighlight(null);
                setCustomMode(false);
              }}
              className={`text-[9px] font-mono px-2 py-0.5 rounded border cursor-pointer transition-colors duration-150 ${
                highlight === null
                  ? 'text-text-label border-[#ff79c6]/40 bg-[#ff79c6]/10'
                  : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
              }`}
            >
              None
            </button>
            {HIGHLIGHT_PRESETS.map((preset) => (
              <button
                key={preset.code}
                onClick={() => {
                  setHighlight(preset.code);
                  setCustomMode(false);
                }}
                className={`text-[9px] font-mono px-2 py-0.5 rounded border cursor-pointer transition-colors duration-150 ${
                  !customMode && highlight === preset.code
                    ? 'border-[#ff79c6]/40 bg-[#ff79c6]/10'
                    : 'border-border-dim bg-transparent hover:text-text-label'
                }`}
                style={{ color: preset.hex }}
              >
                {preset.label}
              </button>
            ))}
            <button
              onClick={() => {
                setCustomMode(true);
                // Pre-fill from current preset if active
                if (highlight && PRESET_CODES.has(highlight)) {
                  const preset = HIGHLIGHT_PRESETS.find((p) => p.code === highlight);
                  if (preset) {
                    setCustomFg(preset.hex);
                    setCustomFgEnabled(true);
                  }
                }
                // Apply current custom state
                const code = hexToAnsi(
                  customFgEnabled ? customFg : null,
                  customBgEnabled ? customBg : null
                );
                setHighlight(code);
              }}
              className={`text-[9px] font-mono px-2 py-0.5 rounded border cursor-pointer transition-colors duration-150 ${
                customMode
                  ? 'text-[#ff79c6] border-[#ff79c6]/40 bg-[#ff79c6]/10'
                  : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
              }`}
            >
              Custom
            </button>
          </div>

          {/* Custom fg/bg color pickers */}
          {customMode && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex gap-3">
                {/* Foreground */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      const next = !customFgEnabled;
                      setCustomFgEnabled(next);
                      setHighlight(
                        hexToAnsi(next ? customFg : null, customBgEnabled ? customBg : null)
                      );
                    }}
                    className={`text-[8px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 ${
                      customFgEnabled
                        ? 'text-[#ff79c6] border-[#ff79c6]/40 bg-[#ff79c6]/10'
                        : 'text-text-dim border-border-dim'
                    }`}
                  >
                    FG
                  </button>
                  <input
                    type="color"
                    value={customFg}
                    onChange={(e) => {
                      setCustomFg(e.target.value);
                      if (customFgEnabled)
                        setHighlight(hexToAnsi(e.target.value, customBgEnabled ? customBg : null));
                    }}
                    className="w-5 h-5 rounded border border-border-dim cursor-pointer bg-transparent p-0"
                    style={{ opacity: customFgEnabled ? 1 : 0.3 }}
                  />
                  <span
                    className="text-[9px] font-mono text-text-dim"
                    style={{ opacity: customFgEnabled ? 1 : 0.4 }}
                  >
                    {customFg}
                  </span>
                </div>
                {/* Background */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      const next = !customBgEnabled;
                      setCustomBgEnabled(next);
                      setHighlight(
                        hexToAnsi(customFgEnabled ? customFg : null, next ? customBg : null)
                      );
                    }}
                    className={`text-[8px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 ${
                      customBgEnabled
                        ? 'text-[#ff79c6] border-[#ff79c6]/40 bg-[#ff79c6]/10'
                        : 'text-text-dim border-border-dim'
                    }`}
                  >
                    BG
                  </button>
                  <input
                    type="color"
                    value={customBg}
                    onChange={(e) => {
                      setCustomBg(e.target.value);
                      if (customBgEnabled)
                        setHighlight(hexToAnsi(customFgEnabled ? customFg : null, e.target.value));
                    }}
                    className="w-5 h-5 rounded border border-border-dim cursor-pointer bg-transparent p-0"
                    style={{ opacity: customBgEnabled ? 1 : 0.3 }}
                  />
                  <span
                    className="text-[9px] font-mono text-text-dim"
                    style={{ opacity: customBgEnabled ? 1 : 0.4 }}
                  >
                    {customBg}
                  </span>
                </div>
              </div>
              {/* Preview */}
              {(customFgEnabled || customBgEnabled) && (
                <div
                  className="px-2 py-1 rounded border border-border-dim text-[10px] font-mono"
                  style={{
                    color: customFgEnabled ? customFg : undefined,
                    backgroundColor: customBgEnabled ? customBg : undefined,
                  }}
                >
                  The quick brown fox jumps over the lazy dog
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="border-t border-[#444] pt-2">
          <label className="text-[10px] text-text-dim mb-0.5 block">Test line</label>
          <MudInput
            accent="pink"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder={
              pattern
                ? `e.g., ${pattern.includes('(') ? 'A sample MUD output line' : pattern}`
                : 'paste a MUD output line...'
            }
            className="w-full"
          />
          {preview && (
            <div className="mt-1 px-2 py-1 rounded bg-bg-primary border border-border-dim">
              <pre
                className={`text-[10px] font-mono whitespace-pre-wrap ${preview.matched ? 'text-green' : 'text-text-dim'}`}
              >
                {preview.text}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Panel ---

export function TriggerPanel({ onClose }: TriggerPanelProps) {
  const {
    characterTriggers,
    globalTriggers,
    createTrigger,
    updateTrigger,
    deleteTrigger,
    triggerPrefill,
    setTriggerPrefill,
  } = useTriggerContext();
  const { activeCharacter } = useSkillTrackerContext();
  const { gagGroups, updateGagGroups } = useAppSettingsContext();

  const [scope, setScope] = useState<TriggerScope>('global');
  const [gagsExpanded, setGagsExpanded] = useState(false);
  const [expandedGagGroup, setExpandedGagGroup] = useState<GagGroupId | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [editingId, setEditingId] = useState<TriggerId | null>(null);
  const [creating, setCreating] = useState(false);

  // Open editor when prefill arrives from context menu
  useEffect(() => {
    if (triggerPrefill) {
      setCreating(true);
      setEditingId(null);
    }
  }, [triggerPrefill]);

  const triggers = scope === 'character' ? characterTriggers : globalTriggers;
  const triggerList = useMemo(() => Object.values(triggers), [triggers]);

  const { groups, grouped: groupedTriggers } = useFilteredGroups(
    triggerList,
    groupFilter,
    searchText
  );

  const editingTrigger = editingId ? (triggers[editingId] ?? null) : null;

  const handleSave = useCallback(
    (
      data: {
        pattern: string;
        matchMode: TriggerMatchMode;
        body: string;
        group: string;
        cooldownMs: number;
        gag: boolean;
        highlight: string | null;
        soundAlert: boolean;
      },
      saveScope: TriggerScope,
      existingId?: TriggerId
    ) => {
      if (existingId) {
        // If scope changed, delete from old scope and create in new scope
        if (saveScope !== scope) {
          deleteTrigger(existingId, scope);
          createTrigger(data, saveScope);
        } else {
          updateTrigger(existingId, data, saveScope);
        }
      } else {
        createTrigger(data, saveScope);
      }
      setEditingId(null);
      setCreating(false);
    },
    [scope, createTrigger, updateTrigger, deleteTrigger]
  );

  const titleText = `Triggers${activeCharacter && scope === 'character' ? ` (${charDisplayName(activeCharacter)})` : scope === 'global' ? ' (Global)' : ''}`;

  return (
    <div className="w-[420px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      <PanelHeader icon={<TriggerIcon size={12} />} title={titleText} onClose={onClose}>
        <button
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          title="New trigger"
          className="flex items-center gap-1 rounded text-[10px] cursor-pointer px-1.5 py-[2px] border border-border-dim text-text-dim hover:text-[#ff79c6] hover:border-[#ff79c6]/40 transition-colors duration-150"
        >
          <PlusIcon size={9} />
          New Trigger
        </button>
      </PanelHeader>

      {/* Scope toggle */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-border-subtle shrink-0">
        <FilterPill
          label="Global"
          active={scope === 'global'}
          accent="pink"
          onClick={() => {
            setScope('global');
            setGroupFilter(null);
          }}
        />
        <FilterPill
          label="Character"
          active={scope === 'character'}
          accent="pink"
          onClick={() => {
            setScope('character');
            setGroupFilter(null);
          }}
        />
      </div>

      {/* Gag Groups — collapsible section */}
      <div className="border-b border-border-subtle shrink-0">
        <button
          onClick={() => setGagsExpanded((v) => !v)}
          className="flex items-center justify-between w-full px-3 py-1.5 cursor-pointer hover:bg-bg-hover/50 transition-colors duration-100"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-dim">
            Gag Groups
          </span>
          <span className="text-text-dim text-[9px]">
            {gagsExpanded ? <ChevronUpIcon size={9} /> : <ChevronDownIcon size={9} />}
          </span>
        </button>
        {gagsExpanded && (
          <div className="px-3 pb-2 space-y-1">
            {GAG_GROUPS.map((group) => {
              const enabled = gagGroups[group.id];
              const isExpanded = expandedGagGroup === group.id;
              return (
                <div key={group.id}>
                  <div className="flex items-center gap-2">
                    <ToggleSwitch
                      checked={enabled}
                      onChange={() =>
                        updateGagGroups({ ...gagGroups, [group.id]: !enabled })
                      }
                      accent="#ff79c6"
                    />
                    <button
                      onClick={() =>
                        updateGagGroups({ ...gagGroups, [group.id]: !enabled })
                      }
                      className="text-[11px] text-text-label font-medium w-[60px] shrink-0 text-left cursor-pointer hover:text-[#ff79c6] transition-colors duration-150"
                    >
                      {group.label}
                    </button>
                    <button
                      onClick={() =>
                        setExpandedGagGroup(isExpanded ? null : group.id)
                      }
                      className="text-[10px] text-text-dim truncate flex-1 text-left cursor-pointer hover:text-text-label transition-colors duration-150 flex items-center gap-1"
                    >
                      <span className="truncate">{group.description}</span>
                      <span className="text-[9px] font-mono text-text-dim shrink-0">
                        ({group.patterns.length})
                      </span>
                      <span className="shrink-0 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        <ChevronDownIcon size={7} />
                      </span>
                    </button>
                  </div>
                  <div
                    className="grid transition-[grid-template-rows] duration-200 ease-in-out"
                    style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden">
                      <div className="mt-1 mb-1.5 max-h-[160px] overflow-y-auto rounded border border-border-dim bg-bg-input px-2 py-1.5">
                        {group.patterns.map((re, i) => (
                          <div
                            key={i}
                            className="text-[10px] font-mono text-text-dim leading-relaxed truncate"
                            title={re.source}
                          >
                            {re.source}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Group filter pills */}
      {groups.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle flex-wrap shrink-0">
          <FilterPill
            label="All"
            active={groupFilter === null}
            accent="pink"
            onClick={() => setGroupFilter(null)}
          />
          {groups.map((g) => (
            <FilterPill
              key={g}
              label={g}
              active={groupFilter === g}
              accent="pink"
              onClick={() => setGroupFilter(groupFilter === g ? null : g)}
            />
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border-subtle shrink-0">
        <div className="relative">
          <MudInput
            accent="pink"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter triggers..."
            className="w-full"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-label text-[11px] cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Editor (inline) */}
      {(creating || editingTrigger) && (
        <TriggerEditor
          key={triggerPrefill ? `prefill-${triggerPrefill.pattern}` : (editingId ?? 'new')}
          trigger={editingTrigger}
          prefill={creating ? triggerPrefill : null}
          scope={scope}
          activeCharacter={activeCharacter}
          onSave={(...args) => {
            handleSave(...args);
            setTriggerPrefill(null);
          }}
          onCancel={() => {
            setCreating(false);
            setEditingId(null);
            setTriggerPrefill(null);
          }}
        />
      )}

      {/* Trigger list */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {triggerList.length === 0 && !creating && (
          <div className="px-2 text-xs text-text-dim">
            {scope === 'character' && !activeCharacter
              ? 'Log in to manage character triggers.'
              : 'No triggers yet. Click + to create one.'}
          </div>
        )}

        {groupedTriggers.map(([groupName, groupTriggers]) => (
          <div key={groupName} className="mb-3">
            {groupFilter === null && groups.length > 1 && (
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1 px-2">
                {groupName}
              </div>
            )}
            {groupTriggers.map((trigger) => (
              <TriggerRow
                key={trigger.id}
                trigger={trigger}
                scope={scope}
                onEdit={(id) => {
                  setEditingId(editingId === id ? null : id);
                  setCreating(false);
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
