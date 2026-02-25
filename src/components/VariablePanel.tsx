import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useVariableContext } from '../contexts/VariableContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import { charDisplayName } from '../lib/panelUtils';
import type { Variable, VariableId, VariableScope } from '../types/variable';
import { TrashIcon, PlusIcon, VariableIcon } from './icons';
import { FilterPill } from './FilterPill';
import { MudInput, MudButton } from './shared';

interface VariablePanelProps {
  onClose: () => void;
}

const VAR_ACCENT = '#4ade80';

// --- Variable Row ---

function VariableRow({
  variable,
  scope,
  onEdit,
}: {
  variable: Variable;
  scope: VariableScope;
  onEdit: (id: VariableId) => void;
}) {
  const { toggleVariable, deleteVariable } = useVariableContext();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-bg-secondary rounded transition-[background] duration-150 cursor-pointer"
      onClick={() => onEdit(variable.id)}
    >
      {confirmingDelete ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteVariable(variable.id, scope);
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
          title="Delete variable"
          className="w-0 overflow-hidden opacity-0 group-hover:w-4 group-hover:opacity-100 shrink-0 flex items-center justify-center text-text-dim hover:text-red cursor-pointer transition-all duration-150"
        >
          <TrashIcon size={9} />
        </button>
      )}
      <span
        className="text-[11px] font-mono shrink-0 truncate"
        style={{ color: VAR_ACCENT }}
        title={`$${variable.name}`}
      >
        ${variable.name}
      </span>
      <span className="text-[11px] font-mono text-text-dim shrink-0">=</span>
      <span className="text-[11px] text-text-dim flex-1 truncate font-mono" title={variable.value}>
        {variable.value}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleVariable(variable.id, scope);
        }}
        title={variable.enabled ? 'Disable variable' : 'Enable variable'}
        className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 shrink-0 ${
          variable.enabled
            ? 'text-green border-green/40 bg-green/10'
            : 'text-text-dim border-border-dim bg-transparent'
        }`}
      >
        {variable.enabled ? 'on' : 'off'}
      </button>
    </div>
  );
}

// --- Variable Editor ---

function VariableEditor({
  variable,
  scope: initialScope,
  onSave,
  onCancel,
}: {
  variable: Variable | null; // null = creating new
  scope: VariableScope;
  onSave: (
    data: { name: string; value: string },
    scope: VariableScope,
    existingId?: VariableId
  ) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(variable?.name ?? '');
  const [value, setValue] = useState(variable?.value ?? '');
  const [scope, setScope] = useState<VariableScope>(initialScope);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const canSave = name.trim().length > 0 && value.trim().length > 0;

  return (
    <div className="border border-[#4ade80]/30 rounded-lg mx-2 my-2 bg-bg-secondary overflow-hidden">
      {/* Editor header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-[11px] font-semibold text-text-heading">
          {variable ? 'Edit Variable' : 'New Variable'}
        </span>
        <div className="flex gap-1">
          <MudButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </MudButton>
          <MudButton
            accent="green"
            size="sm"
            onClick={() => {
              if (canSave) onSave({ name: name.trim(), value: value.trim() }, scope, variable?.id);
            }}
            disabled={!canSave}
          >
            Save
          </MudButton>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        {/* Name + Scope */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-dim mb-0.5 block">Name</label>
            <div className="relative">
              <span
                className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[11px] font-mono"
                style={{ color: VAR_ACCENT, opacity: 0.6 }}
              >
                $
              </span>
              <MudInput
                ref={nameRef}
                accent="green"
                value={name}
                onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                placeholder="weapon"
                className="w-full pl-5"
              />
            </div>
          </div>
          <div className="w-[110px]">
            <label className="text-[10px] text-text-dim mb-0.5 block">Scope</label>
            <div className="flex gap-0.5">
              <button
                onClick={() => setScope('character')}
                className={`flex-1 text-[10px] py-1 rounded-l border cursor-pointer transition-colors duration-150 ${
                  scope === 'character'
                    ? 'border-[#4ade80]/40 text-[#4ade80] bg-[#4ade80]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Char
              </button>
              <button
                onClick={() => setScope('global')}
                className={`flex-1 text-[10px] py-1 rounded-r border cursor-pointer transition-colors duration-150 ${
                  scope === 'global'
                    ? 'border-[#4ade80]/40 text-[#4ade80] bg-[#4ade80]/10'
                    : 'border-border-dim text-text-dim hover:text-text-label'
                }`}
              >
                Global
              </button>
            </div>
          </div>
        </div>

        {/* Value */}
        <div>
          <label className="text-[10px] text-text-dim mb-0.5 block">Value</label>
          <MudInput
            accent="green"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="longsword"
            className="w-full"
          />
        </div>

        {/* Usage hint */}
        <div className="text-[9px] text-text-dim border-t border-[#444] pt-2">
          Use{' '}
          <span className="font-mono" style={{ color: VAR_ACCENT }}>
            ${name || 'name'}
          </span>{' '}
          in commands, aliases, or triggers. Set via terminal:{' '}
          <span className="font-mono" style={{ color: VAR_ACCENT }}>
            /var {name || 'name'} {value || 'value'}
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Main Panel ---

export function VariablePanel({ onClose }: VariablePanelProps) {
  const { characterVariables, globalVariables, createVariable, updateVariable, deleteVariable } =
    useVariableContext();
  const { activeCharacter } = useSkillTrackerContext();

  const [scope, setScope] = useState<VariableScope>('character');
  const [searchText, setSearchText] = useState('');
  const [editingId, setEditingId] = useState<VariableId | null>(null);
  const [creating, setCreating] = useState(false);

  const variables = scope === 'character' ? characterVariables : globalVariables;
  const variableList = useMemo(
    () =>
      Object.values(variables)
        .filter((v) => {
          if (!searchText) return true;
          const q = searchText.toLowerCase();
          return v.name.toLowerCase().includes(q) || v.value.toLowerCase().includes(q);
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [variables, searchText]
  );

  const editingVariable = editingId ? (variables[editingId] ?? null) : null;

  const handleSave = useCallback(
    (data: { name: string; value: string }, saveScope: VariableScope, existingId?: VariableId) => {
      if (existingId) {
        if (saveScope !== scope) {
          deleteVariable(existingId, scope);
          createVariable(data, saveScope);
        } else {
          updateVariable(existingId, data, saveScope);
        }
      } else {
        createVariable(data, saveScope);
      }
      setEditingId(null);
      setCreating(false);
    },
    [scope, createVariable, updateVariable, deleteVariable]
  );

  const titleText = `Variables${activeCharacter && scope === 'character' ? ` (${charDisplayName(activeCharacter)})` : scope === 'global' ? ' (Global)' : ''}`;

  return (
    <div className="w-[400px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5">
          <VariableIcon size={12} /> {titleText}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            title="New variable"
            className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-[#4ade80] transition-colors duration-150"
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

      {/* Scope toggle */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-border-subtle shrink-0">
        <FilterPill
          label="Character"
          active={scope === 'character'}
          accent="green"
          onClick={() => setScope('character')}
        />
        <FilterPill
          label="Global"
          active={scope === 'global'}
          accent="green"
          onClick={() => setScope('global')}
        />
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border-subtle shrink-0">
        <div className="relative">
          <MudInput
            accent="green"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter variables..."
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
      {(creating || editingVariable) && (
        <VariableEditor
          variable={editingVariable}
          scope={scope}
          onSave={handleSave}
          onCancel={() => {
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}

      {/* Variable list */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {variableList.length === 0 && !creating && (
          <div className="px-2 text-xs text-text-dim">
            {scope === 'character' && !activeCharacter
              ? 'Log in to manage character variables.'
              : 'No variables yet. Click + to create one.'}
          </div>
        )}

        {variableList.map((variable) => (
          <VariableRow
            key={variable.id}
            variable={variable}
            scope={scope}
            onEdit={(id) => {
              setEditingId(editingId === id ? null : id);
              setCreating(false);
            }}
          />
        ))}
      </div>
    </div>
  );
}
