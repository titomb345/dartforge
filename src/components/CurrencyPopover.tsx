import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ALL_SYSTEMS,
  findDenomination,
  convert,
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
  const [amount, setAmount] = useState('1');
  const [denomInput, setDenomInput] = useState('Su');
  const [result, setResult] = useState<{ source: CoinBreakdown; targets: CoinBreakdown[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the click that opened the popover from closing it
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [open, onClose]);

  // Focus amount input on open
  useEffect(() => {
    if (open) amountRef.current?.select();
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
    const num = parseFloat(amount);
    if (!num || num <= 0 || !isFinite(num)) {
      setError('Enter a valid amount');
      setResult(null);
      return;
    }
    const found = findDenomination(denomInput);
    if (!found) {
      setError(`Unknown: "${denomInput}"`);
      setResult(null);
      return;
    }
    setError(null);
    setResult(convert(num, found.denom, found.system));
  }, [amount, denomInput]);

  // Auto-convert on input change
  useEffect(() => {
    if (amount && denomInput) doConvert();
  }, [amount, denomInput, doConvert]);

  if (!open) return null;

  // Collect all denomination abbreviations grouped by system for the helper
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

      {/* Input row */}
      <div className="px-3 py-2.5 flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[9px] text-text-dim uppercase tracking-wide mb-1">Amount</label>
          <input
            ref={amountRef}
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-bg-input border border-border-dim rounded px-2 py-1 text-[12px] font-mono text-text-primary focus:outline-none focus:border-[#cd7f32]/40 transition-colors"
          />
        </div>
        <div className="w-[100px]">
          <label className="block text-[9px] text-text-dim uppercase tracking-wide mb-1">Denomination</label>
          <input
            type="text"
            value={denomInput}
            onChange={(e) => setDenomInput(e.target.value)}
            placeholder="Su, Ri, st..."
            className="w-full bg-bg-input border border-border-dim rounded px-2 py-1 text-[12px] font-mono text-text-primary focus:outline-none focus:border-[#cd7f32]/40 transition-colors"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 pb-1 text-[10px] text-red">{error}</div>
      )}

      {/* Results */}
      {result && (
        <div className="px-3 pb-3">
          {/* Source breakdown */}
          {result.source.coins.length > 0 && (
            <div className="mb-2">
              <div className="text-[9px] text-text-dim uppercase tracking-wide mb-0.5">
                {result.source.system.name}
              </div>
              <BreakdownRow breakdown={result.source} />
              <div className="text-[9px] text-text-dim mt-0.5">
                = {result.source.totalBase.toLocaleString()} base units
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="h-px mb-2" style={{ background: 'linear-gradient(to right, rgba(205,127,50,0.2), transparent)' }} />

          {/* Target systems */}
          <div className="space-y-1.5">
            {result.targets.map((t) => (
              <div key={t.system.id}>
                <div className="text-[9px] text-text-dim uppercase tracking-wide mb-0.5">
                  {t.system.name}
                </div>
                <BreakdownRow breakdown={t} />
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
