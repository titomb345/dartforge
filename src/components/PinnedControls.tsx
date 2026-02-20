import type { ReactNode } from 'react';
import type { DockSide } from '../types';
import { PinOffIcon, ArrowLeftIcon, ArrowRightIcon, ChevronUpIcon, ChevronDownIcon } from './icons';

interface PinnedControlsProps {
  side?: DockSide;
  onSwapSide?: () => void;
  canMoveUp?: boolean;
  onMoveUp?: () => void;
  canMoveDown?: boolean;
  onMoveDown?: () => void;
  onUnpin?: () => void;
}

export function HeaderBtn({ onClick, title, children }: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
    >
      {children}
    </button>
  );
}

/**
 * Shared pinned-mode controls for dockable panels:
 * swap side, move up/down, unpin.
 */
export function PinnedControls({
  side,
  onSwapSide,
  canMoveUp,
  onMoveUp,
  canMoveDown,
  onMoveDown,
  onUnpin,
}: PinnedControlsProps) {
  return (
    <>
      {side === 'right' && onSwapSide && (
        <HeaderBtn onClick={onSwapSide} title="Move to left side">
          <ArrowLeftIcon size={9} />
        </HeaderBtn>
      )}
      {canMoveUp && onMoveUp && (
        <HeaderBtn onClick={onMoveUp} title="Move up">
          <ChevronUpIcon size={9} />
        </HeaderBtn>
      )}
      {canMoveDown && onMoveDown && (
        <HeaderBtn onClick={onMoveDown} title="Move down">
          <ChevronDownIcon size={9} />
        </HeaderBtn>
      )}
      {onUnpin && (
        <HeaderBtn onClick={onUnpin} title="Unpin panel">
          <PinOffIcon size={11} />
        </HeaderBtn>
      )}
      {side === 'left' && onSwapSide && (
        <HeaderBtn onClick={onSwapSide} title="Move to right side">
          <ArrowRightIcon size={9} />
        </HeaderBtn>
      )}
    </>
  );
}
