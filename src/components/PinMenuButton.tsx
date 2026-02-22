import { useState } from 'react';
import type { PinnablePanel } from '../types';
import { usePanelContext } from '../contexts/PanelLayoutContext';
import { PinIcon, ArrowLeftIcon, ArrowRightIcon } from './icons';

interface PinMenuButtonProps {
  panel: PinnablePanel;
}

const MAX_PINNED = 3;

export function PinMenuButton({ panel }: PinMenuButtonProps) {
  const { layout, pinPanel } = usePanelContext();
  const [showMenu, setShowMenu] = useState(false);
  const leftFull = layout.left.length >= MAX_PINNED;
  const rightFull = layout.right.length >= MAX_PINNED;

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu((v) => !v)}
        title="Pin panel"
        className="flex items-center rounded text-[10px] cursor-pointer px-1.5 py-[2px] transition-all duration-200 ease-in-out border bg-transparent border-border-dim text-text-dim hover:text-cyan hover:border-cyan/40"
      >
        <PinIcon size={10} />
      </button>
      {showMenu && (
        <div className="absolute top-full right-0 mt-1 z-50 flex flex-col gap-0.5 bg-bg-secondary border border-border rounded-md p-1 shadow-lg min-w-[100px]">
          <button
            onClick={() => { if (!leftFull) { pinPanel(panel, 'left'); setShowMenu(false); } }}
            disabled={leftFull}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors duration-100 ${
              leftFull
                ? 'text-text-dim/40 cursor-not-allowed'
                : 'text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer'
            }`}
          >
            <ArrowLeftIcon size={9} /> Pin Left{leftFull ? ' (full)' : ''}
          </button>
          <button
            onClick={() => { if (!rightFull) { pinPanel(panel, 'right'); setShowMenu(false); } }}
            disabled={rightFull}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors duration-100 ${
              rightFull
                ? 'text-text-dim/40 cursor-not-allowed'
                : 'text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer'
            }`}
          >
            <ArrowRightIcon size={9} /> Pin Right{rightFull ? ' (full)' : ''}
          </button>
        </div>
      )}
    </div>
  );
}
