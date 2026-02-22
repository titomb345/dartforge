import { useState, useRef, useEffect, useCallback } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';
import {
  ALL_SYSTEMS,
  parseCoins,
  toBase,
  convertFromBase,
  type CoinBreakdown,
} from '../lib/currency';

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
        <span
          key={denom.abbr}
          className="text-[11px] font-mono whitespace-nowrap"
          title={count === 1 ? denom.name : denom.plural}
        >
          <span style={{ color: METAL_COLORS[denom.metal] }}>{count}</span>
          <span className="text-text-dim ml-0.5">{denom.abbr}</span>
        </span>
      ))}
    </div>
  );
}

export function CurrencyPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const [input, setInput] = useState('1 Su');
  const [result, setResult] = useState<{ totalBase: number; breakdowns: CoinBreakdown[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.select();
  }, []);

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

  const denomOptions = ALL_SYSTEMS.map((sys) => ({
    system: sys,
    denoms: sys.denominations.map((d) => d),
  }));

  return (
    <div className={panelRootClass(isPinned)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading">Currency Converter</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {isPinned ? <PinnedControls /> : <PinMenuButton panel="currency" />}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Freeform input */}
        <div className="px-3 py-2.5">
          <label className="block text-[9px] text-text-dim uppercase tracking-wide mb-1">
            Coins <span className="normal-case opacity-60">— abbr or full names, e.g. 3Ri, 3 rials, 1,000 gold suns</span>
          </label>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="3 rials 5dn, 1,000 gold suns"
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
          <div className="text-[9px] text-text-dim uppercase tracking-wide mb-1">
            Denominations <span className="normal-case opacity-50">— hover for full names</span>
          </div>
          <div className="space-y-0.5">
            {denomOptions.map(({ system, denoms }) => (
              <div key={system.id} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-text-dim w-[72px] shrink-0">{system.name}</span>
                <span className="font-mono text-text-label">
                  {denoms.map((d, i) => (
                    <span key={d.abbr}>
                      {i > 0 && <span className="text-text-dim opacity-40"> · </span>}
                      <span title={d.name} style={{ color: METAL_COLORS[d.metal] }}>{d.abbr}</span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
