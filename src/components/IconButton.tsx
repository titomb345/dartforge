import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

interface IconButtonProps {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  toggled?: boolean;
  pinned?: boolean;
  accent?: string;
  onClick: () => void;
}

export function IconButton({
  icon,
  title,
  disabled,
  toggled,
  pinned,
  accent = '#8be9fd',
  onClick,
}: IconButtonProps) {
  const on = toggled === true;
  const isPinned = pinned === true;

  return (
    <button
      onClick={onClick}
      disabled={disabled || isPinned}
      title={isPinned ? `${title} (pinned)` : title}
      className={cn(
        'icon-btn flex items-center justify-center w-[30px] h-[30px] p-0 rounded-[6px]',
        'select-none leading-none transition-all duration-200 ease-in-out border',
        isPinned && 'icon-btn-pinned cursor-default',
        !isPinned && disabled && 'cursor-default text-text-disabled border-border-dim',
        !isPinned && !disabled && !on && 'cursor-pointer text-text-dim border-border-faint',
        !isPinned && !disabled && on && 'icon-btn-on cursor-pointer',
      )}
      style={{ '--btn-accent': accent } as React.CSSProperties}
    >
      {icon}
    </button>
  );
}
