import type { ReactNode } from 'react';
import type { PinnablePanel } from '../types';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';

export interface PanelHeaderProps {
  icon: ReactNode;
  title: string;
  /** Optional badge rendered after the title (e.g. player count) */
  badge?: ReactNode;
  /** Pinnable panel ID — enables PinMenuButton in slideout mode */
  panel?: PinnablePanel;
  mode?: 'slideout' | 'pinned';
  /** Close handler — enables × button (for slideout-only panels) */
  onClose?: () => void;
  /** Toolbar contents rendered in a second row below the title */
  children?: ReactNode;
}

export function PanelHeader({
  icon,
  title,
  badge,
  panel,
  mode = 'slideout',
  onClose,
  children,
}: PanelHeaderProps) {
  const isPinned = mode === 'pinned';

  return (
    <>
      {/* Row 1: Title + standard controls */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5">
          {icon} {title}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {badge}
          {isPinned && panel && <PinnedControls />}
          {!isPinned && panel && <PinMenuButton panel={panel} />}
          {onClose && (
            <button
              onClick={onClose}
              title="Close"
              className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150 text-[13px]"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Panel-specific toolbar */}
      {children && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle shrink-0">
          {children}
        </div>
      )}
    </>
  );
}
