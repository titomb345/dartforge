import { type CSSProperties, useState, useEffect, useRef } from 'react';
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

  const container: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 0.15s',
    background: expanded ? '#1a1a1a' : 'transparent',
  };

  const swatch: CSSProperties = {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: '1px solid #444',
    background: value,
    flexShrink: 0,
  };

  const labelStyle: CSSProperties = {
    fontSize: '12px',
    color: '#aaa',
    flex: 1,
    whiteSpace: 'nowrap',
  };

  const hexStyle: CSSProperties = {
    fontSize: '11px',
    fontFamily: 'monospace',
    color: isDefault ? '#666' : '#8be9fd',
  };

  const resetStyle: CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#555',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
    visibility: isDefault ? 'hidden' : 'visible',
    flexShrink: 0,
  };

  return (
    <div>
      <div
        style={container}
        onClick={() => {
          if (expanded) editingRef.current = false;
          onToggle(colorKey);
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = '#1a1a1a';
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        <div style={swatch} />
        <span style={labelStyle}>{label}</span>
        <span style={hexStyle}>{value}</span>
        <button
          style={resetStyle}
          title="Reset to default"
          onClick={(e) => {
            e.stopPropagation();
            onReset(colorKey);
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#aaa')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
        >
          ↺
        </button>
      </div>
      <div
        style={{
          maxHeight: expanded ? '220px' : '0px',
          opacity: expanded ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.25s ease, opacity 0.2s ease',
        }}
      >
        <div
          style={{
            padding: '8px 8px 12px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <HexColorPicker
            color={previewColor}
            onChange={(c) => {
              editingRef.current = false;
              onChange(colorKey, c);
            }}
            style={{ width: '100%', height: '140px' }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              background: '#111',
              border: '1px solid #333',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                padding: '4px 0 4px 10px',
                color: '#555',
                fontSize: '12px',
                fontFamily: 'monospace',
                userSelect: 'none',
              }}
            >
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
              style={{
                flex: 1,
                padding: '4px 10px 4px 2px',
                background: 'transparent',
                border: 'none',
                color: '#ccc',
                fontSize: '12px',
                fontFamily: 'monospace',
                textAlign: 'center',
                outline: 'none',
              }}
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

  const section: CSSProperties = {
    marginBottom: '16px',
  };

  const sectionLabel: CSSProperties = {
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#555',
    marginBottom: '6px',
    padding: '0 8px',
  };

  return (
    <div
      style={{
        width: '280px',
        height: '100%',
        background: '#0d0d0d',
        borderLeft: '1px solid #1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid #1a1a1a',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#ccc' }}>Appearance</span>
        <button
          onClick={onToggleDebug}
          title="Show ANSI color names in terminal output"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: debugMode ? '#f59e0b18' : 'transparent',
            border: `1px solid ${debugMode ? '#f59e0b44' : '#2a2a2a'}`,
            borderRadius: '4px',
            color: debugMode ? '#f59e0b' : '#666',
            fontSize: '11px',
            cursor: 'pointer',
            padding: '3px 8px',
            transition: 'all 0.2s ease',
          }}
        >
          <span style={{ fontSize: '13px', lineHeight: 1 }}>{'</>'}</span>
          Debug
        </button>
      </div>

      {/* Settings list */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 4px' }}>
        {/* Display section */}
        <div style={section}>
          <div style={sectionLabel}>Display</div>

          {/* Font family */}
          <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#aaa', flex: 1 }}>Font</span>
            {display.fontFamily !== DEFAULT_DISPLAY.fontFamily && (
              <button
                onClick={() => onResetDisplay('fontFamily')}
                style={{ background: 'none', border: 'none', color: '#555', fontSize: '14px', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                title="Reset to default"
                onMouseEnter={(e) => (e.currentTarget.style.color = '#aaa')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
              >↺</button>
            )}
            <select
              value={display.fontFamily}
              onChange={(e) => onUpdateDisplay('fontFamily', e.target.value)}
              style={{
                background: '#111',
                border: '1px solid #333',
                borderRadius: '4px',
                color: '#ccc',
                fontSize: '11px',
                padding: '3px 6px',
                outline: 'none',
                cursor: 'pointer',
                fontFamily: display.fontFamily,
              }}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>

          {/* Font size */}
          <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#aaa', flex: 1 }}>Size</span>
            {display.fontSize !== DEFAULT_DISPLAY.fontSize && (
              <button
                onClick={() => onResetDisplay('fontSize')}
                style={{ background: 'none', border: 'none', color: '#555', fontSize: '14px', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                title="Reset to default"
                onMouseEnter={(e) => (e.currentTarget.style.color = '#aaa')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
              >↺</button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={() => onUpdateDisplay('fontSize', Math.max(8, display.fontSize - 1))}
                style={{
                  width: '22px', height: '22px',
                  background: '#111', border: '1px solid #333', borderRadius: '4px',
                  color: '#aaa', fontSize: '14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, padding: 0,
                }}
              >−</button>
              <span style={{
                fontSize: '12px', fontFamily: 'monospace', color: '#ccc',
                minWidth: '28px', textAlign: 'center',
              }}>{display.fontSize}px</span>
              <button
                onClick={() => onUpdateDisplay('fontSize', Math.min(28, display.fontSize + 1))}
                style={{
                  width: '22px', height: '22px',
                  background: '#111', border: '1px solid #333', borderRadius: '4px',
                  color: '#aaa', fontSize: '14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, padding: 0,
                }}
              >+</button>
            </div>
          </div>
        </div>

        <div style={section}>
          <div style={sectionLabel}>Base</div>
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

        <div style={section}>
          <div style={sectionLabel}>Normal</div>
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

        <div style={section}>
          <div style={sectionLabel}>Bright</div>
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
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid #1a1a1a',
        }}
      >
        <button
          onClick={onReset}
          style={{
            width: '100%',
            padding: '6px',
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderRadius: '4px',
            color: '#888',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
