import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { QuickButton, QuickButtonToggle } from '../types';
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

/* ── Shared color picker row ─────────────────────────────────── */

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const isCustom = !COLOR_PRESETS.some((c) => c.hex === value);

  return (
    <div className="flex gap-1 items-center">
      {COLOR_PRESETS.map((c) => (
        <button
          key={c.hex}
          onClick={() => onChange(c.hex)}
          title={c.label}
          className="w-[18px] h-[18px] rounded-full cursor-pointer transition-all duration-100 hover:scale-125"
          style={{
            backgroundColor: c.hex,
            boxShadow:
              value === c.hex
                ? `0 0 0 2px #0d0d0d, 0 0 0 3.5px ${c.hex}, 0 0 8px ${c.hex}55`
                : `inset 0 0 0 1px rgba(0,0,0,0.3)`,
          }}
        />
      ))}
      <label
        title="Custom color"
        className="relative w-[18px] h-[18px] rounded-full cursor-pointer transition-all duration-100 hover:scale-125 flex items-center justify-center"
        style={{
          background: isCustom
            ? value
            : 'conic-gradient(#ff5555, #f1fa8c, #50fa7b, #8be9fd, #bd93f9, #ff79c6, #ff5555)',
          boxShadow: isCustom
            ? `0 0 0 2px #0d0d0d, 0 0 0 3.5px ${value}, 0 0 8px ${value}55`
            : 'inset 0 0 0 1px rgba(0,0,0,0.3)',
        }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}

/* ── Shared body mode toggle + editor ─────────────────────────── */

function BodyEditor({
  body,
  bodyMode,
  onBodyChange,
  onModeChange,
  accentColor,
  canSave,
  onSave,
  placeholder,
  compact,
}: {
  body: string;
  bodyMode: 'commands' | 'script';
  onBodyChange: (v: string) => void;
  onModeChange: (m: 'commands' | 'script') => void;
  accentColor: string;
  canSave: boolean;
  onSave?: () => void;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-0.5">
        <label className="text-[10px] text-text-dim">Body</label>
        <div className="flex gap-0.5 ml-1">
          <button
            type="button"
            onClick={() => onModeChange('commands')}
            className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 ${
              bodyMode === 'commands'
                ? 'border-cyan/40 bg-cyan/10'
                : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
            }`}
            style={bodyMode === 'commands' ? { color: accentColor } : undefined}
          >
            Commands
          </button>
          <button
            type="button"
            onClick={() => onModeChange('script')}
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
        <div style={{ height: compact ? 80 : 150 }}>
          <ScriptEditor
            value={body}
            onChange={onBodyChange}
            placeholder={placeholder ?? "await send('cast heal');"}
            onSave={canSave ? onSave : undefined}
          />
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder={placeholder ?? 'cast heal\nlook'}
          spellCheck={false}
          rows={compact ? 2 : 5}
          className="w-full font-mono text-[11px] bg-bg-input border border-border-dim rounded px-2 py-1 text-text-primary placeholder:text-text-dim focus:outline-none focus:border-cyan/40 resize-y"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey && canSave && onSave) onSave();
          }}
        />
      )}
    </div>
  );
}

/* ── Preview pill ─────────────────────────────────────────────── */

function PreviewPill({ label, color }: { label: string; color: string }) {
  if (!label) return null;
  return (
    <span
      className="text-[10px] font-mono font-semibold px-2 py-px rounded-full border"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

/* ── Main Editor ──────────────────────────────────────────────── */

export function QuickButtonEditor({ button, anchorRect, onSave, onCancel }: QuickButtonEditorProps) {
  // Simple button state
  const [label, setLabel] = useState(button?.label ?? '');
  const [color, setColor] = useState(button?.color ?? COLOR_PRESETS[0].hex);
  const [body, setBody] = useState(button?.body ?? '');
  const [bodyMode, setBodyMode] = useState<'commands' | 'script'>(button?.bodyMode ?? 'commands');

  // Toggle mode
  const [isToggle, setIsToggle] = useState(!!button?.toggle);
  const [variable, setVariable] = useState(button?.toggle?.variable ?? '');
  const [onLabel, setOnLabel] = useState(button?.toggle?.onLabel ?? '');
  const [onColor, setOnColor] = useState(button?.toggle?.onColor ?? COLOR_PRESETS[0].hex);
  const [onBody, setOnBody] = useState(button?.toggle?.onBody ?? '');
  const [onBodyMode, setOnBodyMode] = useState<'commands' | 'script'>(
    button?.toggle?.onBodyMode ?? 'commands'
  );
  const [offLabel, setOffLabel] = useState(button?.toggle?.offLabel ?? '');
  const [offColor, setOffColor] = useState(button?.toggle?.offColor ?? COLOR_PRESETS[1].hex);
  const [offBody, setOffBody] = useState(button?.toggle?.offBody ?? '');
  const [offBodyMode, setOffBodyMode] = useState<'commands' | 'script'>(
    button?.toggle?.offBodyMode ?? 'commands'
  );

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
    if (isToggle) {
      if (!onLabel.trim() || !offLabel.trim() || !variable.trim()) return;
      const toggle: QuickButtonToggle = {
        variable: variable.trim(),
        onLabel: onLabel.trim(),
        offLabel: offLabel.trim(),
        onColor,
        offColor,
        onBody,
        offBody,
        onBodyMode,
        offBodyMode,
      };
      // Use offLabel/offColor as root label/color (default/off state)
      onSave({
        label: offLabel.trim(),
        color: offColor,
        body: '',
        bodyMode: 'commands',
        enabled: button?.enabled ?? true,
        toggle,
      });
    } else {
      if (!label.trim()) return;
      onSave({
        label: label.trim(),
        color,
        body,
        bodyMode,
        enabled: button?.enabled ?? true,
      });
    }
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

  const canSave = isToggle
    ? onLabel.trim().length > 0 && offLabel.trim().length > 0 && variable.trim().length > 0
    : label.trim().length > 0;

  const editorWidth = isToggle ? 340 : 310;

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        ...style,
        width: editorWidth,
        borderColor: `color-mix(in srgb, ${isToggle ? onColor : color} 30%, transparent)`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 1px ${isToggle ? onColor : color}22`,
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
      }}
      className="bg-bg-secondary border rounded-lg p-3 flex flex-col gap-2.5"
    >
      {/* Header with toggle switch + preview */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-label">
            {button ? 'Edit Button' : 'New Button'}
          </span>
          <button
            type="button"
            onClick={() => setIsToggle(!isToggle)}
            className={`text-[9px] font-mono px-1.5 py-px rounded border cursor-pointer transition-colors duration-150 ${
              isToggle
                ? 'text-[#ffb86c] border-[#ffb86c]/40 bg-[#ffb86c]/10'
                : 'text-text-dim border-border-dim bg-transparent hover:text-text-label'
            }`}
          >
            Toggle
          </button>
        </div>
        {isToggle ? (
          <div className="flex gap-1">
            <PreviewPill label={onLabel.trim()} color={onColor} />
            <PreviewPill label={offLabel.trim()} color={offColor} />
          </div>
        ) : (
          <PreviewPill label={label.trim()} color={color} />
        )}
      </div>

      {isToggle ? (
        <>
          {/* Variable name */}
          <div>
            <label className="text-[10px] text-text-dim mb-0.5 block">Variable</label>
            <MudInput
              ref={labelRef}
              value={variable}
              onChange={(e) => setVariable(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="e.g. afk_mode"
              size="sm"
              className="w-full"
              maxLength={30}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) handleSave();
              }}
            />
            <span className="text-[9px] text-text-dim mt-0.5 block">
              Stored as $variable — accessible from scripts and triggers
            </span>
          </div>

          {/* ON state */}
          <div
            className="border border-border-dim rounded p-2 flex flex-col gap-2"
            style={{ borderColor: `color-mix(in srgb, ${onColor} 25%, transparent)` }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="text-[10px] font-semibold"
                style={{ color: onColor }}
              >
                ON State
              </span>
              <span className="text-[9px] text-text-dim">— runs when turning on</span>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[10px] text-text-dim mb-0.5 block">Label</label>
                <MudInput
                  value={onLabel}
                  onChange={(e) => setOnLabel(e.target.value)}
                  placeholder="e.g. AFK On"
                  size="sm"
                  className="w-full"
                  maxLength={20}
                />
              </div>
              <div>
                <label className="text-[10px] text-text-dim mb-0.5 block">Color</label>
                <ColorPicker value={onColor} onChange={setOnColor} />
              </div>
            </div>
            <BodyEditor
              body={onBody}
              bodyMode={onBodyMode}
              onBodyChange={setOnBody}
              onModeChange={setOnBodyMode}
              accentColor={onColor}
              canSave={canSave}
              onSave={handleSave}
              placeholder="echo('AFK mode enabled');"
              compact
            />
          </div>

          {/* OFF state */}
          <div
            className="border border-border-dim rounded p-2 flex flex-col gap-2"
            style={{ borderColor: `color-mix(in srgb, ${offColor} 25%, transparent)` }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="text-[10px] font-semibold"
                style={{ color: offColor }}
              >
                OFF State
              </span>
              <span className="text-[9px] text-text-dim">— runs when turning off</span>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[10px] text-text-dim mb-0.5 block">Label</label>
                <MudInput
                  value={offLabel}
                  onChange={(e) => setOffLabel(e.target.value)}
                  placeholder="e.g. AFK Off"
                  size="sm"
                  className="w-full"
                  maxLength={20}
                />
              </div>
              <div>
                <label className="text-[10px] text-text-dim mb-0.5 block">Color</label>
                <ColorPicker value={offColor} onChange={setOffColor} />
              </div>
            </div>
            <BodyEditor
              body={offBody}
              bodyMode={offBodyMode}
              onBodyChange={setOffBody}
              onModeChange={setOffBodyMode}
              accentColor={offColor}
              canSave={canSave}
              onSave={handleSave}
              placeholder="echo('AFK mode disabled');"
              compact
            />
          </div>
        </>
      ) : (
        <>
          {/* Simple button: Label + Color */}
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
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>

          {/* Simple button: Body */}
          <BodyEditor
            body={body}
            bodyMode={bodyMode}
            onBodyChange={setBody}
            onModeChange={setBodyMode}
            accentColor={color}
            canSave={canSave}
            onSave={handleSave}
          />
        </>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[9px] text-text-dim">
          {isToggle
            ? 'Variable toggles between "1" and "0"'
            : bodyMode === 'commands'
              ? 'One command per line'
              : 'JS with send(), echo(), delay()'}
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
