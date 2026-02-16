import { ClassMode } from '../types';
import { CLASS_MODES, CLASS_COLORS } from '../lib/constants';
import { cn } from '../lib/cn';

interface ClassModeToggleProps {
  classMode: ClassMode;
  onClassModeChange: (mode: ClassMode) => void;
}

export function ClassModeToggle({ classMode, onClassModeChange }: ClassModeToggleProps) {
  return (
    <div className="flex gap-0.5">
      {CLASS_MODES.map((mode) => {
        const isActive = classMode === mode.key;
        const color = CLASS_COLORS[mode.key];
        return (
          <button
            key={mode.key}
            onClick={() => onClassModeChange(mode.key)}
            title={mode.label}
            className={cn(
              'px-2 py-0.5 text-xs font-semibold rounded-[3px] cursor-pointer transition-all duration-150 ease-in-out border',
              isActive
                ? 'text-bg-primary'
                : 'bg-transparent text-text-muted border-border'
            )}
            style={isActive ? { background: color, borderColor: color } : { '--class-color': color } as React.CSSProperties}
          >
            {mode.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
