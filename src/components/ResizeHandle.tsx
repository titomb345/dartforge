import { cn } from '../lib/cn';

interface ResizeHandleProps {
  side: 'left' | 'right';
  onMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
  /** Panel is at its viewport-constrained maximum width */
  constrained?: boolean;
}

export function ResizeHandle({ side, onMouseDown, isDragging, constrained }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'w-1 flex-shrink-0 cursor-col-resize transition-colors duration-150 rounded-full self-stretch',
        isDragging ? 'bg-cyan/40' : constrained ? 'bg-amber/30 hover:bg-amber/50' : 'bg-transparent hover:bg-border',
      )}
      title={constrained ? 'Panel width limited by window size' : undefined}
      style={{
        marginLeft: side === 'left' ? -2 : 0,
        marginRight: side === 'right' ? -2 : 0,
      }}
    />
  );
}
