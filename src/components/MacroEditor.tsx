import { useState, useEffect, useRef, useCallback } from 'react';
import type { Macro, HotkeyCombo } from '../types/macro';
import {
  formatHotkey,
  hotkeyToString,
  hotkeyFromEvent,
  isReservedHotkey,
  isNumpadKey,
} from '../types/macro';
import { MudInput, MudButton } from './shared';
import { ScriptEditor } from './ScriptEditor';

interface MacroEditorProps {
  macro: Macro | null;
  existingHotkeys: Map<string, string>;
  onSave: (data: Omit<Macro, 'id'>) => void;
  onCancel: () => void;
}

const ACCENT = '#e8a849';

export function MacroEditor({ macro, existingHotkeys, onSave, onCancel }: MacroEditorProps) {
  const [name, setName] = useState(macro?.name ?? '');
  const [hotkey, setHotkey] = useState<HotkeyCombo | null>(macro?.hotkey ?? null);
  const [body, setBody] = useState(macro?.body ?? '');
  const [bodyMode, setBodyMode] = useState<'commands' | 'script'>(macro?.bodyMode ?? 'commands');
  const [capturing, setCapturing] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const handleCapture = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const combo = hotkeyFromEvent(e);
      if (!combo) return; // modifier-only press

      // Check reserved
      if (isReservedHotkey(combo)) {
        setHotkeyError(`${formatHotkey(combo)} is reserved`);
        return;
      }

      // Check numpad
      if (isNumpadKey(combo.key)) {
        setHotkeyError('Numpad keys are used for movement');
        return;
      }

      // Require at least one modifier (unless it's an F-key)
      const isFKey = /^F\d+$/.test(combo.key);
      if (!combo.ctrl && !combo.alt && !combo.shift && !isFKey) {
        setHotkeyError('Use Ctrl, Alt, or Shift with letter/number keys');
        return;
      }

      // Check conflict with other macros
      const str = hotkeyToString(combo);
      const conflictId = existingHotkeys.get(str);
      if (conflictId && conflictId !== macro?.id) {
        setHotkeyError(`${formatHotkey(combo)} is already bound`);
        return;
      }

      setHotkey(combo);
      setHotkeyError(null);
      setCapturing(false);
    },
    [existingHotkeys, macro?.id]
  );

  useEffect(() => {
    if (!capturing) return;
    window.addEventListener('keydown', handleCapture, true);
    return () => window.removeEventListener('keydown', handleCapture, true);
  }, [capturing, handleCapture]);

  const handleSave = () => {
    if (!name.trim() || !hotkey) return;
    onSave({
      name: name.trim(),
      hotkey,
      body,
      bodyMode,
      enabled: macro?.enabled ?? true,
    });
  };

  const canSave = name.trim().length > 0 && hotkey != null;

  return (
    <div className="p-3 flex flex-col gap-2.5">
      {/* Header */}
      <span className="text-[11px] font-semibold text-text-label">
        {macro ? 'Edit Macro' : 'New Macro'}
      </span>

      {/* Name */}
      <div>
        <label className="text-[10px] text-text-dim mb-0.5 block">Name</label>
        <MudInput
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Heal rotation"
          size="sm"
          className="w-full"
          maxLength={40}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) handleSave();
          }}
        />
      </div>

      {/* Hotkey capture */}
      <div>
        <label className="text-[10px] text-text-dim mb-0.5 block">Hotkey</label>
        <div className="flex items-center gap-2">
          {capturing ? (
            <div
              className="flex-1 h-[28px] flex items-center justify-center rounded border border-dashed text-[11px] font-mono animate-pulse"
              style={{ borderColor: ACCENT, color: ACCENT }}
            >
              Press a key combo...
            </div>
          ) : hotkey ? (
            <button
              onClick={() => {
                setCapturing(true);
                setHotkeyError(null);
              }}
              className="flex items-center gap-1 h-[28px] px-2 rounded border text-[11px] font-mono font-semibold cursor-pointer transition-colors duration-150 hover:border-[#e8a849]/60"
              style={{
                color: ACCENT,
                borderColor: `color-mix(in srgb, ${ACCENT} 40%, transparent)`,
                background: `color-mix(in srgb, ${ACCENT} 8%, transparent)`,
              }}
              title="Click to rebind"
            >
              {formatHotkey(hotkey)}
            </button>
          ) : (
            <button
              onClick={() => {
                setCapturing(true);
                setHotkeyError(null);
              }}
              className="flex-1 h-[28px] flex items-center justify-center rounded border border-dashed text-[11px] font-mono cursor-pointer text-text-dim border-border-dim hover:border-[#e8a849]/40 hover:text-[#e8a849] transition-colors duration-150"
            >
              Click to set hotkey
            </button>
          )}
          {capturing && (
            <MudButton variant="ghost" size="sm" onClick={() => setCapturing(false)}>
              Cancel
            </MudButton>
          )}
        </div>
        {hotkeyError && (
          <div className="text-[9px] text-red mt-0.5">{hotkeyError}</div>
        )}
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
                  ? 'border-[#e8a849]/40 bg-[#e8a849]/10'
                  : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
              }`}
              style={bodyMode === 'commands' ? { color: ACCENT } : undefined}
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
          <div style={{ height: 120 }}>
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
            rows={4}
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
            {macro ? 'Save' : 'Add'}
          </MudButton>
        </div>
      </div>
    </div>
  );
}
