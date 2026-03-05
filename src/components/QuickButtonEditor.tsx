import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { QuickButton } from '../types';
import { MudInput, MudButton } from './shared';
import { ScriptEditor } from './ScriptEditor';

const COLOR_PRESETS = [
  { hex: '#50fa7b', label: 'Green' },
  { hex: '#ff5555', label: 'Red' },
  { hex: '#8be9fd', label: 'Cyan' },
  { hex: '#ffb86c', label: 'Orange' },
  { hex: '#ff79c6', label: 'Pink' },
  { hex: '#bd93f9', label: 'Purple' },
  { hex: '#f1fa8c', label: 'Yellow' },
  { hex: '#6272a4', label: 'Slate' },
];

interface QuickButtonEditorProps {
  button: QuickButton | null;
  anchorRect: DOMRect | null;
  onSave: (data: Omit<QuickButton, 'id'>) => void;
  onCancel: () => void;
}

export function QuickButtonEditor({ button, anchorRect, onSave, onCancel }: QuickButtonEditorProps) {
  const [label, setLabel] = useState(button?.label ?? '');
  const [color, setColor] = useState(button?.color ?? COLOR_PRESETS[0].hex);
  const [body, setBody] = useState(button?.body ?? '');
  const [bodyMode, setBodyMode] = useState<'commands' | 'script'>(button?.bodyMode ?? 'commands');
  const popoverRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => labelRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleSave = () => {
    if (!label.trim()) return;
    onSave({ label: label.trim(), color, body, bodyMode, enabled: button?.enabled ?? true });
  };

  // Position popover above the anchor (the button bar lives near the bottom)
  const style: React.CSSProperties = { position: 'fixed', zIndex: 9999 };
  if (anchorRect) {
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    if (spaceBelow > 380) {
      style.top = anchorRect.bottom + 4;
    } else {
      style.bottom = window.innerHeight - anchorRect.top + 4;
    }
    style.left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 310));
  } else {
    style.top = '50%';
    style.left = '50%';
    style.transform = 'translate(-50%, -50%)';
  }

  const canSave = label.trim().length > 0;

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        ...style,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 1px ${color}22`,
      }}
      className="w-[310px] bg-bg-secondary border rounded-lg p-3 flex flex-col gap-2.5"
    >
      {/* Header with live preview pill */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text-label">
          {button ? 'Edit Button' : 'New Button'}
        </span>
        {label.trim() && (
          <span
            className="text-[10px] font-mono font-semibold px-2 py-px rounded-full border"
            style={{
              color,
              borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
              background: `color-mix(in srgb, ${color} 8%, transparent)`,
            }}
          >
            {label.trim()}
          </span>
        )}
      </div>

      {/* Label + Color on same row */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[10px] text-text-dim mb-0.5 block">Label</label>
          <MudInput
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Heal"
            size="sm"
            className="w-full"
            maxLength={20}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) handleSave();
            }}
          />
        </div>
        <div>
          <label className="text-[10px] text-text-dim mb-0.5 block">Color</label>
          <div className="flex gap-1">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.hex}
                onClick={() => setColor(c.hex)}
                title={c.label}
                className="w-[18px] h-[18px] rounded-full cursor-pointer transition-all duration-100 hover:scale-125"
                style={{
                  backgroundColor: c.hex,
                  boxShadow:
                    color === c.hex
                      ? `0 0 0 2px #0d0d0d, 0 0 0 3.5px ${c.hex}, 0 0 8px ${c.hex}55`
                      : `inset 0 0 0 1px rgba(0,0,0,0.3)`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center gap-1 mb-0.5">
          <label className="text-[10px] text-text-dim">Body</label>
          <div className="flex gap-0.5 ml-1">
            <button
              type="button"
              onClick={() => setBodyMode('commands')}
              className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 ${
                bodyMode === 'commands'
                  ? 'border-cyan/40 bg-cyan/10'
                  : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
              }`}
              style={bodyMode === 'commands' ? { color } : undefined}
            >
              Commands
            </button>
            <button
              type="button"
              onClick={() => setBodyMode('script')}
              className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 ${
                bodyMode === 'script'
                  ? 'text-[#8be9fd] border-[#8be9fd]/40 bg-[#8be9fd]/10'
                  : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
              }`}
            >
              Script
            </button>
          </div>
        </div>
        {bodyMode === 'script' ? (
          <div style={{ height: 150 }}>
            <ScriptEditor
              value={body}
              onChange={setBody}
              placeholder="await send('cast heal');"
              onSave={canSave ? handleSave : undefined}
            />
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'cast heal\nlook'}
            spellCheck={false}
            rows={5}
            className="w-full font-mono text-[11px] bg-bg-input border border-border-dim rounded px-2 py-1 text-text-primary placeholder:text-text-dim focus:outline-none focus:border-cyan/40 resize-y"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey && canSave) handleSave();
            }}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[9px] text-text-dim">
          {bodyMode === 'commands' ? 'One command per line' : 'JS with send(), echo(), delay()'}
        </span>
        <div className="flex gap-1.5">
          <MudButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </MudButton>
          <MudButton size="sm" onClick={handleSave} disabled={!canSave}>
            {button ? 'Save' : 'Add'}
          </MudButton>
        </div>
      </div>
    </div>,
    document.body
  );
}
