import type { ReactNode } from 'react';
import type { DockSide } from '../types';
import { PinOffIcon, ArrowLeftIcon, ArrowRightIcon } from './icons';

interface PinnedPanelWrapperProps {
  title: string;
  side: DockSide;
  accent?: string;
  onUnpin: () => void;
  onSwapSide: () => void;
  children: ReactNode;
}

export function PinnedPanelWrapper({ title, side, accent = '#8be9fd', onUnpin, onSwapSide, children }: PinnedPanelWrapperProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle shrink-0"
        style={{ background: 'linear-gradient(to bottom, #1e1e1e, #1a1a1a)' }}
      >
        <span className="text-[12px] font-semibold text-text-heading">{title}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onSwapSide}
            title={side === 'left' ? 'Move to right side' : 'Move to left side'}
            className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
          >
            {side === 'left' ? <ArrowRightIcon size={9} /> : <ArrowLeftIcon size={9} />}
          </button>
          <button
            onClick={onUnpin}
            title="Unpin panel"
            className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
            style={{ '--btn-accent': accent } as React.CSSProperties}
          >
            <PinOffIcon size={11} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden min-h-0">
        {children}
      </div>
    </div>
  );
}
