import { useRef, useState } from 'react';
import { useSignatureContext } from '../contexts/SignatureContext';
import type { SignatureId } from '../types/signatureMap';
import { MudInput, MudButton } from './shared';

export function SignaturesSection() {
  const { sortedMappings, createMapping, updateMapping, deleteMapping } = useSignatureContext();
  const [sigValue, setSigValue] = useState('');
  const [nameValue, setNameValue] = useState('');
  const [editingId, setEditingId] = useState<SignatureId | null>(null);
  const [editSig, setEditSig] = useState('');
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editSigRef = useRef<HTMLInputElement | null>(null);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const sig = sigValue.trim();
    const name = nameValue.trim();
    if (!sig || !name) return;
    createMapping(sig, name);
    setSigValue('');
    setNameValue('');
  };

  const startEdit = (id: SignatureId, signature: string, playerName: string) => {
    setEditingId(id);
    setEditSig(signature);
    setEditName(playerName);
    requestAnimationFrame(() => editSigRef.current?.focus());
  };

  const commitEdit = () => {
    if (!editingId) return;
    const sig = editSig.trim();
    const name = editName.trim();
    if (sig && name) {
      updateMapping(editingId, { signature: sig, playerName: name });
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  return (
    <div className="border-b border-border-faint shrink-0 bg-bg-canvas/50">
      {/* Section header */}
      <div className="flex items-center px-3 py-1.5 border-b border-border-dim">
        <span className="text-[11px] font-mono text-cyan/80 uppercase tracking-wider">
          Signatures
          {sortedMappings.length > 0 && (
            <span className="text-cyan/50 ml-1.5">({sortedMappings.length})</span>
          )}
        </span>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex items-center gap-1.5 px-3 py-2">
        <MudInput
          ref={inputRef}
          accent="cyan"
          size="lg"
          value={sigValue}
          onChange={(e) => setSigValue(e.target.value)}
          placeholder="*Signature*"
          className="w-24"
        />
        <span className="text-[11px] text-text-dim shrink-0">&rarr;</span>
        <MudInput
          accent="cyan"
          size="lg"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          placeholder="Player name"
          className="flex-1 min-w-0"
        />
        <MudButton
          type="submit"
          accent="cyan"
          size="sm"
          disabled={!sigValue.trim() || !nameValue.trim()}
          className="shrink-0"
        >
          Add
        </MudButton>
      </form>

      {/* List */}
      <div className="max-h-[160px] overflow-y-auto">
        {sortedMappings.length === 0 && (
          <div className="px-3 py-2.5 text-[11px] text-text-dim text-center">
            No signatures yet. Use <span className="text-amber">?</span> on anonymous messages or
            add above.
          </div>
        )}
        {sortedMappings.map((mapping) =>
          editingId === mapping.id ? (
            <div key={mapping.id} className="flex items-center gap-1.5 px-3 py-1 bg-cyan/5">
              <MudInput
                ref={editSigRef}
                accent="cyan"
                size="lg"
                value={editSig}
                onChange={(e) => setEditSig(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="w-24 py-0.5"
              />
              <span className="text-[10px] text-text-dim/60 shrink-0">&rarr;</span>
              <MudInput
                accent="cyan"
                size="lg"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="flex-1 min-w-0 py-0.5"
              />
              <button
                onClick={commitEdit}
                className="text-[11px] font-mono text-cyan hover:text-cyan/80 cursor-pointer shrink-0"
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
              key={mapping.id}
              onClick={() => startEdit(mapping.id, mapping.signature, mapping.playerName)}
              className="group/row flex items-center justify-between gap-2 px-3 py-1 hover:bg-cyan/5 cursor-pointer transition-colors duration-100"
            >
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className="text-[12px] font-mono text-text-dim shrink-0">
                  {mapping.signature}
                </span>
                <span className="text-[10px] text-text-dim/60 shrink-0">&rarr;</span>
                <span className="text-[12px] font-mono text-text-label truncate">
                  {mapping.playerName}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMapping(mapping.id);
                }}
                className="text-[12px] font-mono text-text-dim hover:text-red cursor-pointer shrink-0 opacity-0 group-hover/row:opacity-100 transition-all duration-150"
                title="Delete mapping"
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
