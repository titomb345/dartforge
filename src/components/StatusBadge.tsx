import type { ReactNode, MouseEvent } from 'react';
import { cn } from '../lib/cn';

/**
 * running   = something you started (autocast, babel, a movement mode):
 *             filled chip with a glowing dot.
 * scheduled = a refresher or timer ticking on a clock (who refresh, anti-idle,
 *             custom timers): outlined, quieter.
 */
export type StatusBadgeKind = 'running' | 'scheduled';

interface StatusBadgeProps {
  color: string;
  title: string;
  kind?: StatusBadgeKind;
  /** Click on the chip body, for things like cycling a mode. Never used to stop. */
  onClick?: () => void;
  /**
   * Shows the × on the chip. Clicking it is the one way to stop anything from
   * a chip, so every chip that can be stopped looks and works the same.
   */
  onStop?: () => void;
  stopTitle?: string;
  children: ReactNode;
  /** Pulse the dot (running chips only). */
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
  kind = 'running',
  onClick,
  onStop,
  stopTitle,
  children,
  animate = false,
}: StatusBadgeProps) {
  const running = kind === 'running';
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
      className={cn(
        'status-chip flex items-center gap-1 pl-1.5 py-[2px] rounded border text-[9px] font-mono',
        'self-center shrink-0 ml-1 select-none whitespace-nowrap',
        onStop ? 'pr-0.5' : 'pr-1.5',
        onClick && 'cursor-pointer',
        running ? 'status-chip-running' : 'status-chip-scheduled'
      )}
      style={
        running
          ? {
              color,
              borderColor: `${color}4d`,
              backgroundColor: `${color}14`,
              filter: `drop-shadow(0 0 3px ${hexToRgba(color, 0.25)})`,
            }
          : {
              color: `color-mix(in srgb, ${color} 80%, var(--color-text-dim))`,
              borderColor: `${color}33`,
            }
      }
    >
      {running && (
        <span className={cn('chip-dot', animate && 'animate-pulse-slow')} aria-hidden="true" />
      )}
      {children}
      {onStop && (
        <button
          type="button"
          title={stopTitle ?? 'Stop'}
          aria-label={stopTitle ?? 'Stop'}
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          className="chip-stop"
        >
          ×
        </button>
      )}
    </span>
  );
}
