import { useState } from 'react';
import { cn } from '../lib/cn';
import { EyeOffIcon } from './icons';

interface StatusReadoutProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  tooltip: string;
  glow?: boolean;
  compact?: boolean;
  /** When true, hover always expands even if user-compacted (overflow mode) */
  autoCompact?: boolean;
  /**
   * The readout's output lines are gagged from the terminal. Dims the whole
   * readout and shows a slashed-eye badge next to the icon so the state is
   * visible at a glance, even when compact.
   */
  filtered?: boolean;
  danger?: boolean;
  /** Optional custom label rendering (e.g., rainbow text) — overrides plain label */
  labelNode?: React.ReactNode;
  onClick?: () => void;
  /**
   * Right-click handler. When provided it replaces the legacy
   * right-click-toggles-compact behavior (the caller is expected to open a
   * menu instead). `preventDefault` is already called.
   */
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Legacy: right-click toggles compact when no `onContextMenu` is given */
  onToggleCompact?: () => void;
}

export function StatusReadout({
  icon,
  label,
  color,
  tooltip,
  glow,
  compact,
  autoCompact,
  filtered,
  danger,
  labelNode,
  onClick,
  onContextMenu,
  onToggleCompact,
}: StatusReadoutProps) {
  const [hovered, setHovered] = useState(false);
  const showExpanded = !compact || (hovered && !!autoCompact);

  const handleContextMenu =
    onContextMenu || onToggleCompact
      ? (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          if (onContextMenu) onContextMenu(e);
          else onToggleCompact?.();
        }
      : undefined;

  return (
    <button
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={tooltip}
      aria-pressed={filtered === undefined ? undefined : filtered}
      className={cn(
        'status-readout relative flex items-center rounded-[3px] select-none border border-transparent transition-all duration-200',
        onClick || handleContextMenu ? 'cursor-pointer' : 'cursor-default',
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
          opacity: filtered ? 0.55 : 1,
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

      {filtered && (
        <span
          className="flex items-center ml-1 text-text-muted"
          aria-label="Lines hidden from output"
        >
          <EyeOffIcon size={9} />
        </span>
      )}

      <span
        className="text-[11px] leading-none tracking-wide uppercase overflow-hidden whitespace-nowrap transition-all duration-200"
        style={{
          color: labelNode ? undefined : color,
          maxWidth: showExpanded ? 200 : 0,
          opacity: showExpanded ? 1 : 0,
          marginLeft: showExpanded ? 6 : 0,
        }}
      >
        {labelNode ?? label}
      </span>
    </button>
  );
}
