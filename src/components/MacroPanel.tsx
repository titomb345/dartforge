import { useState, useCallback, useMemo } from 'react';
import type { Macro, MacroId } from '../types/macro';
import { formatHotkey, hotkeyToString } from '../types/macro';
import { MacroIcon, PlusIcon } from './icons';
import { PanelHeader } from './PanelHeader';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { MacroEditor } from './MacroEditor';
import { MudInput } from './shared';

interface MacroPanelProps {
  onClose: () => void;
  macros: Macro[];
  onAdd: (data: Omit<Macro, 'id'>) => void;
  onUpdate: (id: MacroId, data: Partial<Macro>) => void;
  onDelete: (id: MacroId) => void;
}

const ACCENT = '#e8a849';

function MacroRow({
  macro,
  onEdit,
  onToggle,
  onDelete,
}: {
  macro: Macro;
  onEdit: (id: MacroId) => void;
  onToggle: (id: MacroId) => void;
  onDelete: (id: MacroId) => void;
}) {
  const hotkeyLabel = formatHotkey(macro.hotkey);
  const bodyPreview =
    macro.bodyMode === 'script'
      ? 'JS script'
      : macro.body.split('\n')[0].slice(0, 50) + (macro.body.length > 50 ? '...' : '');

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-bg-secondary rounded transition-[background] duration-150 cursor-pointer"
      onClick={() => onEdit(macro.id)}
    >
      {/* Enable toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(macro.id);
        }}
        className={`w-3 h-3 rounded-sm border cursor-pointer transition-colors duration-150 shrink-0 ${
          macro.enabled
            ? 'border-[#e8a849]/60 bg-[#e8a849]/30'
            : 'border-border-dim bg-transparent'
        }`}
        title={macro.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      />

      {/* Hotkey badge */}
      <span
        className="text-[10px] font-mono font-semibold px-1.5 py-px rounded border shrink-0"
        style={{
          color: macro.enabled ? ACCENT : '#555',
          borderColor: macro.enabled
            ? `color-mix(in srgb, ${ACCENT} 40%, transparent)`
            : '#333',
          background: macro.enabled
            ? `color-mix(in srgb, ${ACCENT} 8%, transparent)`
            : 'transparent',
        }}
      >
        {hotkeyLabel}
      </span>

      {/* Name + body preview */}
      <div className="flex-1 min-w-0">
        <div
          className={`text-[11px] font-mono truncate ${
            macro.enabled ? 'text-text-label' : 'text-text-dim'
          }`}
        >
          {macro.name}
        </div>
        <div className="text-[9px] text-text-dim font-mono truncate">{bodyPreview}</div>
      </div>

      {/* Delete */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
        <ConfirmDeleteButton
          onDelete={() => onDelete(macro.id)}
          title="Delete macro"
        />
      </div>
    </div>
  );
}

export function MacroPanel({ onClose, macros, onAdd, onUpdate, onDelete }: MacroPanelProps) {
  const [editingId, setEditingId] = useState<MacroId | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchText, setSearchText] = useState('');

  const filtered = useMemo(() => {
    if (!searchText) return macros;
    const lower = searchText.toLowerCase();
    return macros.filter(
      (m) =>
        m.name.toLowerCase().includes(lower) ||
        formatHotkey(m.hotkey).toLowerCase().includes(lower) ||
        m.body.toLowerCase().includes(lower)
    );
  }, [macros, searchText]);

  const editingMacro = editingId ? macros.find((m) => m.id === editingId) ?? null : null;

  // Build set of existing hotkey strings for conflict detection
  const existingHotkeys = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of macros) {
      map.set(hotkeyToString(m.hotkey), m.id);
    }
    return map;
  }, [macros]);

  const handleSave = useCallback(
    (data: Omit<Macro, 'id'>, existingId?: MacroId) => {
      if (existingId) {
        onUpdate(existingId, data);
      } else {
        onAdd(data);
      }
      setEditingId(null);
      setCreating(false);
    },
    [onAdd, onUpdate]
  );

  const handleToggle = useCallback(
    (id: MacroId) => {
      const m = macros.find((m) => m.id === id);
      if (m) onUpdate(id, { enabled: !m.enabled });
    },
    [macros, onUpdate]
  );

  return (
    <div className="w-[400px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      <PanelHeader icon={<MacroIcon size={12} />} title="Macros" onClose={onClose}>
        <button
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          title="New macro"
          className="flex items-center gap-1 rounded text-[10px] cursor-pointer px-1.5 py-[2px] border border-border-dim text-text-dim hover:text-[#e8a849] hover:border-[#e8a849]/40 transition-colors duration-150"
        >
          <PlusIcon size={9} />
          New Macro
        </button>
      </PanelHeader>

      {/* Search */}
      {macros.length > 5 && (
        <div className="px-2 py-1.5 border-b border-border-subtle shrink-0">
          <MudInput
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search macros..."
            size="sm"
            className="w-full"
          />
        </div>
      )}

      {/* Editor (creating or editing) */}
      {(creating || editingMacro) && (
        <div className="border-b border-border-subtle shrink-0">
          <MacroEditor
            macro={editingMacro}
            existingHotkeys={existingHotkeys}
            onSave={(data) => handleSave(data, editingMacro?.id)}
            onCancel={() => {
              setCreating(false);
              setEditingId(null);
            }}
          />
        </div>
      )}

      {/* Macro list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1">
        {filtered.length === 0 && (
          <div className="text-center text-[11px] text-text-dim py-6">
            {macros.length === 0
              ? 'No macros yet. Click "New Macro" to create one.'
              : 'No matches.'}
          </div>
        )}
        {filtered.map((m) => (
          <MacroRow
            key={m.id}
            macro={m}
            onEdit={setEditingId}
            onToggle={handleToggle}
            onDelete={onDelete}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-2 py-1.5 border-t border-border-subtle text-[9px] text-text-dim shrink-0">
        Macros fire their commands when you press the hotkey anywhere in the app.
      </div>
    </div>
  );
}
