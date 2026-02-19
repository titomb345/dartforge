import { useState } from 'react';
import { useDoubleClick } from '../hooks/useDoubleClick';
import { cn } from '../lib/cn';

interface StatusReadoutProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  tooltip: string;
  glow?: boolean;
  compact?: boolean;
  /** When true, hover always expands even if user-compacted (overflow mode) */
  autoCompact?: boolean;
  filtered?: boolean;
  danger?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

export function StatusReadout({ icon, label, color, tooltip, glow, compact, autoCompact, filtered, danger, onClick, onDoubleClick }: StatusReadoutProps) {
  const [hovered, setHovered] = useState(false);
  const showExpanded = !compact || (hovered && !!autoCompact);
  const handleClick = useDoubleClick(onClick, onDoubleClick);

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={tooltip}
      className={cn(
        'status-readout relative flex items-center rounded-[3px] select-none border border-transparent transition-all duration-200',
        (onClick || onDoubleClick) ? 'cursor-pointer' : 'cursor-default',
        danger && !filtered && 'status-readout-danger'
      )}
      style={
        {
          '--readout-color': color,
          paddingLeft: showExpanded ? 8 : 6,
          paddingRight: showExpanded ? 10 : 6,
          paddingTop: 3,
          paddingBottom: 3,
          borderLeftWidth: 2,
          borderLeftColor: color,
          borderLeftStyle: filtered ? 'dashed' : 'solid',
        } as React.CSSProperties
      }
    >
      <span
        className="flex items-center transition-all duration-200"
        style={{
          color,
          filter: glow && !filtered ? `drop-shadow(0 0 3px ${color})` : 'none',
        }}
      >
        {icon}
      </span>

      <span
        className="text-[11px] leading-none tracking-wide uppercase overflow-hidden whitespace-nowrap transition-all duration-200"
        style={{
          color,
          maxWidth: showExpanded ? 200 : 0,
          opacity: showExpanded ? 1 : 0,
          marginLeft: showExpanded ? 6 : 0,
        }}
      >
        {label}
      </span>
    </button>
  );
}
