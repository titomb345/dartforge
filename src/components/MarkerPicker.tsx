/**
 * MarkerPicker — the Shift+click popover for choosing a landmark marker
 * (hex map) or room icon (town map). Renders through a portal at viewport
 * coords like the map tooltips, with a full-screen backdrop that closes it.
 * Each option shows its actual canvas glyph, so what you pick is exactly
 * what the map draws.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { paintMarkerGlyph, type MarkerGlyph } from '../lib/mapMarkers';

const PICKER_BG = 'rgba(20, 18, 16, 0.97)';
const PICKER_BORDER = 'rgba(140, 125, 100, 0.5)';
const PICKER_TEXT = '#c8b9a0';
const GLYPH_COLOR = '#e8c97a';

function GlyphSwatch({ glyph }: { glyph: MarkerGlyph }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 16 * dpr;
    canvas.height = 16 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 16, 16);
    paintMarkerGlyph(ctx, glyph, 8, 8, 6, GLYPH_COLOR, PICKER_BG);
  }, [glyph]);
  return <canvas ref={ref} style={{ width: 16, height: 16 }} />;
}

export interface MarkerPickerProps<T extends string> {
  /** Viewport coords (portal, fixed positioning) */
  x: number;
  y: number;
  title: string;
  options: { type: T; label: string }[];
  /** The value currently set ('none', null = auto, or a type) */
  current: T | 'none' | null;
  /** null = back to auto-detection, 'none' = no icon */
  onPick: (value: T | 'none' | null) => void;
  onClose: () => void;
}

export function MarkerPicker<T extends string>({
  x,
  y,
  title,
  options,
  current,
  onPick,
  onClose,
}: MarkerPickerProps<T>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const width = 148;
  const height = options.length * 24 + 76;
  const tx = x + width + 12 > window.innerWidth ? x - width - 4 : x + 4;
  const ty =
    y + height + 12 > window.innerHeight ? Math.max(8, window.innerHeight - height - 8) : y + 4;

  const row = (
    key: string,
    label: string,
    value: T | 'none' | null,
    swatch: React.ReactNode,
    selected: boolean
  ) => (
    <button
      key={key}
      onClick={() => {
        onPick(value);
        onClose();
      }}
      className="w-full flex items-center gap-2 px-2 py-[3px] text-[10px] font-mono text-left rounded hover:bg-white/10 cursor-pointer"
      style={{ color: selected ? GLYPH_COLOR : PICKER_TEXT }}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0">{swatch}</span>
      {label}
      {selected && <span className="ml-auto opacity-60">✓</span>}
    </button>
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-[10001]" onClick={onClose} onContextMenu={onClose} />
      <div
        className="fixed z-[10002] rounded px-1.5 py-1.5"
        style={{
          left: tx,
          top: ty,
          width,
          background: PICKER_BG,
          border: `1px solid ${PICKER_BORDER}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        <div
          className="text-[9px] font-semibold uppercase tracking-wider opacity-50 px-2 pb-1"
          style={{ color: PICKER_TEXT }}
        >
          {title}
        </div>
        {options.map((o) =>
          row(
            o.type,
            o.label,
            o.type,
            <GlyphSwatch glyph={o.type as MarkerGlyph} />,
            current === o.type
          )
        )}
        <div className="h-px my-1" style={{ background: PICKER_BORDER }} />
        {row(
          '__auto',
          'Auto-detect',
          null,
          <span className="text-[9px] opacity-60">◈</span>,
          false
        )}
        {row(
          '__none',
          'No icon',
          'none',
          <span className="text-[9px] opacity-60">✕</span>,
          current === 'none'
        )}
      </div>
    </>,
    document.body
  );
}
