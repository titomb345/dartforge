import { cn } from '../lib/cn';

interface VerticalResizeHandleProps {
  index: number;
  onMouseDown: (index: number, e: React.MouseEvent) => void;
  isDragging: boolean;
}

export function VerticalResizeHandle({
  index,
  onMouseDown,
  isDragging,
}: VerticalResizeHandleProps) {
  return (
    <div
      onMouseDown={(e) => onMouseDown(index, e)}
      className={cn(
        'h-1 flex-shrink-0 cursor-row-resize transition-colors duration-150 rounded-full',
        isDragging ? 'bg-cyan/40' : 'bg-transparent hover:bg-border'
      )}
    />
  );
}
