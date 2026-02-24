import { useRef, useState } from 'react';
import { MudInput, MudButton } from './shared';

export function MutedSection({
  mutedSenders,
  onMute,
  onUnmute,
}: {
  mutedSenders: string[];
  onMute: (name: string) => void;
  onUnmute: (name: string) => void;
}) {
  const [addValue, setAddValue] = useState('');
  const [search, setSearch] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const name = addValue.trim();
    if (!name) return;
    onMute(name);
    setAddValue('');
  };

  const startEdit = (name: string) => {
    setEditingName(name);
    setEditValue(name);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  const commitEdit = () => {
    if (!editingName) return;
    const newName = editValue.trim();
    if (newName && newName !== editingName) {
      onUnmute(editingName);
      onMute(newName);
    }
    setEditingName(null);
  };

  const cancelEdit = () => setEditingName(null);

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const filtered = search
    ? mutedSenders.filter((s) => s.toLowerCase().includes(search.toLowerCase()))
    : mutedSenders;

  return (
    <div className="border-b border-border-faint shrink-0 bg-bg-canvas/50">
      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-dim">
        <span className="text-[11px] font-mono text-red/80 uppercase tracking-wider">
          Muted Senders
          {mutedSenders.length > 0 && (
            <span className="text-red/50 ml-1.5">({mutedSenders.length})</span>
          )}
        </span>
        {mutedSenders.length > 6 && (
          <MudInput
            accent="red"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-28"
            size="sm"
          />
        )}
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex items-center gap-1.5 px-3 py-2">
        <MudInput
          ref={inputRef}
          accent="red"
          size="lg"
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          placeholder="Add name to mute..."
          className="flex-1 min-w-0"
        />
        <MudButton
          type="submit"
          accent="red"
          size="sm"
          disabled={!addValue.trim()}
          className="shrink-0"
        >
          Mute
        </MudButton>
      </form>

      {/* List */}
      <div className="max-h-[160px] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-2.5 text-[11px] text-text-dim text-center">
            {mutedSenders.length === 0 ? 'No muted senders.' : 'No matches.'}
          </div>
        )}
        {filtered.map((name) =>
          editingName === name ? (
            <div key={name} className="flex items-center gap-1.5 px-3 py-1 bg-red/5">
              <MudInput
                ref={editRef}
                accent="red"
                size="lg"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={commitEdit}
                className="flex-1 min-w-0 py-0.5"
              />
              <button
                onClick={commitEdit}
                className="text-[11px] font-mono text-red hover:text-red/80 cursor-pointer shrink-0"
                title="Save"
              >
                &#10003;
              </button>
              <button
                onClick={cancelEdit}
                className="text-[11px] font-mono text-text-dim hover:text-red cursor-pointer shrink-0"
                title="Cancel"
              >
                &times;
              </button>
            </div>
          ) : (
            <div
              key={name}
              onClick={() => startEdit(name)}
              className="group/row flex items-center justify-between gap-2 px-3 py-1 hover:bg-red/5 cursor-pointer transition-colors duration-100"
            >
              <span className="text-[12px] font-mono text-text-label truncate">{name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUnmute(name);
                }}
                className="text-[12px] font-mono text-text-dim hover:text-red cursor-pointer shrink-0 opacity-0 group-hover/row:opacity-100 transition-all duration-150"
                title={`Unmute ${name}`}
              >
                &times;
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
