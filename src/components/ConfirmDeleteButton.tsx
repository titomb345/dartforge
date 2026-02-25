import type { ReactNode } from 'react';
import { useState } from 'react';
import { TrashIcon } from './icons';

interface ConfirmDeleteButtonProps {
  onDelete: () => void;
  size?: number;
  className?: string;
  variant?: 'row' | 'fixed';
  /** Override the default "Del?" confirmation label. */
  confirmText?: string;
  /** Override the default trash icon (pre-rendered ReactNode). */
  icon?: ReactNode;
  /** Tooltip for the default (non-confirming) state. */
  title?: string;
}

export function ConfirmDeleteButton({
  onDelete,
  size = 9,
  className,
  variant = 'row',
  confirmText = 'Del?',
  icon,
  title: titleProp,
}: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);

  const defaultTitle = titleProp ?? 'Delete';
  const renderedIcon = icon ?? <TrashIcon size={size} />;

  if (confirming) {
    return (
      <button
        onClick={(e) => {
          if (variant === 'row') e.stopPropagation();
          onDelete();
          setConfirming(false);
        }}
        onBlur={() => setConfirming(false)}
        className={`text-[8px] font-mono text-red border border-red/40 rounded px-1 py-px cursor-pointer hover:bg-red/10 shrink-0 transition-colors duration-150 ${className ?? ''}`}
      >
        {confirmText}
      </button>
    );
  }

  if (variant === 'fixed') {
    return (
      <button
        onClick={() => setConfirming(true)}
        className={`flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-red cursor-pointer transition-colors ${className ?? ''}`}
        title={defaultTitle}
      >
        {renderedIcon}
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setConfirming(true);
      }}
      title={defaultTitle}
      className={`w-0 overflow-hidden opacity-0 group-hover:w-4 group-hover:opacity-100 shrink-0 flex items-center justify-center text-text-dim hover:text-red cursor-pointer transition-all duration-150 ${className ?? ''}`}
    >
      {renderedIcon}
    </button>
  );
}
