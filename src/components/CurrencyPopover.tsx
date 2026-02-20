import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ALL_SYSTEMS,
  parseCoins,
  toBase,
  convertFromBase,
  type CoinBreakdown,
} from '../lib/currency';

interface CurrencyPopoverProps {
  open: boolean;
  onClose: () => void;
}

const METAL_COLORS: Record<string, string> = {
  copper: '#cd7f32',
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#ffd700',
};

function BreakdownRow({ breakdown }: { breakdown: CoinBreakdown }) {
  if (breakdown.coins.length === 0) {
    return <div className="text-[10px] text-text-dim italic">less than 1 of smallest coin</div>;
  }
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      {breakdown.coins.map(({ denom, count }) => (
        <span key={denom.abbr} className="text-[11px] font-mono whitespace-nowrap">
          <span style={{ color: METAL_COLORS[denom.metal] }}>{count}</span>
          <span className="text-text-dim ml-0.5">{denom.abbr}</span>
        </span>
      ))}
    </div>
  );
}

export function CurrencyPopover({ open, onClose }: CurrencyPopoverProps) {
  const [input, setInput] = useState('1 Su');
  const [result, setResult] = useState<{ totalBase: number; breakdowns: CoinBreakdown[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [open, onClose]);

  // Focus input on open
  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const doConvert = useCallback(() => {
    if (!input.trim()) {
      setError(null);
      setResult(null);
      return;
    }
    const parsed = parseCoins(input);
    if (typeof parsed === 'string') {
      setError(parsed);
      setResult(null);
      return;
    }
    const totalBase = parsed.reduce((sum, e) => sum + toBase(e.amount, e.denom), 0);
    const breakdowns = convertFromBase(totalBase);
    setError(null);
    setResult({ totalBase, breakdowns });
  }, [input]);

  // Auto-convert on input change
  useEffect(() => {
    doConvert();
  }, [doConvert]);

  if (!open) return null;

  const denomOptions = ALL_SYSTEMS.map((sys) => ({
    system: sys,
    abbrs: sys.denominations.map((d) => d.abbr),
  }));

  return (
    <div
      ref={popoverRef}
      className="absolute top-full right-0 mt-1 z-[200] w-[320px] rounded-lg border border-border-subtle overflow-hidden"
      style={{
        background: 'linear-gradient(165deg, #1a1714 0%, #1c1917 40%, #171513 100%)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(205,127,50,0.08)',
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-border-subtle flex items-center gap-2"
        style={{ background: 'linear-gradient(to right, rgba(205,127,50,0.08), transparent)' }}
      >
        <span style={{ color: '#cd7f32', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>
          CURRENCY CONVERTER
        </span>
        <span className="text-[10px] text-text-dim ml-auto">
          #convert in terminal
        </span>
      </div>

      {/* Freeform input */}
      <div className="px-3 py-2.5">
        <label className="block text-[9px] text-text-dim uppercase tracking-wide mb-1">
          Coins <span className="normal-case opacity-60">— e.g. 3Ri 5dn, 1su2g50mn</span>
        </label>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="3Ri 5dn 100fs"
          className="w-full bg-bg-input border border-border-dim rounded px-2 py-1.5 text-[12px] font-mono text-text-primary focus:outline-none focus:border-[#cd7f32]/40 transition-colors"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 pb-1 text-[10px] text-red">{error}</div>
      )}

      {/* Results */}
      {result && (
        <div className="px-3 pb-3">
          <div className="text-[9px] text-text-dim mb-2">
            = {result.totalBase.toLocaleString()} base units
          </div>

          <div className="space-y-1.5">
            {result.breakdowns.map((bd) => (
              <div key={bd.system.id}>
                <div className="text-[9px] text-text-dim uppercase tracking-wide mb-0.5">
                  {bd.system.name}
                </div>
                <BreakdownRow breakdown={bd} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick reference */}
      <div
        className="px-3 py-2 border-t border-border-subtle"
        style={{ background: 'rgba(0,0,0,0.15)' }}
      >
        <div className="text-[9px] text-text-dim uppercase tracking-wide mb-1">Denominations</div>
        <div className="space-y-0.5">
          {denomOptions.map(({ system, abbrs }) => (
            <div key={system.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="text-text-dim w-[72px] shrink-0">{system.name}</span>
              <span className="font-mono text-text-label">{abbrs.join(' · ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
