import { cn } from '../lib/cn';

interface ResizeHandleProps {
  side: 'left' | 'right';
  onMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
}

export function ResizeHandle({ side, onMouseDown, isDragging }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'w-1 flex-shrink-0 cursor-col-resize transition-colors duration-150 rounded-full self-stretch',
        isDragging ? 'bg-cyan/40' : 'bg-transparent hover:bg-border',
      )}
      style={{
        marginLeft: side === 'left' ? -2 : 0,
        marginRight: side === 'right' ? -2 : 0,
      }}
    />
  );
}
