import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useAliasContext } from '../contexts/AliasContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import { expandInput } from '../lib/aliasEngine';
import { formatCommandPreview } from '../lib/commandUtils';
import { useFilteredGroups } from '../lib/useFilteredGroups';
import { charDisplayName } from '../lib/panelUtils';
import type { Alias, AliasId, AliasMatchMode, AliasScope } from '../types/alias';
import { TrashIcon, PlusIcon, ChevronDownIcon, ChevronUpIcon, AliasIcon } from './icons';
import { FilterPill } from './FilterPill';
import { MudInput, MudTextarea, MudButton } from './shared';
import { SyntaxHelpTable } from './SyntaxHelpTable';
import type { HelpRow } from './SyntaxHelpTable';

interface AliasPanelProps {
  onClose: () => void;
}

const MATCH_MODE_LABELS: Record<AliasMatchMode, string> = {
  exact: 'Exact',
  prefix: 'Prefix',
  regex: 'Regex',
};

// --- Alias Row ---

function AliasRow({
  alias,
  scope,
  onEdit,
}: {
  alias: Alias;
  scope: AliasScope;
  onEdit: (id: AliasId) => void;
}) {
  const { toggleAlias, deleteAlias } = useAliasContext();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-bg-secondary rounded transition-[background] duration-150 cursor-pointer"
      onClick={() => onEdit(alias.id)}
    >
      {confirmingDelete ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteAlias(alias.id, scope);
            setConfirmingDelete(false);
          }}
          onBlur={() => setConfirmingDelete(false)}
          className="text-[8px] font-mono text-red border border-red/40 rounded px-1 py-px cursor-pointer hover:bg-red/10 shrink-0 transition-colors duration-150"
        >
          Del?
        </button>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmingDelete(true);
          }}
          title="Delete alias"
          className="w-0 overflow-hidden opacity-0 group-hover:w-4 group-hover:opacity-100 shrink-0 flex items-center justify-center text-text-dim hover:text-red cursor-pointer transition-all duration-150"
        >
          <TrashIcon size={9} />
        </button>
      )}
      <span
        className={`text-[11px] font-mono flex-1 truncate ${
          alias.matchMode === 'exact'
            ? 'text-[#a78bfa]'
            : alias.matchMode === 'prefix'
              ? 'text-[#f59e0b]'
              : 'text-[#22d3ee]'
        }`}
        title={`${alias.pattern}\n${alias.matchMode} match`}
      >
        {alias.pattern}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleAlias(alias.id, scope);
        }}
        title={alias.enabled ? 'Disable alias' : 'Enable alias'}
        className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 shrink-0 ${
          alias.enabled
            ? 'text-green border-green/40 bg-green/10'
            : 'text-text-dim border-border-dim bg-transparent'
        }`}
      >
        {alias.enabled ? 'on' : 'off'}
      </button>
    </div>
  );
}

// --- Syntax Help ---

const ALIAS_ACCENT = '#a78bfa';

const ALIAS_HELP_ROWS: HelpRow[] = [
  { token: '$1 $2 .. $9', desc: 'Positional arguments (space-separated)', example: 'aa goblin  \u2192  $1 = goblin' },
  { token: '$*', desc: 'All arguments after the trigger' },
  { token: '$-', desc: 'All arguments except the last' },
  { token: '$!', desc: 'The last argument only' },
  { token: '$opposite1..9', desc: 'Opposite direction of $N arg', example: 'door n  \u2192  $opposite1 = s' },
  { token: '$me', desc: 'Your active character name (lowercase)' },
  { token: '$Me', desc: 'Your active character name (Capitalized)' },
  { token: '$varName', desc: 'User-defined variable (set via /var)', example: '/var target goblin  \u2192  $target = goblin' },
  { token: ';', desc: 'Command separator \u2014 sends multiple commands', example: 'kill $1;loot corpse' },
  { token: '\\;', desc: 'Literal semicolon (not a separator)' },
  { token: '/delay <ms>', desc: 'Pause between commands (milliseconds)', example: 'cast shield;/delay 1500;cast armor' },
  { token: '/echo <text>', desc: 'Print text locally (not sent to MUD)', example: '/echo --- Starting combo ---' },
  { token: '/spam <N> <cmd>', desc: 'Repeat a command N times (max 1000)', example: '/spam 5 cast heal' },
  { token: '/var <name> <val>', desc: 'Set a variable', example: '/var foe $1  →  $foe = goblin' },
  { token: '/convert <amt>', desc: 'Convert currency and display locally', example: '/convert 3ri 5dn' },
];

const ALIAS_HELP_FOOTER = (
  <>
    <span className="text-text-label">Match modes:</span>{' '}
    <span className="font-mono" style={{ color: ALIAS_ACCENT }}>Exact</span> = trigger only, no arguments.{' '}
    <span className="font-mono" style={{ color: ALIAS_ACCENT }}>Prefix</span> = trigger + arguments ($1, $2, etc.).{' '}
    <span className="font-mono" style={{ color: ALIAS_ACCENT }}>Regex</span> = pattern match, capture groups become $1, $2.
  </>
);

function BodySyntaxHelp() {
  return <SyntaxHelpTable rows={ALIAS_HELP_ROWS} accentColor={ALIAS_ACCENT} footer={ALIAS_HELP_FOOTER} />;
}

// --- Alias Editor ---

function AliasEditor({
  alias,
  scope: initialScope,
  activeCharacter,
  onSave,
  onCancel,
}: {
  alias: Alias | null; // null = creating new
  scope: AliasScope;
  activeCharacter: string | null;
  onSave: (
    data: { pattern: string; matchMode: AliasMatchMode; body: string; group: string },
    scope: AliasScope,
    existingId?: AliasId,
  ) => void;
  onCancel: () => void;
}) {
  const [pattern, setPattern] = useState(alias?.pattern ?? '');
  const [matchMode, setMatchMode] = useState<AliasMatchMode>(alias?.matchMode ?? 'prefix');
  const [body, setBody] = useState(alias?.body ?? '');
  const [group, setGroup] = useState(alias?.group ?? '');
  const [scope, setScope] = useState<AliasScope>(initialScope);
  const [testInput, setTestInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const patternRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    patternRef.current?.focus();
  }, []);

  // Live expansion preview
  const preview = useMemo(() => {
    if (!testInput.trim()) return null;
    // Build a temp alias for preview
    const tempAlias: Alias = {
      id: 'preview',
      pattern,
      matchMode,
      body,
      enabled: true,
      group: '',
      createdAt: '',
      updatedAt: '',
    };
    try {
      const opts = { activeCharacter };
      const result = expandInput(testInput, [tempAlias], opts);
      const expand = (input: string) => expandInput(input, [tempAlias], opts).commands;
      return formatCommandPreview(result.commands, expand).join('\n');
    } catch {
      return '[expansion error]';
    }
  }, [testInput, pattern, matchMode, body, activeCharacter]);

  const canSave = pattern.trim().length > 0 && body.trim().length > 0;

  const handleFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSave) {
      e.preventDefault();
      onSave({ pattern: pattern.trim(), matchMode, body, group: group.trim() || 'General' }, scope, alias?.id);
    }
  };

  return (
    <div className="border border-[#a78bfa]/30 rounded-lg mx-2 my-2 bg-bg-secondary overflow-hidden">
      {/* Editor header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-[11px] font-semibold text-text-heading">
          {alias ? 'Edit Alias' : 'New Alias'}
        </span>
        <div className="flex gap-1">
          <MudButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </MudButton>
          <MudButton
            accent="purple"
            size="sm"
            onClick={() => {
              if (canSave) onSave({ pattern: pattern.trim(), matchMode, body, group: group.trim() || 'General' }, scope, alias?.id);
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
              accent="purple"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={handleFieldKeyDown}
              placeholder="e.g., aa"
              className="w-full"
            />
          </div>
          <div className="w-[90px]">
            <label className="text-[10px] text-text-dim mb-0.5 block">Match</label>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as AliasMatchMode)}
              className="w-full text-[11px] px-1.5 py-1 rounded border border-border-dim bg-bg-input text-text-primary focus:outline-none focus:border-[#a78bfa]/40 transition-colors duration-150 cursor-pointer"
            >
              {(['exact', 'prefix', 'regex'] as const).map((m) => (
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
            <label className="text-[10px] text-text-dim">Body</label>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className="flex items-center gap-0.5 text-[9px] text-[#a78bfa]/70 hover:text-[#a78bfa] cursor-pointer transition-colors duration-150"
            >
              {showHelp ? 'hide help' : 'syntax help'}
              {showHelp ? <ChevronUpIcon size={7} /> : <ChevronDownIcon size={7} />}
            </button>
          </div>
          {showHelp && <BodySyntaxHelp />}
          <MudTextarea
            accent="purple"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="attack $1;kill $1"
            rows={3}
            className="w-full"
          />
        </div>

        {/* Group + Scope row */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-dim mb-0.5 block">Group</label>
            <MudInput
              accent="purple"
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
                    ? 'border-[#a78bfa]/40 text-[#a78bfa] bg-[#a78bfa]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Global
              </button>
              <button
                onClick={() => setScope('character')}
                className={`flex-1 text-[10px] py-1 rounded-r border cursor-pointer transition-colors duration-150 ${
                  scope === 'character'
                    ? 'border-[#a78bfa]/40 text-[#a78bfa] bg-[#a78bfa]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Char
              </button>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="border-t border-[#444] pt-2">

          <label className="text-[10px] text-text-dim mb-0.5 block">Test expansion</label>
          <MudInput
            accent="purple"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder={pattern ? (matchMode === 'exact' ? pattern : `${pattern} goblin`) : 'type a test command...'}
            className="w-full"
          />
          {preview && (
            <div className="mt-1 px-2 py-1 rounded bg-bg-primary border border-border-dim">
              <pre className="text-[10px] font-mono text-green whitespace-pre-wrap">{preview}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Panel ---

export function AliasPanel({ onClose }: AliasPanelProps) {
  const {
    characterAliases,
    globalAliases,
    enableSpeedwalk,
    setEnableSpeedwalk,
    createAlias,
    updateAlias,
    deleteAlias,
  } = useAliasContext();
  const { activeCharacter } = useSkillTrackerContext();

  const [scope, setScope] = useState<AliasScope>('global');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [editingId, setEditingId] = useState<AliasId | null>(null);
  const [creating, setCreating] = useState(false);

  const aliases = scope === 'character' ? characterAliases : globalAliases;
  const aliasList = useMemo(() => Object.values(aliases), [aliases]);

  const { groups, grouped: groupedAliases } =
    useFilteredGroups(aliasList, groupFilter, searchText);

  const editingAlias = editingId ? aliases[editingId] ?? null : null;

  const handleSave = useCallback(
    (
      data: { pattern: string; matchMode: AliasMatchMode; body: string; group: string },
      saveScope: AliasScope,
      existingId?: AliasId,
    ) => {
      if (existingId) {
        // If scope changed, delete from old scope and create in new scope
        if (saveScope !== scope) {
          deleteAlias(existingId, scope);
          createAlias(data, saveScope);
        } else {
          updateAlias(existingId, data, saveScope);
        }
      } else {
        createAlias(data, saveScope);
      }
      setEditingId(null);
      setCreating(false);
    },
    [scope, createAlias, updateAlias, deleteAlias],
  );

  const titleText = `Aliases${activeCharacter && scope === 'character' ? ` (${charDisplayName(activeCharacter)})` : scope === 'global' ? ' (Global)' : ''}`;

  return (
    <div className="w-[400px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5"><AliasIcon size={12} /> {titleText}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            title="New alias"
            className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-[#a78bfa] transition-colors duration-150"
          >
            <PlusIcon size={11} />
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150 text-[13px]"
          >
            ×
          </button>
        </div>
      </div>

      {/* Scope toggle + speedwalk */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-border-subtle shrink-0">
        <FilterPill
          label="Global"
          active={scope === 'global'}
          accent="purple"
          onClick={() => { setScope('global'); setGroupFilter(null); }}
        />
        <FilterPill
          label="Character"
          active={scope === 'character'}
          accent="purple"
          onClick={() => { setScope('character'); setGroupFilter(null); }}
        />
        <div className="flex-1" />
        <button
          onClick={() => setEnableSpeedwalk(!enableSpeedwalk)}
          title={enableSpeedwalk ? 'Speedwalk ON (e.g., 3n2e)' : 'Speedwalk OFF'}
          className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 ${
            enableSpeedwalk
              ? 'text-green border-green/40 bg-green/10'
              : 'text-text-dim border-border-dim bg-transparent'
          }`}
        >
          SW
        </button>
      </div>

      {/* Group filter pills */}
      {groups.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle flex-wrap shrink-0">
          <FilterPill
            label="All"
            active={groupFilter === null}
            accent="purple"
            onClick={() => setGroupFilter(null)}
          />
          {groups.map((g) => (
            <FilterPill
              key={g}
              label={g}
              active={groupFilter === g}
              accent="purple"
              onClick={() => setGroupFilter(groupFilter === g ? null : g)}
            />
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border-subtle shrink-0">
        <div className="relative">
          <MudInput
            accent="purple"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter aliases..."
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
      {(creating || editingAlias) && (
        <AliasEditor
          alias={editingAlias}
          scope={scope}
          activeCharacter={activeCharacter}
          onSave={handleSave}
          onCancel={() => {
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}

      {/* Alias list */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {aliasList.length === 0 && !creating && (
          <div className="px-2 text-xs text-text-dim">
            {scope === 'character' && !activeCharacter
              ? 'Log in to manage character aliases.'
              : 'No aliases yet. Click + to create one.'}
          </div>
        )}

        {groupedAliases.map(([groupName, groupAliases]) => (
          <div key={groupName} className="mb-3">
            {(groupFilter === null && groups.length > 1) && (
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1 px-2">
                {groupName}
              </div>
            )}
            {groupAliases.map((alias) => (
              <AliasRow
                key={alias.id}
                alias={alias}
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
