import type { ReactNode, MouseEvent } from 'react';

interface StatusBadgeProps {
  color: string;
  title: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
  animate?: boolean;
}

/** Hex color to rgba string for drop-shadow. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function StatusBadge({
  color,
  title,
  onClick,
  onDoubleClick,
  children,
  animate = false,
}: StatusBadgeProps) {
  const handleClick = onClick
    ? (e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }
    : undefined;

  return (
    <span
      title={title}
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      className={`flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] font-mono self-center shrink-0 ml-1 select-none${
        onClick || onDoubleClick ? ' cursor-pointer' : ''
      }${animate ? ' animate-pulse-slow' : ''}`}
      style={{
        color,
        borderColor: `${color}4d`,
        backgroundColor: `${color}14`,
        filter: `drop-shadow(0 0 3px ${hexToRgba(color, 0.25)})`,
      }}
    >
      {children}
    </span>
  );
}
