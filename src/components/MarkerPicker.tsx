/**
 * MarkerPicker — the Shift+click popover for choosing a landmark marker
 * (hex map) or room icon (town map). Rendered through the shared
 * PopoverMenu (portal, backdrop, Escape, viewport clamping). Each option
 * shows its actual canvas glyph, so what you pick is exactly what the
 * map draws.
 */

import { useEffect, useRef } from 'react';
import { paintMarkerGlyph, MARKER_COLOR, type MarkerGlyph } from '../lib/mapMarkers';
import { PopoverMenu } from './PopoverMenu';

const PICKER_BG = 'rgba(20, 18, 16, 0.97)';
const PICKER_BORDER = 'rgba(140, 125, 100, 0.5)';
const PICKER_TEXT = '#c8b9a0';
const GLYPH_COLOR = MARKER_COLOR;

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
  // Selection is derived in one place: `current === value` also covers the
  // Auto row (both null) so an unclassified cell shows Auto as active.
  const row = (label: string, value: T | 'none' | null, swatch: React.ReactNode) => {
    const selected = current === value;
    return (
      <button
        key={value ?? '__auto'}
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
  };

  return (
    <PopoverMenu
      x={x}
      y={y}
      onClose={onClose}
      className="rounded px-1.5 py-1.5"
      style={{
        width: 148,
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
      {options.map((o) => row(o.label, o.type, <GlyphSwatch glyph={o.type as MarkerGlyph} />))}
      <div className="h-px my-1" style={{ background: PICKER_BORDER }} />
      {row('Auto-detect', null, <span className="text-[9px] opacity-60">◈</span>)}
      {row('No icon', 'none', <span className="text-[9px] opacity-60">✕</span>)}
    </PopoverMenu>
  );
}
