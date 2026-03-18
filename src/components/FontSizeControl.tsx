export function FontSizeControl({
  value,
  onChange,
  min = 8,
  max = 18,
  onReset,
  globalValue,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Called to clear the per-panel override and revert to the global panel font size. */
  onReset?: () => void;
  /** The global default font size — reset button only shows when value differs from this. */
  globalValue?: number;
}) {
  const showReset = onReset && globalValue !== undefined && value !== globalValue;

  return (
    <div className="flex items-center gap-0">
      <button
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        className="w-[18px] h-[18px] flex items-center justify-center rounded text-[10px] font-mono text-text-label hover:bg-bg-secondary/60 cursor-pointer disabled:text-text-dim/30 disabled:cursor-default transition-colors"
        title="Decrease font size"
      >
        -
      </button>
      <span className="text-[9px] font-mono text-text-label w-[16px] text-center tabular-nums">
        {value}
      </span>
      <button
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="w-[18px] h-[18px] flex items-center justify-center rounded text-[10px] font-mono text-text-label hover:bg-bg-secondary/60 cursor-pointer disabled:text-text-dim/30 disabled:cursor-default transition-colors"
        title="Increase font size"
      >
        +
      </button>
      {showReset && (
        <button
          onClick={onReset}
          className="w-[18px] h-[18px] flex items-center justify-center rounded text-text-dim hover:text-cyan hover:bg-bg-secondary/60 cursor-pointer transition-colors ml-0.5"
          title="Reset to global panel font size"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H6.5L1 8l5.5 5H14a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
            <line x1="11" y1="6" x2="8" y2="10" />
            <line x1="8" y1="6" x2="11" y2="10" />
          </svg>
        </button>
      )}
    </div>
  );
}
