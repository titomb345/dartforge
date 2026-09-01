import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

interface IconButtonProps {
  icon: ReactNode;
  title: string;
  /**
   * Short name shown under the icon. Makes the button readable without a
   * tooltip; the toolbar hides labels when it is too narrow to fit them.
   */
  label?: string;
  /** Tiny key printed in the corner (the panel's shortcut digit or letter). */
  hint?: string;
  disabled?: boolean;
  toggled?: boolean;
  pinned?: boolean;
  accent?: string;
  helpId?: string;
  panelId?: string;
  onClick: () => void;
}

export function IconButton({
  icon,
  title,
  label,
  hint,
  disabled,
  toggled,
  pinned,
  accent = '#8be9fd',
  helpId,
  panelId,
  onClick,
}: IconButtonProps) {
  const on = toggled === true;
  const isPinned = pinned === true;

  return (
    <button
      onClick={onClick}
      disabled={disabled || isPinned}
      title={isPinned ? `${title} (pinned)` : title}
      data-help-id={helpId}
      data-panel={panelId}
      className={cn(
        'icon-btn relative flex flex-col items-center justify-center rounded-[6px] border',
        'select-none leading-none transition-all duration-200 ease-in-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--btn-accent)]',
        label ? 'icon-btn-labeled h-10 min-w-10 px-1.5 gap-[3px]' : 'w-[30px] h-[30px] p-0',
        isPinned && 'icon-btn-pinned cursor-default',
        !isPinned && disabled && 'cursor-default text-text-disabled border-border-dim',
        !isPinned && !disabled && !on && 'icon-btn-rest cursor-pointer border-transparent',
        !isPinned && !disabled && on && 'icon-btn-on cursor-pointer'
      )}
      style={{ '--btn-accent': accent } as React.CSSProperties}
    >
      {icon}
      {label && <span className="toolbar-label">{label}</span>}
      {hint && (
        <span className="toolbar-hint" aria-hidden="true">
          {hint}
        </span>
      )}
    </button>
  );
}
