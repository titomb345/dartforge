import { type ReactNode } from 'react';
import { ChevronDownSmallIcon } from './icons';
import { cn } from '../lib/cn';

const GOLD = '#d9af50';

interface HelpSectionProps {
  icon: ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function HelpSection({ icon, title, open, onToggle, children }: HelpSectionProps) {
  return (
    <div className="border border-border-dim rounded overflow-hidden">
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-150',
          'bg-bg-secondary hover:bg-[#252525]',
        )}
        style={{ borderLeft: `2px solid ${open ? GOLD : 'transparent'}` }}
      >
        <span style={{ color: GOLD }} className="shrink-0">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-label flex-1 text-left">
          {title}
        </span>
        <span
          className="text-text-dim transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <ChevronDownSmallIcon size={12} />
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-3 py-2 space-y-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
