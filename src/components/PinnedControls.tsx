import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { PinnablePanel } from '../types';
import { usePinnedControls } from '../contexts/PinnedControlsContext';
import {
  PinOffIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  SwapHorizontalIcon,
  TrendingUpIcon,
  ChatIcon,
  CounterIcon,
  NotesIcon,
  // MapIcon, // automapper disabled
  AllocIcon,
  CoinIcon,
  BabelIcon,
  WhoIcon,
} from './icons';

const PANEL_INFO: Record<PinnablePanel, { label: string; icon: ReactNode }> = {
  skills: { label: 'Skills', icon: <TrendingUpIcon size={10} /> },
  chat: { label: 'Chat', icon: <ChatIcon size={10} /> },
  counter: { label: 'Counters', icon: <CounterIcon size={10} /> },
  notes: { label: 'Notes', icon: <NotesIcon size={10} /> },
  // map: { label: 'Map', icon: <MapIcon size={10} /> }, // automapper disabled
  alloc: { label: 'Allocations', icon: <AllocIcon size={10} /> },
  currency: { label: 'Currency', icon: <CoinIcon size={10} /> },
  babel: { label: 'Babel', icon: <BabelIcon size={10} /> },
  who: { label: 'Who', icon: <WhoIcon size={10} /> },
};

export function HeaderBtn({
  onClick,
  title,
  children,
}: {
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

function SwapPicker({
  side,
  otherSidePanels,
  onSwapWith,
}: {
  side: 'left' | 'right';
  otherSidePanels: PinnablePanel[];
  onSwapWith: (target: PinnablePanel) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: side === 'left' ? rect.left : rect.right,
    });
  }, [side]);

  useEffect(() => {
    if (!open) return;
    updatePos();
    function handleClickOutside(e: MouseEvent) {
      if (
        btnRef.current &&
        !btnRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, updatePos]);

  const dirLabel = side === 'left' ? 'right' : 'left';

  return (
    <div ref={btnRef}>
      <HeaderBtn
        onClick={() => {
          updatePos();
          setOpen((v) => !v);
        }}
        title={`Swap with ${dirLabel} panel`}
      >
        <SwapHorizontalIcon size={9} />
      </HeaderBtn>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] flex flex-col gap-0.5 bg-bg-secondary border border-border rounded-md p-1 shadow-lg min-w-[120px]"
            data-panel-dropdown
            style={{
              top: pos.top,
              ...(side === 'left' ? { left: pos.left } : { right: window.innerWidth - pos.left }),
            }}
          >
            <div className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-text-dim select-none">
              Swap with
            </div>
            {otherSidePanels.map((targetId) => {
              const info = PANEL_INFO[targetId];
              return (
                <button
                  key={targetId}
                  onClick={() => {
                    onSwapWith(targetId);
                    setOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer transition-colors duration-100"
                >
                  <span className="text-text-dim">{info.icon}</span>
                  {info.label}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * Shared pinned-mode controls for dockable panels:
 * swap side, move up/down, unpin.
 * Reads all state from PinnedControlsContext.
 */
export function PinnedControls() {
  const ctx = usePinnedControls();
  if (!ctx) return null;

  const {
    side,
    onSwapSide,
    canMoveUp,
    onMoveUp,
    canMoveDown,
    onMoveDown,
    onUnpin,
    otherSidePanels,
    onSwapWith,
  } = ctx;

  const swapButton = onSwapSide ? (
    <HeaderBtn
      onClick={onSwapSide}
      title={side === 'right' ? 'Move to left side' : 'Move to right side'}
    >
      {side === 'right' ? <ArrowLeftIcon size={9} /> : <ArrowRightIcon size={9} />}
    </HeaderBtn>
  ) : otherSidePanels && otherSidePanels.length > 0 && onSwapWith ? (
    <SwapPicker side={side} otherSidePanels={otherSidePanels} onSwapWith={onSwapWith} />
  ) : null;

  return (
    <>
      {side === 'right' && swapButton}
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
      {side === 'left' && swapButton}
    </>
  );
}
