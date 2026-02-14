import { ClassMode } from '../types';
import { ClassModeToggle } from './ClassModeToggle';

interface StatusBarProps {
  connected: boolean;
  statusMessage: string;
  classMode: ClassMode;
  onClassModeChange: (mode: ClassMode) => void;
}

export function StatusBar({ connected, statusMessage, classMode, onClassModeChange }: StatusBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: '#1a1a1a',
        borderBottom: '1px solid #333',
        fontSize: '13px',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: connected ? '#22c55e' : '#ef4444',
          }}
        />
        <span style={{ color: '#ccc' }}>{statusMessage}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <ClassModeToggle classMode={classMode} onClassModeChange={onClassModeChange} />
        <span style={{ color: '#555', fontSize: '11px' }}>v0.1.0</span>
      </div>
    </div>
  );
}
