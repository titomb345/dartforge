import { ClassMode } from '../types';
import { CLASS_MODES, CLASS_COLORS } from '../lib/constants';

interface ClassModeToggleProps {
  classMode: ClassMode;
  onClassModeChange: (mode: ClassMode) => void;
}

export function ClassModeToggle({ classMode, onClassModeChange }: ClassModeToggleProps) {
  return (
    <div style={{ display: 'flex', gap: '2px' }}>
      {CLASS_MODES.map((mode) => {
        const isActive = classMode === mode.key;
        const color = CLASS_COLORS[mode.key];
        return (
          <button
            key={mode.key}
            onClick={() => onClassModeChange(mode.key)}
            title={mode.label}
            style={{
              padding: '2px 8px',
              fontSize: '12px',
              fontWeight: 600,
              border: `1px solid ${isActive ? color : '#333'}`,
              borderRadius: '3px',
              background: isActive ? color : 'transparent',
              color: isActive ? '#0d0d0d' : '#888',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {mode.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
