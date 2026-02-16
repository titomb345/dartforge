import { type CSSProperties, useRef } from 'react';
import {
  THEME_COLOR_META,
  DEFAULT_THEME,
  type TerminalTheme,
  type ThemeColorKey,
} from '../lib/defaultTheme';

interface ColorSettingsProps {
  theme: TerminalTheme;
  onUpdateColor: (key: ThemeColorKey, value: string) => void;
  onResetColor: (key: ThemeColorKey) => void;
  onReset: () => void;
  debugMode: boolean;
  onToggleDebug: () => void;
}

function ColorSwatch({
  colorKey,
  label,
  value,
  onChange,
  onReset,
}: {
  colorKey: ThemeColorKey;
  label: string;
  value: string;
  onChange: (key: ThemeColorKey, value: string) => void;
  onReset: (key: ThemeColorKey) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isDefault = value === DEFAULT_THEME[colorKey];

  const container: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 0.15s',
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
    <div
      style={container}
      onClick={() => inputRef.current?.click()}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1a')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(colorKey, e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}

export function ColorSettings({ theme, onUpdateColor, onResetColor, onReset, debugMode, onToggleDebug }: ColorSettingsProps) {
  const base = THEME_COLOR_META.filter((m) => m.group === 'base');
  const normal = THEME_COLOR_META.filter((m) => m.group === 'normal');
  const bright = THEME_COLOR_META.filter((m) => m.group === 'bright');

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
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#ccc' }}>Colors</span>
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

      {/* Color list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 4px' }}>
        <div style={section}>
          <div style={sectionLabel}>Base</div>
          {base.map((m) => (
            <ColorSwatch
              key={m.key}
              colorKey={m.key}
              label={m.label}
              value={theme[m.key]}
              onChange={onUpdateColor}
              onReset={onResetColor}
            />
          ))}
        </div>

        <div style={section}>
          <div style={sectionLabel}>Normal (0-7)</div>
          {normal.map((m) => (
            <ColorSwatch
              key={m.key}
              colorKey={m.key}
              label={m.label}
              value={theme[m.key]}
              onChange={onUpdateColor}
              onReset={onResetColor}
            />
          ))}
        </div>

        <div style={section}>
          <div style={sectionLabel}>Bright (8-15)</div>
          {bright.map((m) => (
            <ColorSwatch
              key={m.key}
              colorKey={m.key}
              label={m.label}
              value={theme[m.key]}
              onChange={onUpdateColor}
              onReset={onResetColor}
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
