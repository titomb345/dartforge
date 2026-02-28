import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useTimerContext } from '../contexts/TimerContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import { expandInput } from '../lib/aliasEngine';
import { formatCommandPreview } from '../lib/commandUtils';
import { useFilteredGroups } from '../lib/useFilteredGroups';
import { charDisplayName } from '../lib/panelUtils';
import type { Timer, TimerId, TimerScope } from '../types/timer';
import { PlusIcon, ChevronDownIcon, ChevronUpIcon, TimerIcon } from './icons';
import { PanelHeader } from './PanelHeader';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { FilterPill } from './FilterPill';
import { MudInput, MudTextarea, MudButton, MudNumberInput } from './shared';
import { SyntaxHelpTable } from './SyntaxHelpTable';
import type { HelpRow } from './SyntaxHelpTable';

interface TimerPanelProps {
  onClose: () => void;
}

const ACCENT = '#f97316';

/** Format seconds into a human-readable interval label. */
function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

// --- Timer Row ---

function TimerRow({
  timer,
  scope,
  onEdit,
}: {
  timer: Timer;
  scope: TimerScope;
  onEdit: (id: TimerId) => void;
}) {
  const { toggleTimer, deleteTimer } = useTimerContext();

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-bg-secondary rounded transition-[background] duration-150 cursor-pointer"
      onClick={() => onEdit(timer.id)}
    >
      <ConfirmDeleteButton onDelete={() => deleteTimer(timer.id, scope)} />
      <span
        className="text-[11px] font-mono flex-1 truncate text-[#f97316]"
        title={`${timer.name}\nEvery ${formatInterval(timer.intervalSeconds)}`}
      >
        {timer.name}
      </span>
      <span
        title={`Fires every ${formatInterval(timer.intervalSeconds)}`}
        className="text-[8px] font-mono px-1 py-px rounded border border-[#f97316]/40 text-[#f97316] bg-[#f97316]/10 shrink-0"
      >
        {formatInterval(timer.intervalSeconds)}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTimer(timer.id, scope);
        }}
        title={timer.enabled ? 'Disable timer' : 'Enable timer'}
        className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 shrink-0 ${
          timer.enabled
            ? 'text-green border-green/40 bg-green/10'
            : 'text-text-dim border-border-dim bg-transparent'
        }`}
      >
        {timer.enabled ? 'on' : 'off'}
      </button>
    </div>
  );
}

// --- Syntax Help ---

const TIMER_HELP_ROWS: HelpRow[] = [
  { token: '$me', desc: 'Your active character name (lowercase)' },
  { token: '$Me', desc: 'Your active character name (Capitalized)' },
  {
    token: '$varName',
    desc: 'User-defined variable (set via /var)',
    example: '/var target goblin  \u2192  $target = goblin',
  },
  { token: ';', desc: 'Command separator \u2014 sends multiple commands', example: 'hp;score' },
  { token: '\\;', desc: 'Literal semicolon (not a separator)' },
  {
    token: '/delay <ms>',
    desc: 'Pause between commands (milliseconds)',
    example: '/delay 1000;cast heal',
  },
  {
    token: '/echo <text>',
    desc: 'Print text locally (not sent to MUD)',
    example: '/echo [TIMER] Healing...',
  },
  {
    token: '/spam <N> <cmd>',
    desc: 'Repeat a command N times (max 1000)',
    example: '/spam 3 get coin',
  },
  { token: '/var <name> <val>', desc: 'Set a variable (track state)', example: '/var count 5' },
  {
    token: '/convert <amt>',
    desc: 'Convert currency and display locally',
    example: '/convert 500',
  },
];

const TIMER_HELP_FOOTER = (
  <>
    <span className="text-text-label">Timers</span> fire their body at a fixed interval while
    connected and logged in. The body supports the same command syntax as aliases and triggers.
  </>
);

function BodySyntaxHelp() {
  return <SyntaxHelpTable rows={TIMER_HELP_ROWS} accentColor={ACCENT} footer={TIMER_HELP_FOOTER} />;
}

// --- Timer Editor ---

function TimerEditor({
  timer,
  scope: initialScope,
  activeCharacter,
  onSave,
  onCancel,
}: {
  timer: Timer | null; // null = creating new
  scope: TimerScope;
  activeCharacter: string | null;
  onSave: (
    data: {
      name: string;
      body: string;
      intervalSeconds: number;
      group: string;
    },
    scope: TimerScope,
    existingId?: TimerId
  ) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(timer?.name ?? '');
  const [body, setBody] = useState(timer?.body ?? '');
  const [group, setGroup] = useState(timer?.group ?? '');
  const [scope, setScope] = useState<TimerScope>(initialScope);
  const [intervalValue, setIntervalValue] = useState(() => {
    if (!timer) return 30;
    return timer.intervalSeconds >= 60 && timer.intervalSeconds % 60 === 0
      ? timer.intervalSeconds / 60
      : timer.intervalSeconds;
  });
  const [intervalUnit, setIntervalUnit] = useState<'seconds' | 'minutes'>(() => {
    if (!timer) return 'seconds';
    return timer.intervalSeconds >= 60 && timer.intervalSeconds % 60 === 0 ? 'minutes' : 'seconds';
  });
  const [showHelp, setShowHelp] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const intervalSeconds = intervalUnit === 'minutes' ? intervalValue * 60 : intervalValue;

  // Command preview
  const preview = useMemo(() => {
    if (!body.trim()) return null;
    try {
      const result = expandInput(body, [], { activeCharacter });
      const expand = (input: string) => expandInput(input, [], { activeCharacter }).commands;
      const text = formatCommandPreview(result.commands, expand).join('\n');
      return text || '(no commands)';
    } catch {
      return '[expansion error]';
    }
  }, [body, activeCharacter]);

  const canSave = name.trim().length > 0 && intervalSeconds > 0;

  const handleFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSave) {
      e.preventDefault();
      onSave(
        { name: name.trim(), body, intervalSeconds, group: group.trim() || 'General' },
        scope,
        timer?.id
      );
    }
  };

  return (
    <div className="border border-[#f97316]/30 rounded-lg mx-2 my-2 bg-bg-secondary overflow-hidden">
      {/* Editor header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-[11px] font-semibold text-text-heading">
          {timer ? 'Edit Timer' : 'New Timer'}
        </span>
        <div className="flex gap-1">
          <MudButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </MudButton>
          <MudButton
            accent="orange"
            size="sm"
            onClick={() => {
              if (canSave)
                onSave(
                  { name: name.trim(), body, intervalSeconds, group: group.trim() || 'General' },
                  scope,
                  timer?.id
                );
            }}
            disabled={!canSave}
          >
            Save
          </MudButton>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        {/* Name + Interval */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-dim mb-0.5 block">Name</label>
            <MudInput
              ref={nameRef}
              accent="orange"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleFieldKeyDown}
              placeholder="e.g., Auto-heal"
              className="w-full"
            />
          </div>
          <div className="w-[140px]">
            <label className="text-[10px] text-text-dim mb-0.5 block">Interval</label>
            <div className="flex gap-1">
              <MudNumberInput
                accent="orange"
                min={1}
                value={intervalValue}
                onChange={setIntervalValue}
                onKeyDown={handleFieldKeyDown}
                className="w-[60px]"
              />
              <select
                value={intervalUnit}
                onChange={(e) => setIntervalUnit(e.target.value as 'seconds' | 'minutes')}
                className="flex-1 text-[11px] px-1.5 py-1 rounded border border-border-dim bg-bg-input text-text-primary focus:outline-none focus:border-[#f97316]/40 transition-colors duration-150 cursor-pointer"
              >
                <option value="seconds">sec</option>
                <option value="minutes">min</option>
              </select>
            </div>
          </div>
        </div>

        {/* Body */}
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <label className="text-[10px] text-text-dim">Command body</label>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className="flex items-center gap-0.5 text-[9px] text-[#f97316]/70 hover:text-[#f97316] cursor-pointer transition-colors duration-150"
            >
              {showHelp ? 'hide help' : 'syntax help'}
              {showHelp ? <ChevronUpIcon size={7} /> : <ChevronDownIcon size={7} />}
            </button>
          </div>
          {showHelp && <BodySyntaxHelp />}
          <MudTextarea
            accent="orange"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="cast heal $me"
            rows={3}
            className="w-full"
          />
        </div>

        {/* Group + Scope row */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-dim mb-0.5 block">Group</label>
            <MudInput
              accent="orange"
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
                    ? 'border-[#f97316]/40 text-[#f97316] bg-[#f97316]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Global
              </button>
              <button
                onClick={() => setScope('character')}
                className={`flex-1 text-[10px] py-1 rounded-r border cursor-pointer transition-colors duration-150 ${
                  scope === 'character'
                    ? 'border-[#f97316]/40 text-[#f97316] bg-[#f97316]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Char
              </button>
            </div>
          </div>
        </div>

        {/* Command preview */}
        {preview && (
          <div className="border-t border-[#444] pt-2">
            <label className="text-[10px] text-text-dim mb-0.5 block">Command preview</label>
            <div className="px-2 py-1 rounded bg-bg-primary border border-border-dim">
              <pre className="text-[10px] font-mono whitespace-pre-wrap text-green">{preview}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Panel ---

export function TimerPanel({ onClose }: TimerPanelProps) {
  const { characterTimers, globalTimers, createTimer, updateTimer, deleteTimer } =
    useTimerContext();
  const { activeCharacter } = useSkillTrackerContext();

  const [scope, setScope] = useState<TimerScope>('global');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [editingId, setEditingId] = useState<TimerId | null>(null);
  const [creating, setCreating] = useState(false);

  const timers = scope === 'character' ? characterTimers : globalTimers;
  const timerList = useMemo(() => Object.values(timers), [timers]);

  // Adapt for useFilteredGroups which expects { pattern, body, group }
  const adapted = useMemo(() => timerList.map((t) => ({ ...t, pattern: t.name })), [timerList]);
  const { groups, grouped: groupedTimers } = useFilteredGroups(adapted, groupFilter, searchText);

  const editingTimer = editingId ? (timers[editingId] ?? null) : null;

  const handleSave = useCallback(
    (
      data: {
        name: string;
        body: string;
        intervalSeconds: number;
        group: string;
      },
      saveScope: TimerScope,
      existingId?: TimerId
    ) => {
      if (existingId) {
        if (saveScope !== scope) {
          deleteTimer(existingId, scope);
          createTimer(data, saveScope);
        } else {
          updateTimer(existingId, data, saveScope);
        }
      } else {
        createTimer(data, saveScope);
      }
      setEditingId(null);
      setCreating(false);
    },
    [scope, createTimer, updateTimer, deleteTimer]
  );

  const titleText = `Timers${activeCharacter && scope === 'character' ? ` (${charDisplayName(activeCharacter)})` : scope === 'global' ? ' (Global)' : ''}`;

  return (
    <div className="w-[420px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      <PanelHeader icon={<TimerIcon size={12} />} title={titleText} onClose={onClose}>
        <button
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          title="New timer"
          className="flex items-center gap-1 rounded text-[10px] cursor-pointer px-1.5 py-[2px] border border-border-dim text-text-dim hover:text-[#f97316] hover:border-[#f97316]/40 transition-colors duration-150"
        >
          <PlusIcon size={9} />
          New Timer
        </button>
      </PanelHeader>

      {/* Scope toggle */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-border-subtle shrink-0">
        <FilterPill
          label="Global"
          active={scope === 'global'}
          accent="orange"
          onClick={() => {
            setScope('global');
            setGroupFilter(null);
          }}
        />
        <FilterPill
          label="Character"
          active={scope === 'character'}
          accent="orange"
          onClick={() => {
            setScope('character');
            setGroupFilter(null);
          }}
        />
      </div>

      {/* Group filter pills */}
      {groups.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle flex-wrap shrink-0">
          <FilterPill
            label="All"
            active={groupFilter === null}
            accent="orange"
            onClick={() => setGroupFilter(null)}
          />
          {groups.map((g) => (
            <FilterPill
              key={g}
              label={g}
              active={groupFilter === g}
              accent="orange"
              onClick={() => setGroupFilter(groupFilter === g ? null : g)}
            />
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border-subtle shrink-0">
        <div className="relative">
          <MudInput
            accent="orange"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter timers..."
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
      {(creating || editingTimer) && (
        <TimerEditor
          key={editingId ?? 'new'}
          timer={editingTimer}
          scope={scope}
          activeCharacter={activeCharacter}
          onSave={handleSave}
          onCancel={() => {
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}

      {/* Timer list */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {timerList.length === 0 && !creating && (
          <div className="px-2 text-xs text-text-dim">
            {scope === 'character' && !activeCharacter
              ? 'Log in to manage character timers.'
              : 'No timers yet. Click + to create one.'}
          </div>
        )}

        {groupedTimers.map(([groupName, groupTimers]) => (
          <div key={groupName} className="mb-3">
            {groupFilter === null && groups.length > 1 && (
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1 px-2">
                {groupName}
              </div>
            )}
            {groupTimers.map((timer) => (
              <TimerRow
                key={timer.id}
                timer={timer}
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
