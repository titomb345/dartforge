import { useState, useEffect, useRef } from 'react';
import { HexColorPicker } from 'react-colorful';
import {
  THEME_COLOR_META,
  DEFAULT_THEME,
  type TerminalTheme,
  type ThemeColorKey,
} from '../lib/defaultTheme';
import {
  FONT_OPTIONS,
  DEFAULT_DISPLAY,
  type DisplaySettings,
} from '../hooks/useThemeColors';
import { cn } from '../lib/cn';

interface ColorSettingsProps {
  theme: TerminalTheme;
  onUpdateColor: (key: ThemeColorKey, value: string) => void;
  onResetColor: (key: ThemeColorKey) => void;
  onReset: () => void;
  display: DisplaySettings;
  onUpdateDisplay: <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => void;
  onResetDisplay: (key: keyof DisplaySettings) => void;
  debugMode: boolean;
  onToggleDebug: () => void;
}

function ColorSwatch({
  colorKey,
  label,
  value,
  expanded,
  onChange,
  onReset,
  onToggle,
}: {
  colorKey: ThemeColorKey;
  label: string;
  value: string;
  expanded: boolean;
  onChange: (key: ThemeColorKey, value: string) => void;
  onReset: (key: ThemeColorKey) => void;
  onToggle: (key: ThemeColorKey) => void;
}) {
  const isDefault = value === DEFAULT_THEME[colorKey];
  const [hexInput, setHexInput] = useState(value.replace('#', ''));
  const editingRef = useRef(false);

  // Only sync from external changes (picker drag, reset) — not while user is typing
  useEffect(() => {
    if (!editingRef.current) {
      setHexInput(value.replace('#', ''));
    }
  }, [value]);

  /** Strip to just hex digits, max 6 */
  const sanitizeHex = (raw: string) =>
    raw.replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6);

  // The color to display in the picker/swatch: padded with 0s for live preview
  const previewColor = (() => {
    const digits = sanitizeHex(hexInput);
    if (editingRef.current && digits.length > 0) {
      return `#${digits.padEnd(6, '0')}`;
    }
    return value;
  })();

  const handleHexChange = (raw: string) => {
    editingRef.current = true;
    const digits = sanitizeHex(raw);
    setHexInput(digits);
    // If they've completed all 6 digits, persist it
    if (digits.length === 6) {
      onChange(colorKey, `#${digits}`.toLowerCase());
    }
  };

  const handleHexSubmit = () => {
    editingRef.current = false;
    const digits = sanitizeHex(hexInput);
    if (digits.length === 6) {
      onChange(colorKey, `#${digits}`.toLowerCase());
      setHexInput(digits);
    } else {
      // Revert to last saved value
      setHexInput(value.replace('#', ''));
    }
  };

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-[background] duration-150',
          expanded ? 'bg-bg-secondary' : 'bg-transparent hover:bg-bg-secondary'
        )}
        onClick={() => {
          if (expanded) editingRef.current = false;
          onToggle(colorKey);
        }}
      >
        <div
          className="w-6 h-6 rounded border border-[#444] shrink-0"
          style={{ background: value }}
        />
        <span className="text-xs text-text-label flex-1 whitespace-nowrap">{label}</span>
        <span className={cn('text-[11px] font-mono', isDefault ? 'text-text-dim' : 'text-cyan')}>
          {value}
        </span>
        <button
          className={cn(
            'bg-transparent border-none text-[#555] hover:text-text-label text-sm cursor-pointer px-0.5 leading-none shrink-0',
            isDefault ? 'invisible' : 'visible'
          )}
          title="Reset to default"
          onClick={(e) => {
            e.stopPropagation();
            onReset(colorKey);
          }}
        >
          ↺
        </button>
      </div>
      <div
        className={cn(
          'overflow-hidden transition-[max-height,opacity] ease-in-out',
          expanded ? 'max-h-[220px] opacity-100 duration-250' : 'max-h-0 opacity-0 duration-200'
        )}
      >
        <div className="px-4 pb-3 pt-2 flex flex-col items-center gap-2">
          <HexColorPicker
            color={previewColor}
            onChange={(c) => {
              editingRef.current = false;
              onChange(colorKey, c);
            }}
            style={{ width: '100%', height: '140px' }}
          />
          <div className="flex items-center w-full bg-bg-input border border-border rounded overflow-hidden">
            <span className="pl-2.5 py-1 text-[#555] text-xs font-mono select-none">
              #
            </span>
            <input
              type="text"
              value={hexInput}
              onChange={(e) => handleHexChange(e.target.value)}
              onBlur={handleHexSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleHexSubmit();
              }}
              onClick={(e) => e.stopPropagation()}
              spellCheck={false}
              maxLength={6}
              className="flex-1 py-1 pr-2.5 pl-0.5 bg-transparent border-none text-text-heading text-xs font-mono text-center outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ColorSettings({ theme, onUpdateColor, onResetColor, onReset, display, onUpdateDisplay, onResetDisplay, debugMode, onToggleDebug }: ColorSettingsProps) {
  const base = THEME_COLOR_META.filter((m) => m.group === 'base');
  const normal = THEME_COLOR_META.filter((m) => m.group === 'normal');
  const bright = THEME_COLOR_META.filter((m) => m.group === 'bright');
  const [expandedKey, setExpandedKey] = useState<ThemeColorKey | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleExpanded = (key: ThemeColorKey) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  return (
    <div className="w-[360px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[13px] font-semibold text-text-heading">Appearance</span>
        <button
          onClick={onToggleDebug}
          title="Show ANSI color names in terminal output"
          className={cn(
            'flex items-center gap-[5px] rounded text-[11px] cursor-pointer px-2 py-[3px] transition-all duration-200 ease-in-out border',
            debugMode
              ? 'bg-[#f59e0b18] border-[#f59e0b44] text-amber'
              : 'bg-transparent border-border-faint text-text-dim'
          )}
        >
          <span className="text-[13px] leading-none">{'</>'}</span>
          Debug
        </button>
      </div>

      {/* Settings list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 py-3">
        {/* Display section */}
        <div className="mb-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1.5 px-2">Display</div>

          {/* Font family */}
          <div className="px-2 py-1 flex items-center gap-2">
            <span className="text-xs text-text-label flex-1">Font</span>
            {display.fontFamily !== DEFAULT_DISPLAY.fontFamily && (
              <button
                onClick={() => onResetDisplay('fontFamily')}
                className="bg-transparent border-none text-[#555] hover:text-text-label text-sm cursor-pointer px-0.5 leading-none"
                title="Reset to default"
              >↺</button>
            )}
            <select
              value={display.fontFamily}
              onChange={(e) => onUpdateDisplay('fontFamily', e.target.value)}
              className="bg-bg-input border border-border rounded text-text-heading text-[11px] px-1.5 py-[3px] outline-none cursor-pointer"
              style={{ fontFamily: display.fontFamily }}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>

          {/* Font size */}
          <div className="px-2 py-1 flex items-center gap-2">
            <span className="text-xs text-text-label flex-1">Size</span>
            {display.fontSize !== DEFAULT_DISPLAY.fontSize && (
              <button
                onClick={() => onResetDisplay('fontSize')}
                className="bg-transparent border-none text-[#555] hover:text-text-label text-sm cursor-pointer px-0.5 leading-none"
                title="Reset to default"
              >↺</button>
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onUpdateDisplay('fontSize', Math.max(8, display.fontSize - 1))}
                className="w-[22px] h-[22px] bg-bg-input border border-border rounded text-text-label text-sm cursor-pointer flex items-center justify-center leading-none p-0"
              >−</button>
              <span className="text-xs font-mono text-text-heading min-w-[28px] text-center">
                {display.fontSize}px
              </span>
              <button
                onClick={() => onUpdateDisplay('fontSize', Math.min(28, display.fontSize + 1))}
                className="w-[22px] h-[22px] bg-bg-input border border-border rounded text-text-label text-sm cursor-pointer flex items-center justify-center leading-none p-0"
              >+</button>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1.5 px-2">Base</div>
          {base.map((m) => (
            <ColorSwatch
              key={m.key}
              colorKey={m.key}
              label={m.label}
              value={theme[m.key]}
              expanded={expandedKey === m.key}
              onChange={onUpdateColor}
              onReset={onResetColor}
              onToggle={toggleExpanded}
            />
          ))}
        </div>

        <div className="mb-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1.5 px-2">Normal</div>
          {normal.map((m) => (
            <ColorSwatch
              key={m.key}
              colorKey={m.key}
              label={m.label}
              value={theme[m.key]}
              expanded={expandedKey === m.key}
              onChange={onUpdateColor}
              onReset={onResetColor}
              onToggle={toggleExpanded}
            />
          ))}
        </div>

        <div className="mb-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1.5 px-2">Bright</div>
          {bright.map((m) => (
            <ColorSwatch
              key={m.key}
              colorKey={m.key}
              label={m.label}
              value={theme[m.key]}
              expanded={expandedKey === m.key}
              onChange={onUpdateColor}
              onReset={onResetColor}
              onToggle={toggleExpanded}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-border-subtle">
        <button
          onClick={onReset}
          className="w-full py-1.5 bg-bg-secondary border border-border-faint rounded text-text-muted text-xs cursor-pointer"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
