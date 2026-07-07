/**
 * PopoverMenu — shared chrome for portal-rendered context menus and
 * popovers (map gear menu, quick-button context menu, marker picker).
 * Owns the behavior every copy used to hand-roll and drift on: portal to
 * body, full-screen backdrop (click or right-click closes), Escape to
 * close, and viewport clamping measured from the menu's REAL rendered
 * size (cursor-anchored menus flip to the left of the cursor at the
 * right edge and clamp to the bottom).
 *
 * Anchoring — pass one of:
 *   x/y        viewport coords (cursor menus: right-click, Shift+click)
 *   top/right  right-aligned placement (toolbar-button menus)
 *
 * The box's look is the caller's: pass chrome via className/style; this
 * component only positions it. Interactive children that handle Escape
 * themselves (inline rename inputs) should stopPropagation to keep the
 * menu open.
 */

import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 8;
const CURSOR_GAP = 4;

export interface PopoverMenuProps {
  /** Cursor anchor (viewport coords) — flipped/clamped to stay on screen */
  x?: number;
  y?: number;
  /** Toolbar anchor — top edge + distance from the right viewport edge */
  top?: number;
  right?: number;
  onClose: () => void;
  /** Chrome classes for the menu box */
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function PopoverMenu({
  x,
  y,
  top,
  right,
  onClose,
  className,
  style,
  children,
}: PopoverMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Clamp cursor-anchored menus with the real rendered size, before paint.
  useLayoutEffect(() => {
    if (x === undefined || y === undefined) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x + CURSOR_GAP;
    if (left + rect.width + MARGIN > window.innerWidth) {
      left = Math.max(MARGIN, x - rect.width - CURSOR_GAP);
    }
    let clampedTop = y + CURSOR_GAP;
    if (clampedTop + rect.height + MARGIN > window.innerHeight) {
      clampedTop = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    }
    setClamped({ left, top: clampedTop });
  }, [x, y]);

  const pos: React.CSSProperties =
    x !== undefined && y !== undefined
      ? (clamped ?? { left: x + CURSOR_GAP, top: y + CURSOR_GAP })
      : { top, right };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[10001]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className={`fixed z-[10002] ${className ?? ''}`}
        style={{ ...pos, ...style }}
      >
        {children}
      </div>
    </>,
    document.body
  );
}
