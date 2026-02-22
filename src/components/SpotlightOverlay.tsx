import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSpotlight } from '../contexts/SpotlightContext';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const TOOLTIP_GAP = 12;
const TOOLTIP_MAX_W = 300;

function calculateTooltipStyle(
  rect: Rect,
  preferred?: 'above' | 'below' | 'left' | 'right',
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = rect.left + rect.width / 2;
  const spaceAbove = rect.top - PADDING;
  const spaceBelow = vh - (rect.top + rect.height + PADDING);

  // Determine placement
  let placement = preferred ?? 'below';
  if (placement === 'below' && spaceBelow < 120) placement = 'above';
  if (placement === 'above' && spaceAbove < 120) placement = 'below';

  // Clamp horizontal center so tooltip stays in viewport
  const tooltipLeft = Math.max(12, Math.min(cx - TOOLTIP_MAX_W / 2, vw - TOOLTIP_MAX_W - 12));

  if (placement === 'above') {
    return {
      left: tooltipLeft,
      bottom: vh - rect.top + PADDING + TOOLTIP_GAP,
    };
  }
  if (placement === 'below') {
    return {
      left: tooltipLeft,
      top: rect.top + rect.height + PADDING + TOOLTIP_GAP,
    };
  }
  if (placement === 'left') {
    return {
      right: vw - rect.left + PADDING + TOOLTIP_GAP,
      top: rect.top + rect.height / 2 - 30,
    };
  }
  // right
  return {
    left: rect.left + rect.width + PADDING + TOOLTIP_GAP,
    top: rect.top + rect.height / 2 - 30,
  };
}

export function SpotlightOverlay() {
  const { active, tourQueue, advanceTour, clear } = useSpotlight();
  const [rect, setRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);

  // Find and track target element position
  useEffect(() => {
    if (!active) {
      setRect(null);
      setVisible(false);
      return;
    }

    const el = document.querySelector(`[data-help-id="${active.helpId}"]`);
    if (!el) {
      setRect(null);
      setVisible(false);
      return;
    }

    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    // Small delay before showing to let panel close animation finish
    requestAnimationFrame(() => setVisible(true));

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active]);

  // Escape key to dismiss
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, clear]);

  const handleClick = useCallback(() => {
    if (tourQueue.length === 0) clear();
    else advanceTour();
  }, [tourQueue, advanceTour, clear]);

  if (!active || !rect) return null;

  const isLastStep = tourQueue.length === 0;
  const tooltipStyle = calculateTooltipStyle(rect, active.position);

  return createPortal(
    <div
      className={`spotlight-overlay ${visible ? 'spotlight-visible' : ''}`}
      onClick={handleClick}
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
    >
      {/* SVG mask overlay */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={rect.left - PADDING}
              y={rect.top - PADDING}
              width={rect.width + PADDING * 2}
              height={rect.height + PADDING * 2}
              rx="8"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.78)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Glow ring */}
      <div
        className="spotlight-ring"
        style={{
          position: 'absolute',
          left: rect.left - PADDING - 2,
          top: rect.top - PADDING - 2,
          width: rect.width + (PADDING + 2) * 2,
          height: rect.height + (PADDING + 2) * 2,
          borderRadius: 10,
          border: '2px solid rgba(217, 175, 80, 0.4)',
          pointerEvents: 'none',
        }}
      />

      {/* Tooltip */}
      <div
        className="spotlight-tooltip"
        style={{
          position: 'absolute',
          ...tooltipStyle,
          maxWidth: TOOLTIP_MAX_W,
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="rounded-lg p-3"
          style={{
            background: '#0d0d0d',
            border: '1px solid rgba(217, 175, 80, 0.3)',
            boxShadow: '0 0 30px rgba(217, 175, 80, 0.1), 0 4px 20px rgba(0,0,0,0.5)',
          }}
        >
          <p
            className="leading-relaxed"
            style={{ fontSize: 12, color: '#e0e0e0' }}
          >
            {active.tooltip}
          </p>
          <div className="flex items-center justify-between mt-2">
            <span style={{ fontSize: 10, color: '#666' }}>
              {tourQueue.length > 0 ? `${tourQueue.length} more` : ''}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleClick(); }}
              className="cursor-pointer transition-colors duration-150"
              style={{
                fontSize: 10,
                fontFamily: 'inherit',
                padding: '2px 8px',
                borderRadius: 4,
                color: '#d9af50',
                borderColor: 'rgba(217, 175, 80, 0.3)',
                border: '1px solid rgba(217, 175, 80, 0.3)',
                background: 'rgba(217, 175, 80, 0.08)',
              }}
            >
              {isLastStep ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
