import { ClassMode } from '../types';
import { ClassModeToggle } from './ClassModeToggle';
import { cn } from '../lib/cn';

interface StatusBarProps {
  connected: boolean;
  statusMessage: string;
  classMode: ClassMode;
  onClassModeChange: (mode: ClassMode) => void;
}

export function StatusBar({ connected, statusMessage, classMode, onClassModeChange }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-bg-secondary border-b border-border text-[13px] select-none">
      <div className="flex items-center gap-2">
        <span className={cn('inline-block w-2 h-2 rounded-full', connected ? 'bg-connected' : 'bg-disconnected')} />
        <span className="text-text-heading">{statusMessage}</span>
      </div>
      <div className="flex items-center gap-3">
        <ClassModeToggle classMode={classMode} onClassModeChange={onClassModeChange} />
        <span className="text-text-dim text-[11px]">v0.1.0</span>
      </div>
    </div>
  );
}
