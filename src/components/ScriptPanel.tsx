import { useState, useEffect, useCallback } from 'react';
import { PanelHeader } from './PanelHeader';
import { CodeIcon } from './icons';
import { ScriptEditor } from './ScriptEditor';

interface ScriptPanelProps {
  script: string;
  onSave: (content: string) => void;
  onClose?: () => void;
}

export function ScriptPanel({ script, onSave, onClose }: ScriptPanelProps) {
  const [draft, setDraft] = useState(script);
  const [dirty, setDirty] = useState(false);

  // Sync when external script changes (e.g. initial load)
  useEffect(() => {
    setDraft(script);
    setDirty(false);
  }, [script]);

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      setDirty(value !== script);
    },
    [script]
  );

  const handleSave = useCallback(() => {
    onSave(draft);
    setDirty(false);
  }, [draft, onSave]);

  return (
    <div className="w-[500px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      <PanelHeader
        icon={<CodeIcon size={12} />}
        title="Global Script"
        onClose={onClose}
      >
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="text-[10px] font-medium px-2 py-0.5 rounded border cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-default text-[#50fa7b] border-[#50fa7b]/40 bg-[#50fa7b]/10 hover:bg-[#50fa7b]/20"
        >
          {dirty ? 'Save' : 'Saved'}
        </button>
      </PanelHeader>

      <div className="px-3 py-2 text-[10px] text-text-dim border-b border-border-subtle shrink-0">
        Define shared functions and constants available to all script-mode triggers and aliases.
        Changes apply on next trigger/alias execution.
      </div>

      <div className="flex-1 p-3 overflow-hidden flex flex-col">
        <ScriptEditor
          value={draft}
          onChange={handleChange}
          onSave={handleSave}
          placeholder="// Shared functions for all scripts\n// Example:\n\nasync function buffUp() {\n  await send('cast shield');\n  await send('cast armor');\n}\n\nfunction healIfLow(hp) {\n  if (parseInt(hp) < 50) {\n    await send('cast heal');\n  }\n}"
          className="flex-1"
        />
      </div>
    </div>
  );
}
