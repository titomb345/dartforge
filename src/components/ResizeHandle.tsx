import { cn } from '../lib/cn';

interface ResizeHandleProps {
  side: 'left' | 'right';
  onMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
  /** Panel is at its viewport-constrained maximum width */
  constrained?: boolean;
  /** Collapse the panel on this side to icon strip */
  onCollapse?: () => void;
}

export function ResizeHandle({
  side,
  onMouseDown,
  isDragging,
  constrained,
  onCollapse,
}: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'group relative w-1 flex-shrink-0 cursor-col-resize transition-colors duration-150 rounded-full self-stretch',
        isDragging
          ? 'bg-cyan/40'
          : constrained
            ? 'bg-amber/30 hover:bg-amber/50'
            : 'bg-transparent hover:bg-border'
      )}
      title={constrained ? 'Panel width limited by window size' : undefined}
      style={{
        marginLeft: side === 'left' ? -2 : 0,
        marginRight: side === 'right' ? -2 : 0,
      }}
    >
      {onCollapse && (
        <button
          onMouseDown={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          className={cn(
            'absolute top-1/2 -translate-y-1/2 z-10',
            'w-4 h-8 flex items-center justify-center',
            'rounded bg-bg-primary border border-border-subtle shadow-md',
            'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
            'cursor-pointer hover:bg-bg-secondary',
            side === 'left' ? '-right-1.5' : '-left-1.5'
          )}
          title="Collapse to icons"
        >
          <svg
            width="8"
            height="12"
            viewBox="0 0 8 12"
            fill="none"
            className="text-text-secondary"
          >
            <path
              d={side === 'left' ? 'M6 1L1 6L6 11' : 'M2 1L7 6L2 11'}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
