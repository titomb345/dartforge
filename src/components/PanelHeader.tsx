import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import type { PinnablePanel } from '../types';
import { usePanelContext } from '../contexts/PanelLayoutContext';
import { cn } from '../lib/cn';
import { PinnedControls } from './PinnedControls';
import { PopoverMenu } from './PopoverMenu';
import { PinIcon, ArrowLeftIcon, ArrowRightIcon, XIcon } from './icons';

const MAX_PINNED = 3;

export interface PanelHeaderProps {
  icon: ReactNode;
  title: string;
  /** Optional badge rendered after the title (e.g. player count) */
  badge?: ReactNode;
  /** Pinnable panel ID — enables the pin control in slideout mode */
  panel?: PinnablePanel;
  mode?: 'slideout' | 'pinned';
  /** Close handler — enables the close button (for slideout-only panels) */
  onClose?: () => void;
  /** Toolbar contents rendered in a second row below the title */
  children?: ReactNode;
}

/**
 * 24x24 header control sharing IconButton's rest/hover treatment
 * (.icon-btn / .icon-btn-rest / .icon-btn-on in index.css).
 */
function HeaderControl({
  title,
  onClick,
  active = false,
  accent = '#8be9fd',
  children,
}: {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  accent?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'icon-btn flex items-center justify-center w-6 h-6 p-0 rounded-[6px] border cursor-pointer',
        'select-none leading-none transition-all duration-200 ease-in-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--btn-accent)]',
        active ? 'icon-btn-on' : 'icon-btn-rest border-transparent'
      )}
      style={{ '--btn-accent': accent } as React.CSSProperties}
    >
      {children}
    </button>
  );
}

function PinControl({ panel }: { panel: PinnablePanel }) {
  const { layout, pinPanel } = usePanelContext();
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const leftFull = layout.left.length >= MAX_PINNED;
  const rightFull = layout.right.length >= MAX_PINNED;

  const closeMenu = useCallback(() => setMenuPos(null), []);

  const pin = (side: 'left' | 'right') => {
    pinPanel(panel, side);
    setMenuPos(null);
  };

  const itemClass =
    'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors duration-100';
  const itemState = (full: boolean) =>
    full
      ? 'text-text-dim/40 cursor-not-allowed'
      : 'text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer';

  return (
    <>
      <HeaderControl
        title="Pin panel"
        active={menuPos !== null}
        onClick={(e) => {
          if (menuPos) {
            setMenuPos(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
        }}
      >
        <PinIcon size={12} />
      </HeaderControl>
      {menuPos && (
        <PopoverMenu
          top={menuPos.top}
          right={menuPos.right}
          onClose={closeMenu}
          className="flex flex-col gap-0.5 bg-bg-secondary border border-border rounded-md p-1 shadow-lg min-w-[100px]"
        >
          <button
            type="button"
            onClick={() => !leftFull && pin('left')}
            disabled={leftFull}
            className={`${itemClass} ${itemState(leftFull)}`}
          >
            <ArrowLeftIcon size={9} /> Pin Left{leftFull ? ' (full)' : ''}
          </button>
          <button
            type="button"
            onClick={() => !rightFull && pin('right')}
            disabled={rightFull}
            className={`${itemClass} ${itemState(rightFull)}`}
          >
            <ArrowRightIcon size={9} /> Pin Right{rightFull ? ' (full)' : ''}
          </button>
        </PopoverMenu>
      )}
    </>
  );
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
      {/* Row 1: Title + standard controls. py-2 + 24px controls keeps the
          row at the same 40px it had with py-2.5 + 20px controls. */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5">
          {icon} {title}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 min-h-6">
          {badge}
          {isPinned && panel && <PinnedControls />}
          {!isPinned && panel && <PinControl panel={panel} />}
          {onClose && (
            <HeaderControl title="Close" onClick={onClose}>
              <XIcon size={12} />
            </HeaderControl>
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
