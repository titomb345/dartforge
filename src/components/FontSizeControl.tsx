export function FontSizeControl({
  value,
  onChange,
  min = 8,
  max = 18,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
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
    </div>
  );
}
