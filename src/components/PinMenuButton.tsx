import { useState } from 'react';
import type { DockSide } from '../types';
import { PinIcon, ArrowLeftIcon, ArrowRightIcon } from './icons';

interface PinMenuButtonProps {
  onPin: (side: DockSide) => void;
}

export function PinMenuButton({ onPin }: PinMenuButtonProps) {
  const [showMenu, setShowMenu] = useState(false);

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
            onClick={() => { onPin('left'); setShowMenu(false); }}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer transition-colors duration-100"
          >
            <ArrowLeftIcon size={9} /> Pin Left
          </button>
          <button
            onClick={() => { onPin('right'); setShowMenu(false); }}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer transition-colors duration-100"
          >
            <ArrowRightIcon size={9} /> Pin Right
          </button>
        </div>
      )}
    </div>
  );
}
